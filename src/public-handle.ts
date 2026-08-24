/**
 * 公开编号 helpers (#493).
 * 0 / #000000 is reserved for unattributed reviews and is never stored on users.
 * Real users get sequential integers starting at 1, displayed zero-padded.
 */

export const RESERVED_PUBLIC_CODE = 0;
export const FIRST_USER_PUBLIC_CODE = 1;
export const PUBLIC_CODE_MAX = 999999;
export const AVATAR_KEY_COUNT = 5;

export type PublicHandleFields = {
  public_code: number;
  avatar_key: number;
};

export function formatPublicCode(code: number): string {
  return String(code).padStart(6, "0");
}

export function formatPublicHandle(code: number): string {
  return `匿名用户#${formatPublicCode(code)}`;
}

export function parsePublicCodeParam(value: string | undefined): number | null {
  if (!value || !/^\d{1,6}$/.test(value)) return null;
  const code = Number(value);
  if (!Number.isInteger(code) || code < 0 || code > PUBLIC_CODE_MAX) return null;
  return code;
}

export function defaultAvatarKey(publicCode: number): number {
  return ((publicCode % AVATAR_KEY_COUNT) + AVATAR_KEY_COUNT) % AVATAR_KEY_COUNT;
}

export function publicAuthorFields(row: {
  author_public_code?: number | null;
  author_avatar_key?: number | null;
}): {
  author_public_code: number;
  author_avatar_key: number;
} {
  const code =
    row.author_public_code == null
      ? RESERVED_PUBLIC_CODE
      : Number(row.author_public_code);
  const avatarKey =
    row.author_avatar_key == null
      ? defaultAvatarKey(code)
      : Number(row.author_avatar_key);
  return {
    author_public_code: Number.isInteger(code) ? code : RESERVED_PUBLIC_CODE,
    author_avatar_key: Number.isInteger(avatarKey)
      ? defaultAvatarKey(avatarKey)
      : defaultAvatarKey(code),
  };
}

export async function takeNextPublicCode(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `UPDATE user_public_code_seq
       SET next_code = next_code + 1
       WHERE id = 1 AND next_code <= ${PUBLIC_CODE_MAX}
       RETURNING next_code - 1 AS public_code`,
    )
    .first<{ public_code: number }>();
  if (!row) throw new Error("public code sequence exhausted");
  const code = Number(row.public_code);
  if (!Number.isInteger(code) || code < FIRST_USER_PUBLIC_CODE) {
    throw new Error("public code sequence missing");
  }
  if (code > PUBLIC_CODE_MAX) {
    throw new Error("public code sequence exhausted");
  }
  return code;
}

function isUniqueConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE|constraint/i.test(message);
}

export async function assignPublicHandle(
  db: D1Database,
  userId: string,
): Promise<PublicHandleFields> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const public_code = await takeNextPublicCode(db);
    const avatar_key = defaultAvatarKey(public_code);
    const result = await db
      .prepare(
        `UPDATE users
         SET public_code=?, avatar_key=COALESCE(avatar_key, ?)
         WHERE id=? AND public_code IS NULL`,
      )
      .bind(public_code, avatar_key, userId)
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      const stored = await db
        .prepare("SELECT public_code,avatar_key FROM users WHERE id=?")
        .bind(userId)
        .first<PublicHandleFields>();
      if (stored?.public_code != null && stored.avatar_key != null) return stored;
    }
    const existing = await db
      .prepare("SELECT public_code,avatar_key FROM users WHERE id=?")
      .bind(userId)
      .first<PublicHandleFields>();
    if (existing?.public_code != null && existing.avatar_key != null) {
      return existing;
    }
  }
  throw new Error("failed to assign public handle");
}

export async function insertUserWithPublicHandle(
  db: D1Database,
  userId: string,
): Promise<PublicHandleFields> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const public_code = await takeNextPublicCode(db);
    const avatar_key = defaultAvatarKey(public_code);
    try {
      await db
        .prepare(
          "INSERT INTO users(id,status,public_code,avatar_key) VALUES(?,?,?,?)",
        )
        .bind(userId, "active", public_code, avatar_key)
        .run();
      return { public_code, avatar_key };
    } catch (error) {
      const existing = await db
        .prepare("SELECT public_code,avatar_key FROM users WHERE id=?")
        .bind(userId)
        .first<PublicHandleFields>();
      if (existing?.public_code != null && existing.avatar_key != null) {
        return existing;
      }
      if (existing && existing.public_code == null) {
        return assignPublicHandle(db, userId);
      }
      if (isUniqueConstraintError(error)) continue;
      throw error;
    }
  }
  throw new Error("failed to create user public handle");
}

export async function ensureUserPublicHandle<
  T extends { id: string; public_code?: number | null; avatar_key?: number | null },
>(db: D1Database, user: T): Promise<T & PublicHandleFields> {
  if (
    user.public_code != null &&
    user.public_code >= FIRST_USER_PUBLIC_CODE &&
    user.avatar_key != null
  ) {
    return user as T & PublicHandleFields;
  }
  const assigned = await assignPublicHandle(db, user.id);
  return { ...user, ...assigned };
}

/** SQL fragments: unattributed rows emit reserved 0; authored rows join users. */
export const reservedAuthorSql = "0 author_public_code, 0 author_avatar_key";
export const authoredReviewJoinSql = "LEFT JOIN users author_user ON author_user.id=r.author_user_id";
export const authoredReviewAuthorSql = `
    CASE WHEN r.author_user_id IS NULL THEN 0 ELSE author_user.public_code END author_public_code,
    CASE WHEN r.author_user_id IS NULL THEN 0 ELSE COALESCE(author_user.avatar_key, 0) END author_avatar_key`;
