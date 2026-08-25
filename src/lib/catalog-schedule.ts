/**
 * 排课模拟的本站目录适配：学期/年级是本机筛选，专业用公开院系，
 * 候选课用课程×教师任课关系，上课时间只在开课班 schedule 有原文时解析。
 */
import { JWXT_SNAPSHOT_SOURCE, JWXT_SNAPSHOT_VERSION, type JwxtSnapshotV1 } from "./jwxt-snapshot";
import {
  isJwxtFilterSelected,
  normalizeOffering,
  type JwxtFilterOption,
  type JwxtOffering,
} from "./jwxt-offering";
import type { CourseRelation } from "./types";

export const CATALOG_TEACHER_SECTION_RE = /^t\d+$/;
export const HISTORICAL_OFFERING_SECTION = "历史数据";

export type CatalogOfferingRow = {
  id?: number;
  course_id?: number;
  term?: string;
  section?: string;
  campus?: string;
  schedule?: string;
  status?: string;
  teachers?: string | null;
  teacher_ids?: string | null;
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

export function departmentsToMajors(departments: string[]): JwxtFilterOption[] {
  return departments
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: name, label: name }));
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

function teacherIdsOf(row: CatalogOfferingRow): number[] {
  return (row.teacher_ids || "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function teacherNamesOf(row: CatalogOfferingRow): string[] {
  return (row.teachers || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function catalogTeacherMatches(row: CatalogOfferingRow, offering: JwxtOffering): boolean {
  if (offering.catalogTeacherId && teacherIdsOf(row).includes(offering.catalogTeacherId)) {
    return true;
  }
  return Boolean(offering.teacherName) && teacherNamesOf(row).includes(offering.teacherName);
}

export function applyCatalogOfferingRows(
  current: JwxtOffering[],
  rows: CatalogOfferingRow[],
): JwxtOffering[] {
  const active = rows.filter((row) => (row.status || "active") === "active");
  const patched = current.map((offering) => {
    const match = active.find((row) => catalogTeacherMatches(row, offering));
    if (!match) return offering;
    return normalizeOffering({
      ...offering,
      section: usableOfferingSection(match.section) || offering.section,
      campus: (match.campus || "").trim() || offering.campus,
      timeText: (match.schedule || "").trim() || offering.timeText,
    });
  });
  const seed = current[0];
  const extras = active
    .filter((row) => (row.schedule || "").trim() && !current.some((offering) => catalogTeacherMatches(row, offering)))
    .map((row) =>
      normalizeOffering({
        courseCode: seed?.courseCode || "",
        courseName: seed?.courseName || "",
        categoryPath: seed?.categoryPath || "",
        section: usableOfferingSection(row.section),
        teacherName: teacherNamesOf(row)[0] || "",
        campus: (row.campus || "").trim(),
        timeText: (row.schedule || "").trim(),
        catalogCourseId: seed?.catalogCourseId ?? (row.course_id || null),
        catalogTeacherId: teacherIdsOf(row)[0] || null,
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
