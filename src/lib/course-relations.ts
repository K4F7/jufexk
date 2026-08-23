/**
 * 目录行展开（Issue #402）：/api/courses 一门课一行、教师是 teacher_refs
 * "id:name,id:name" 串；目录 UI 一行一条课程×教师，在前端展开。
 * 关系级评分 / 点评数 / 四维档期的后端投影属 #410：未下发前本模块只
 * 携带课程级 review_count，行内据它区分「暂无评价」与统计占位。
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
