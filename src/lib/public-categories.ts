/**
 * 公开目录的类别筛选行（Issue #402 浅蓝框；#415 把专业课/公共课并进通识课）。
 * URL 继续用 ?category=；空值表示全部。mooc 深链仍被 API 接受，
 * 但不再出现在筛选行里（网课课程从「全部」进入）。
 * major / public_basic 深链仍有效，语义与通识课相同。
 */
export const GENERAL_EDUCATION_FILTER = "general";

/** scheme_key values that 通识课 includes. */
export const GENERAL_EDUCATION_SCHEME_KEYS = ["major", "public_basic"] as const;

export const PUBLIC_CATEGORY_OPTIONS = [
  { id: "", label: "全部" },
  { id: GENERAL_EDUCATION_FILTER, label: "通识课" },
  { id: "sports", label: "体育课" },
  { id: "english", label: "英语课" },
  { id: "ideology", label: "思政课" },
  { id: "math", label: "数学课" },
] as const;

export type PublicCategoryOptionId =
  (typeof PUBLIC_CATEGORY_OPTIONS)[number]["id"];

export function isGeneralEducationFilter(value: string): boolean {
  return (
    value === GENERAL_EDUCATION_FILTER ||
    (GENERAL_EDUCATION_SCHEME_KEYS as readonly string[]).includes(value)
  );
}

/** 前端接受的 ?category= 深链值（含不在筛选行里的 mooc / 通识别名）。 */
export function isPublicCatalogCategory(value: string): boolean {
  return (
    (PUBLIC_CATEGORY_OPTIONS as readonly { id: string }[]).some(
      (opt) => opt.id !== "" && opt.id === value,
    ) ||
    value === "mooc" ||
    isGeneralEducationFilter(value)
  );
}

export function publicCategoryOptionLabel(id: string): string {
  if (id === "mooc") return "网课";
  if (isGeneralEducationFilter(id)) return "通识课";
  return (
    (PUBLIC_CATEGORY_OPTIONS as readonly { id: string; label: string }[]).find(
      (opt) => opt.id === id,
    )?.label ?? id
  );
}

/** 通识课按钮在 general / major / public_basic 深链下都保持选中。 */
export function publicCategoryOptionSelected(
  optionId: string,
  category: string,
): boolean {
  if (optionId === GENERAL_EDUCATION_FILTER) {
    return isGeneralEducationFilter(category);
  }
  return category === optionId;
}
