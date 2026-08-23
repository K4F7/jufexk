import { publicCourseCategory } from "./public-course-presentation";
import { resolveSchemeKey, type CourseTag } from "./review-schemes";

/**
 * 课程详情头部元信息（#410）：选课类别 / 教学类型 / 课程层次。
 * 教务目录没有这三列，按公开类别、评价规则键与 mooc 标签派生，
 * 对齐原型 CATALOG_META。课程类别仍用 category，开课单位仍用 department，
 * 学分仍用 credits。
 */
export type CourseCatalogMeta = {
  enrollment_category: string;
  teaching_type: string;
  course_level: string;
};

const UNDERGRADUATE = "本科";

export function deriveCourseCatalogMeta(input: {
  name?: string | null;
  category?: string | null;
  schemeKey?: string | null;
  tags?: readonly string[] | null;
}): CourseCatalogMeta {
  const tags = input.tags ?? [];
  const mooc = tags.includes("mooc" satisfies CourseTag);
  const publicCategory = publicCourseCategory(input.name, input.category);
  const scheme = resolveSchemeKey(input.schemeKey, publicCategory || input.category || "");

  if (mooc) {
    return {
      enrollment_category: "慕课",
      teaching_type: "网络课程",
      course_level: UNDERGRADUATE,
    };
  }
  if (publicCategory === "sports" || scheme === "pe") {
    return {
      enrollment_category: "体育课",
      teaching_type: "实践",
      course_level: UNDERGRADUATE,
    };
  }
  if (scheme === "english") {
    return {
      enrollment_category: "大学英语",
      teaching_type: "讲授",
      course_level: UNDERGRADUATE,
    };
  }
  if (scheme === "ideology") {
    return {
      enrollment_category: "思政",
      teaching_type: "讲授",
      course_level: UNDERGRADUATE,
    };
  }
  if (scheme === "math" || scheme === "public_basic") {
    return {
      enrollment_category: scheme === "math" ? "公共课" : "公共课",
      teaching_type: "讲授",
      course_level: UNDERGRADUATE,
    };
  }
  if (scheme === "major") {
    return {
      enrollment_category: "专业课",
      teaching_type: "讲授",
      course_level: UNDERGRADUATE,
    };
  }
  return {
    enrollment_category: "通识",
    teaching_type: "讲授",
    course_level: UNDERGRADUATE,
  };
}

export function dimensionLabelOptions(
  labels: ReadonlyArray<{ id: string; option: string }> | null | undefined,
  order: readonly { key: string }[],
): Array<string | null> {
  if (!labels?.length) return order.map(() => null);
  return order.map((dim) => labels.find((item) => item.id === dim.key)?.option ?? null);
}
