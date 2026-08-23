/**
 * 课程目录 /courses — USTC 评课社区对齐（Issue #402）：
 * 标题「课程列表」；浅蓝筛选框（课程类别行）；一行一条课程×教师任课
 * 关系（CourseRelationRow）；分页沿用 URL ?page=。
 * 页内搜索已上移到顶栏居中搜索；院系/教师筛选随旧工具条下线。
 *
 * 数据走现有 GET /api/courses（课程级行），前端按 teacher_refs 展开成
 * 关系行；分页总数仍按课程计。关系级评分/点评数、四维档位与
 * 「排序方式：课程评分」依赖 #410 的后端投影，未下发前行内显示占位、
 * 排序行暂不上线。
 *
 * DEV-only: ?module=global-search&variant=A 保留页内搜索头（#303 对照），
 * variant=C 保留跨目录提示链接。
 */
import { Button, Skeleton, Typography } from "@heroui/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  CatalogEmptyRescueLink,
  CatalogResultsStates,
  type CatalogResultsCopy,
} from "../components/CatalogResultsStates";
import {
  CatalogSearchHeader,
  type CatalogSearchSuggestion,
} from "../components/CatalogSearchHeader";
import { CourseRelationRow } from "../components/CourseRelationRow";
import { api } from "../lib/api";
import { shouldOfferCatalogRescue } from "../lib/catalog-empty-rescue";
import { CATALOG_SUGGEST_PAGE_SIZE } from "../lib/catalog-search-suggest";
import { expandCourseRelations } from "../lib/course-relations";
import {
  isPublicCatalogCategory,
  PUBLIC_CATEGORY_OPTIONS,
  publicCategoryOptionLabel,
} from "../lib/public-categories";
import { useCatalogSuggestions } from "../lib/use-catalog-suggestions";
import type { Course, Paginated, Teacher } from "../lib/types";

const RELATION_CATALOG_COPY: CatalogResultsCopy = {
  errorTitle: "课程目录加载失败",
  refreshingLabel: "正在更新课程目录…",
  emptyFilteredTitle: (query) =>
    query ? `没有找到匹配「${query}」的课程` : "没有符合筛选条件的课程",
  emptyFilteredDesc: "试试调整关键词或类别。",
  emptyCatalogTitle: "目录暂无课程数据",
  emptyCatalogDesc: "请稍后再来，或联系维护者导入公开目录。",
  clearLabel: "清空筛选",
  totalUnit: "条",
};

/** DEV-only: global-search A/B/C compare (issue #303; not production). */
const GlobalSearchHintLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/GlobalSearchVariants").then((m) => ({
        default: m.GlobalSearchCrossCatalogHint,
      })),
    )
  : null;

function useGlobalSearchPrototypeVariant(): "A" | "B" | "C" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "global-search") return null;
    const key = (params.get("variant") || "A").toUpperCase();
    if (key === "A" || key === "B" || key === "C") return key;
    return "A";
  }, [params]);
}

