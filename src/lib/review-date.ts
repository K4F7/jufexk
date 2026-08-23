/** Format a SQLite CURRENT_TIMESTAMP / ISO-ish created_at for public UI. */
export function formatReviewDate(value?: string | null): string {
  if (!value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? value.trim();
}
