export const categoryLabels: Record<string, string> = {
  major: "专业课",
  pe: "体育课",
  sports: "体育课", // remote catalog enum (post 0011)
  general: "公共选修",
};

export function categoryLabel(value?: string | null) {
  if (!value) return "未确定";
  return categoryLabels[value] || value;
}

export function scoreText(value?: number | null) {
  if (value === null || value === undefined || Number(value) === 0) return "—";
  return String(value);
}