export function CoursesPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const globalSearchVariant = useGlobalSearchPrototypeVariant();
  const q = params.get("q") || "";
  const rawCategory = params.get("category") || "";
  const category = isPublicCatalogCategory(rawCategory) ? rawCategory : "";
  const parsedPage = Number(params.get("page") || "1");
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [data, setData] = useState<Paginated<Course> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  /** Bumps to re-fetch the current catalog query (retry / force-reload). */
  const [reloadToken, setReloadToken] = useState(0);
  const [rescueTotal, setRescueTotal] = useState<number | null>(null);

  // Stale bookmarks may still carry general/pe/required; those 400 on the API.
  useEffect(() => {
    if (!rawCategory || isPublicCatalogCategory(rawCategory)) return;
    const next = new URLSearchParams(params);
    next.delete("category");
    setParams(next, { replace: true });
  }, [rawCategory, params, setParams]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (category) sp.set("category", category);
    sp.set("page", String(page));
    return sp.toString();
  }, [q, category, page]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError("");
    api<Paginated<Course>>(`/api/courses?${queryString}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError((reason as Error).message || "课程目录加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [queryString, reloadToken]);

  const offerRescue =
    data != null &&
    shouldOfferCatalogRescue({
      itemCount: data.items.length,
      query: q,
      extraFilters: Boolean(category),
    });

  useEffect(() => {
    if (!offerRescue) {
      setRescueTotal(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const query = new URLSearchParams({
      q,
      page: "1",
      pageSize: "1",
    });

    api<Paginated<Teacher>>(`/api/teachers?${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) setRescueTotal(result.total);
      })
      .catch(() => {
        if (!cancelled) setRescueTotal(null);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [offerRescue, q]);

  function update(next: Record<string, string>, replace = false) {
    const sp = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (!value) sp.delete(key);
      else sp.set(key, value);
    }
    if (!("page" in next)) sp.set("page", "1");
    setParams(sp, { replace });
  }

  const hasFilters = Boolean(q || category);
  const currentPage = data?.pages ? Math.min(data.page, data.pages) : 1;
  const totalPages = data?.pages || 1;
  /** 空状态文案点名全部生效筛选（关键词 / 类别）。 */
  const activeFilterLabels = [
    q ? `关键词“${q}”` : "",
    category ? publicCategoryOptionLabel(category) : "",
  ].filter(Boolean);

  function clearFilters() {
    update({ q: "", category: "", page: "1" }, true);
  }

  const rescue =
    rescueTotal && rescueTotal > 0 ? (
      <CatalogEmptyRescueLink to={`/teachers?q=${encodeURIComponent(q)}`}>
        教师资料有 {rescueTotal} 位匹配，去查看
      </CatalogEmptyRescueLink>
    ) : undefined;

  const results = (
    <CatalogResultsStates
      loading={loading}
      hasPayload={data != null}
      error={error}
      itemCount={data?.items.length ?? 0}
      hasFilters={hasFilters}
      emptyQuery={q || undefined}
      emptyFilters={activeFilterLabels}
      currentPage={currentPage}
      totalPages={totalPages}
      total={data?.total ?? 0}
      onPageChange={(nextPage) => update({ page: String(nextPage) })}
      onRetry={() => setReloadToken((n) => n + 1)}
      onClearFilters={clearFilters}
      copy={RELATION_CATALOG_COPY}
      rescue={rescue}
    >
      {data ? (
        <div>
          {data.items.flatMap((course) =>
            expandCourseRelations(course).map((relation) => (
              <CourseRelationRow
                key={`${relation.course_id}:${relation.teacher_id ?? "none"}`}
                relation={relation}
                search={location.search}
              />
            )),
          )}
        </div>
      ) : null}
    </CatalogResultsStates>
  );

  const filterBox = (
    <div
      aria-label="课程目录筛选"
      className="mb-3 rounded-lg border border-border bg-surface-secondary px-4 py-2.5"
      role="search"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="shrink-0 text-[13px] font-semibold text-foreground">
          课程类别：
        </span>
        {PUBLIC_CATEGORY_OPTIONS.map((opt) => (
          <Button
            key={opt.id || "all"}
            size="sm"
            variant={category === opt.id ? "secondary" : "ghost"}
            onPress={() => update({ category: opt.id }, true)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );

  // DEV-only #303 variant A: 页内搜索头（含建议）替代生产标题行。
  if (globalSearchVariant === "A") {
    return (
      <section>
        <GlobalSearchVariantAHeader q={q} update={update} />
        {filterBox}
        {results}
      </section>
    );
  }

  return (
    <section>
      <header aria-label="目录标题" className="mb-3">
        <Typography
          className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
          type="h1"
        >
          课程列表
        </Typography>
        {/* 计数行恒占一行高度：加载时骨架、到达后文字，避免布局跳动。 */}
        <div
          className="mt-0.5 flex min-h-4 items-center text-xs text-muted"
          aria-live="polite"
        >
          {loading && !data ? (
            <Skeleton className="h-3 w-20 rounded" aria-label="数量加载中" />
          ) : data ? (
            `共 ${data.total} 条`
          ) : null}
        </div>
      </header>
      {filterBox}
      {globalSearchVariant === "C" && q && GlobalSearchHintLazy ? (
        <Suspense fallback={null}>
          <GlobalSearchHintLazy catalog="courses" query={q} />
        </Suspense>
      ) : null}
      {results}
    </section>
  );
}

/** DEV-only #303 variant A 页内搜索头：建议选择即写入 ?q=。 */
function GlobalSearchVariantAHeader({
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
      return api<Paginated<Course>>(`/api/courses?${suggest}`, { signal }).then(
        (result) =>
          result.items.slice(0, CATALOG_SUGGEST_PAGE_SIZE).map(
            (course): CatalogSearchSuggestion => ({
              id: String(course.id),
              title: course.name,
              detail: course.code,
            }),
          ),
      );
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
