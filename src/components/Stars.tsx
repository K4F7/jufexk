/**
 * 1–5 推荐度星级，支持半星。rating 为 null 时整排灰星。
 * 默认 aria-hidden：旁侧总有数字分或「暂无评价」文字；单独使用时传 label。
 * Icons: HeroUI-recommended @gravity-ui/icons (Star / StarFill). HeroUI has no Rating.
 */
import { Star, StarFill } from "@gravity-ui/icons";
import { overallCaption } from "../lib/review-overall";

const STAR_COUNT = 5;

export function starFill(
  rating: number | null,
  star: number,
): "empty" | "half" | "full" {
  if (rating == null) return "empty";
  if (rating >= star) return "full";
  if (rating >= star - 0.5) return "half";
  return "empty";
}

export function StarGlyph({
  fill,
  className = "",
}: {
  fill: "empty" | "half" | "full";
  className?: string;
}) {
  if (fill === "full") {
    return (
      <StarFill aria-hidden className={`size-[1em] shrink-0 ${className}`} />
    );
  }
  if (fill === "empty") {
    return (
      <Star
        aria-hidden
        className={`size-[1em] shrink-0 text-border ${className}`}
      />
    );
  }
  return (
    <span className={`relative inline-block size-[1em] shrink-0 ${className}`}>
      <Star aria-hidden className="absolute inset-0 size-full text-border" />
      <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
        <StarFill
          aria-hidden
          className="block h-full w-[200%] max-w-none"
        />
      </span>
    </span>
  );
}

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
  return (
    <span
      className={`inline-flex items-center gap-[0.12em] leading-none text-accent ${className}`}
      {...(label ? { "aria-label": label } : { "aria-hidden": true })}
    >
      {Array.from({ length: STAR_COUNT }, (_, index) => (
        <StarGlyph key={index} fill={starFill(rating, index + 1)} />
      ))}
    </span>
  );
}

/** 点评条目用：星级旁侧显示投稿页同一套推荐度文案（很推荐 / 必选…）。 */
export function StarsWithCaption({
  rating,
  className = "",
}: {
  rating: number;
  className?: string;
}) {
  const caption = overallCaption(String(rating));
  return (
    <span className="inline-flex items-center gap-x-1.5">
      <Stars rating={rating} className={className} />
      {caption ? (
        <span className="font-normal text-muted">{caption}</span>
      ) : null}
    </span>
  );
}
