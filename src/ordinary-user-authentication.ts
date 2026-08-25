import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  ensureUserPublicHandle,
  insertUserWithPublicHandle,
} from "./public-handle";
import { readSecret } from "./secrets";

export const ORDINARY_USER_ID_HEADER = "X-Jufexk-Ordinary-User";
export const ORDINARY_USER_MAC_HEADER = "X-Jufexk-Ordinary-User-Mac";
export const EMAIL_LOGIN_COOKIE = "jufexk_user_session";
export const ORDINARY_USER_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Used only when wrangler is HTTP-local and CAMPUS_IDENTITY_SECRET is unset. */
const LOCAL_DEV_IDENTITY_FALLBACK = "jufexk-local-dev-identity";

export type OrdinaryUserStatus =
  | "active"
  | "banned"
  | "pending_deletion"
  | "deleted";

export type OrdinaryUser = {
  id: string;
  status: OrdinaryUserStatus;
  muted_until?: number | null;
  pending_deletion_at?: string | null;
  public_code?: number | null;
  avatar_key?: number | null;
};

export type OrdinaryUserCredentialAdapter = (
  c: Context,
) => Promise<OrdinaryUser | null>;

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function hmacHex(value: string, secret: string) {
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

export async function ordinaryUserTestHeaders(userId: string, secret: string) {
  return {
    [ORDINARY_USER_ID_HEADER]: userId,
    [ORDINARY_USER_MAC_HEADER]: await hmacHex(userId, secret),
  };
}

const isStableUserId = (value: string) =>
  /^[A-Za-z0-9_-]{8,128}$/.test(value) && !value.includes("@");

const timingSafeEqualHex = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
};

const USER_SELECT = `SELECT id,status,muted_until,public_code,avatar_key,
       COALESCE(pending_deletion_at,deletion_requested_at) AS pending_deletion_at
     FROM users WHERE id=?`;

async function loadOrCreateUser(
  db: D1Database,
  userId: string,
): Promise<OrdinaryUser | null> {
  const existing = await db
    .prepare(USER_SELECT)
    .bind(userId)
    .first<OrdinaryUser>();
  if (existing) {
    const cleared = await clearExpiredMute(db, existing);
    return ensureUserPublicHandle(db, cleared);
  }
  const handle = await insertUserWithPublicHandle(db, userId);
  return { id: userId, status: "active", ...handle };
}

async function clearExpiredMute(db: D1Database, user: OrdinaryUser) {
  if (user.muted_until == null || user.muted_until > Date.now() / 1000) return user;
  await db
    .prepare(
      "UPDATE users SET muted_until=NULL WHERE id=? AND muted_until IS NOT NULL AND muted_until<=unixepoch()",
    )
    .bind(user.id)
    .run();
  return { ...user, muted_until: null };
}

export async function resolveTestHmacCredential(
  c: Context,
): Promise<OrdinaryUser | null> {
  const secret =
    typeof c.env.ORDINARY_USER_TEST_AUTH_SECRET === "string"
      ? c.env.ORDINARY_USER_TEST_AUTH_SECRET
      : "";
  if (!secret) return null;
  const userId = c.req.header(ORDINARY_USER_ID_HEADER) || "";
  const mac = c.req.header(ORDINARY_USER_MAC_HEADER) || "";
  if (!isStableUserId(userId) || !mac) return null;
  const expected = await hmacHex(userId, secret);
  if (!timingSafeEqualHex(expected, mac)) return null;
  const stableId = await hmacHex(`ordinary-test-user:${userId}`, secret);
  return loadOrCreateUser(c.env.DB, stableId);
}

/** Production reads CAMPUS_IDENTITY_SECRET; local wrangler may have the binding empty. */
export async function ordinaryUserIdentitySecret(c: Context): Promise<string> {
  const secret = await readSecret(
    (c.env as { CAMPUS_IDENTITY_SECRET?: Parameters<typeof readSecret>[0] })
      .CAMPUS_IDENTITY_SECRET,
  );
  if (secret) return secret;
  try {
    if (new URL(c.req.url).protocol === "http:") return LOCAL_DEV_IDENTITY_FALLBACK;
  } catch {
    /* ignore */
  }
  return "";
}

export async function issueOrdinaryUserSessionCookie(
  c: Context,
  userId: string,
  identitySecret: string,
) {
  const exp = Math.floor(Date.now() / 1000) + ORDINARY_USER_SESSION_TTL_SECONDS;
  const mac = await hmacHex(`email-session:v1:${userId}:${exp}`, identitySecret);
  const token = `v1.${userId}.${exp}.${mac}`;
  setCookie(c, EMAIL_LOGIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: ORDINARY_USER_SESSION_TTL_SECONDS,
  });
  return token;
}

export async function resolveOrdinaryUserSessionCredential(
  c: Context,
): Promise<OrdinaryUser | null> {
  const raw = getCookie(c, EMAIL_LOGIN_COOKIE) || "";
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, userId, expRaw, mac] = parts;
  const exp = Number(expRaw);
  if (!isStableUserId(userId) || !Number.isFinite(exp) || exp <= Date.now() / 1000) {
    return null;
  }
  const identitySecret = await ordinaryUserIdentitySecret(c);
  if (!identitySecret || !mac) return null;
  const expected = await hmacHex(`email-session:v1:${userId}:${exp}`, identitySecret);
  if (!timingSafeEqualHex(expected, mac)) return null;
  const db = c.env.DB as D1Database;
  return db
    .prepare(USER_SELECT)
    .bind(userId)
    .first<OrdinaryUser>()
    .then(async (user) => {
      if (!user) return null;
      return ensureUserPublicHandle(db, await clearExpiredMute(db, user));
    });
}

export function createOrdinaryUserResolver(
  adapters: readonly OrdinaryUserCredentialAdapter[],
): OrdinaryUserCredentialAdapter {
  return async (c) => {
    for (const adapter of adapters) {
      const user = await adapter(c);
      if (user) return user;
    }
    return null;
  };
}

/**
 * Session boundary for ordinary-user writes.
 * Guests stay anonymous. Test HMAC or the CAS/email session cookie can
 * authenticate; AuthBridge JWT, admin cookies, IP hashes and submitter
 * hashes never authenticate here.
 */
export const resolveOrdinaryUser = createOrdinaryUserResolver([
  resolveTestHmacCredential,
  resolveOrdinaryUserSessionCredential,
]);
