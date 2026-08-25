/**
 * 教务开课班统一形状。Worker 代理与浏览器 JSON 导入/导出共用同一版本化 DTO。
 * 不含 Cookie、学生学号、学生姓名；来源教师名属于开课班字段。
 */
import {
  parseJwxtTimeText,
  parseJwxtWeeks,
  splitCourseCell,
} from "./jwxt-schedule-text";
import { defaultWeeks, type ScheduleSlot } from "./schedule-plan";

export const JWXT_DTO_VERSION = 1 as const;

export type JwxtMeeting = {
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
  place: string;
};

export type JwxtOffering = {
  courseCode: string;
  courseName: string;
  credits: number | null;
  categoryPath: string;
  section: string;
  teacherName: string;
  campus: string;
  weekText: string;
  timeText: string;
  place: string;
  capacityLimit: number | null;
  capacitySelected: number | null;
  capacityAvailable: number | null;
  enrollStatus: string;
  meetings: JwxtMeeting[];
  catalogCourseId: number | null;
  catalogTeacherId: number | null;
  catalogRating?: number | null;
  catalogReviewCount?: number;
};

export type JwxtFilterOption = {
  id: string;
  label: string;
};

export type JwxtCategoryKind = "planned" | "public";

export type JwxtCategoryOption = JwxtFilterOption & {
  kind: JwxtCategoryKind;
};

export const JWXT_MAJOR_REQUIRED_MESSAGE = "请先选择年级和专业，再导出快照";

/** 保持为无外部依赖函数，以便通过 toString 内联进教务页书签。 */
export function isJwxtPlaceholderOption(id: string, label = ""): boolean {
  const idText = id.trim();
  const labelText = label.trim();
  if (!idText && !labelText) return true;
  const tokens = [idText, labelText];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith("请选择") || token === "全部" || token === "--" || token === "—") {
      return true;
    }
  }
  return false;
}

export function isJwxtFilterSelected(option: JwxtFilterOption | null | undefined): boolean {
  if (!option?.id.trim()) return false;
  return !isJwxtPlaceholderOption(option.id, option.label);
}

export function jwxtCandidateFiltersReady(snapshot: {
  grade: JwxtFilterOption;
  major: JwxtFilterOption;
  grades: JwxtFilterOption[];
  majors: JwxtFilterOption[];
}): boolean {
  return (
    (snapshot.grades.length === 0 || isJwxtFilterSelected(snapshot.grade)) &&
    (snapshot.majors.length === 0 || isJwxtFilterSelected(snapshot.major))
  );
}

const SECRET_RE = /CASTGC|JSESSIONID|password|passwd|cookie|Set-Cookie/i;
const PERSONAL_RE = /学号\s*\d{6,}|学生姓名|姓名\s*[:：]\s*\S/;

export function looksLikeForbidden(text: string): boolean {
  return SECRET_RE.test(text) || PERSONAL_RE.test(text);
}

export function offeringKey(termId: string, courseCode: string, section: string, courseName = ""): string {
  const identity = courseCode.trim() || `name:${courseName.trim()}`;
  return [termId, identity, section]
    .map((part) => encodeURIComponent(part.trim()))
    .join("|");
}

export function parseCredits(raw: string): number | null {
  const match = /([0-9]+(?:\.[0-9]+)?)/.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseCount(raw: string): number | null {
  const match = /(\d+)/.exec(raw.replace(/,/g, "").trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

export function meetingsFromOffering(
  timeText: string,
  weekText: string,
  place: string,
): JwxtMeeting[] {
  const slots = parseJwxtTimeText(timeText, weekText);
  if (slots.length === 0 && !timeText.trim()) {
    return [];
  }
  return slots.map((slot) => ({
    weekday: slot.weekday,
    startPeriod: slot.startPeriod,
    endPeriod: slot.endPeriod,
    weeks: slot.weeks.length ? slot.weeks : defaultWeeks(),
    place: slot.place || place,
  }));
}

export function slotsFromMeetings(meetings: JwxtMeeting[], courseKey: string): ScheduleSlot[] {
  return meetings.map((meeting) => ({
    id: `${courseKey}:${meeting.weekday}:${meeting.startPeriod}:${meeting.endPeriod}`,
    weekday: meeting.weekday,
    startPeriod: meeting.startPeriod,
    endPeriod: meeting.endPeriod,
    weeks: meeting.weeks.length ? meeting.weeks : parseJwxtWeeks(""),
  }));
}

export function normalizeOffering(partial: Partial<JwxtOffering> & Pick<JwxtOffering, "courseName">): JwxtOffering {
  const split = splitCourseCell(partial.courseName);
  const courseCode = (partial.courseCode || split.courseCode).trim();
  const courseName = (split.courseName || partial.courseName).trim();
  const weekText = (partial.weekText || "").trim();
  const timeText = (partial.timeText || "").trim();
  const sourcePlace = (partial.place || "").trim();
  const meetings =
    partial.meetings && partial.meetings.length
      ? partial.meetings
      : meetingsFromOffering(timeText, weekText, sourcePlace);
  const place = sourcePlace || meetings.find((meeting) => meeting.place)?.place || "";
  return {
    courseCode,
    courseName,
    credits: partial.credits ?? null,
    categoryPath: (partial.categoryPath || "").trim(),
    section: (partial.section || "").trim(),
    teacherName: (partial.teacherName || "").trim(),
    campus: (partial.campus || "").trim(),
    weekText,
    timeText,
    place,
    capacityLimit: partial.capacityLimit ?? null,
    capacitySelected: partial.capacitySelected ?? null,
    capacityAvailable: partial.capacityAvailable ?? null,
    enrollStatus: (partial.enrollStatus || "").trim(),
    meetings,
    catalogCourseId: partial.catalogCourseId ?? null,
    catalogTeacherId: partial.catalogTeacherId ?? null,
    catalogRating: partial.catalogRating ?? null,
    catalogReviewCount: partial.catalogReviewCount ?? 0,
  };
}

export function offeringHasForbidden(offering: JwxtOffering): boolean {
  return looksLikeForbidden(
    [
      offering.courseCode,
      offering.courseName,
      offering.categoryPath,
      offering.section,
      offering.teacherName,
      offering.campus,
      offering.weekText,
      offering.timeText,
      offering.place,
      offering.enrollStatus,
    ].join(" "),
  );
}
