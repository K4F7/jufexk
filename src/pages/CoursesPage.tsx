/**
 * 课程目录 /courses — USTC 评课社区对齐（Issue #402）：
 * 标题「课程列表」；类别与排序浏览框；一行一条课程×教师任课
 * 关系（CourseRelationRow）；分页沿用 URL ?page=。
 * 搜索在顶栏；只有 ?q= 算筛选。院系/教师工具条已下线。
 *
 * 数据走 GET /api/courses?view=relations（一行一条课程×教师）。
 * 支持 sort=rating；分页总数按关系行计。
 *
 * DEV-only: ?module=global-search&variant=A 保留页内搜索头（#303 对照）。
 */
import {
  Label,
  Separator,
  Skeleton,
  Surface,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  type Key,
} from "@heroui/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  CatalogResultsStates,
  type CatalogResultsCopy,
} from "../components/CatalogResultsStates";
import { CourseRelationRow } from "../components/CourseRelationRow";
import { api } from "../lib/api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { emptyCatalogPage, readDevPreview } from "../lib/dev-preview";
import {
  GENERAL_EDUCATION_FILTER,
  isGeneralEducationFilter,
  isPublicCatalogCategory,
  PUBLIC_CATEGORY_OPTIONS,
} from "../lib/public-categories";
import { expandCourseRelations } from "../lib/course-relations";
import type { Course, CourseRelation, Paginated } from "../lib/types";

const GlobalSearchVariantAHeader = import.meta.env.DEV
  ? lazy(() =>
      import("./CoursesPageGlobalSearch").then((m) => ({
        default: m.GlobalSearchVariantAHeader,
      })),
    )
  : null;

function asRelationRows(
  items: Array<CourseRelation | Course>,
): CourseRelation[] {
  return items.flatMap((item) =>
    "course_id" in item && typeof item.course_id === "number"
      ? [item]
      : expandCourseRelations(item as Course),
  );
}

const SORT_OPTIONS = [
  { id: "", label: "评价数量" },
  { id: "rating", label: "课程评分" },
] as const;

const ALL_CATEGORY_KEY = "all";
const DEFAULT_SORT_KEY = "reviews";
const MOBILE_FILTER_QUERY = "(max-width: 639px)";

function firstSelectedKey(keys: Iterable<Key>): string | undefined {
  const [key] = keys;
  return key == null ? undefined : String(key);
}

function categoryToggleKey(category: string): string {
  if (!category) return ALL_CATEGORY_KEY;
  if (isGeneralEducationFilter(category)) return GENERAL_EDUCATION_FILTER;
  return category;
}

