/**
 * Detail-page summary — frozen 摘要 B: left identity / right Surface.
 * Back button restores the originating catalog URL state.
 * Count is the public text stream. Course and teacher pages omit
 * entity-level aggregate scores (Issues #140 / #153); ratings stay on
 * 教师×课程 rows below.
 */
import { Button, Surface } from "@heroui/react";
import type { ReactNode } from "react";

export type DetailSummaryProps = {
  /** e.g. 返回课程目录 */
  backLabel: string;
  onBack: () => void;
  /** Public text review count (visible stream) */
  reviewCount: number;
  /** Accessible label for the summary header */
  ariaLabel: string;
  children: ReactNode;
};

export function DetailSummary({
  backLabel,
  onBack,
  reviewCount,
  ariaLabel,
  children,
}: DetailSummaryProps) {
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
          aria-label="评价数概览"
        >
          {reviewCount > 0 ? (
            <>
              <div className="tabular text-[calc(32/15*1rem)] font-bold leading-none">
                {reviewCount}
              </div>
              <div className="mt-2 text-xs text-muted">条评价</div>
            </>
          ) : (
            <div className="text-sm font-medium text-foreground">
              还没有公开评价
            </div>
          )}
        </Surface>
      </div>
    </header>
  );
}
