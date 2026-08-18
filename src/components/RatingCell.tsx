import { scoreText } from "../lib/labels";

/**
 * Shared 评分/投稿 cell: `x.x · N 投` when a rating exists, `N 投` when only
 * text reviews exist — an empty rating never renders a placeholder dash
 * (Issue #202). Count covers the public text stream only, so a score-only
 * submission still surfaces its average with `· 0 投`.
 */
export function RatingCell({
  rating,
  reviewCount,
}: {
  rating?: number | null;
  reviewCount?: number | null;
}) {
  const count = reviewCount ?? 0;
  const hasRating = rating != null && Number(rating) > 0;
  if (count <= 0 && !hasRating) {
    return <span className="text-[13px] text-muted">暂无</span>;
  }
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap tabular">
      {hasRating ? (
        <span className="font-semibold text-accent">{scoreText(rating)}</span>
      ) : null}
      <span className="text-[12px] text-muted">
        {hasRating ? `· ${count} 投` : `${count} 投`}
      </span>
    </div>
  );
}
