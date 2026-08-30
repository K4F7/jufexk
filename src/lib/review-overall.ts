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

/** 点评区筛选用的整星，5 → 1。 */
export const OVERALL_STAR_FILTERS = [5, 4, 3, 2, 1] as const;

/** 整星桶：4 含 4 与 4.5；5 只有 5。 */
export function expandOverallStarBucket(star: number): number[] {
  if (!Number.isInteger(star) || star < 1 || star > 5) return [];
  return star === 5 ? [5] : [star, star + 0.5];
}

export function expandOverallStarFilter(stars: readonly number[]): number[] {
  return stars.flatMap(expandOverallStarBucket);
}

/**
 * 解析 `rating=4,5`。空串为「全部」（null）；含非整星或越界则无效（也返回 null，
 * 由调用方凭原始串是否为空区分）。
 */
export function parseReviewRatingFilter(value: string): number[] | null {
  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  const stars = new Set<number>();
  for (const token of tokens) {
    if (!/^[1-5]$/.test(token)) return null;
    stars.add(Number(token));
  }
  return [...stars].sort((a, b) => a - b);
}

export function formatReviewRatingFilterLabel(stars: readonly number[]): string {
  if (!stars.length) return "全部";
  return [...stars]
    .sort((a, b) => a - b)
    .map((star) => `${star} 星`)
    .join("、");
}

/** 「全部」与整星互斥：点全部清空星级；取消最后一颗星回到全部。 */
export function nextReviewRatingFilter(
  previous: readonly number[],
  selectedKeys: readonly string[],
): number[] {
  const previousKeys = previous.length
    ? previous.map(String)
    : (["all"] as const);
  const nextKeys = selectedKeys.map(String);
  const previousSet = new Set<string>(previousKeys);
  if (nextKeys.some((key) => key === "all" && !previousSet.has("all"))) {
    return [];
  }
  const stars = [
    ...new Set(
      nextKeys
        .filter((key) => key !== "all")
        .map(Number)
        .filter((star) => Number.isInteger(star) && star >= 1 && star <= 5),
    ),
  ].sort((a, b) => a - b);
  return stars;
}
