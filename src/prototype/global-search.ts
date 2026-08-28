/**
 * PROTOTYPE — global-search URL helpers (throwaway; not production-ready).
 * Seams for ?q= jumps, detail links, and suggestion caps.
 * The public list is courses only; teacher hits go to /teachers/:id.
 */

export const GLOBAL_SEARCH_MODULE = "global-search";

export type GlobalSearchVariantKey = "A" | "B" | "C";
export type CatalogKind = "courses" | "teachers";

const VARIANT_KEYS: GlobalSearchVariantKey[] = ["A", "B", "C"];

export function isGlobalSearchVariantKey(
  key: string,
): key is GlobalSearchVariantKey {
  return (VARIANT_KEYS as string[]).includes(key);
}

export function parseGlobalSearchVariant(
  isDev: boolean,
  module: string | null,
  variant: string | null,
): GlobalSearchVariantKey | null {
  if (!isDev) return null;
  if (module !== GLOBAL_SEARCH_MODULE) return null;
  const key = (variant || "A").toUpperCase();
  return isGlobalSearchVariantKey(key) ? key : "A";
}

export function catalogDetailPath(kind: CatalogKind, id: number): string {
  return kind === "teachers" ? `/teachers/${id}` : `/courses/${id}`;
}

function withPrototypeParams(
  pathname: string,
  params: URLSearchParams,
  query?: string,
): string {
  const next = new URLSearchParams();
  const trimmed = query?.trim() ?? "";
  if (trimmed) next.set("q", trimmed);
  const module = params.get("module");
  const variant = params.get("variant");
  if (module) next.set("module", module);
  if (variant) next.set("variant", variant);
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function catalogSearchHref(
  query: string,
  params: URLSearchParams,
): string {
  return withPrototypeParams("/courses", params, query);
}

export function catalogDetailHref(
  kind: CatalogKind,
  id: number,
  params: URLSearchParams,
): string {
  return withPrototypeParams(catalogDetailPath(kind, id), params);
}

export function takeSuggestions<T>(items: T[], limit = 5): T[] {
  return items.slice(0, limit);
}
