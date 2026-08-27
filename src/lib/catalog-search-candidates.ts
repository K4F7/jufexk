import { ftsLiteral, parseSearchTerms } from "./catalog-search";

export const CATALOG_FUZZY_CANDIDATE_LIMIT = 200;
export const CATALOG_FUZZY_SERVER_HARD_LIMIT = 500;

export type CourseSearchCandidate = {
  id: number;
  name: string;
  code: string;
  department: string;
  teachers: string[];
  pinyin: string;
};

export type TeacherSearchCandidate = {
  id: number;
  name: string;
  department: string;
  pinyin: string;
};

export type CatalogSearchCandidate = CourseSearchCandidate | TeacherSearchCandidate;
export type CatalogSearchCandidateKind = "course" | "teacher";

export type CatalogSearchCandidateResponse<T extends CatalogSearchCandidate> = {
  items: T[];
  meta: { rows_read: number; candidate_count: number };
};

/** Two-Han-character fuzzy remains disabled until the quality corpus supports it. */
export function isCatalogFuzzyQueryEligible(query: string): boolean {
  const normalized = query.trim();
  if ([...normalized].length < 3) return false;
  return /[\p{L}\p{N}]/u.test(normalized);
}

/**
 * Build a literal FTS5 OR query from overlapping trigram windows. A typo only
 * needs to share one or more windows with a public projection to be recalled;
 * BM25 then keeps the server-side candidate set bounded before Fuse sees it.
 */
export function buildCatalogCandidateFtsQuery(query: string): string | null {
  if (!isCatalogFuzzyQueryEligible(query)) return null;
  const windows = new Set<string>();
  for (const term of parseSearchTerms(query)) {
    const chars = [...term.toLowerCase()];
    for (let index = 0; index <= chars.length - 3; index += 1) {
      windows.add(chars.slice(index, index + 3).join(""));
    }
  }
  return windows.size ? [...windows].map(ftsLiteral).join(" OR ") : null;
}
