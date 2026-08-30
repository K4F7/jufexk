import { cache as workersCache } from "cloudflare:workers";
import {
  EMAIL_LOGIN_COOKIE,
  ORDINARY_USER_ID_HEADER,
  ORDINARY_USER_MAC_HEADER,
} from "../ordinary-user-authentication";
import { EHALL_SESSION_COOKIE } from "../ordinary-user-session";

const PUBLIC_CACHE_CREDENTIAL_COOKIES = [
  "jufexk_voter",
  EMAIL_LOGIN_COOKIE,
  "jufexk_admin",
  "jufexk_csrf",
  "jufexk_user_csrf",
  EHALL_SESSION_COOKIE,
  "TGC",
  "SESSION",
  "CASTGC",
  "JSESSIONID",
] as const;

/**
 * Public catalog list GETs use Workers Caching via Cache-Control / Cache-Tag.
 * Cookie is not in that cache key and is not an automatic bypass, so ordinary
 * browser cookies do not require a Cache API + URL-only-key fallback.
 */

export const PUBLIC_CATALOG_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
export const PUBLIC_CATALOG_CACHE_TAG = "public-catalog";
export const PUBLIC_DETAIL_CACHE_TAG = "public-detail";
export const PUBLIC_CONFIG_CACHE_TAG = "public-config";
export const DEFAULT_API_CACHE_CONTROL = "no-store";
export const PUBLIC_DETAIL_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
export const PUBLIC_CONFIG_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

export type PublicCacheScope = "list" | "detail" | "config";

const cacheScopeValues: Record<PublicCacheScope, { control: string; tag: string }> = {
  list: { control: PUBLIC_CATALOG_CACHE_CONTROL, tag: PUBLIC_CATALOG_CACHE_TAG },
  detail: { control: PUBLIC_DETAIL_CACHE_CONTROL, tag: PUBLIC_DETAIL_CACHE_TAG },
  config: { control: PUBLIC_CONFIG_CACHE_CONTROL, tag: PUBLIC_CONFIG_CACHE_TAG },
};

type HeaderContext = {
  header: (name: string, value: string) => unknown;
};

type CachePurgeContext = {
  executionCtx?: unknown;
};

export function setPublicCatalogCacheHeaders(
  c: HeaderContext,
  scope: PublicCacheScope = "list",
) {
  const values = cacheScopeValues[scope];
  c.header("Cache-Control", values.control);
  c.header("Cache-Tag", values.tag);
}

export async function purgePublicCatalogCache(
  c: CachePurgeContext,
  scopes: readonly PublicCacheScope[] = ["list"],
) {
  const tags = [...new Set(scopes.map((scope) => cacheScopeValues[scope].tag))];
  try {
    // Hono's ExecutionContext type omits Workers Caching; the runtime ctx has it.
    const runtimeCache = (
      c.executionCtx as
        | { cache?: { purge?: (options: { tags: string[] }) => Promise<unknown> | unknown } }
        | undefined
    )?.cache;
    if (runtimeCache?.purge) {
      await runtimeCache.purge({ tags });
      return;
    }
    await workersCache.purge({ tags });
  } catch {
    // Best-effort: a write must still succeed if purge is missing or fails.
  }
}

/**
 * Cache keys ignore cookies in Workers Cache. Only requests without any
 * credential that can alter public payload fields may use shared responses.
 */
function isPublicRequestCacheable(
  c: {
    req: {
      header: (name: string) => string | undefined;
    };
  },
  allowVoterCookie: boolean,
) {
  const blockedCookies = allowVoterCookie
    ? PUBLIC_CACHE_CREDENTIAL_COOKIES.filter((name) => name !== "jufexk_voter")
    : PUBLIC_CACHE_CREDENTIAL_COOKIES;
  const cookieHeader = c.req.header("Cookie") || "";
  const hasCookie = (name: string) =>
    cookieHeader.split(";").some((part) => part.trim().startsWith(`${name}=`));
  if (blockedCookies.some(hasCookie)) return false;
  if (c.req.header(ORDINARY_USER_ID_HEADER)) return false;
  if (c.req.header(ORDINARY_USER_MAC_HEADER)) return false;
  if (c.req.header("Authorization")) return false;
  if (c.req.header("X-Test-Auth") || c.req.header("X-Test-Authentication"))
    return false;
  return true;
}

export function isPublicCatalogCacheableRequest(c: {
  req: {
    header: (name: string) => string | undefined;
  };
}) {
  return isPublicRequestCacheable(c, false);
}

/**
 * Public course and relation lists never serialize viewer signals, so the
 * anonymous voter marker is safe to ignore for shared caching.
 */
export function isPublicCourseListCacheableRequest(c: {
  req: {
    header: (name: string) => string | undefined;
  };
}) {
  return isPublicRequestCacheable(c, true);
}
