import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { CAMPUS_JWT_COOKIE } from "./campus-jwt";
import {
  ensureUserPublicHandle,
  insertUserWithPublicHandle,
} from "./public-handle";
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
/** Used only when wrangler is HTTP-local and CAMPUS_IDENTITY_SECRET is unset. */
const LOCAL_DEV_IDENTITY_FALLBACK = "jufexk-local-dev-identity";

/**
 * Ordinary-user session types. Campus login is CAS password proxy.
 * AuthBridge JWT is abandoned and does not authenticate.
 */
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

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const isLoopbackHttpOrigin = (value: string) => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      LOOPBACK_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
};

/** Host may be `127.0.0.1:8787` while wrangler rewrites `c.req.url` to the custom domain. */
const loopbackHostHeader = (host: string | undefined) => {
  if (!host) return "";
  const hostname = host.startsWith("[")
    ? host.slice(0, Math.max(host.indexOf("]"), 0) + 1)
    : host.split(":")[0];
  return LOOPBACK_HOSTS.has(hostname) ? hostname : "";
};

/**
 * wrangler remaps Host + URL to the custom domain (courses.sein.moe) over
 * HTTP. Production is HTTPS, so this never matches the live Worker.
 */
const isWranglerLocalRewrite = (c: Context, origin: string) => {
  try {
    return new URL(c.req.url).protocol === "http:" && isLoopbackHttpOrigin(origin);
  } catch {
    return false;
  }
};

/**
 * Same-origin writes, plus local preview (`pnpm prototype` on :5173) talking
 * to wrangler (`pnpm dev` on :8787) through the Vite /api proxy.
 * Production hosts still require an exact Origin match.
 */
export const originOk = (c: Context) => {
  const origin = c.req.header("Origin");
  if (!origin) return false;
  const requestOrigin = new URL(c.req.url).origin;
  if (origin === requestOrigin) return true;
  if (!isLoopbackHttpOrigin(origin)) return false;
  return (
    isLoopbackHttpOrigin(requestOrigin) ||
    Boolean(loopbackHostHeader(c.req.header("Host"))) ||
    isWranglerLocalRewrite(c, origin)
  );
};

/** wrangler / Vite loopback only — production Worker hostnames never match. */
export const isLoopbackWorkerRequest = (c: Context) => {
  if (loopbackHostHeader(c.req.header("Host"))) return true;
  try {
    const url = new URL(c.req.url);
    if (LOOPBACK_HOSTS.has(url.hostname)) return true;
    return isWranglerLocalRewrite(c, c.req.header("Origin") || "");
  } catch {
    return false;
  }
};

const randomToken = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

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

/**
 * Session boundary for ordinary-user writes.
 * Guests stay anonymous. Test HMAC or the CAS/email session cookie can
 * authenticate; AuthBridge JWT, admin cookies, IP hashes and submitter
 * hashes never authenticate here.
 */
export async function resolveOrdinaryUser(
  c: Context,
): Promise<OrdinaryUser | null> {
  const hmacUser = await resolveTestHmacUser(c);
  if (hmacUser) return hmacUser;
  return resolveEmailSessionUser(c);
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

export function isOrdinaryUserAuthenticated(user: OrdinaryUser) {
  return user.status === "active";
}

export function canOrdinaryUserWrite(user: OrdinaryUser) {
  return (
    isOrdinaryUserAuthenticated(user) &&
    (user.muted_until == null || user.muted_until <= Date.now() / 1000)
  );
}

/**
 * Shared write gate for ordinary-user mutations (reviews, catalog requests,
 * endorsements). Guests 401; muted / banned / pending_deletion / deleted 403;
 * origin and CSRF must both pass. Call this before any INSERT, including
 * honeypot short-circuits so anonymous bots cannot get a fake ok.
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
  if (!user || !isOrdinaryUserAuthenticated(user)) return guestSession();
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
