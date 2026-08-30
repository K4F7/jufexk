import { describe, expect, it } from "vitest";
import { isReviewFolded, REVIEW_FOLD_LABEL } from "../src/lib/recognition";

describe("review fold threshold", () => {
  it("folds for everyone when challenge is at least 3 and ahead of endorsement", () => {
    expect(
      isReviewFolded({ endorsementCount: 2, challengeCount: 3 }),
    ).toBe(true);
    expect(REVIEW_FOLD_LABEL).toBe("该评价因不受欢迎被折叠");
  });

  it("does not fold a tied or minority challenge below the public threshold", () => {
    expect(
      isReviewFolded({ endorsementCount: 3, challengeCount: 3 }),
    ).toBe(false);
    expect(
      isReviewFolded({ endorsementCount: 0, challengeCount: 2 }),
    ).toBe(false);
  });

  it("folds immediately for the viewer who challenged", () => {
    expect(
      isReviewFolded({
        endorsementCount: 4,
        challengeCount: 1,
        viewerChallenged: true,
      }),
    ).toBe(true);
    expect(
      isReviewFolded({
        endorsementCount: 4,
        challengeCount: 1,
        viewerChallenged: false,
      }),
    ).toBe(false);
  });
});
