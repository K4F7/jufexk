/**
 * 本地计划 v2：按学期分桶，origin=enrolled|planned|public|legacy。
 * 稳定键 term+courseCode+section；v1 自动迁移为 legacy。
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
export const LEGACY_TERM_ID = "legacy";

export type PlanOrigin = "enrolled" | "planned" | "public" | "legacy";

export type PlannedItem = {
  key: string;
  termId: string;
  courseCode: string;
  courseName: string;
  section: string;
  teacherName: string;
  origin: PlanOrigin;
  included: boolean;
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

export type SchedulePlanV2 = {
  version: typeof SCHEDULE_PLAN_V2;
  activeTermId: string;
  terms: Record<string, PlannedItem[]>;
};

export function emptyPlan(activeTermId = ""): SchedulePlanV2 {
  return { version: SCHEDULE_PLAN_V2, activeTermId, terms: {} };
}

export function itemsOf(plan: SchedulePlanV2, termId = plan.activeTermId): PlannedItem[] {
  return plan.terms[termId] ?? [];
}

export function includedItems(plan: SchedulePlanV2, termId = plan.activeTermId): PlannedItem[] {
  return itemsOf(plan, termId).filter((item) => item.included);
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

function replaceTerm(plan: SchedulePlanV2, termId: string, items: PlannedItem[]): SchedulePlanV2 {
  return {
    ...plan,
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
    if (!item.included || item.key === ignoreKey) continue;
    for (const slot of item.slots) insertOccupied(occupied, slot, itemToStaged(item));
  }
  for (const slot of slots) {
    const result = canAddSlot(occupied, slot, ignoreKey);
    if (!result.ok) return result;
  }
  return { ok: true };
}

export type JoinResult =
  | { ok: true; plan: SchedulePlanV2; swapped: boolean }
  | { ok: false; collideName: string };

export function joinOffering(
  plan: SchedulePlanV2,
  offering: JwxtOffering,
  origin: Exclude<PlanOrigin, "legacy">,
  termId = plan.activeTermId,
): JoinResult {
  const incoming = offeringToItem(offering, termId, origin, true);
  const current = itemsOf(plan, termId);
  const sameKey = current.find((item) => item.key === incoming.key);
  if (sameKey) {
    return { ok: true, plan: replaceTerm(plan, termId, current.map((item) => (item.key === incoming.key ? { ...incoming, included: true } : item))), swapped: false };
  }
  const sameCourse = findSameCourse(current, incoming.courseCode);
  if (sameCourse) {
    const without = current.filter((item) => item.key !== sameCourse.key);
    const conflict = conflictAgainst(without, incoming.slots);
    if (!conflict.ok) return conflict;
    return {
      ok: true,
      plan: replaceTerm(plan, termId, [...without, { ...incoming, included: sameCourse.included }]),
      swapped: true,
    };
  }
  const conflict = conflictAgainst(current, incoming.slots);
  if (!conflict.ok) return conflict;
  return { ok: true, plan: replaceTerm(plan, termId, [...current, incoming]), swapped: false };
}

export function setIncluded(plan: SchedulePlanV2, key: string, included: boolean, termId = plan.activeTermId): SchedulePlanV2 {
  return replaceTerm(
    plan,
    termId,
    itemsOf(plan, termId).map((item) => (item.key === key ? { ...item, included } : item)),
  );
}

export function removeItem(plan: SchedulePlanV2, key: string, termId = plan.activeTermId): SchedulePlanV2 {
  return replaceTerm(
    plan,
    termId,
    itemsOf(plan, termId).filter((item) => item.key !== key),
  );
}

export function mergeEnrolledRefresh(plan: SchedulePlanV2, snapshot: JwxtSnapshotV1): SchedulePlanV2 {
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
    const item = offeringToItem(offering, termId, "enrolled", true);
    const sameCourse = previousByCourse.get(item.courseCode) ?? [];
    const previous = previousByKey.get(item.key) ?? (
      sameCourse.length === 1 && incomingCourseCounts.get(item.courseCode) === 1
        ? sameCourse[0]
        : undefined
    );
    return { ...item, included: previous?.included ?? true };
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

export function migrateV1Courses(courses: StagedCourse[]): SchedulePlanV2 {
  const items: PlannedItem[] = courses.filter(isV1Course).map((course) => ({
    key: offeringKey(LEGACY_TERM_ID, course.courseCode || course.id, String(course.id)),
    termId: LEGACY_TERM_ID,
    courseCode: course.courseCode,
    courseName: course.courseName,
    section: course.id,
    teacherName: course.teacherName || "",
    origin: "legacy",
    included: true,
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
  return { version: SCHEDULE_PLAN_V2, activeTermId: LEGACY_TERM_ID, terms: { [LEGACY_TERM_ID]: items } };
}

export function parsePlan(raw: string | null): SchedulePlanV2 {
  if (!raw) return emptyPlan();
  try {
    const parsed = JSON.parse(raw) as { version?: number; courses?: unknown; terms?: unknown; activeTermId?: unknown };
    if (parsed.version === 1) {
      return Array.isArray(parsed.courses) ? migrateV1Courses(parsed.courses.filter(isV1Course)) : emptyPlan();
    }
    if (parsed.version !== SCHEDULE_PLAN_V2 || !parsed.terms || typeof parsed.terms !== "object") {
      return emptyPlan();
    }
    const terms: Record<string, PlannedItem[]> = {};
    for (const [termId, items] of Object.entries(parsed.terms as Record<string, unknown>)) {
      if (!Array.isArray(items)) continue;
      terms[termId] = items.filter(isPlannedItem).map((item) => ({
        ...item,
        key: offeringKey(termId, item.courseCode, item.section, item.courseName),
      }));
    }
    return {
      version: SCHEDULE_PLAN_V2,
      activeTermId: typeof parsed.activeTermId === "string" ? parsed.activeTermId : Object.keys(terms)[0] || "",
      terms,
    };
  } catch {
    return emptyPlan();
  }
}

export function loadPlan(): SchedulePlanV2 {
  if (typeof localStorage === "undefined") return emptyPlan();
  try {
    return parsePlan(localStorage.getItem(SCHEDULE_PLAN_STORAGE_KEY));
  } catch {
    return emptyPlan();
  }
}

export function savePlan(plan: SchedulePlanV2) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SCHEDULE_PLAN_STORAGE_KEY, JSON.stringify(plan));
}
