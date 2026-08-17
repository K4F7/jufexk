import {
  decryptAuthBridgeAesSubject,
  type CampusJwtClaims,
} from "./campus-jwt";
import type { OrdinaryUser } from "./ordinary-user-session";

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

async function hmacHex(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export const AUTH_PROVIDER_AUTHBRIDGE = "authbridge";

const newUserId = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export async function campusIdentitySubject(
  claims: CampusJwtClaims,
  secrets: { identitySecret: string; aesKeyHex?: string },
): Promise<string | null> {
  if (!secrets.identitySecret) return null;
  if (claims.enc === "ecc") return null;
  if (claims.enc === "aes") {
    const campusHandle = await decryptAuthBridgeAesSubject(
      claims,
      secrets.aesKeyHex || "",
    );
    if (!campusHandle) return null;
    return hmacHex(`campus-handle:${campusHandle}`, secrets.identitySecret);
  }
  if (claims.enc) return null;
  return hmacHex(`campus-sub:${claims.sub}`, secrets.identitySecret);
}

export async function resolveOrCreateIdentityUser(
  db: D1Database,
  input: { provider: string; issuer: string; subject: string },
): Promise<OrdinaryUser | null> {
  const existing = await db
    .prepare(
      `SELECT users.id, users.status
       FROM auth_identities
       JOIN users ON users.id = auth_identities.user_id
       WHERE auth_identities.provider=? AND auth_identities.issuer=? AND auth_identities.subject=?`,
    )
    .bind(input.provider, input.issuer, input.subject)
    .first<OrdinaryUser>();
  if (existing) return existing;

  const userId = newUserId();
  await db
    .prepare("INSERT INTO users(id,status) VALUES(?,?)")
    .bind(userId, "active")
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO auth_identities(provider,issuer,subject,user_id)
       VALUES(?,?,?,?)`,
    )
    .bind(input.provider, input.issuer, input.subject, userId)
    .run();
  return db
    .prepare(
      `SELECT users.id, users.status
       FROM auth_identities
       JOIN users ON users.id = auth_identities.user_id
       WHERE auth_identities.provider=? AND auth_identities.issuer=? AND auth_identities.subject=?`,
    )
    .bind(input.provider, input.issuer, input.subject)
    .first<OrdinaryUser>();
}
