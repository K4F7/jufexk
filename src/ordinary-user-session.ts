import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { readCampusJwt } from "./campus-jwt";

export const ORDINARY_USER_CSRF_COOKIE = "jufexk_user_csrf";
export const ORDINARY_USER_ID_HEADER = "X-Jufexk-Ordinary-User";
export const ORDINARY_USER_MAC_HEADER = "X-Jufexk-Ordinary-User-Mac";
export const LOGIN_PATH = "/login";
export const LOGOUT_PATH = "/logout";

/**
 * Campus JWT issued after JXUFE CAS, via Mine-JUFE/AuthBridge.
 * Public contract (no local AuthBridge source in this repo):
 * - login: GET {authbridge}/login?appid=…&mode=callback
 * - callback POST field: `token` (HS256, per-app key; optional AES/ECC wrap)
 * - verify on the Worker: signature, `exp`, `aud`, and a stable `sub`
 * - do not trust decode-only payload; do not log the raw token
 * Production verifier stays closed until this app is on the AuthBridge whitelist.
 * @see https://github.com/Mine-JUFE/AuthBridge
 */
export type OrdinaryUserStatus =
  | "active"
  | "banned"
  | "pending_deletion"
  | "deleted";

export type OrdinaryUser = {
  id: string;
  status: OrdinaryUserStatus;
};

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

async function loadOrCreateUser(
  db: D1Database,
  userId: string,
): Promise<OrdinaryUser | null> {
  const existing = await db
    .prepare("SELECT id,status FROM users WHERE id=?")
    .bind(userId)
    .first<OrdinaryUser>();
  if (existing) return existing;
  await db
    .prepare("INSERT INTO users(id,status) VALUES(?,?)")
    .bind(userId, "active")
    .run();
  return { id: userId, status: "active" };
}

/**
 * Campus JWT stays closed until AuthBridge whitelists this app.
 * Always returns null so an unverified token cannot mint an ordinary user.
 */
export async function resolveCampusJwt(
  c: Context,
): Promise<OrdinaryUser | null> {
  void readCampusJwt(c);
  return null;
}

/**
 * Session boundary for ordinary-user writes.
 * Production accepts a campus AuthBridge JWT once the verifier is wired.
 * Until then this resolver only accepts a signed test proof of `users.id`
 * when the test secret is bound. Admin cookies, IP hashes and submitter
 * hashes never authenticate here. Email OTP / Access are not used.
 */
export async function resolveOrdinaryUser(
  c: Context,
): Promise<OrdinaryUser | null> {
  const campusUser = await resolveCampusJwt(c);
  if (campusUser) return campusUser;
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

export function ordinaryUserCsrfOk(c: Context) {
  const header = c.req.header("X-CSRF-Token");
  const cookie = getCookie(c, ORDINARY_USER_CSRF_COOKIE);
  return !!header && header === cookie;
}

export function issueOrdinaryUserCsrf(c: Context, token: string) {
  const existing = getCookie(c, ORDINARY_USER_CSRF_COOKIE);
  const csrf = existing || token;
  if (!existing) {
    setCookie(c, ORDINARY_USER_CSRF_COOKIE, csrf, {
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 86400,
    });
  }
  return csrf;
}

export function canOrdinaryUserWrite(user: OrdinaryUser) {
  return user.status === "active";
}
