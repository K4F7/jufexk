/**
 * 本地计划 v3：按学期分桶；未选/备选只在内存，已选才写入 localStorage。
 * 稳定键 term+courseCode+section；v1/v2 迁成已选。
 */
import { localImportCourseId } from "./jwxt-schedule-import";
import {
  offeringKey,
  slotsFromMeetings,
  type JwxtOffering,
} from "./jwxt-offering";
import type { JwxtSnapshotV1 } from "./jwxt-snapshot";
import {
  canAddSlot,
  emptyOccupied,
  insertOccupied,
  SCHEDULE_PLAN_STORAGE_KEY,
  type ScheduleSlot,
  type StagedCourse,
} from "./schedule-plan";

export const SCHEDULE_PLAN_V2 = 2;
export const SCHEDULE_PLAN_V3 = 3;
export const LEGACY_TERM_ID = "legacy";

export type PlanOrigin = "enrolled" | "planned" | "public" | "legacy";
export type CoursePickStatus = 0 | 1 | 2;

export type PlannedItem = {
  key: string;
  termId: string;
  courseCode: string;
  courseName: string;
  section: string;
  teacherName: string;
  origin: PlanOrigin;
  included: boolean;
  status: CoursePickStatus;
  slots: ScheduleSlot[];
  credits: number | null;
  categoryPath: string;
  campus: string;
  place: string;
  courseId: number;
  teacherId: number | null;
  rating: number | null;
  reviewCount: number;
};

export type SchedulePlanV3 = {
  version: typeof SCHEDULE_PLAN_V3;
  activeTermId: string;
  terms: Record<string, PlannedItem[]>;
};

export type SchedulePlanV2 = SchedulePlanV3;

export function emptyPlan(activeTermId = ""): SchedulePlanV3 {
  return { version: SCHEDULE_PLAN_V3, activeTermId, terms: {} };
}

export function itemsOf(plan: SchedulePlanV3, termId = plan.activeTermId): PlannedItem[] {
  return plan.terms[termId] ?? [];
}

export function includedItems(plan: SchedulePlanV3, termId = plan.activeTermId): PlannedItem[] {
  return itemsOf(plan, termId).filter((item) => item.included && item.status >= 1);
}

export function itemToStaged(item: PlannedItem): StagedCourse {
  return {
    id: item.key,
    courseId: item.courseId,
    courseCode: item.courseCode,
    courseName: item.courseName,
    teacherId: item.teacherId,
    teacherName: item.teacherName || null,
    rating: item.rating,
    reviewCount: item.reviewCount,
    slots: item.slots,
  };
}

export function offeringToItem(
  offering: JwxtOffering,
  termId: string,
  origin: PlanOrigin,
  included = true,
  status: CoursePickStatus = included ? 1 : 0,
): PlannedItem {
  const key = offeringKey(termId, offering.courseCode, offering.section, offering.courseName);
  const courseId = offering.catalogCourseId ?? localImportCourseId(offering.courseName, offering.teacherName);
  const teacherId =
    offering.catalogTeacherId ?? (offering.teacherName ? courseId : null);
  return {
    key,
    termId,
    courseCode: offering.courseCode,
    courseName: offering.courseName,
    section: offering.section,
    teacherName: offering.teacherName,
    origin,
    included,
    status,
    slots: slotsFromMeetings(offering.meetings, key),
    credits: offering.credits,
    categoryPath: offering.categoryPath,
    campus: offering.campus,
    place: offering.place,
    courseId,
    teacherId,
    rating: offering.catalogRating ?? null,
    reviewCount: offering.catalogReviewCount ?? 0,
  };
}

function replaceTerm(plan: SchedulePlanV3, termId: string, items: PlannedItem[]): SchedulePlanV3 {
  return {
    ...plan,
    version: SCHEDULE_PLAN_V3,
    activeTermId: plan.activeTermId || termId,
    terms: { ...plan.terms, [termId]: items },
  };
}

export function findSameCourse(items: PlannedItem[], courseCode: string): PlannedItem | undefined {
  return items.find((item) => item.courseCode === courseCode);
}

