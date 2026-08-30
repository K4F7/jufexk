import { describe, expect, it } from "vitest";
import {
  isReviewFolded,
  REVIEW_FOLD_LABEL,
  REVIEW_PUBLIC_FOLD_EXPAND_LABEL,
  reviewFoldKind,
} from "../src/lib/recognition";

describe("review fold threshold", () => {
  it("folds for everyone when challenge is at least 3 and ahead of endorsement", () => {
    expect(
      isReviewFolded({ endorsementCount: 2, challengeCount: 3 }),
    ).toBe(true);
    expect(reviewFoldKind({ endorsementCount: 2, challengeCount: 3 })).toBe(
      "public",
    );
    expect(REVIEW_FOLD_LABEL).toBe("该评价因不受欢迎被折叠");
    expect(REVIEW_PUBLIC_FOLD_EXPAND_LABEL).toBe("看看");
  });

  it("does not fold a tied or minority challenge below the public threshold", () => {
    expect(
      isReviewFolded({ endorsementCount: 3, challengeCount: 3 }),
    ).toBe(false);
    expect(
      isReviewFolded({ endorsementCount: 0, challengeCount: 2 }),
    ).toBe(false);
    expect(reviewFoldKind({ endorsementCount: 3, challengeCount: 3 })).toBe(
      "none",
    );
  });

  it("does not fold just because the viewer challenged", () => {
    expect(
      reviewFoldKind({
        endorsementCount: 4,
        challengeCount: 1,
      }),
    ).toBe("none");
    expect(
      isReviewFolded({
        endorsementCount: 4,
        challengeCount: 1,
      }),
    ).toBe(false);
  });

  it("still uses the public fold when the viewer also challenged a threshold review", () => {
    expect(
      reviewFoldKind({
        endorsementCount: 1,
        challengeCount: 3,
      }),
    ).toBe("public");
  });
});
