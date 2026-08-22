import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  CAMPUS_JWT_COOKIE,
  type CampusJwtClaims,
  readCampusJwt,
  verifyCampusJwtHs256,
} from "./campus-jwt";
import {
  AUTH_PROVIDER_AUTHBRIDGE,
  campusIdentitySubject,
  resolveOrCreateIdentityUser,
} from "./ordinary-user-identity";
import { readSecret } from "./secrets";

export const ORDINARY_USER_CSRF_COOKIE = "jufexk_user_csrf";
export const ORDINARY_USER_ID_HEADER = "X-Jufexk-Ordinary-User";
export const ORDINARY_USER_MAC_HEADER = "X-Jufexk-Ordinary-User-Mac";
export const EMAIL_LOGIN_COOKIE = "jufexk_user_session";
export const LOGIN_PATH = "/login";
export const LOGOUT_PATH = "/logout";
export const USER_SESSION_PATH = "/api/user/session";
export const USER_LOGOUT_PATH = "/api/user/logout";
const EMAIL_SESSION_TTL_SECONDS = 86400;

/**
 * Campus JWT issued after JXUFE CAS, via Mine-JUFE/AuthBridge.
 * Public contract (no local AuthBridge source in this repo):
 * - login: GET {authbridge}/login?appid=…&mode=callback
 * - callback POST field: `token` (HS256, per-app key; optional AES/ECC wrap)
 * - verify on the Worker: signature, `exp`, `aud`, and a stable subject
 * - AuthBridge `sub` is ciphertext when `enc=aes`; decrypt then hash
 * - do not trust decode-only payload; do not log the raw token
 * AuthBridge login is abandoned; leftover JWT cookies may still resolve.
 */
export type OrdinaryUserStatus =
  | "active"
  | "banned"
  | "pending_deletion"
  | "deleted";

export type OrdinaryUser = {
  id: string;
  status: OrdinaryUserStatus;
  pending_deletion_at?: string | null;
};

export type OrdinaryUserSession = {
  authenticated: boolean;
  accountStatus?: "pending_deletion";
  restoreUntil?: string;
  csrfToken?: string;
  loginPath: string;
  logoutPath: string;
};

const ACCOUNT_DELETION_RECOVERY_DAYS = 30;

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

const guestSession = (): OrdinaryUserSession => ({
  authenticated: false,
  loginPath: LOGIN_PATH,
  logoutPath: LOGOUT_PATH,
});

export const originOk = (c: Context) => {
  const origin = c.req.header("Origin");
  return origin === new URL(c.req.url).origin;
};

const randomToken = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

async function loadOrCreateUser(
  db: D1Database,
  userId: string,
): Promise<OrdinaryUser | null> {
  const existing = await db
    .prepare(
      "SELECT id,status,COALESCE(pending_deletion_at,deletion_requested_at) AS pending_deletion_at FROM users WHERE id=?",
    )
    .bind(userId)
    .first<OrdinaryUser>();
  if (existing) return existing;
  await db
    .prepare("INSERT INTO users(id,status) VALUES(?,?)")
    .bind(userId, "active")
    .run();
  return { id: userId, status: "active" };
}

function campusSecrets(env: {
  CAMPUS_JWT_SECRET?: string | { get(): Promise<string> };
  CAMPUS_JWT_AUD?: string;
  CAMPUS_JWT_AES_KEY?: string | { get(): Promise<string> };
  CAMPUS_IDENTITY_SECRET?: string | { get(): Promise<string> };
}) {
  return {
    jwtSecret: env.CAMPUS_JWT_SECRET,
    audience: typeof env.CAMPUS_JWT_AUD === "string" ? env.CAMPUS_JWT_AUD : "",
    aesKey: env.CAMPUS_JWT_AES_KEY,
    identitySecret: env.CAMPUS_IDENTITY_SECRET,
  };
}

async function mapCampusJwtToken(
  env: Parameters<typeof campusSecrets>[0] & { DB: D1Database },
  token: string,
): Promise<{ user: OrdinaryUser; claims: CampusJwtClaims } | null> {
  const secrets = campusSecrets(env);
  const jwtSecret = await readSecret(secrets.jwtSecret);
  const identitySecret = await readSecret(secrets.identitySecret);
  if (!jwtSecret || !identitySecret || !secrets.audience) return null;
  const claims = await verifyCampusJwtHs256(token, jwtSecret, secrets.audience);
  if (!claims) return null;
  const subject = await campusIdentitySubject(claims, {
    identitySecret,
    aesKeyHex: await readSecret(secrets.aesKey),
  });
  if (!subject) return null;
  const user = await resolveOrCreateIdentityUser(env.DB, {
    provider: AUTH_PROVIDER_AUTHBRIDGE,
    issuer: claims.aud || secrets.audience || AUTH_PROVIDER_AUTHBRIDGE,
    subject,
  });
  return user ? { user, claims } : null;
}

/**
 * Verify a campus AuthBridge JWT and map it to a stable users.id.
 * Encrypted `sub` is decrypted then hashed; raw campus handles never persist.
 * Missing secrets, bad signatures, and `enc=ecc` fail closed.
 */
export async function resolveCampusJwt(
  c: Context,
): Promise<OrdinaryUser | null> {
  const token = readCampusJwt(c);
  if (!token) return null;
  const mapped = await mapCampusJwtToken(c.env, token);
  return mapped?.user ?? null;
}