export function conflictAgainst(
  items: PlannedItem[],
  slots: ScheduleSlot[],
  ignoreKey?: string,
): { ok: true } | { ok: false; collideName: string } {
  const occupied = emptyOccupied();
  for (const item of items) {
    if (!item.included || item.status < 1 || item.key === ignoreKey) continue;
    for (const slot of item.slots) insertOccupied(occupied, slot, itemToStaged(item));
  }
  for (const slot of slots) {
    const result = canAddSlot(occupied, slot, ignoreKey);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export type JoinResult =
  | { ok: true; plan: SchedulePlanV3; swapped: boolean }
  | { ok: false; collideName: string };

export function stageCourse(
  plan: SchedulePlanV3,
  offering: JwxtOffering,
  origin: Exclude<PlanOrigin, "legacy">,
  termId = plan.activeTermId,
): SchedulePlanV3 {
  const incoming = offeringToItem(offering, termId, origin, false, 0);
  const current = itemsOf(plan, termId);
  if (findSameCourse(current, incoming.courseCode)) return replaceTerm(plan, termId, current);
  return replaceTerm(plan, termId, [...current, { ...incoming, teacherName: "", section: "", slots: [] }]);
}

export function joinOffering(
  plan: SchedulePlanV3,
  offering: JwxtOffering,
  origin: Exclude<PlanOrigin, "legacy">,
  termId = plan.activeTermId,
): JoinResult {
  const incoming = offeringToItem(offering, termId, origin, true, 1);
  const current = itemsOf(plan, termId);
  const sameKey = current.find((item) => item.key === incoming.key);
  if (sameKey) {
    if (sameKey.status >= 1 && sameKey.included) {
      return { ok: true, plan, swapped: false };
    }
    return {
      ok: true,
      plan: replaceTerm(
        plan,
        termId,
        current.map((item) => (item.key === incoming.key ? { ...incoming, included: true, status: 1 } : item)),
      ),
      swapped: false,
    };
  }
  const sameCourse = findSameCourse(current, incoming.courseCode);
  if (sameCourse) {
    const without = current.filter((item) => item.key !== sameCourse.key);
    const conflict = conflictAgainst(without, incoming.slots);
    if (!conflict.ok) return conflict;
    return {
      ok: true,
      plan: replaceTerm(plan, termId, [...without, incoming]),
      swapped: sameCourse.status >= 1 && Boolean(sameCourse.section),
    };
  }
  const conflict = conflictAgainst(current, incoming.slots);
  if (!conflict.ok) return conflict;
  return { ok: true, plan: replaceTerm(plan, termId, [...current, incoming]), swapped: false };
}

export function setIncluded(plan: SchedulePlanV3, key: string, included: boolean, termId = plan.activeTermId): SchedulePlanV3 {
  return replaceTerm(
    plan,
    termId,
    itemsOf(plan, termId).map((item) => (item.key === key ? { ...item, included } : item)),
  );
}

export function removeItem(plan: SchedulePlanV3, key: string, termId = plan.activeTermId): SchedulePlanV3 {
  return replaceTerm(
    plan,
    termId,
    itemsOf(plan, termId).filter((item) => item.key !== key),
  );
}

export function removeCourse(plan: SchedulePlanV3, courseCode: string, termId = plan.activeTermId): SchedulePlanV3 {
  return replaceTerm(
    plan,
    termId,
    itemsOf(plan, termId).filter((item) => item.courseCode !== courseCode),
  );
}

export function commitSave(plan: SchedulePlanV3): SchedulePlanV3 {
  const terms: Record<string, PlannedItem[]> = {};
  for (const [termId, items] of Object.entries(plan.terms)) {
    terms[termId] = items.map((item) => (item.status === 1 ? { ...item, status: 2 as const } : item));
  }
  return { ...plan, version: SCHEDULE_PLAN_V3, terms };
}

export function persistedPlan(plan: SchedulePlanV3): SchedulePlanV3 {
  const terms: Record<string, PlannedItem[]> = {};
  for (const [termId, items] of Object.entries(plan.terms)) {
    const selected = items.filter((item) => item.status === 2);
    if (selected.length > 0) terms[termId] = selected;
  }
  return { ...plan, version: SCHEDULE_PLAN_V3, terms };
}

export function mergeEnrolledRefresh(plan: SchedulePlanV3, snapshot: JwxtSnapshotV1): SchedulePlanV3 {
  const termId = snapshot.term.id;
  if (snapshot.enrolled.length === 0) {
    if (snapshot.captured?.includes("enrolled")) {
      return replaceTerm(
        { ...plan, activeTermId: termId || plan.activeTermId },
        termId,
        itemsOf(plan, termId).filter((item) => item.origin !== "enrolled"),
      );
    }
    return { ...plan, activeTermId: termId || plan.activeTermId };
  }
  const current = itemsOf(plan, termId);
  const previousItems = current.filter((item) => item.origin === "enrolled");
  const previousByKey = new Map(previousItems.map((item) => [item.key, item]));
  const previousByCourse = new Map<string, PlannedItem[]>();
  for (const item of previousItems) {
    const matches = previousByCourse.get(item.courseCode) ?? [];
    matches.push(item);
    previousByCourse.set(item.courseCode, matches);
  }
  const incomingCourseCounts = new Map<string, number>();
  for (const offering of snapshot.enrolled) {
    incomingCourseCounts.set(offering.courseCode, (incomingCourseCounts.get(offering.courseCode) ?? 0) + 1);
  }
  const nextEnrolled = snapshot.enrolled.map((offering) => {
    const item = offeringToItem(offering, termId, "enrolled", true, 2);
    const sameCourse = previousByCourse.get(item.courseCode) ?? [];
    const previous = previousByKey.get(item.key) ?? (
      sameCourse.length === 1 && incomingCourseCounts.get(item.courseCode) === 1
        ? sameCourse[0]
        : undefined
    );
    return { ...item, included: previous?.included ?? true, status: 2 as const };
  });
  const enrolledKeys = new Set(nextEnrolled.map((item) => item.key));
  const kept = current.filter((item) => item.origin !== "enrolled" && !enrolledKeys.has(item.key));
  return replaceTerm({ ...plan, activeTermId: termId || plan.activeTermId }, termId, [...nextEnrolled, ...kept]);
}

function isSlot(value: unknown): value is ScheduleSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as ScheduleSlot;
  return typeof slot.id === "string" && typeof slot.weekday === "number" && Array.isArray(slot.weeks);
}

function isPickStatus(value: unknown): value is CoursePickStatus {
  return value === 0 || value === 1 || value === 2;
}

function isPlannedItem(value: unknown): value is PlannedItem {
  if (!value || typeof value !== "object") return false;
  const item = value as PlannedItem;
  return (
    typeof item.key === "string" &&
    typeof item.termId === "string" &&
    typeof item.courseCode === "string" &&
    typeof item.courseName === "string" &&
    typeof item.section === "string" &&
    (item.origin === "enrolled" || item.origin === "planned" || item.origin === "public" || item.origin === "legacy") &&
    typeof item.included === "boolean" &&
    Array.isArray(item.slots) &&
    item.slots.every(isSlot)
  );
}

function isV1Course(value: unknown): value is StagedCourse {
  if (!value || typeof value !== "object") return false;
  const course = value as StagedCourse;
  return (
    typeof course.id === "string" &&
    typeof course.courseName === "string" &&
    typeof course.courseCode === "string" &&
    Array.isArray(course.slots)
  );
}

function withLoadedStatus(item: PlannedItem): PlannedItem {
  return {
    ...item,
    status: isPickStatus(item.status) ? item.status : 2,
  };
}

export function migrateV1Courses(courses: StagedCourse[]): SchedulePlanV3 {
  const items: PlannedItem[] = courses.filter(isV1Course).map((course) => ({
    key: offeringKey(LEGACY_TERM_ID, course.courseCode || course.id, String(course.id)),
    termId: LEGACY_TERM_ID,
    courseCode: course.courseCode,
    courseName: course.courseName,
    section: course.id,
    teacherName: course.teacherName || "",
    origin: "legacy",
    included: true,
    status: 2,
    slots: course.slots,
    credits: null,
    categoryPath: "",
    campus: "",
    place: "",
    courseId: course.courseId,
    teacherId: course.teacherId,
    rating: course.rating,
    reviewCount: course.reviewCount,
  }));
  return { version: SCHEDULE_PLAN_V3, activeTermId: LEGACY_TERM_ID, terms: { [LEGACY_TERM_ID]: items } };
}

export function parsePlan(raw: string | null): SchedulePlanV3 {
  if (!raw) return emptyPlan();
  try {
    const parsed = JSON.parse(raw) as { version?: number; courses?: unknown; terms?: unknown; activeTermId?: unknown };
    if (parsed.version === 1) {
      return Array.isArray(parsed.courses) ? migrateV1Courses(parsed.courses.filter(isV1Course)) : emptyPlan();
    }
    if (
      (parsed.version !== SCHEDULE_PLAN_V2 && parsed.version !== SCHEDULE_PLAN_V3) ||
      !parsed.terms ||
      typeof parsed.terms !== "object"
    ) {
      return emptyPlan();
    }
    const terms: Record<string, PlannedItem[]> = {};
    for (const [termId, items] of Object.entries(parsed.terms as Record<string, unknown>)) {
      if (!Array.isArray(items)) continue;
      terms[termId] = items.filter(isPlannedItem).map((item) => ({
        ...withLoadedStatus(item),
        key: offeringKey(termId, item.courseCode, item.section, item.courseName),
      }));
    }
    const plan: SchedulePlanV3 = {
      version: SCHEDULE_PLAN_V3,
      activeTermId: typeof parsed.activeTermId === "string" ? parsed.activeTermId : Object.keys(terms)[0] || "",
      terms,
    };
    return parsed.version === SCHEDULE_PLAN_V3 ? persistedPlan(plan) : plan;
  } catch {
    return emptyPlan();
  }
}

export function loadPlan(): SchedulePlanV3 {
  if (typeof localStorage === "undefined") return emptyPlan();
  try {
    return parsePlan(localStorage.getItem(SCHEDULE_PLAN_STORAGE_KEY));
  } catch {
    return emptyPlan();
  }
}

export function savePlan(plan: SchedulePlanV3) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SCHEDULE_PLAN_STORAGE_KEY, JSON.stringify(persistedPlan(commitSave(plan))));
}
