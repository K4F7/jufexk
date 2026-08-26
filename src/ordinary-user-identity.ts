import type { OrdinaryUser } from "./ordinary-user-authentication";
import {
  AVATAR_KEY_COUNT,
  PUBLIC_CODE_MAX,
  ensureUserPublicHandle,
} from "./public-handle";

export const AUTH_PROVIDER_EMAIL = "email";
export const AUTH_PROVIDER_CAS = "cas";
export const EMAIL_IDENTITY_ISSUER = "stu.jxufe.edu.cn";
export const CAS_IDENTITY_ISSUER = "ssl.jxufe.edu.cn";

const newUserId = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

async function lookupIdentityUser(
  db: D1Database,
  input: { provider: string; issuer: string; subject: string },
) {
  return identityUserStatement(db, input).first<OrdinaryUser>();
}

function identityUserStatement(
  db: D1Database,
  input: { provider: string; issuer: string; subject: string },
) {
  return db
    .prepare(
      `SELECT users.id, users.status, users.muted_until, users.public_code, users.avatar_key,
              COALESCE(users.pending_deletion_at, users.deletion_requested_at) AS pending_deletion_at
       FROM auth_identities
       JOIN users ON users.id = auth_identities.user_id
       WHERE auth_identities.provider=? AND auth_identities.issuer=? AND auth_identities.subject=?`,
    )
    .bind(input.provider, input.issuer, input.subject);
}

export async function resolveOrCreateIdentityUser(
  db: D1Database,
  input: { provider: string; issuer: string; subject: string },
): Promise<OrdinaryUser | null> {
  const existing = await lookupIdentityUser(db, input);
  if (existing) {
    if (existing.public_code != null && existing.public_code >= 1) return existing;
    return ensureUserPublicHandle(db, existing);
  }

  const userId = newUserId();
  // Occupy the identity slot first. A lost race must not insert an orphan
  // users row; the winner's user_id is filled only after the slot is taken.
  const results = await db.batch<OrdinaryUser>([
    db
      .prepare(
        `INSERT OR IGNORE INTO auth_identities(provider,issuer,subject,user_id)
         VALUES(?,?,?,?)`,
      )
      .bind(input.provider, input.issuer, input.subject, userId),
    db.prepare(
      `UPDATE user_public_code_seq SET next_code = next_code + 1
       WHERE id = 1 AND next_code <= ${PUBLIC_CODE_MAX}`,
    ),
    db
      .prepare(
        `INSERT OR IGNORE INTO users(id,status,public_code,avatar_key)
         SELECT user_id, 'active',
           (SELECT next_code - 1 FROM user_public_code_seq WHERE id=1),
           (SELECT (next_code - 1) % ${AVATAR_KEY_COUNT} FROM user_public_code_seq WHERE id=1)
         FROM auth_identities
         WHERE provider=? AND issuer=? AND subject=? AND user_id=?
           AND changes()=1`,
      )
      .bind(input.provider, input.issuer, input.subject, userId),
    identityUserStatement(db, input),
  ]);
  const created = results[3]?.results[0] || null;
  return created ? ensureUserPublicHandle(db, created) : null;
}
