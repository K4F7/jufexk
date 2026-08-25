/** 本次推荐度：1–5，半星步进。文案随星数变化。 */

export const OVERALL_STEPS = [
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "4.5",
  "5",
] as const;

export const OVERALL_CAPTIONS: Record<(typeof OVERALL_STEPS)[number], string> = {
  "1": "较差",
  "1.5": "一般",
  "2": "还行",
  "2.5": "不错",
  "3": "推荐",
  "3.5": "很推荐",
  "4": "强烈推荐",
  "4.5": "非常推荐",
  "5": "必选",
};

export function parseOverallRating(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  const halves = Math.round(n * 2) / 2;
  return Math.abs(halves - n) < 1e-9 ? halves : null;
}

export function overallCaption(value: string): string {
  return Object.hasOwn(OVERALL_CAPTIONS, value)
    ? OVERALL_CAPTIONS[value as (typeof OVERALL_STEPS)[number]]
    : "";
}
