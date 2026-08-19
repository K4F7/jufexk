/**
 * PROTOTYPE — global-search URL helpers (throwaway; not production-ready).
 * Seams for catalog kind, ?q= jumps, detail links, and suggestion caps.
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

export function catalogKindFromPath(pathname: string): CatalogKind {
  if (pathname === "/teachers" || pathname.startsWith("/teachers/")) {
    return "teachers";
  }
  return "courses";
}

export function oppositeCatalog(kind: CatalogKind): CatalogKind {
  return kind === "courses" ? "teachers" : "courses";
}

export function catalogListPath(kind: CatalogKind): string {
  return kind === "teachers" ? "/teachers" : "/courses";
}

export function catalogDetailPath(kind: CatalogKind, id: number): string {
  return `${catalogListPath(kind)}/${id}`;
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
  kind: CatalogKind,
  query: string,
  params: URLSearchParams,
): string {
  return withPrototypeParams(catalogListPath(kind), params, query);
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

export function crossCatalogHintLabel(
  kind: CatalogKind,
  query: string,
): string {
  const q = query.trim();
  return kind === "courses"
    ? `也在教师资料中搜「${q}」`
    : `也在课程目录中搜「${q}」`;
}
