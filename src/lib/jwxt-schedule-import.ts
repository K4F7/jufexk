import {
  mergeAdjacentSlots,
  parseJwxtTimeText,
  splitCourseCell,
  type JwxtImportRow,
} from "./jwxt-schedule-text";
import {
  normalizeSlot,
  slotIdFor,
  stagedCourseId,
  type StagedCourse,
} from "./schedule-plan";
import type { CourseRelation } from "./types";

export function localImportCourseId(courseName: string, teacherName: string): number {
  const key = `${courseName}\0${teacherName}`;
  let hash = 5381;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(index);
  }
  const id = Math.abs(hash % 1_000_000_000);
  return id === 0 ? -1 : -id;
}

function normalizeTeacher(name: string) {
  return name.replace(/\s+/g, " ").trim();
}

function normalizeCourseName(name: string) {
  return splitCourseCell(name).courseName;
}

export function matchImportedRelation(
  row: Pick<JwxtImportRow, "courseName" | "teacherName">,
  relations: CourseRelation[],
): CourseRelation | null {
  const courseName = normalizeCourseName(row.courseName);
  const teacherName = normalizeTeacher(row.teacherName);
  const sameName = relations.filter((item) => item.name === courseName);
  if (sameName.length === 0) return null;
  if (teacherName) {
    const exact = sameName.find((item) => item.teacher_name === teacherName);
    if (exact) return exact;
  }
  return sameName.length === 1 ? sameName[0] : null;
}

function groupKey(row: JwxtImportRow) {
  return `${normalizeCourseName(row.courseName)}\0${normalizeTeacher(row.teacherName)}`;
}

export function stagedCoursesFromJwxtImport(
  rows: JwxtImportRow[],
  relations: CourseRelation[] = [],
): { courses: StagedCourse[]; skipped: number } {
  const groups = new Map<string, JwxtImportRow[]>();
  for (const row of rows) {
    const courseName = normalizeCourseName(row.courseName);
    if (!courseName) continue;
    const key = groupKey(row);
    const list = groups.get(key) ?? [];
    list.push({ ...row, courseName });
    groups.set(key, list);
  }
  const courses: StagedCourse[] = [];
  let skipped = 0;
  for (const group of groups.values()) {
    const first = group[0];
    const slots = mergeAdjacentSlots(
      group.flatMap((row) => parseJwxtTimeText(row.timeText, row.weekText)),
    );
    if (slots.length === 0) {
      skipped += group.length;
      continue;
    }
    const matched = matchImportedRelation(first, relations);
    const courseId = matched?.course_id ?? localImportCourseId(first.courseName, first.teacherName);
    const teacherId = matched ? matched.teacher_id : first.teacherName ? courseId : null;
    const id = stagedCourseId(courseId, teacherId);
    courses.push({
      id,
      courseId,
      courseCode: matched?.code || first.courseCode,
      courseName: matched?.name || first.courseName,
      teacherId,
      teacherName: matched?.teacher_name ?? (first.teacherName || null),
      rating: matched?.rating ?? null,
      reviewCount: matched?.review_count ?? 0,
      slots: slots.map((slot) =>
        normalizeSlot({
          id: slotIdFor(id, slot),
          ...slot,
        }),
      ),
    });
  }
  return { courses, skipped };
}

export function mergeImportedCourses(
  current: StagedCourse[],
  incoming: StagedCourse[],
): StagedCourse[] {
  const next = [...current];
  for (const course of incoming) {
    const index = next.findIndex((item) => item.id === course.id);
    if (index < 0) {
      next.push(course);
      continue;
    }
    const existing = next[index];
    const slots = [...existing.slots];
    for (const slot of course.slots) {
      if (!slots.some((item) => item.id === slot.id)) slots.push(slot);
    }
    next[index] = {
      ...existing,
      courseCode: existing.courseCode || course.courseCode,
      rating: existing.rating ?? course.rating,
      reviewCount: Math.max(existing.reviewCount, course.reviewCount),
      slots,
    };
  }
  return next;
}
