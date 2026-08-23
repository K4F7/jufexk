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
