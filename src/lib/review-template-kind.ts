/** Review template kind stored on a course: sports when PE evidence exists, otherwise general. */
export type ReviewTemplateKind = "general" | "sports";

const SPORTS_SOURCE_VALUES = new Set(["sports", "pe"]);

/**
 * Normalize leftover catalog / historical category values onto the ADR-0012
 * contract. Empty stays empty so the UI can show 未确定; every other non-sports
 * value becomes general so professional courses never fall through to 其他.
 */
export function normalizeReviewTemplateKind(
  value?: string | null,
): ReviewTemplateKind | "" {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  if (SPORTS_SOURCE_VALUES.has(trimmed)) return "sports";
  return "general";
}
