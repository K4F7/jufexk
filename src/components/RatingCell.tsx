import { scoreText } from "../lib/labels";

/**
 * Shared 评分/投稿 cell: `x.x · N 投` when a rating or text reviews exist,
 * muted 暂无 otherwise. Count covers the public text stream only, so a
 * score-only submission still surfaces its average with `· 0 投`.
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
      <span className="font-semibold text-accent">{scoreText(rating)}</span>
      <span className="text-[12px] text-muted">· {count} 投</span>
    </div>
  );
}
