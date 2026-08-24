/**
 * 排课模拟：本机课表计划与冲突检测。
 * 冲突算法参考 tongji-course-scheduler 的 occupy / 周次相交，
 * 对象是本站课程×教师任课关系，不是开课班目录。
 */

export const PERIOD_COUNT = 11;
export const WEEKDAY_COUNT = 7;
export const DEFAULT_WEEK_COUNT = 16;
export const SCHEDULE_PLAN_STORAGE_KEY = "jufexk-schedule-plan";
export const SCHEDULE_PLAN_VERSION = 1;

export const JUFE_PERIODS = [
  { period: 1, start: "08:00", end: "08:45" },
  { period: 2, start: "08:50", end: "09:35" },
  { period: 3, start: "09:55", end: "10:40" },
  { period: 4, start: "10:45", end: "11:30" },
  { period: 5, start: "11:35", end: "12:20" },
  { period: 6, start: "14:00", end: "14:45" },
  { period: 7, start: "14:50", end: "15:35" },
  { period: 8, start: "15:55", end: "16:40" },
  { period: 9, start: "16:45", end: "17:30" },
  { period: 10, start: "19:00", end: "19:45" },
  { period: 11, start: "19:50", end: "20:35" },
] as const;

export const WEEKDAYS = [
  { day: 1, label: "周一" },
  { day: 2, label: "周二" },
  { day: 3, label: "周三" },
  { day: 4, label: "周四" },
  { day: 5, label: "周五" },
  { day: 6, label: "周六" },
  { day: 7, label: "周日" },
] as const;

export type ScheduleSlot = {
  id: string;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
};

export type StagedCourse = {
  id: string;
  courseId: number;
  courseCode: string;
  courseName: string;
  teacherId: number | null;
  teacherName: string | null;
  rating: number | null;
  reviewCount: number;
  slots: ScheduleSlot[];
};

export type OccupyCell = {
  courseKey: string;
  courseName: string;
  courseId: number;
  teacherId: number | null;
  weeks: number[];
};

export type SlotConflict = {
  leftName: string;
  rightName: string;
  sameCourse: boolean;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
};

export function defaultWeeks(): number[] {
  return Array.from({ length: DEFAULT_WEEK_COUNT }, (_, index) => index + 1);
}

export function stagedCourseId(
  courseId: number,
  teacherId: number | null,
): string {
  return `${courseId}:${teacherId ?? 0}`;
}

export function stagedCourseName(course: Pick<StagedCourse, "courseName" | "teacherName">) {
  return course.teacherName
    ? `${course.courseName}（${course.teacherName}）`
    : course.courseName;
}

export function weekdayLabel(day: number): string {
  return WEEKDAYS.find((item) => item.day === day)?.label ?? `周${day}`;
}

export function periodRange(startPeriod: number, endPeriod: number): number[] {
  const start = Math.min(startPeriod, endPeriod);
  const end = Math.max(startPeriod, endPeriod);
  const periods: number[] = [];
  for (let period = start; period <= end; period += 1) periods.push(period);
  return periods;
}

export function normalizeSlot(slot: Omit<ScheduleSlot, "id"> & { id?: string }): ScheduleSlot {
  const startPeriod = Math.min(slot.startPeriod, slot.endPeriod);
  const endPeriod = Math.max(slot.startPeriod, slot.endPeriod);
  return {
    id: slot.id ?? `${slot.weekday}-${startPeriod}-${endPeriod}`,
    weekday: slot.weekday,
    startPeriod,
    endPeriod,
    weeks: [...slot.weeks].sort((left, right) => left - right),
  };
}

export function weeksIntersect(left: number[], right: number[]): boolean {
  const other = new Set(right);
  return left.some((week) => other.has(week));
}

export function periodsOverlap(left: ScheduleSlot, right: ScheduleSlot): boolean {
  return (
    left.weekday === right.weekday &&
    left.startPeriod <= right.endPeriod &&
    right.startPeriod <= left.endPeriod
  );
}

export function emptyOccupied(): OccupyCell[][][] {
  return Array.from({ length: PERIOD_COUNT }, () =>
    Array.from({ length: WEEKDAY_COUNT }, () => [] as OccupyCell[]),
  );
}

export function insertOccupied(
  occupied: OccupyCell[][][],
  slot: ScheduleSlot,
  course: Pick<
    StagedCourse,
    "id" | "courseId" | "teacherId" | "courseName" | "teacherName"
  >,
) {
  const normalized = normalizeSlot(slot);
  const courseName = stagedCourseName(course);
  for (const period of periodRange(normalized.startPeriod, normalized.endPeriod)) {
    occupied[period - 1][normalized.weekday - 1].push({
      courseKey: course.id,
      courseName,
      courseId: course.courseId,
      teacherId: course.teacherId,
      weeks: normalized.weeks,
    });
  }
}

export function buildOccupied(courses: StagedCourse[]): OccupyCell[][][] {
  const occupied = emptyOccupied();
  for (const course of courses) {
    for (const slot of course.slots) {
      insertOccupied(occupied, slot, course);
    }
  }
  return occupied;
}

