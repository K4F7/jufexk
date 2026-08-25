import { describe, expect, it } from "vitest";
import { parseReviewDraft, REVIEW_DRAFT_VERSION } from "../src/lib/review-draft";

describe("parseReviewDraft", () => {
  it("keeps a valid draft and drops expired or broken payloads", () => {
    const fresh = parseReviewDraft({
      version: REVIEW_DRAFT_VERSION,
      term: "2026秋",
      scores: { difficulty: "2" },
      overall: "4.5",
      note: "老师讲课很清楚，收获很大，推荐给学弟学妹。",
      grade: "90",
      loginOnly: true,
      reviewOnly: true,
      savedAt: Date.now(),
    });
    expect(fresh).toMatchObject({
      overall: "4.5",
      note: "老师讲课很清楚，收获很大，推荐给学弟学妹。",
      grade: "90",
      loginOnly: true,
      reviewOnly: true,
    });
    expect(
      parseReviewDraft({
        version: REVIEW_DRAFT_VERSION,
        term: "2026秋",
        scores: {},
        overall: "",
        note: "还没写完",
        grade: "",
        loginOnly: false,
        savedAt: Date.now(),
      })?.reviewOnly,
    ).toBe(false);

    expect(
      parseReviewDraft({
        version: REVIEW_DRAFT_VERSION,
        term: "",
        scores: {},
        overall: "",
        note: "还没写完",
        grade: "",
        savedAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
      }),
    ).toBeNull();
    expect(parseReviewDraft({ version: 0 })).toBeNull();
  });
});
