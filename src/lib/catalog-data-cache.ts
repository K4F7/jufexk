import { api } from "./api";
import { PUBLIC_CATEGORY_OPTIONS } from "./public-categories";
import { courseDetailApiPath } from "./public-course-identity";

type CacheEntry = {
  expiresAt: number;
  value?: unknown;
  promise?: Promise<unknown>;
};

const entries = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 30_000;

/** Canonicalize a public API URL so equivalent query ordering shares a cache entry. */
export function catalogDataCacheKey(url: string): string {
  const parsed = new URL(url, "https://jufexk.invalid");
  parsed.searchParams.sort();
  return `${parsed.pathname}${parsed.search}`;
}

export function getCatalogData<T>(
  url: string,
  load: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const key = catalogDataCacheKey(url);
  const now = Date.now();
  const current = entries.get(key);
  if (current?.value !== undefined && current.expiresAt > now) {
    return Promise.resolve(current.value as T);
  }
  if (current?.promise) return current.promise as Promise<T>;

  const promise = load()
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((error) => {
      entries.delete(key);
      throw error;
    });
  entries.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
}

/** Synchronous cache lookup. Does not fetch, refresh TTL, or return in-flight work. */
export function peekCatalogData<T>(url: string): T | undefined {
  const key = catalogDataCacheKey(url);
  const now = Date.now();
  const current = entries.get(key);
  if (current?.value !== undefined && current.expiresAt > now) {
    return current.value as T;
  }
  return undefined;
}

/** Fire-and-forget intent prefetch. A failed prefetch must never surface in UI. */
export function prefetchCatalogData<T>(
  url: string,
  load: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): void {
  void getCatalogData(url, load, ttlMs).catch(() => undefined);
}

export function invalidateCatalogData(prefix?: string): void {
  if (!prefix) {
    entries.clear();
    return;
  }
  const normalized = catalogDataCacheKey(prefix);
  for (const key of entries.keys()) {
    if (
      key === normalized ||
      key.startsWith(`${normalized}?`) ||
      key.startsWith(`${normalized}/`)
    ) {
      entries.delete(key);
    }
  }
}

export function clearCatalogDataCache(): void {
  entries.clear();
}

export function shouldPrefetchCatalog(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData) return false;
  return !["slow-2g", "2g"].includes(connection?.effectiveType || "");
}

const COURSE_CATALOG_PREFETCH_SORTS = ["", "rating"] as const;

function prefetchCourseCatalogBrowseNow(): void {
  for (const option of PUBLIC_CATEGORY_OPTIONS) {
    for (const sort of COURSE_CATALOG_PREFETCH_SORTS) {
      const params = new URLSearchParams();
      if (option.id) params.set("category", option.id);
      if (sort) params.set("sort", sort);
      params.set("view", "relations");
      params.set("page", "1");
      const url = `/api/courses?${params}`;
      prefetchCatalogData(url, () => api(url));
    }
  }
}

/** Idle prefetch for the category pills × two sorts on page 1. */
export function prefetchCourseCatalogBrowse(): void {
  if (!shouldPrefetchCatalog()) return;
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => prefetchCourseCatalogBrowseNow(), { timeout: 2000 });
    return;
  }
  setTimeout(prefetchCourseCatalogBrowseNow, 0);
}

/** Prefetch the exact detail and default latest review keys used by the course page. */
export function prefetchCourseDetail(
  courseIdentity: string | number,
  teacherId?: number | null,
): void {
  if (!shouldPrefetchCatalog()) return;
  const detailUrl = courseDetailApiPath(String(courseIdentity));
  prefetchCatalogData(detailUrl, () => api(detailUrl));
  if (teacherId == null) return;
  const params = new URLSearchParams({
    teacherId: String(teacherId),
    sort: "latest",
  });
  const reviewsUrl = courseDetailApiPath(String(courseIdentity), `/reviews?${params}`);
  prefetchCatalogData(reviewsUrl, () => api(reviewsUrl));
}
