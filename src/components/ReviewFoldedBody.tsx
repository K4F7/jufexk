import { Button } from "@heroui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  REVIEW_FOLD_LABEL,
  REVIEW_PUBLIC_FOLD_EXPAND_LABEL,
  reviewFoldKind,
  type ReviewFoldKind,
} from "../lib/recognition";

const HEADER_ROW_CLASS =
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-1";

export type ReviewPublicFold = {
  kind: ReviewFoldKind;
  publicOpen: boolean;
  openPublic: () => void;
  compact: boolean;
};

export function useReviewPublicFold(
  endorsementCount: number,
  challengeCount: number,
): ReviewPublicFold {
  const kind = reviewFoldKind({
    endorsementCount,
    challengeCount,
  });
  const [publicOpen, setPublicOpen] = useState(false);
  const previousKind = useRef(kind);

  useEffect(() => {
    if (kind !== "public") {
      setPublicOpen(false);
    } else if (previousKind.current === "none") {
      setPublicOpen(true);
    }
    previousKind.current = kind;
  }, [kind]);

  return {
    kind,
    publicOpen,
    openPublic: () => setPublicOpen(true),
    compact: kind === "public" && !publicOpen,
  };
}

export function reviewCardClassName({
  compact,
  variant,
}: {
  compact: boolean;
  variant: "course" | "public";
}) {
  const visibility = "[content-visibility:auto]";
  const base =
    variant === "course"
      ? `scroll-mt-20 border-b border-separator last:border-b-0 ${visibility}`
      : visibility;
  if (compact) {
    return `${base} py-2 [contain-intrinsic-size:auto_3rem]`;
  }
  return variant === "course"
    ? `${base} py-5 [contain-intrinsic-size:auto_9rem]`
    : `${base} py-4 [contain-intrinsic-size:auto_6rem]`;
}

function ReviewPostedDate({ date }: { date?: string }) {
  if (!date) return null;
  return (
    <time
      className="shrink-0 text-[calc(12/15*1rem)] text-muted"
      dateTime={date}
    >
      {date}
    </time>
  );
}

function ReviewVisibleChrome({
  leading,
  className,
  header,
  date,
  children,
}: {
  leading?: ReactNode;
  className?: string;
  header: ReactNode;
  date: ReactNode;
  children: ReactNode;
}) {
  const row = (
    <>
      <header
        className={[HEADER_ROW_CLASS, leading ? "mb-1" : null]
          .filter(Boolean)
          .join(" ")}
      >
        {header}
        {date}
      </header>
      {children}
    </>
  );
  if (!leading) return row;
  return (
    <div className={["flex items-start gap-2", className].filter(Boolean).join(" ")}>
      {leading}
      <div className="min-w-0 flex-1">{row}</div>
    </div>
  );
}

export function ReviewFoldedBody({
  fold,
  date,
  header,
  leading,
  chromeClassName,
  footer,
  children,
}: {
  fold: ReviewPublicFold;
  date?: string;
  header: ReactNode;
  leading?: ReactNode;
  chromeClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const dateNode = <ReviewPostedDate date={date} />;
  const chrome = (
    <ReviewVisibleChrome
      leading={leading}
      className={fold.kind === "none" ? chromeClassName : undefined}
      header={header}
      date={dateNode}
    >
      {children}
    </ReviewVisibleChrome>
  );
  const expanded = (
    <>
      {chrome}
      {footer}
    </>
  );

  if (fold.kind === "none") return expanded;

  return (
    <>
      <header
        className={[HEADER_ROW_CLASS, chromeClassName].filter(Boolean).join(" ")}
      >
        {fold.publicOpen ? (
          <p className="mb-0 text-[calc(12/15*1rem)] text-muted">
            {REVIEW_FOLD_LABEL}
          </p>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={false}
            onPress={fold.openPublic}
          >
            <span className="font-normal text-muted">{REVIEW_FOLD_LABEL}</span>
            {REVIEW_PUBLIC_FOLD_EXPAND_LABEL}
          </Button>
        )}
      </header>
      {fold.publicOpen ? expanded : null}
    </>
  );
}
