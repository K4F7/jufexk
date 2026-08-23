/** Empty catalog/review term strings become null on public payloads. */
export function publicTerm(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const term = value.trim();
  return term || null;
}

export function publicOverall(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
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
