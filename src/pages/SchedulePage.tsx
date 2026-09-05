/**
 * 排课模拟 /schedule：培养方案课号去重后再选开课班。
 * 未选不占课表；点班上表为备选；保存课表才变成已选。
 * 只做电脑端；窄屏进入弹一次告示（Issue #565）。
 */
import { Alert, Typography } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { JwxtCourseBrowser } from "../components/JwxtCourseBrowser";
import { ScheduleMobileNotice } from "../components/ScheduleMobileNotice";
import { ScheduleTimetable } from "../components/ScheduleTimetable";
import { api } from "../lib/api";
import {
  catalogBrowseSnapshot,
  catalogFiltersReady,
  catalogScheduleGrades,
  catalogScheduleMajors,
  catalogScheduleTerms,
  currentCatalogTermId,
  offeringsFromScheduleRows,
  programPlanCourseToOffering,
  relationToOffering,
  uniqueOfferingsByCourseCode,
  type ScheduleOfferingRow,
} from "../lib/catalog-schedule";
import type { JwxtFilterOption, JwxtOffering } from "../lib/jwxt-offering";
import {
  commitSave,
  includedItems,
  itemToStaged,
  itemsOf,
  joinOffering,
  loadPlan,
  persistPlan,
  removeCourse,
  savePlan,
  setIncluded,
  stageCourse,
  type SchedulePlanV2,
} from "../lib/jwxt-plan";
import {
  catalogTermToSuggestedTerm,
  uniqueProgramCourses,
  PROGRAM_PLAN_RECORD_SCHEMA,
  type ProgramPlanCourse,
} from "../lib/program-plan";
import { conflictMessage, listConflicts } from "../lib/schedule-plan";
import type { CourseRelation, Paginated } from "../lib/types";

const emptyFilter: JwxtFilterOption = { id: "", label: "" };

async function fetchCatalogRelations(filters: {
  category?: string;
}): Promise<CourseRelation[]> {
  const items: CourseRelation[] = [];
  for (let page = 1; page <= 2; page += 1) {
    const params = new URLSearchParams({
      view: "relations",
      pageSize: "50",
      sort: "name",
      page: String(page),
    });
    if (filters.category) params.set("category", filters.category);
    const data = await api<Paginated<CourseRelation>>(`/api/courses?${params.toString()}`);
    items.push(...(data.items ?? []));
    if (page >= (data.pages || 1)) break;
  }
  return items;
}

async function fetchProgramPlanCourses(grade: string, major: string): Promise<ProgramPlanCourse[]> {
  const params = new URLSearchParams({ grade, major });
  const data = await api<{ items: Array<{
    courseCode: string;
    courseName: string;
    credits: number | null;
    categoryPath: string;
    courseStanding: string;
    suggestedTerm: string;
    catalogCourseId: number | null;
  }> }>(`/api/program-plan?${params.toString()}`);
  return (data.items ?? []).map((item) => ({
    schemaVersion: PROGRAM_PLAN_RECORD_SCHEMA,
    grade,
    departmentCode: "",
    departmentName: "",
    majorCode: "",
    majorName: major,
    studyKind: "主修",
    courseCode: item.courseCode,
    courseName: item.courseName,
    credits: item.credits,
    categoryPath: item.categoryPath,
    courseStanding: item.courseStanding,
    assessment: "",
    suggestedTerm: item.suggestedTerm,
    totalHours: null,
    lectureHours: null,
    labHours: null,
    practiceHours: null,
    otherHours: null,
    weeklyHours: null,
    catalogCourseId: item.catalogCourseId,
  }));
}

async function fetchScheduleOfferings(courseId: number, termId: string): Promise<ScheduleOfferingRow[]> {
  const params = new URLSearchParams({ courseId: String(courseId), term: termId });
  const rows = await api<ScheduleOfferingRow[]>(`/api/schedule-offerings?${params.toString()}`);
  return Array.isArray(rows) ? rows : [];
}

