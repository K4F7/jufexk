import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  CAMPUS_JWT_COOKIE,
  type CampusJwtClaims,
  campusJwtLive,
  issueCampusJwtCookie,
  readAuthBridgeCallbackToken,
  readCampusJwt,
  safeCampusReturnPath,
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
export const LOGIN_PATH = "/login";
export const LOGOUT_PATH = "/logout";
export const USER_SESSION_PATH = "/api/user/session";
export const USER_LOGOUT_PATH = "/api/user/logout";

/**
 * Campus JWT issued after JXUFE CAS, via Mine-JUFE/AuthBridge.
 * Public contract (no local AuthBridge source in this repo):
 * - login: GET {authbridge}/login?appid=…&mode=callback
 * - callback POST field: `token` (HS256, per-app key; optional AES/ECC wrap)
 * - verify on the Worker: signature, `exp`, `aud`, and a stable subject
 * - AuthBridge `sub` is ciphertext when `enc=aes`; decrypt then hash
 * - do not trust decode-only payload; do not log the raw token
 * AuthBridge callback stays closed until CAMPUS_JWT_ENABLED=1.
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

export type OrdinaryUserSession = {
  authenticated: boolean;
  csrfToken?: string;
  loginPath: string;
  logoutPath: string;
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

const guestSession = (): OrdinaryUserSession => ({
  authenticated: false,
  loginPath: LOGIN_PATH,
  logoutPath: LOGOUT_PATH,
});

const originOk = (c: Context) => {
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

function campusSecrets(env: {
  CAMPUS_JWT_SECRET?: string | { get(): Promise<string> };
  CAMPUS_JWT_AUD?: string;
  CAMPUS_JWT_AES_KEY?: string | { get(): Promise<string> };
  CAMPUS_IDENTITY_SECRET?: string | { get(): Promise<string> };
  CAMPUS_JWT_ENABLED?: string;
}) {
  return {
    jwtSecret: env.CAMPUS_JWT_SECRET,
    audience: typeof env.CAMPUS_JWT_AUD === "string" ? env.CAMPUS_JWT_AUD : "",
    aesKey: env.CAMPUS_JWT_AES_KEY,
    identitySecret: env.CAMPUS_IDENTITY_SECRET,
    enabled: campusJwtLive(env),
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

/**
 * Session boundary for ordinary-user writes.
 * Guests stay anonymous. Campus JWT or the signed test proof of a
 * `users.id` can authenticate; admin cookies, IP hashes and submitter
 * hashes never authenticate here.
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

export function clearOrdinaryUserCookies(c: Context) {
  deleteCookie(c, CAMPUS_JWT_COOKIE, { path: "/" });
  deleteCookie(c, ORDINARY_USER_CSRF_COOKIE, { path: "/" });
}

export function canOrdinaryUserWrite(user: OrdinaryUser) {
  return user.status === "active";
}

export async function ordinaryUserSessionPayload(
  c: Context,
): Promise<OrdinaryUserSession> {
  const user = await resolveOrdinaryUser(c);
  if (!user || !canOrdinaryUserWrite(user)) return guestSession();
  return {
    authenticated: true,
    csrfToken: issueOrdinaryUserCsrf(c, randomToken()),
    loginPath: LOGIN_PATH,
    logoutPath: LOGOUT_PATH,
  };
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
  reason: "not_whitelisted",
});

/**
 * AuthBridge demo-backend shape: POST form/JSON `token`, verify HS256,
 * then set an HttpOnly cookie on this origin and redirect. Closed until
 * CAMPUS_JWT_ENABLED=1; missing secrets stay 503.
 * @see https://github.com/Mine-JUFE/AuthBridge/blob/main/demo-backend/app.js
 */
export async function handleCampusAuthCallback(c: Context) {
  const token = await readAuthBridgeCallbackToken(c);
  const secrets = campusSecrets(c.env);
  const jwtSecret = await readSecret(secrets.jwtSecret);
  const identitySecret = await readSecret(secrets.identitySecret);
  const aesKey = await readSecret(secrets.aesKey);
  if (!secrets.enabled || !jwtSecret || !identitySecret || !aesKey) {
    return c.json(closedCampusCallback(), 503);
  }

  const fail = () => c.redirect(`${LOGIN_PATH}?error=campus`, 303);
  if (!token) return fail();
  const mapped = await mapCampusJwtToken(c.env, token);
  if (!mapped || !canOrdinaryUserWrite(mapped.user)) return fail();
  issueCampusJwtCookie(
    c,
    token,
    Math.max(1, mapped.claims.exp - Math.floor(Date.now() / 1000)),
  );
  return c.redirect(safeCampusReturnPath(c.req.query("from")), 303);
}
