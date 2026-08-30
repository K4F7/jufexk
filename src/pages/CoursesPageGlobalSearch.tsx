/**
 * DEV-only #303 variant A 页内搜索头。独立文件，避免生产 CoursesPage
 * 静态碰到 fuse.js。
 */
import { useCallback, useEffect, useState } from "react";
import {
  CatalogSearchHeader,
  type CatalogSearchSuggestion,
} from "../components/CatalogSearchHeader";
import { api } from "../lib/api";
import { CATALOG_SUGGEST_PAGE_SIZE } from "../lib/catalog-search-suggest";
import {
  isCatalogFuzzyQueryEligible,
  rankCatalogFuzzyCandidates,
} from "../lib/catalog-fuzzy-search";
import type { CourseSearchCandidate } from "../lib/catalog-search-candidates";
import { useCatalogSuggestions } from "../lib/use-catalog-suggestions";
import type { Course, Paginated } from "../lib/types";

export function GlobalSearchVariantAHeader({
  q,
  update,
}: {
  q: string;
  update: (next: Record<string, string>, replace?: boolean) => void;
}) {
  const [queryDraft, setQueryDraft] = useState(q);
  useEffect(() => setQueryDraft(q), [q]);
  const loadCourseSuggestions = useCallback(
    (query: string, signal: AbortSignal) => {
      const suggest = new URLSearchParams({
        q: query,
        page: "1",
        pageSize: String(CATALOG_SUGGEST_PAGE_SIZE),
      });
      return api<Paginated<Course>>(`/api/courses?${suggest}`, { signal }).then(async (result) => {
        if (result.items.length > 0) {
          return result.items.slice(0, CATALOG_SUGGEST_PAGE_SIZE).map(
            (course): CatalogSearchSuggestion => ({
              id: String(course.id), title: course.name, detail: course.code, kind: "strict",
            }),
          );
        }
        if (!isCatalogFuzzyQueryEligible(query)) return [];
        const candidates = await api<{ items: CourseSearchCandidate[] }>(
          `/api/search/candidates?kind=course&q=${encodeURIComponent(query)}&limit=200`,
          { signal },
        );
        return rankCatalogFuzzyCandidates("course", query, candidates.items)
          .slice(0, CATALOG_SUGGEST_PAGE_SIZE)
          .map(({ item }): CatalogSearchSuggestion => ({
            id: String(item.id), title: item.name, detail: item.code, kind: "fuzzy",
          }));
      });
    },
    [],
  );
  const courseSuggestions = useCatalogSuggestions(
    queryDraft,
    loadCourseSuggestions,
  );
  return (
    <CatalogSearchHeader
      title="课程列表"
      value={queryDraft}
      onChange={setQueryDraft}
      placeholder="搜索课程、课号或教师"
      searchLabel="搜索课程"
      clearAriaLabel="清空课程搜索"
      name="course-search"
      suggestions={courseSuggestions.items}
      suggestionsReady={courseSuggestions.ready}
      suggestionsFailed={courseSuggestions.failed}
      onSelectSuggestion={(next) => update({ q: next, page: "1" }, true)}
    />
  );
}