export function SchedulePage() {
  const terms = useMemo(() => catalogScheduleTerms(), []);
  const grades = useMemo(() => catalogScheduleGrades(), []);
  const defaultTerm = useMemo(
    () => terms.find((item) => item.id === currentCatalogTermId()) ?? terms[0] ?? emptyFilter,
    [terms],
  );

  const [plan, setPlan] = useState<SchedulePlanV2>(() => {
    const loaded = loadPlan();
    return loaded.activeTermId ? loaded : { ...loaded, activeTermId: defaultTerm.id };
  });
  const [term, setTerm] = useState<JwxtFilterOption>(defaultTerm);
  const [grade, setGrade] = useState<JwxtFilterOption>(emptyFilter);
  const [major, setMajor] = useState<JwxtFilterOption>(emptyFilter);
  const majors = useMemo(() => catalogScheduleMajors(), []);
  const [planned, setPlanned] = useState<JwxtOffering[]>([]);
  const [publicElectives, setPublicElectives] = useState<JwxtOffering[]>([]);
  const [offeringsByCode, setOfferingsByCode] = useState<Record<string, JwxtOffering[]>>({});
  const [selectedCode, setSelectedCode] = useState("");
  const [notice, setNotice] = useState("");
  const [joinError, setJoinError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogReload, setCatalogReload] = useState(0);
  const [savePending, setSavePending] = useState(false);
  const [selectedOfferingsLoading, setSelectedOfferingsLoading] = useState(false);
  const [selectedOfferingsError, setSelectedOfferingsError] = useState("");
  const enrichedCodes = useRef(new Set<string>());
  const selectedRequest = useRef(0);
  const selectionGeneration = useRef(0);

  const filtersReady = catalogFiltersReady(grade, major);

  useEffect(() => {
    if (!filtersReady) {
      setCatalogLoading(false);
      enrichedCodes.current = new Set();
      setPlanned([]);
      setPublicElectives([]);
      setOfferingsByCode({});
      return;
    }
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError("");
    setPlanned([]);
    setPublicElectives([]);
    void Promise.all([
      fetchProgramPlanCourses(grade.id, major.id),
      fetchCatalogRelations({ category: "sports" }),
    ])
      .then(([programRows, sportsRows]) => {
        if (cancelled) return;
        const unique = uniqueProgramCourses(programRows, catalogTermToSuggestedTerm(term.id));
        setPlanned(unique.map(programPlanCourseToOffering));
        setPublicElectives(
          uniqueOfferingsByCourseCode(sportsRows.map((row) => relationToOffering(row, "public"))),
        );
        setCatalogError("");
      })
      .catch(() => {
        if (!cancelled) setCatalogError("无法读取培养方案或公共选修目录。");
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogReload, filtersReady, grade.id, major.id, term.id]);

  const snapshot = useMemo(
    () =>
      catalogBrowseSnapshot({
        term,
        terms,
        grade,
        grades,
        major,
        majors,
        planned,
        publicElectives,
      }),
    [term, terms, grade, grades, major, majors, planned, publicElectives],
  );

  const termItems = itemsOf(plan, term.id || plan.activeTermId);
  const staged = useMemo(
    () => includedItems(plan, term.id || plan.activeTermId).map(itemToStaged),
    [plan, term],
  );
  const conflicts = useMemo(() => listConflicts(staged), [staged]);
  const selectedOfferings = offeringsByCode[selectedCode] ?? [];

  function handleFilters(patch: Partial<Pick<typeof snapshot, "term" | "grade" | "major">>) {
    selectionGeneration.current += 1;
    selectedRequest.current += 1;
    enrichedCodes.current = new Set();
    setOfferingsByCode({});
    setSelectedOfferingsLoading(false);
    setSelectedOfferingsError("");
    if (patch.term) {
      setTerm(patch.term);
      setPlan((current) => ({ ...current, activeTermId: patch.term?.id || current.activeTermId }));
    }
    if (patch.grade) {
      setGrade(patch.grade);
      setMajor(emptyFilter);
    }
    if (patch.major) setMajor(patch.major);
  }

  async function enrichCourse(courseCode: string) {
    const generation = selectionGeneration.current;
    const cacheKey = `${term.id}:${courseCode}`;
    const seed = [...planned, ...publicElectives].find((item) => item.courseCode === courseCode);
    if (!seed?.catalogCourseId) return offeringsByCode[courseCode] ?? [];
    if (enrichedCodes.current.has(cacheKey) && offeringsByCode[courseCode]) {
      return offeringsByCode[courseCode];
    }
    const rows = await fetchScheduleOfferings(seed.catalogCourseId, term.id);
    if (generation !== selectionGeneration.current) return [];
    const next = offeringsFromScheduleRows(seed, rows);
    enrichedCodes.current.add(cacheKey);
    setOfferingsByCode((current) => ({ ...current, [courseCode]: next }));
    return next;
  }

  async function handleSelectCourse(courseCode: string) {
    setSelectedCode(courseCode);
    const request = ++selectedRequest.current;
    setSelectedOfferingsError("");
    if (!courseCode) {
      setSelectedOfferingsLoading(false);
      return;
    }
    setSelectedOfferingsLoading(true);
    try {
      await enrichCourse(courseCode);
    } catch {
      if (request === selectedRequest.current) {
        setSelectedOfferingsError("无法读取开课班，请检查网络后重试。");
      }
    } finally {
      if (request === selectedRequest.current) setSelectedOfferingsLoading(false);
    }
  }

  function handleStage(offering: JwxtOffering, origin: "planned" | "public") {
    setJoinError("");
    setPlan(stageCourse({ ...plan, activeTermId: term.id }, offering, origin, term.id));
    setNotice(`已将${offering.courseName}加入待选课表。`);
  }

  async function handleJoin(offering: JwxtOffering, origin: "planned" | "public") {
    let nextRows: JwxtOffering[];
    try {
      nextRows = await enrichCourse(offering.courseCode);
    } catch {
      setJoinError("无法读取开课班，请检查网络后重试。");
      return;
    }
    const enriched =
      nextRows.find((item) => item.catalogTeacherId === offering.catalogTeacherId && item.courseCode === offering.courseCode)
      ?? nextRows.find((item) => item.teacherName === offering.teacherName && item.courseCode === offering.courseCode)
      ?? offering;
    const result = joinOffering({ ...plan, activeTermId: term.id }, enriched, origin, term.id);
    if (!result.ok) {
      setJoinError(`${offering.courseName}与${result.collideName}时间冲突，未加入。`);
      return;
    }
    setJoinError("");
    setPlan(result.plan);
    setNotice(result.swapped ? `已将${offering.courseName}换到新班次。` : `已将${offering.courseName}加入课表。`);
  }

  function handleSave() {
    if (savePending) return;
    setSavePending(true);
    const committed = commitSave(plan);
    savePlan(committed);
    setPlan(committed);
    setNotice("课表已保存到本机。");
    window.setTimeout(() => setSavePending(false), 250);
  }

  return (
    <section>
      <ScheduleMobileNotice />
      <header aria-label="排课模拟标题" className="mb-3">
        <Typography
          className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
          type="h1"
        >
          排课模拟
        </Typography>
        <p className="mb-0 mt-1 text-sm text-muted">提前处理掉早八刺客</p>
      </header>

      {catalogLoading ? (
        <Alert className="mb-4" role="status">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>目录加载中</Alert.Title>
            <Alert.Description>正在读取培养方案和公共选修目录，请稍候。</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {notice ? (
        <Alert className="mb-4" role="status">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>课表</Alert.Title>
            <Alert.Description>{notice}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {joinError ? (
        <Alert className="mb-4" role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>无法加入</Alert.Title>
            <Alert.Description>{joinError}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {conflicts.length > 0 ? (
        <Alert className="mb-4" role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>课表有时间冲突</Alert.Title>
            <Alert.Description>
              {conflicts.map((conflict) => conflictMessage(conflict)).join("；")}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-8">
        <div className="min-w-0">
          <JwxtCourseBrowser
            snapshot={snapshot}
            planItems={termItems}
            courseOfferings={selectedOfferings}
            candidatesReady={filtersReady}
            candidatesLoading={catalogLoading}
            candidatesError={catalogError}
            courseOfferingsLoading={selectedOfferingsLoading}
            courseOfferingsError={selectedOfferingsError}
            onFilters={handleFilters}
            onSelectedCourseChange={(code) => {
              void handleSelectCourse(code);
            }}
            onRetryCourseOfferings={() => {
              void handleSelectCourse(selectedCode);
            }}
            onRetryCandidates={() => setCatalogReload((current) => current + 1)}
            onStage={handleStage}
            onJoin={(offering, origin) => {
              void handleJoin(offering, origin);
            }}
            onToggle={(item, included) => {
              setPlan(setIncluded(plan, item.key, included, item.termId));
            }}
            onRemove={(item) => {
              const next = removeCourse(plan, item.courseCode, item.termId);
              setPlan(next);
              if (item.status === 2) persistPlan(next);
            }}
            onSave={handleSave}
            savePending={savePending}
          />
        </div>

        <div>
          <Typography className="m-0 mb-2 text-sm font-semibold" type="h2">
            模拟课表
          </Typography>
          <ScheduleTimetable courses={staged} />
        </div>
      </div>
    </section>
  );
}
