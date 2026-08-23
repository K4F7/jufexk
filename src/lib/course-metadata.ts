/**
 * 课程详情头部元信息（#410 / #436）：选课类别 / 教学类型 / 课程层次。
 * 只回传已写入的江财课表字段；没有就空串，详情页显示 —。
 * 不再按评价规则键猜测「专业课 / 讲授 / 本科」。
 */
export type CourseCatalogMeta = {
  enrollment_category: string;
  teaching_type: string;
  course_level: string;
};

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export function deriveCourseCatalogMeta(input: {
  enrollment_category?: unknown;
  teaching_type?: unknown;
  course_level?: unknown;
}): CourseCatalogMeta {
  return {
    enrollment_category: text(input.enrollment_category),
    teaching_type: text(input.teaching_type),
    course_level: text(input.course_level),
  };
}

export function dimensionLabelOptions(
  labels: ReadonlyArray<{ id: string; option: string }> | null | undefined,
  order: readonly { key: string }[],
): Array<string | null> {
  if (!labels?.length) return order.map(() => null);
  return order.map((dim) => labels.find((item) => item.id === dim.key)?.option ?? null);
}
