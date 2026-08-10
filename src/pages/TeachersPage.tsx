/**
 * Teacher catalog — adapted from frozen course-catalog language:
 * CatalogSearchHeader C · CatalogResultsStates A · TeacherResultTable (B fold).
 * No separate A/B/C prototype round (foundations).
 */
import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  CatalogResultsStates,
  TEACHER_CATALOG_COPY,
} from "../components/CatalogResultsStates";
import { CatalogSearchHeader } from "../components/CatalogSearchHeader";
import { TeacherResultTable } from "../components/TeacherResultTable";
import { api } from "../lib/api";
import type { Paginated, Teacher } from "../lib/types";

const FILTER_DELAY = 320;

export function TeachersPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const q = params.get("q") || "";
  const parsedPage = Number(params.get("page") || "1");
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const [queryDraft, setQueryDraft] = useState(q);
  const [data, setData] = useState<Paginated<Teacher> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => setQueryDraft(q), [q]);

  useEffect(() => {
    const nextQuery = queryDraft.trim();
    if (nextQuery === q) return;

    const timer = window.setTimeout(() => {
      const sp = new URLSearchParams(params);
      if (nextQuery) sp.set("q", nextQuery);
      else sp.delete("q");
      sp.set("page", "1");
      setParams(sp, { replace: true });
    }, FILTER_DELAY);

    return () => window.clearTimeout(timer);
  }, [queryDraft, q, params, setParams]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    query.set("page", String(page));

    setLoading(true);
    setError("");
    api<Paginated<Teacher>>(`/api/teachers?${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message || "教师资料加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [q, page, reloadToken]);

  const hasFilters = Boolean(queryDraft.trim() || q);
  const currentPage = data?.pages ? Math.min(data.page, data.pages) : 1;
  const totalPages = data?.pages || 1;
  const teacherMeta = data ? `${data.total} 位教师` : "";

  function clearSearch() {
    setQueryDraft("");
    const sp = new URLSearchParams(params);
    sp.delete("q");
    sp.set("page", "1");
    setParams(sp, { replace: true });
  }

  function goToPage(nextPage: number) {
    const sp = new URLSearchParams(params);
    sp.set("page", String(nextPage));
    setParams(sp);
  }

  return (
    <section>
      <CatalogSearchHeader
        title="教师资料"
        meta={teacherMeta}
        value={queryDraft}
        onChange={setQueryDraft}
        placeholder="搜索教师姓名或院系"
        searchLabel="搜索教师"
        clearAriaLabel="清空教师搜索"
        name="teacher-search"
      />

      <CatalogResultsStates
        loading={loading}
        hasPayload={data != null}
        error={error}
        itemCount={data?.items.length ?? 0}
        hasFilters={hasFilters}
        emptyQuery={q || undefined}
        currentPage={currentPage}
        totalPages={totalPages}
        total={data?.total ?? 0}
        onPageChange={goToPage}
        onRetry={() => setReloadToken((n) => n + 1)}
        onClearFilters={clearSearch}
        copy={TEACHER_CATALOG_COPY}
      >
        {data ? (
          <TeacherResultTable items={data.items} search={location.search} />
        ) : null}
      </CatalogResultsStates>
    </section>
  );
}
