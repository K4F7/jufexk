/**
 * 排课模拟的本站目录适配：学期/年级是本机筛选，专业用本科专业名单，
 * 候选课按专业所属学院匹配公开开课单位后取课程×教师任课关系。
 */
import { JWXT_SNAPSHOT_SOURCE, JWXT_SNAPSHOT_VERSION, type JwxtSnapshotV1 } from "./jwxt-snapshot";
import {
  isJwxtFilterSelected,
  normalizeOffering,
  type JwxtFilterOption,
  type JwxtOffering,
} from "./jwxt-offering";
import type { CourseRelation } from "./types";

export { catalogScheduleMajors, matchDepartmentForMajor } from "./catalog-majors";

export const CATALOG_TEACHER_SECTION_RE = /^t\d+$/;
export const HISTORICAL_OFFERING_SECTION = "历史数据";

export type ScheduleOfferingRow = {
  key: string;
  courseCode: string;
  courseName: string;
  teacherName: string;
  termId: string;
  campus: string;
  weekText: string;
  timeText: string;
  place: string;
  catalogCourseId: number;
  catalogTeacherId: number | null;
};

export function catalogScheduleTerms(now = new Date()): JwxtFilterOption[] {
  const year = now.getFullYear();
  const startYear = year - 2;
  const terms: JwxtFilterOption[] = [];
  for (let start = startYear; start <= year; start += 1) {
    const end = start + 1;
    terms.push(
      { id: `${start}-${end}-1`, label: `${start}-${end}学年 第一学期` },
      { id: `${start}-${end}-2`, label: `${start}-${end}学年 第二学期` },
    );
  }
  return terms;
}

export function currentCatalogTermId(now = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 8) return `${year}-${year + 1}-1`;
  if (month >= 2) return `${year - 1}-${year}-2`;
  return `${year - 1}-${year}-1`;
}

export function catalogScheduleGrades(now = new Date()): JwxtFilterOption[] {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const latest = month >= 8 ? year : year - 1;
  return [0, 1, 2, 3].map((offset) => {
    const grade = latest - offset;
    return { id: String(grade), label: `${grade}级` };
  });
}

export function isCatalogPublicElective(category: string): boolean {
  return category.trim() === "sports";
}

export function catalogTeacherSection(teacherId: number | null | undefined): string {
  return teacherId && teacherId > 0 ? `t${teacherId}` : "";
}

export function displaySection(section: string): string {
  const text = section.trim();
  if (!text || text === HISTORICAL_OFFERING_SECTION || CATALOG_TEACHER_SECTION_RE.test(text)) {
    return "—";
  }
  return text;
}

export function usableOfferingSection(section: string | null | undefined): string {
  const text = (section || "").trim();
  if (!text || text === HISTORICAL_OFFERING_SECTION) return "";
  return text;
}

export function relationToOffering(
  relation: CourseRelation,
  origin: "planned" | "public" = "planned",
): JwxtOffering {
  return normalizeOffering({
    courseCode: relation.code,
    courseName: relation.name,
    categoryPath: origin === "public" ? "公共选修" : "专业计划内",
    section: catalogTeacherSection(relation.teacher_id),
    teacherName: relation.teacher_name || "",
    catalogCourseId: relation.course_id,
    catalogTeacherId: relation.teacher_id,
    catalogRating: relation.rating,
    catalogReviewCount: relation.review_count,
  });
}

export function scheduleTeacherMatches(row: ScheduleOfferingRow, offering: JwxtOffering): boolean {
  if (offering.catalogTeacherId && row.catalogTeacherId === offering.catalogTeacherId) {
    return true;
  }
  return Boolean(offering.teacherName) && row.teacherName === offering.teacherName;
}

export function applyScheduleOfferingRows(
  current: JwxtOffering[],
  rows: ScheduleOfferingRow[],
): JwxtOffering[] {
  const patched = current.map((offering) => {
    const match = rows.find((row) => scheduleTeacherMatches(row, offering));
    if (!match) return offering;
    return normalizeOffering({
      ...offering,
      section: match.key,
      campus: match.campus.trim() || offering.campus,
      weekText: match.weekText.trim() || offering.weekText,
      timeText: match.timeText.trim() || offering.timeText,
      place: match.place.trim() || offering.place,
    });
  });
  const seed = current[0];
  const extras = rows
    .filter((row) => row.timeText.trim() && !current.some((offering) => scheduleTeacherMatches(row, offering)))
    .map((row) =>
      normalizeOffering({
        courseCode: row.courseCode || seed?.courseCode || "",
        courseName: row.courseName || seed?.courseName || "",
        categoryPath: seed?.categoryPath || "",
        section: row.key,
        teacherName: row.teacherName,
        campus: row.campus.trim(),
        weekText: row.weekText.trim(),
        timeText: row.timeText.trim(),
        place: row.place.trim(),
        catalogCourseId: row.catalogCourseId || seed?.catalogCourseId || null,
        catalogTeacherId: row.catalogTeacherId,
      }),
    );
  return [...patched, ...extras];
}

export function replaceCourseOfferings(
  list: JwxtOffering[],
  courseCode: string,
  next: JwxtOffering[],
): JwxtOffering[] {
  const without = list.filter((item) => item.courseCode !== courseCode);
  const matched = next.filter((item) => item.courseCode === courseCode);
  const firstIndex = list.findIndex((item) => item.courseCode === courseCode);
  if (firstIndex < 0 || matched.length === 0) return list;
  return [...without.slice(0, firstIndex), ...matched, ...without.slice(firstIndex)];
}

export function catalogFiltersReady(grade: JwxtFilterOption, major: JwxtFilterOption): boolean {
  return isJwxtFilterSelected(grade) && isJwxtFilterSelected(major);
}

export function catalogBrowseSnapshot(input: {
  term: JwxtFilterOption;
  terms: JwxtFilterOption[];
  grade: JwxtFilterOption;
  grades: JwxtFilterOption[];
  major: JwxtFilterOption;
  majors: JwxtFilterOption[];
  planned: JwxtOffering[];
  publicElectives: JwxtOffering[];
}): JwxtSnapshotV1 {
  return {
    version: JWXT_SNAPSHOT_VERSION,
    source: JWXT_SNAPSHOT_SOURCE,
    term: input.term,
    terms: input.terms,
    educationLevel: { id: "", label: "" },
    educationLevels: [],
    grade: input.grade,
    grades: input.grades,
    major: input.major,
    majors: input.majors,
    categories: [],
    enrolled: [],
    planned: input.planned,
    publicElectives: input.publicElectives,
  };
}
