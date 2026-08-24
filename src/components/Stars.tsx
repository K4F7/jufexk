/**
 * 1–5 推荐度星级。rating 为 null 时整排灰星。
 * 默认 aria-hidden：旁侧总有数字分或「暂无评价」文字；单独使用时传 label。
 * Icons: HeroUI-recommended @gravity-ui/icons (Star / StarFill). HeroUI has no Rating.
 */
import { Star, StarFill } from "@gravity-ui/icons";

const STAR_COUNT = 5;

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
    rating == null
      ? 0
      : Math.min(STAR_COUNT, Math.max(0, Math.round(rating)));
  return (
    <span
      className={`inline-flex items-center gap-[0.12em] leading-none text-accent ${className}`}
      {...(label ? { "aria-label": label } : { "aria-hidden": true })}
    >
      {Array.from({ length: STAR_COUNT }, (_, index) => {
        const Icon = index < filled ? StarFill : Star;
        return (
          <Icon
            key={index}
            aria-hidden
            className={`size-[1em] shrink-0 ${index < filled ? "" : "text-border"}`}
          />
        );
      })}
    </span>
  );
}
