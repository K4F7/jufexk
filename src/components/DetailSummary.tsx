/**
 * Detail-page summary — frozen 摘要 B: left identity / right rating Surface.
 * Back button restores the originating catalog URL state.
 * Rating is AVG(overall) of approved reviews; count is the public text stream.
 */
import { Button, Surface } from "@heroui/react";
import type { ReactNode } from "react";
import { scoreText } from "../lib/labels";

export type DetailSummaryProps = {
  /** e.g. 返回课程目录 */
  backLabel: string;
  onBack: () => void;
  /** Aggregate AVG(overall); null/0 when no scored reviews */
  rating?: number | null;
  /** Public text review count (visible stream) */
  reviewCount: number;
  /** Accessible label for the summary header */
  ariaLabel: string;
  children: ReactNode;
};

export function DetailSummary({
  backLabel,
  onBack,
  rating,
  reviewCount,
  ariaLabel,
  children,
}: DetailSummaryProps) {
  const hasRating = rating != null && rating > 0;
  return (
    <header className="mb-6" aria-label={ariaLabel}>
      <Button variant="ghost" size="sm" className="mb-1 px-0" onPress={onBack}>
        ← {backLabel}
      </Button>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-border pb-5">
        <div className="min-w-0 flex-1 basis-72">{children}</div>
        <Surface
          variant="secondary"
          className="flex w-full shrink-0 flex-col items-center justify-center rounded-xl px-8 py-5 text-center sm:w-auto"
          aria-label="评分概览"
        >
          {hasRating ? (
            <>
              <div className="tabular text-[32px] font-bold leading-none text-accent">
                {scoreText(rating)}
                <span className="ms-0.5 text-sm font-normal text-muted">
                  / 5
                </span>
              </div>
              <div className="mt-2 text-xs text-muted">{reviewCount} 条评价</div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-foreground">暂无评分</div>
              <div className="mt-1.5 text-xs text-muted">
                {reviewCount > 0 ? `${reviewCount} 条评价` : "还没有公开评价"}
              </div>
            </>
          )}
        </Surface>
      </div>
    </header>
  );
}