/** 参考 tongji canAddCourse：同一时段且周次相交则不能无冲突加入。 */
export function canAddSlot(
  occupied: OccupyCell[][][],
  slot: ScheduleSlot,
  ignoreCourseKey?: string,
): { ok: true } | { ok: false; collideName: string } {
  const normalized = normalizeSlot(slot);
  for (const period of periodRange(normalized.startPeriod, normalized.endPeriod)) {
    const cell = occupied[period - 1]?.[normalized.weekday - 1] ?? [];
    const hit = cell.find(
      (item) =>
        item.courseKey !== ignoreCourseKey &&
        weeksIntersect(item.weeks, normalized.weeks),
    );
    if (hit) return { ok: false, collideName: hit.courseName };
  }
  return { ok: true };
}

export function cellHasConflict(cell: OccupyCell[]): boolean {
  for (let index = 0; index < cell.length; index += 1) {
    for (let next = index + 1; next < cell.length; next += 1) {
      if (weeksIntersect(cell[index].weeks, cell[next].weeks)) return true;
    }
  }
  return false;
}

export function listConflicts(courses: StagedCourse[]): SlotConflict[] {
  const conflicts: SlotConflict[] = [];
  const seen = new Set<string>();
  for (let leftIndex = 0; leftIndex < courses.length; leftIndex += 1) {
    const left = courses[leftIndex];
    for (let rightIndex = leftIndex; rightIndex < courses.length; rightIndex += 1) {
      const right = courses[rightIndex];
      for (const leftSlot of left.slots) {
        for (const rightSlot of right.slots) {
          if (left.id === right.id && leftSlot.id === rightSlot.id) continue;
          if (!periodsOverlap(leftSlot, rightSlot)) continue;
          if (!weeksIntersect(leftSlot.weeks, rightSlot.weeks)) continue;
          const startPeriod = Math.max(leftSlot.startPeriod, rightSlot.startPeriod);
          const endPeriod = Math.min(leftSlot.endPeriod, rightSlot.endPeriod);
          const key = [
            left.id,
            right.id,
            leftSlot.weekday,
            startPeriod,
            endPeriod,
            leftSlot.id,
            rightSlot.id,
          ]
            .sort()
            .join("|");
          if (seen.has(key)) continue;
          seen.add(key);
          conflicts.push({
            leftName: stagedCourseName(left),
            rightName: stagedCourseName(right),
            sameCourse: left.id === right.id,
            weekday: leftSlot.weekday,
            startPeriod,
            endPeriod,
          });
        }
      }
    }
  }
  return conflicts;
}

export function periodSpanLabel(startPeriod: number, endPeriod: number): string {
  const start = Math.min(startPeriod, endPeriod);
  const end = Math.max(startPeriod, endPeriod);
  return start === end ? `第${start}节` : `第${start}–${end}节`;
}

export function conflictMessage(conflict: SlotConflict): string {
  const when = `${weekdayLabel(conflict.weekday)}${periodSpanLabel(conflict.startPeriod, conflict.endPeriod)}`;
  if (conflict.sameCourse) {
    return `${conflict.leftName}的两段上课时间在${when}重叠`;
  }
  return `${conflict.leftName}与${conflict.rightName}在${when}冲突`;
}

export function formatSlotLabel(slot: ScheduleSlot): string {
  const normalized = normalizeSlot(slot);
  return `${weekdayLabel(normalized.weekday)}${periodSpanLabel(normalized.startPeriod, normalized.endPeriod)}`;
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isSlot(value: unknown): value is ScheduleSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as ScheduleSlot;
  return (
    typeof slot.id === "string" &&
    isFiniteInt(slot.weekday) &&
    slot.weekday >= 1 &&
    slot.weekday <= WEEKDAY_COUNT &&
    isFiniteInt(slot.startPeriod) &&
    isFiniteInt(slot.endPeriod) &&
    slot.startPeriod >= 1 &&
    slot.endPeriod <= PERIOD_COUNT &&
    Array.isArray(slot.weeks) &&
    slot.weeks.every((week) => isFiniteInt(week) && week >= 1 && week <= 30)
  );
}

function isStagedCourse(value: unknown): value is StagedCourse {
  if (!value || typeof value !== "object") return false;
  const course = value as StagedCourse;
  return (
    typeof course.id === "string" &&
    isFiniteInt(course.courseId) &&
    typeof course.courseCode === "string" &&
    typeof course.courseName === "string" &&
    (course.teacherId === null || isFiniteInt(course.teacherId)) &&
    (course.teacherName === null || typeof course.teacherName === "string") &&
    (course.rating === null || typeof course.rating === "number") &&
    isFiniteInt(course.reviewCount) &&
    Array.isArray(course.slots) &&
    course.slots.every(isSlot)
  );
}

export function loadSchedulePlan(): StagedCourse[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SCHEDULE_PLAN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; courses?: unknown };
    if (parsed.version !== SCHEDULE_PLAN_VERSION || !Array.isArray(parsed.courses)) {
      return [];
    }
    return parsed.courses.filter(isStagedCourse).map((course) => ({
      ...course,
      slots: course.slots.map((slot) => normalizeSlot(slot)),
    }));
  } catch {
    return [];
  }
}

export function saveSchedulePlan(courses: StagedCourse[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    SCHEDULE_PLAN_STORAGE_KEY,
    JSON.stringify({ version: SCHEDULE_PLAN_VERSION, courses }),
  );
}

export function slotIdFor(courseKey: string, slot: Omit<ScheduleSlot, "id">): string {
  const normalized = normalizeSlot({ ...slot, id: "tmp" });
  return `${courseKey}:${normalized.weekday}:${normalized.startPeriod}:${normalized.endPeriod}`;
}
