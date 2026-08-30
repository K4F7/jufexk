import { Button } from "@heroui/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  REVIEW_FOLD_LABEL,
  REVIEW_PUBLIC_FOLD_COLLAPSE_LABEL,
  REVIEW_PUBLIC_FOLD_EXPAND_LABEL,
  reviewFoldKind,
} from "../lib/recognition";

const HEADER_ROW_CLASS =
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-1";

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
  endorsementCount,
  challengeCount,
  date,
  header,
  leading,
  chromeClassName,
  children,
}: {
  endorsementCount: number;
  challengeCount: number;
  date?: string;
  header: ReactNode;
  leading?: ReactNode;
  chromeClassName?: string;
  children: ReactNode;
}) {
  const kind = reviewFoldKind({
    endorsementCount,
    challengeCount,
  });
  const [publicOpen, setPublicOpen] = useState(false);

  useEffect(() => {
    if (kind !== "public") setPublicOpen(false);
  }, [kind]);

  const dateNode = <ReviewPostedDate date={date} />;
  const showChrome = kind === "none" || publicOpen;
  const chrome = showChrome ? (
    <ReviewVisibleChrome
      leading={leading}
      className={kind === "none" ? chromeClassName : undefined}
      header={header}
      date={kind === "none" ? dateNode : null}
    >
      {children}
    </ReviewVisibleChrome>
  ) : null;

  if (kind === "none") return chrome;

  return (
    <>
      <header
        className={[HEADER_ROW_CLASS, chromeClassName].filter(Boolean).join(" ")}
      >
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={publicOpen}
          onPress={() => setPublicOpen((open) => !open)}
        >
          <span className="font-normal text-muted">{REVIEW_FOLD_LABEL}</span>
          {publicOpen
            ? REVIEW_PUBLIC_FOLD_COLLAPSE_LABEL
            : REVIEW_PUBLIC_FOLD_EXPAND_LABEL}
        </Button>
        {dateNode}
      </header>
      {chrome}
    </>
  );
}
