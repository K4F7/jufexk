/**
 * 1–5 推荐度星级（icourse 式文字星）。rating 为 null 时整排灰星。
 * 默认 aria-hidden：旁侧总有数字分或「暂无评价」文字；单独使用时传 label。
 */
export function Stars({
  rating,
  label,
  className = "",
}: {
  rating: number | null;
  /** 可访问名（如「4 星」）；提供后不再 aria-hidden。 */
  label?: string;
  className?: string;
}) {
  const filled =
    rating == null ? 0 : Math.min(5, Math.max(0, Math.round(rating)));
  return (
    <span
      className={`[font-variant-emoji:text] leading-none tracking-[0.12em] text-accent ${className}`}
      {...(label ? { "aria-label": label } : { "aria-hidden": true })}
    >
      {"★".repeat(filled)}
      <span className="text-border">{"★".repeat(5 - filled)}</span>
    </span>
  );
}
