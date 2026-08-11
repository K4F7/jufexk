import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { CatalogFilters } from "../components/CatalogFilters";
import {
  CatalogResultsStates,
  COURSE_CATALOG_COPY,
} from "../components/CatalogResultsStates";
import { CatalogSearchHeader } from "../components/CatalogSearchHeader";
import { CourseResultTable } from "../components/CourseResultTable";
import { EmptyBox } from "../components/EmptyBox";
import { api } from "../lib/api";
import type { Course, Paginated, Teacher } from "../lib/types";

const FILTER_DELAY = 320;

/** DEV-only: live catalog-search A/B/C compare (production default is C). */
const CatalogSearchPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/CatalogSearchVariants").then((m) => ({
        default: m.CatalogSearchHeader,
      })),
    )
  : null;

/** DEV-only: live catalog-filters A/B/C compare. */
const CatalogFiltersPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/CatalogFiltersVariants").then((m) => ({
        default: m.CatalogFiltersPrototype,
      })),
    )
  : null;

/** DEV-only: live course-table A/B/C compare. */
const CourseTablePrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/CourseTableVariants").then((m) => ({
        default: m.CourseTablePrototype,
      })),
    )
  : null;

/** DEV-only: live catalog-states A/B/C compare. */
const CatalogStatesPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/CatalogStatesVariants").then((m) => ({
        default: m.CatalogStatesPrototype,
      })),
    )
  : null;

/** DEV-only: issue #63 catalog follow-up (favorites + conditional density). */
const CatalogFollowupPrototypeLazy = import.meta.env.DEV
  ? lazy(() =>
      import("../prototype/CatalogFollowupVariants").then((m) => ({
        default: m.CatalogFollowupPrototype,
      })),
    )
  : null;

function useCatalogSearchPrototypeVariant(): "A" | "B" | "C" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "catalog-search") return null;
    const key = (params.get("variant") || "C").toUpperCase();
    if (key === "A" || key === "B" || key === "C") return key;
    return "C";
  }, [params]);
}

function useCatalogFiltersPrototypeVariant(): "A" | "B" | "C" | "D" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "catalog-filters") return null;
    const key = (params.get("variant") || "D").toUpperCase();
    if (key === "A" || key === "B" || key === "C" || key === "D") return key;
    return "D";
  }, [params]);
}

function useCourseTablePrototypeVariant(): "A" | "B" | "C" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "course-table") return null;
    const key = (params.get("variant") || "B").toUpperCase();
    if (key === "A" || key === "B" || key === "C") return key;
    return "B";
  }, [params]);
}

function useCatalogStatesPrototypeVariant(): "A" | "B" | "C" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "catalog-states") return null;
    const key = (params.get("variant") || "A").toUpperCase();
    if (key === "A" || key === "B" || key === "C") return key;
    return "A";
  }, [params]);
}

function useCatalogFollowupPrototypeVariant(): "A" | "B" | "C" | null {
  const [params] = useSearchParams();
  return useMemo(() => {
    if (!import.meta.env.DEV) return null;
    if (params.get("module") !== "catalog-followup") return null;
    const key = (params.get("variant") || "A").toUpperCase();
    if (key === "A" || key === "B" || key === "C") return key;
    return "A";
  }, [params]);
}

