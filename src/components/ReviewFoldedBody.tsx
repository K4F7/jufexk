import { Button } from "@heroui/react";
import { useEffect, useState, type ReactNode } from "react";
import { isReviewFolded, reviewFoldLabel } from "../lib/recognition";

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
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!folded) setExpanded(false);
  }, [folded]);

  if (!folded || expanded) {
    return (
      <div>
        {children}
        {folded ? (
          <Button
            className="mt-1.5"
            size="sm"
            variant="ghost"
            onPress={() => setExpanded(false)}
          >
            收起
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <p className="mb-0 mt-2 text-sm text-muted">
      {reviewFoldLabel({ endorsementCount, challengeCount })}
      <Button
        className="ms-2"
        size="sm"
        variant="ghost"
        onPress={() => setExpanded(true)}
      >
        展开
      </Button>
    </p>
  );
}
