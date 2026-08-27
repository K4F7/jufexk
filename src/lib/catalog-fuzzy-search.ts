import Fuse, { type FuseResult, type IFuseOptions } from "fuse.js";
import {
  CATALOG_FUZZY_CANDIDATE_LIMIT,
  isCatalogFuzzyQueryEligible,
  type CatalogSearchCandidate,
  type CatalogSearchCandidateKind,
  type CourseSearchCandidate,
  type TeacherSearchCandidate,
} from "./catalog-search-candidates";

export {
  CATALOG_FUZZY_CANDIDATE_LIMIT,
  CATALOG_FUZZY_SERVER_HARD_LIMIT,
  isCatalogFuzzyQueryEligible,
  type CatalogSearchCandidate,
  type CatalogSearchCandidateKind,
  type CourseSearchCandidate,
  type TeacherSearchCandidate,
} from "./catalog-search-candidates";

export const CATALOG_FUZZY_THRESHOLD = 0.35;

const sharedOptions = {
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
  threshold: CATALOG_FUZZY_THRESHOLD,
} as const;

export const courseFuseOptions: IFuseOptions<CourseSearchCandidate> = {
  ...sharedOptions,
  keys: [
    { name: "name", weight: 0.4 },
    { name: "code", weight: 0.25 },
    { name: "pinyin", weight: 0.25 },
    { name: "teachers", weight: 0.08 },
    { name: "department", weight: 0.02 },
  ],
};

export const teacherFuseOptions: IFuseOptions<TeacherSearchCandidate> = {
  ...sharedOptions,
  keys: [
    { name: "name", weight: 0.58 },
    { name: "pinyin", weight: 0.37 },
    { name: "department", weight: 0.05 },
  ],
};

export function rankCatalogFuzzyCandidates(
  kind: "course",
  query: string,
  candidates: readonly CourseSearchCandidate[],
): FuseResult<CourseSearchCandidate>[];
export function rankCatalogFuzzyCandidates(
  kind: "teacher",
  query: string,
  candidates: readonly TeacherSearchCandidate[],
): FuseResult<TeacherSearchCandidate>[];
export function rankCatalogFuzzyCandidates(
  kind: CatalogSearchCandidateKind,
  query: string,
  candidates: readonly CatalogSearchCandidate[],
): FuseResult<CatalogSearchCandidate>[] {
  const bounded = candidates.slice(0, CATALOG_FUZZY_CANDIDATE_LIMIT);
  if (!isCatalogFuzzyQueryEligible(query) || bounded.length === 0) return [];

  if (kind === "course") {
    return new Fuse(
      bounded as CourseSearchCandidate[],
      courseFuseOptions,
    ).search(query) as FuseResult<CatalogSearchCandidate>[];
  }

  return new Fuse(
    bounded as TeacherSearchCandidate[],
    teacherFuseOptions,
  ).search(query) as FuseResult<CatalogSearchCandidate>[];
}
