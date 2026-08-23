import { normalizeReviewTemplateKind } from "./review-template-kind";

export const categoryLabels: Record<string, string> = {
  general: "普通课程",
  sports: "体育课",
};

export function categoryLabel(value?: string | null) {
  if (!value) return "未确定";
  const kind = normalizeReviewTemplateKind(value);
  return categoryLabels[kind] || "其他";
}

export function scoreText(value?: number | null) {
  if (value === null || value === undefined || Number(value) === 0) return "—";
  return String(value);
}

export function formatCredits(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(1);
}
