/**
 * 目录行展开：兼容旧的课程级 /api/courses 行（teacher_refs 串）。
 * 生产目录已改走 view=relations；DEV 建议与旧 mock 仍可能用本函数。
 */
import type { Course, CourseRelation } from "./types";

/** teacher_refs 单项解析："9:测试教师" → { id: 9, name: "测试教师" }。 */
export function parseTeacherRef(ref: string): {
  id: number | null;
  name: string;
} {
  const colon = ref.indexOf(":");
  if (colon <= 0) return { id: null, name: ref };
  const id = Number(ref.slice(0, colon));
  const name = ref.slice(colon + 1);
  return {
    id: Number.isSafeInteger(id) && id > 0 ? id : null,
    name: name || ref,
  };
}

export function expandCourseRelations(course: Course): CourseRelation[] {
  const base = {
    course_id: course.id,
    code: course.code,
    name: course.name,
    category: course.category,
    department: course.department,
    rating: course.rating ?? null,
    review_count: course.review_count ?? 0,
    course_review_count: course.review_count ?? 0,
  };
  const refs = (course.teacher_refs || "")
    .split(",")
    .map((ref) => ref.trim())
    .filter(Boolean);
  if (refs.length === 0) {
    return [{ ...base, teacher_id: null, teacher_name: null }];
  }
  return refs.map((ref) => {
    const teacher = parseTeacherRef(ref);
    return { ...base, teacher_id: teacher.id, teacher_name: teacher.name };
  });
}
