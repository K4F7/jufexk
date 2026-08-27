/** Format a SQLite CURRENT_TIMESTAMP / ISO-ish created_at for public UI. */
export function formatReviewDate(value?: string | null): string {
  if (!value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? value.trim();
}

function parseReviewTimestamp(value: string): number {
  const trimmed = value.trim();
  const normalized = trimmed.includes("T")
    ? trimmed
    : trimmed.replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? Date.parse(trimmed) : ms;
}

/** Relative time for nested 回复; falls back to the calendar date. */
export function formatRelativeTime(
  value?: string | null,
  now = Date.now(),
): string {
  if (!value) return "";
  const ms = parseReviewTimestamp(value);
  if (Number.isNaN(ms)) return formatReviewDate(value);
  const seconds = Math.round((now - ms) / 1000);
  if (seconds < 45) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
  return formatReviewDate(value);
}
