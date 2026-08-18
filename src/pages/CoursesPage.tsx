import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  CatalogFilters,
  catalogActiveFilters,
  isPublicCategoryFilter,
} from "../components/CatalogFilters";
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
  const rawCategory = params.get("category") || "";
  const category = isPublicCategoryFilter(rawCategory) ? rawCategory : "";
  const department = params.get("department") || "";
  const teacherId = params.get("teacherId") || "";
  const sort = params.get("sort") === "name" ? "name" : "reviews";
  const parsedPage = Number(params.get("page") || "1");
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [queryDraft, setQueryDraft] = useState(q);
  const [departmentDraft, setDepartmentDraft] = useState(department);
  const [teacherQueryDraft, setTeacherQueryDraft] = useState("");
  const [teacherQuery, setTeacherQuery] = useState("");
  const [data, setData] = useState<Paginated<Course> | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [error, setError] = useState("");
  const [teacherError, setTeacherError] = useState("");
  const [loading, setLoading] = useState(true);
  const [teacherLoading, setTeacherLoading] = useState(true);
  /** Bumps to re-fetch the current catalog query (prototype retry / force-reload). */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => setQueryDraft(q), [q]);
  useEffect(() => setDepartmentDraft(department), [department]);
  useEffect(() => {
    // Stale bookmarks may still carry major/pe/general; those 400 on the API.
    if (!rawCategory || isPublicCategoryFilter(rawCategory)) return;
    const next = new URLSearchParams(params);
    next.delete("category");
    setParams(next, { replace: true });
  }, [rawCategory, params, setParams]);

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
    if (sort !== "reviews") sp.set("sort", sort);
    sp.set("page", String(page));
    return sp.toString();
  }, [q, category, department, teacherId, sort, page]);

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

  /** 深链 teacherId 的解析状态：pending=按 id 拉取中；found=姓名可用；
   *  missing=该 id 不存在（Issue #213，不再回退显示原始 id）。 */
  const [teacherIdStatus, setTeacherIdStatus] = useState<
    "pending" | "found" | "missing"
  >("pending");

  // 深链教师不在当前列表（默认前 50 / 当前搜索）时按 id 拉取并并入选项。
  useEffect(() => {
    if (!teacherId) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setTeacherIdStatus("pending");
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
        setTeacherIdStatus("found");
      })
      .catch(() => {
        if (!cancelled) setTeacherIdStatus("missing");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [teacherId]);

  // 教师本就在当前列表内（前 50 或搜索命中）时直接视为已解析，不等按 id 拉取。
  useEffect(() => {
    if (
      teacherId &&
      teachers.some((teacher) => String(teacher.id) === teacherId)
    ) {
      setTeacherIdStatus("found");
    }
  }, [teacherId, teachers]);

  // 院系筛选项：目录去重非空院系；拉取失败视为无选项（院系筛隐藏，Issue #203）。
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    api<{ items: string[] }>("/api/courses/departments", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!cancelled) setDepartments(result.items);
      })
      .catch(() => {
        if (!cancelled) setDepartments([]);
      })
      .finally(() => {
        if (!cancelled) setDepartmentsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  // 深链 ?teacherId= 进入时，把选中教师姓名回填进教师 ComboBox 输入框。
  useEffect(() => {
    if (!teacherId || teacherQueryDraft) return;
    const selected = teachers.find(
      (teacher) => String(teacher.id) === teacherId,
    );
    if (selected) setTeacherQueryDraft(selected.name);
  }, [teacherId, teachers, teacherQueryDraft]);

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
  const selectedTeacherName = teacherId
    ? teachers.find((teacher) => String(teacher.id) === teacherId)?.name
    : undefined;
  /** 与「当前筛选」chips 同源的标签列表，供空状态文案点名全部生效筛选。 */
  const activeFilterLabels = catalogActiveFilters({
    queryDraft,
    category,
    departmentDraft,
    teacherId,
    teacherIdStatus,
    teacherQueryDraft,
    selectedTeacherName,
  }).map((tag) => tag.label);

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
  /** 深链院系不在目录选项内时并入列表，保证 Select 能显示当前值。 */
  const departmentOptions = useMemo(
    () =>
      department && !departments.includes(department)
        ? [department, ...departments]
        : departments,
    [department, departments],
  );
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
      departments={departmentOptions}
      departmentsLoading={departmentsLoading}
      teacherQueryDraft={teacherQueryDraft}
      teacherId={teacherId}
      teacherIdStatus={teacherIdStatus}
      teachers={teachers}
      teacherLoading={teacherLoading}
      teacherError={teacherError}
      teacherQuery={teacherQuery}
      sort={sort}
      hasFilters={hasFilters}
      onCategoryChange={(value) => update({ category: value })}
      onDepartmentDraftChange={setDepartmentDraft}
      onTeacherQueryDraftChange={setTeacherQueryDraft}
      onTeacherIdChange={(value) => update({ teacherId: value })}
      onSortChange={(value) =>
        update({ sort: value === "reviews" ? "" : value })
      }
      onQueryClear={() => {
        setQueryDraft("");
        update({ q: "" }, true);
      }}
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
      emptyFilters={activeFilterLabels}
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
    departments: departmentOptions,
    departmentsLoading,
    teacherQueryDraft,
    teacherId,
    teacherIdStatus,
    teachers,
    teacherLoading,
    teacherError,
    teacherQuery,
    sort,
    hasFilters,
    onCategoryChange: (value: string) => update({ category: value }),
    onDepartmentDraftChange: setDepartmentDraft,
    onTeacherQueryDraftChange: setTeacherQueryDraft,
    onTeacherIdChange: (value: string) => update({ teacherId: value }),
    onSortChange: (value: string) =>
      update({ sort: value === "reviews" ? "" : value }),
    onQueryClear: () => {
      setQueryDraft("");
      update({ q: "" }, true);
    },
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
          metaLoading={loading && !data}
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