async function resolveTestHmacUser(c: Context): Promise<OrdinaryUser | null> {
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

export async function issueEmailSessionCookie(
  c: Context,
  userId: string,
  identitySecret: string,
) {
  const exp = Math.floor(Date.now() / 1000) + EMAIL_SESSION_TTL_SECONDS;
  const mac = await hmacHex(`email-session:v1:${userId}:${exp}`, identitySecret);
  setCookie(c, EMAIL_LOGIN_COOKIE, `v1.${userId}.${exp}.${mac}`, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: EMAIL_SESSION_TTL_SECONDS,
  });
}

async function resolveEmailSessionUser(c: Context): Promise<OrdinaryUser | null> {
  const raw = getCookie(c, EMAIL_LOGIN_COOKIE) || "";
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, userId, expRaw, mac] = parts;
  const exp = Number(expRaw);
  if (!isStableUserId(userId) || !Number.isFinite(exp) || exp <= Date.now() / 1000) {
    return null;
  }
  const identitySecret = await readSecret(c.env.CAMPUS_IDENTITY_SECRET);
  if (!identitySecret || !mac) return null;
  const expected = await hmacHex(`email-session:v1:${userId}:${exp}`, identitySecret);
  if (!timingSafeEqualHex(expected, mac)) return null;
  const db = c.env.DB as D1Database;
  return db
    .prepare(
      "SELECT id,status,COALESCE(pending_deletion_at,deletion_requested_at) AS pending_deletion_at FROM users WHERE id=?",
    )
    .bind(userId)
    .first<OrdinaryUser>();
}

/**
 * Session boundary for ordinary-user writes.
 * Guests stay anonymous. Test HMAC, the email session cookie, or campus JWT
 * can authenticate; admin cookies, IP hashes and submitter hashes never
 * authenticate here.
 */
export async function resolveOrdinaryUser(
  c: Context,
): Promise<OrdinaryUser | null> {
  const hmacUser = await resolveTestHmacUser(c);
  if (hmacUser) return hmacUser;
  const emailUser = await resolveEmailSessionUser(c);
  if (emailUser) return emailUser;
  return resolveCampusJwt(c);
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

export function clearOrdinaryUserCookies(c: Context) {
  deleteCookie(c, CAMPUS_JWT_COOKIE, { path: "/" });
  deleteCookie(c, EMAIL_LOGIN_COOKIE, { path: "/" });
  deleteCookie(c, ORDINARY_USER_CSRF_COOKIE, { path: "/" });
}

export function canOrdinaryUserWrite(user: OrdinaryUser) {
  return user.status === "active";
}

/**
 * Shared write gate for ordinary-user mutations (reviews, catalog requests,
 * endorsements). Guests 401; banned / pending_deletion / deleted 403; origin
 * and CSRF must both pass. Call this before any INSERT, including honeypot
 * short-circuits so anonymous bots cannot get a fake ok.
 */
export async function requireOrdinaryWriteUser(
  c: Context,
  loginError: string,
  forbiddenError: string,
): Promise<{ user: OrdinaryUser } | { error: Response }> {
  const user = await resolveOrdinaryUser(c);
  if (!user) return { error: c.json({ error: loginError }, 401) };
  if (!canOrdinaryUserWrite(user))
    return { error: c.json({ error: forbiddenError }, 403) };
  if (!originOk(c) || !ordinaryUserCsrfOk(c))
    return { error: c.json({ error: "安全校验失败，请刷新后重试" }, 403) };
  return { user };
}

function restoreUntilFrom(pendingDeletionAt: string | null | undefined) {
  const start = pendingDeletionAt ? Date.parse(pendingDeletionAt) : Number.NaN;
  const from = Number.isFinite(start) ? start : Date.now();
  return new Date(
    from + ACCOUNT_DELETION_RECOVERY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function pendingDeletionSession(
  c: Context,
  pendingDeletionAt: string | null | undefined,
): OrdinaryUserSession {
  return {
    authenticated: false,
    accountStatus: "pending_deletion",
    restoreUntil: restoreUntilFrom(pendingDeletionAt),
    csrfToken: issueOrdinaryUserCsrf(c, randomToken()),
    loginPath: LOGIN_PATH,
    logoutPath: LOGOUT_PATH,
  };
}

export function sessionPayloadForUser(
  c: Context,
  user: OrdinaryUser | null,
): OrdinaryUserSession {
  if (user?.status === "pending_deletion") {
    return pendingDeletionSession(c, user.pending_deletion_at);
  }
  if (!user || !canOrdinaryUserWrite(user)) return guestSession();
  return {
    authenticated: true,
    csrfToken: issueOrdinaryUserCsrf(c, randomToken()),
    loginPath: LOGIN_PATH,
    logoutPath: LOGOUT_PATH,
  };
}

export async function ordinaryUserSessionPayload(
  c: Context,
): Promise<OrdinaryUserSession> {
  return sessionPayloadForUser(c, await resolveOrdinaryUser(c));
}

export async function handleOrdinaryUserSession(c: Context) {
  return c.json(await ordinaryUserSessionPayload(c));
}

export async function handleOrdinaryUserLogout(c: Context) {
  const user = await resolveOrdinaryUser(c);
  if (
    user &&
    canOrdinaryUserWrite(user) &&
    (!originOk(c) || !ordinaryUserCsrfOk(c))
  ) {
    return c.json({ error: "安全校验失败，请刷新后重试" }, 403);
  }
  clearOrdinaryUserCookies(c);
  return c.json({ ok: true, ...guestSession() });
}

const closedCampusCallback = () => ({
  error: "普通用户认证尚未开放接入",
  reason: "abandoned",
});

/**
 * Abandoned AuthBridge callback. Campus login is jufe_cas password proxy.
 * Always 503, including when CAMPUS_JWT_ENABLED=1 is set by mistake.
 */
export async function handleCampusAuthCallback(c: Context) {
  return c.json(closedCampusCallback(), 503);
}
