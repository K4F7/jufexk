import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  resolveOrdinaryUser,
  type OrdinaryUser,
} from "./ordinary-user-authentication";

export const ORDINARY_USER_CSRF_COOKIE = "jufexk_user_csrf";

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

/**
 * wrangler / Vite loopback only — production Worker hostnames never match.
 * Origin is ignored: a public HTTP host plus a loopback Origin is not local.
 */
export const isLoopbackWorkerRequest = (c: Context) => {
  if (loopbackHostHeader(c.req.header("Host"))) return true;
  try {
    return LOOPBACK_HOSTS.has(new URL(c.req.url).hostname);
  } catch {
    return false;
  }
};

export function ordinaryUserCsrfOk(c: Context) {
  const header = c.req.header("X-CSRF-Token");
  const cookie = getCookie(c, ORDINARY_USER_CSRF_COOKIE);
  return !!header && header === cookie;
}

export function ordinaryUserMutationSecurityOk(c: Context) {
  return originOk(c) && ordinaryUserCsrfOk(c);
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
  if (!ordinaryUserMutationSecurityOk(c))
    return { error: c.json({ error: "安全校验失败，请刷新后重试" }, 403) };
  return { user };
}
