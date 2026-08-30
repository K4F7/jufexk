import type { ReactNode } from "react";
import { isReviewFolded, REVIEW_FOLD_LABEL } from "../lib/recognition";

export function ReviewFoldedBody({
  endorsementCount,
  challengeCount,
  viewerChallenged,
  children,
}: {
  endorsementCount: number;
  challengeCount: number;
  viewerChallenged: boolean;
  children: ReactNode;
}) {
  const folded = isReviewFolded({
    endorsementCount,
    challengeCount,
    viewerChallenged,
  });

  if (!folded) return children;

  return <p className="mb-0 mt-2 text-xs text-muted">{REVIEW_FOLD_LABEL}</p>;
}
