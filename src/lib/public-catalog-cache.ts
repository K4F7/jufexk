import { cache as workersCache } from "cloudflare:workers";

/**
 * Public catalog list GETs use Workers Caching via Cache-Control / Cache-Tag.
 * Cookie is not in that cache key and is not an automatic bypass, so ordinary
 * browser cookies do not require a Cache API + URL-only-key fallback.
 */

export const PUBLIC_CATALOG_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
export const PUBLIC_CATALOG_CACHE_TAG = "public-catalog";
export const DEFAULT_API_CACHE_CONTROL = "no-store";

type HeaderContext = {
  header: (name: string, value: string) => unknown;
};

type CachePurgeContext = {
  executionCtx?: unknown;
};

export function setPublicCatalogCacheHeaders(c: HeaderContext) {
  c.header("Cache-Control", PUBLIC_CATALOG_CACHE_CONTROL);
  c.header("Cache-Tag", PUBLIC_CATALOG_CACHE_TAG);
}

export async function purgePublicCatalogCache(c: CachePurgeContext) {
  try {
    // Hono's ExecutionContext type omits Workers Caching; the runtime ctx has it.
    const runtimeCache = (
      c.executionCtx as
        | { cache?: { purge?: (options: { tags: string[] }) => Promise<unknown> | unknown } }
        | undefined
    )?.cache;
    if (runtimeCache?.purge) {
      await runtimeCache.purge({ tags: [PUBLIC_CATALOG_CACHE_TAG] });
      return;
    }
    await workersCache.purge({ tags: [PUBLIC_CATALOG_CACHE_TAG] });
  } catch {
    // Best-effort: a write must still succeed if purge is missing or fails.
  }
}