const RELATION_CATALOG_COPY: CatalogResultsCopy = {
  errorTitle: "课程目录加载失败",
  emptyFilteredTitle: (query) =>
    query ? `没有找到匹配「${query}」的课程` : "没有找到匹配的课程",
  emptyFilteredDesc: "试试换个关键词。",
  emptyCatalogTitle: "目录暂无课程数据",
  emptyCatalogDesc: "目录还在整理，请稍后再来看看。",
  clearLabel: "清空搜索",
  totalUnit: "条",
};

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
  const isMobileFilterLayout = useMediaQuery(MOBILE_FILTER_QUERY);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const globalSearchVariant = useGlobalSearchPrototypeVariant();
  const preview = readDevPreview(params);
  const q = params.get("q") || "";
  const rawCategory = params.get("category") || "";
  const category = isPublicCatalogCategory(rawCategory) ? rawCategory : "";
  const rawSort = params.get("sort") || "";
  const sort = rawSort === "rating" ? "rating" : "";
  const parsedPage = Number(params.get("page") || "1");
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [data, setData] = useState<Paginated<CourseRelation> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  /** Bumps to re-fetch the current catalog query (retry / force-reload). */
  const [reloadToken, setReloadToken] = useState(0);

  // Stale bookmarks may still carry pe/required/elective; those 400 on the API.
  // general / major / public_basic 都是通识课，保留深链。
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
    if (sort) sp.set("sort", sort);
    sp.set("view", "relations");
    sp.set("page", String(page));
    return sp.toString();
  }, [q, category, sort, page]);

  useEffect(() => {
    if (preview === "error") {
      setData(null);
      setError("课程目录加载失败");
      setLoading(false);
      return;
    }
    if (preview === "empty-catalog" || preview === "empty") {
      setData(emptyCatalogPage());
      setError("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError("");
    api<Paginated<CourseRelation>>(`/api/courses?${queryString}`, {
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
  }, [queryString, reloadToken, preview]);

  function update(next: Record<string, string>, replace = false) {
    const sp = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (!value) sp.delete(key);
      else sp.set(key, value);
    }
    if (!("page" in next)) sp.set("page", "1");
    setParams(sp, { replace });
  }

  // 类别与排序是浏览切换，不算「筛选」；
  // 只有顶栏关键词才走「没有找到匹配」空态，其余空结果跟无数据。
  const hasSearchQuery = Boolean(q);
  const currentPage = data?.pages ? Math.min(data.page, data.pages) : 1;
  const totalPages = data?.pages || 1;

  function clearSearch() {
    update({ q: "", category: "", sort: "", page: "1" }, true);
  }

  const results = (
    <CatalogResultsStates
      loading={loading}
      hasPayload={data != null}
      error={error}
      itemCount={data?.items.length ?? 0}
      hasFilters={hasSearchQuery}
      emptyQuery={q || undefined}
      currentPage={currentPage}
      totalPages={totalPages}
      total={data?.total ?? 0}
      onPageChange={(nextPage) => update({ page: String(nextPage) })}
      onRetry={() => setReloadToken((n) => n + 1)}
      onClearFilters={clearSearch}
      copy={RELATION_CATALOG_COPY}
    >
      {data ? (
        <div>
          {asRelationRows(data.items).map((relation) => (
            <CourseRelationRow
              key={`${relation.course_id}:${relation.teacher_id ?? "none"}`}
              relation={relation}
              search={location.search}
            />
          ))}
        </div>
      ) : null}
    </CatalogResultsStates>
  );

  const browseBox = (
    <Surface
      aria-label="课程类别与排序"
      className="mb-3 flex flex-col gap-2 p-3"
      role="region"
      variant="secondary"
    >
      <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        <Label className="shrink-0">课程类别：</Label>
        {/* 窄屏 3+3 整齐双排(整行宽 grid);sm+ 恢复内联单行。 */}
        <ToggleButtonGroup
          aria-label="课程类别"
          className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto"
          isDetached
          selectedKeys={[categoryToggleKey(category)]}
          selectionMode="single"
          size="sm"
          onSelectionChange={(keys) => {
            const key = firstSelectedKey(keys);
            if (key == null) return;
            update({ category: key === ALL_CATEGORY_KEY ? "" : key }, true);
          }}
        >
          {PUBLIC_CATEGORY_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.id || ALL_CATEGORY_KEY}
              id={opt.id || ALL_CATEGORY_KEY}
            >
              {opt.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
      <Separator />
      <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
        <Label className="shrink-0">排序方式：</Label>
        {/* 窄屏两个选项纵向双排;sm+ 恢复内联单行。 */}
        <ToggleButtonGroup
          aria-label="排序方式"
          className="flex flex-col items-start sm:inline-flex sm:flex-row sm:items-center"
          disallowEmptySelection
          isDetached
          orientation={isMobileFilterLayout ? "vertical" : "horizontal"}
          selectedKeys={[sort || DEFAULT_SORT_KEY]}
          selectionMode="single"
          size="sm"
          onSelectionChange={(keys) => {
            const key = firstSelectedKey(keys);
            if (key == null) return;
            update({ sort: key === DEFAULT_SORT_KEY ? "" : key }, true);
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <ToggleButton
              key={opt.id || DEFAULT_SORT_KEY}
              id={opt.id || DEFAULT_SORT_KEY}
            >
              {opt.id === "" && q ? "相关度" : opt.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
    </Surface>
  );

  // DEV-only #303 variant A: 页内搜索头（含建议）替代生产标题行。
  if (globalSearchVariant === "A" && GlobalSearchVariantAHeader) {
    return (
      <section>
        <Suspense fallback={null}>
          <GlobalSearchVariantAHeader q={q} update={update} />
        </Suspense>
        {browseBox}
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
      {browseBox}
      {results}
    </section>
  );
}
