/**
 * 公开目录的类别筛选行（Issue #402 浅蓝框；类别集合与 #364 对齐）。
 * URL 继续用 ?category=；空值表示全部。mooc 深链仍被 API 接受，
 * 但不再出现在筛选行里（网课课程从「全部」进入）。
 */
export const PUBLIC_CATEGORY_OPTIONS = [
  { id: "", label: "全部" },
  { id: "major", label: "专业课" },
  { id: "public_basic", label: "公共课" },
  { id: "sports", label: "体育课" },
  { id: "english", label: "英语课" },
  { id: "ideology", label: "思政课" },
  { id: "math", label: "数学课" },
] as const;

export type PublicCategoryOptionId = (typeof PUBLIC_CATEGORY_OPTIONS)[number]["id"];

/** 前端接受的 ?category= 深链值（含不在筛选行里的 mooc）。 */
export function isPublicCatalogCategory(value: string): boolean {
  return (
    (PUBLIC_CATEGORY_OPTIONS as readonly { id: string }[]).some(
      (opt) => opt.id !== "" && opt.id === value,
    ) || value === "mooc"
  );
}

export function publicCategoryOptionLabel(id: string): string {
  if (id === "mooc") return "网课";
  return (
    (PUBLIC_CATEGORY_OPTIONS as readonly { id: string; label: string }[]).find(
      (opt) => opt.id === id,
    )?.label ?? id
  );
}
