import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  ORDINARY_USER_SESSION_TTL_SECONDS,
  clearOrdinaryUserSessionCookie,
  resolveOrdinaryUser,
  type OrdinaryUser,
} from "./ordinary-user-authentication";
import {
  ORDINARY_USER_CSRF_COOKIE,
  canOrdinaryUserWrite,
  isOrdinaryUserAuthenticated,
  ordinaryUserMutationSecurityOk,
} from "./ordinary-user-write-authorization";
import {
  FIRST_USER_PUBLIC_CODE,
  defaultAvatarKey,
  formatPublicHandle,
} from "./public-handle";
import { issueGuestVoterCookie, readVoteActorId } from "./review-vote-actor";

export { ORDINARY_USER_SESSION_TTL_SECONDS };
export const EHALL_SESSION_COOKIE = "jufexk_ehall_session";
export const EHALL_SESSION_COOKIE_PATH = "/api/ehall";
export const LOGIN_PATH = "/login";
export const LOGOUT_PATH = "/logout";
export const USER_SESSION_PATH = "/api/user/session";
export const USER_LOGOUT_PATH = "/api/user/logout";

export type OrdinaryUserSession = {
  authenticated: boolean;
  accountStatus?: "pending_deletion";
  restoreUntil?: string;
  csrfToken?: string;
  loginPath: string;
  logoutPath: string;
  /** Public display name only — never email, student id, or users.id. */
  handle?: string;
  avatar_key?: number;
};

const ACCOUNT_DELETION_RECOVERY_DAYS = 30;

const guestSession = (c: Context): OrdinaryUserSession => ({
  authenticated: false,
  csrfToken: issueOrdinaryUserCsrf(c, randomToken()),
  loginPath: LOGIN_PATH,
  logoutPath: LOGOUT_PATH,
});

const randomToken = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export function issueOrdinaryUserCsrf(c: Context, token: string) {
  const existing = getCookie(c, ORDINARY_USER_CSRF_COOKIE);
  const csrf = existing || token;
  if (!existing) {
    setCookie(c, ORDINARY_USER_CSRF_COOKIE, csrf, {
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: ORDINARY_USER_SESSION_TTL_SECONDS,
    });
  }
  return csrf;
}

export function clearOrdinaryUserCookies(c: Context) {
  clearOrdinaryUserSessionCookie(c);
  deleteCookie(c, ORDINARY_USER_CSRF_COOKIE, { path: "/" });
  deleteCookie(c, EHALL_SESSION_COOKIE, { path: EHALL_SESSION_COOKIE_PATH });
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
  if (!user || !isOrdinaryUserAuthenticated(user)) return guestSession(c);
  const publicCode = user.public_code;
  const publicIdentity =
    publicCode != null && publicCode >= FIRST_USER_PUBLIC_CODE
      ? {
          handle: formatPublicHandle(publicCode),
          avatar_key: user.avatar_key ?? defaultAvatarKey(publicCode),
        }
      : {};
  return {
    authenticated: true,
    csrfToken: issueOrdinaryUserCsrf(c, randomToken()),
    loginPath: LOGIN_PATH,
    logoutPath: LOGOUT_PATH,
    ...publicIdentity,
  };
}

export async function ordinaryUserSessionPayload(
  c: Context,
): Promise<OrdinaryUserSession> {
  return sessionPayloadForUser(c, await resolveOrdinaryUser(c));
}

export async function handleOrdinaryUserSession(c: Context) {
  const payload = await ordinaryUserSessionPayload(c);
  if (!payload.authenticated && !(await readVoteActorId(c))) {
    await issueGuestVoterCookie(c);
  }
  return c.json(payload);
}

export async function handleOrdinaryUserLogout(c: Context) {
  const user = await resolveOrdinaryUser(c);
  if (user && canOrdinaryUserWrite(user) && !ordinaryUserMutationSecurityOk(c)) {
    return c.json({ error: "安全校验失败，请刷新后重试" }, 403);
  }
  clearOrdinaryUserCookies(c);
  return c.json({ ok: true, ...guestSession(c) });
}