export function CoursesPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const catalogSearchVariant = useCatalogSearchPrototypeVariant();
  const catalogFiltersVariant = useCatalogFiltersPrototypeVariant();
  const courseTableVariant = useCourseTablePrototypeVariant();
  const catalogStatesVariant = useCatalogStatesPrototypeVariant();
  const catalogFollowupVariant = useCatalogFollowupPrototypeVariant();
  const q = params.get("q") || "";
  const category = params.get("category") || "";
  const department = params.get("department") || "";
  const teacherId = params.get("teacherId") || "";
  const parsedPage = Number(params.get("page") || "1");
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [queryDraft, setQueryDraft] = useState(q);
  const [departmentDraft, setDepartmentDraft] = useState(department);
  const [teacherQueryDraft, setTeacherQueryDraft] = useState("");
  const [teacherQuery, setTeacherQuery] = useState("");
  const [data, setData] = useState<Paginated<Course> | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [error, setError] = useState("");
  const [teacherError, setTeacherError] = useState("");
  const [loading, setLoading] = useState(true);
  const [teacherLoading, setTeacherLoading] = useState(true);
  /** Bumps to re-fetch the current catalog query (prototype retry / force-reload). */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => setQueryDraft(q), [q]);
  useEffect(() => setDepartmentDraft(department), [department]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setTeacherQuery(teacherQueryDraft.trim()),
      FILTER_DELAY,
    );
    return () => window.clearTimeout(timer);
  }, [teacherQueryDraft]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (category) sp.set("category", category);
    if (department) sp.set("department", department);
    if (teacherId) sp.set("teacherId", teacherId);
    sp.set("page", String(page));
    return sp.toString();
  }, [q, category, department, teacherId, page]);

  useEffect(() => {
    const nextQ = queryDraft.trim();
    const nextDepartment = departmentDraft.trim();
    if (nextQ === q && nextDepartment === department) return;

    const timer = window.setTimeout(() => {
      const sp = new URLSearchParams(params);
      if (nextQ) sp.set("q", nextQ);
      else sp.delete("q");
      if (nextDepartment) sp.set("department", nextDepartment);
      else sp.delete("department");
      sp.set("page", "1");
      setParams(sp, { replace: true });
    }, FILTER_DELAY);

    return () => window.clearTimeout(timer);
  }, [queryDraft, departmentDraft, q, department, params, setParams]);

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

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const query = new URLSearchParams({ page: "1", pageSize: "50" });
    if (teacherQuery) query.set("q", teacherQuery);

    setTeacherLoading(true);
    setTeacherError("");
    api<Paginated<Teacher>>(`/api/teachers?${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) {
          setTeachers((current) => {
            const selected = current.find(
              (teacher) => String(teacher.id) === teacherId,
            );
            if (
              !selected ||
              result.items.some((teacher) => teacher.id === selected.id)
            ) {
              return result.items;
            }
            return [selected, ...result.items];
          });
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setTeacherError((reason as Error).message || "教师筛选暂时不可用");
        }
      })
      .finally(() => {
        if (!cancelled) setTeacherLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [teacherQuery, teacherId]);

  useEffect(() => {
    if (!teacherId) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    api<{ teacher: Teacher }>(`/api/teachers/${teacherId}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (cancelled) return;
        setTeachers((current) =>
          current.some((teacher) => teacher.id === result.teacher.id)
            ? current
            : [result.teacher, ...current],
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [teacherId]);

  function update(next: Record<string, string>, replace = false) {
    const sp = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (!value) sp.delete(key);
      else sp.set(key, value);
    }
    if (!("page" in next)) sp.set("page", "1");
    setParams(sp, { replace });
  }

  const hasFilters = Boolean(
    queryDraft.trim() ||
      q ||
      category ||
      departmentDraft.trim() ||
      department ||
      teacherId ||
      teacherQueryDraft.trim() ||
      teacherQuery,
  );
  const currentPage = data?.pages ? Math.min(data.page, data.pages) : 1;
  const totalPages = data?.pages || 1;

  function clearFilters() {
    setQueryDraft("");
    setDepartmentDraft("");
    setTeacherQueryDraft("");
    update(
      { q: "", category: "", department: "", teacherId: "", page: "1" },
      true,
    );
  }

  const courseMeta = data ? `${data.total} 门课程` : "";
  const comparingSearch =
    Boolean(catalogSearchVariant) && Boolean(CatalogSearchPrototypeLazy);
  const comparingFilters =
    Boolean(catalogFiltersVariant) && Boolean(CatalogFiltersPrototypeLazy);
  const comparingTable =
    Boolean(courseTableVariant) && Boolean(CourseTablePrototypeLazy);
  const comparingStates =
    Boolean(catalogStatesVariant) && Boolean(CatalogStatesPrototypeLazy);
  const comparingFollowup =
    Boolean(catalogFollowupVariant) && Boolean(CatalogFollowupPrototypeLazy);

  const pageSize = data?.pageSize || 20;

  const filtersModel = {
    queryDraft,
    category,
    departmentDraft,
    teacherQueryDraft,
    teacherId,
    teachers,
    teacherLoading,
    teacherError,
    teacherQuery,
    hasFilters,
    setCategory: (value: string) => update({ category: value }),
    setDepartmentDraft,
    setTeacherQueryDraft,
    setTeacherId: (value: string) => update({ teacherId: value }),
    clearFilters,
  };

  const defaultFilters = (
    <CatalogFilters
      queryDraft={queryDraft}
      category={category}
      departmentDraft={departmentDraft}
      teacherQueryDraft={teacherQueryDraft}
      teacherId={teacherId}
      teachers={teachers}
      teacherLoading={teacherLoading}
      teacherError={teacherError}
      teacherQuery={teacherQuery}
      hasFilters={hasFilters}
      onCategoryChange={(value) => update({ category: value })}
      onDepartmentDraftChange={setDepartmentDraft}
      onTeacherQueryDraftChange={setTeacherQueryDraft}
      onTeacherIdChange={(value) => update({ teacherId: value })}
      onClear={clearFilters}
    />
  );

  const statesModel = {
    items: data?.items ?? [],
    search: location.search,
    emptyQuery: q || undefined,
    loading,
    hasPayload: data != null,
    error,
    currentPage,
    totalPages,
    total: data?.total ?? 0,
    pageSize,
    hasFilters,
    onPageChange: (nextPage: number) => update({ page: String(nextPage) }),
    onRetry: () => setReloadToken((n) => n + 1),
    onClearFilters: clearFilters,
  };

  const productionResults = (
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
      onPageChange={(nextPage) => update({ page: String(nextPage) })}
      onRetry={() => setReloadToken((n) => n + 1)}
      onClearFilters={clearFilters}
      copy={COURSE_CATALOG_COPY}
    >
      {data ? (
        comparingTable && courseTableVariant && CourseTablePrototypeLazy ? (
          <Suspense
            fallback={<EmptyBox role="status">加载结果表原型…</EmptyBox>}
          >
            <CourseTablePrototypeLazy
              key={courseTableVariant}
              variant={courseTableVariant}
              items={data.items}
              emptyQuery={q || undefined}
            />
          </Suspense>
        ) : (
          <CourseResultTable
            items={data.items}
            search={location.search}
            emptyQuery={q || undefined}
          />
        )
      ) : null}
    </CatalogResultsStates>
  );

  const results =
    comparingStates && catalogStatesVariant && CatalogStatesPrototypeLazy ? (
      <Suspense fallback={<EmptyBox role="status">加载状态原型…</EmptyBox>}>
        <CatalogStatesPrototypeLazy
          key={catalogStatesVariant}
          variant={catalogStatesVariant}
          model={statesModel}
        />
      </Suspense>
    ) : (
      productionResults
    );

  const followupModel = {
    items: data?.items ?? [],
    emptyQuery: q || undefined,
    loading,
    hasPayload: data != null,
    error,
    currentPage,
    totalPages,
    total: data?.total ?? 0,
    onPageChange: (nextPage: number) => update({ page: String(nextPage) }),
    onRetry: () => setReloadToken((n) => n + 1),
    queryDraft,
    category,
    departmentDraft,
    teacherQueryDraft,
    teacherId,
    teachers,
    teacherLoading,
    teacherError,
    teacherQuery,
    hasFilters,
    onCategoryChange: (value: string) => update({ category: value }),
    onDepartmentDraftChange: setDepartmentDraft,
    onTeacherQueryDraftChange: setTeacherQueryDraft,
    onTeacherIdChange: (value: string) => update({ teacherId: value }),
    onClear: clearFilters,
  };

  // Follow-up prototype owns filters + table; keep search C + states A footer.
  if (
    comparingFollowup &&
    catalogFollowupVariant &&
    CatalogFollowupPrototypeLazy
  ) {
    return (
      <section>
        <CatalogSearchHeader
          title="课程目录"
          meta={courseMeta}
          value={queryDraft}
          onChange={setQueryDraft}
          placeholder="搜索课程、课号或教师"
          searchLabel="搜索课程"
          clearAriaLabel="清空课程搜索"
          name="course-search"
        />
        <Suspense fallback={<EmptyBox role="status">加载目录后续原型…</EmptyBox>}>
          <CatalogFollowupPrototypeLazy
            key={catalogFollowupVariant}
            variant={catalogFollowupVariant}
            model={followupModel}
          />
        </Suspense>
      </section>
    );
  }

  return (
    <section>
      {comparingSearch && catalogSearchVariant && CatalogSearchPrototypeLazy ? (
        <Suspense fallback={null}>
          <CatalogSearchPrototypeLazy
            variant={catalogSearchVariant}
            value={queryDraft}
            onChange={setQueryDraft}
            meta={courseMeta}
          />
        </Suspense>
      ) : (
        <CatalogSearchHeader
          title="课程目录"
          meta={courseMeta}
          value={queryDraft}
          onChange={setQueryDraft}
          placeholder="搜索课程、课号或教师"
          searchLabel="搜索课程"
          clearAriaLabel="清空课程搜索"
          name="course-search"
        />
      )}

      {comparingFilters &&
      catalogFiltersVariant &&
      CatalogFiltersPrototypeLazy ? (
        <Suspense fallback={null}>
          <CatalogFiltersPrototypeLazy
            variant={catalogFiltersVariant}
            model={filtersModel}
          >
            {results}
          </CatalogFiltersPrototypeLazy>
        </Suspense>
      ) : (
        <>
          {defaultFilters}
          {results}
        </>
      )}
    </section>
  );
}
