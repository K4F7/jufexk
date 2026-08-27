import { parseOverallRating } from "./review-overall";

export function publicOverall(value: unknown): number | null {
  return parseOverallRating(value);
}

export function publicCreatedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

/** 一句话总结（#444）：历史/旧行没有该列，公开载荷统一回空串。 */
export function publicHeadline(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 选填成绩（#444）：仅在有非空文本时下发，其余为 null。 */
export function publicGrade(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const grade = value.trim();
  return grade || null;
}
