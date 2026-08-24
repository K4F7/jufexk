import { describe, expect, it } from "vitest";
import { mergePublicReviewPages } from "../src/hooks/usePublicReviewPagination";
import type { PublicReview } from "../src/lib/types";

const review = (id: string, comment: string): PublicReview => ({
  id,
  comment,
  course_id: 1,
  teacher_id: 1,
});

describe("mergePublicReviewPages", () => {
  it("appends unseen reviews and drops duplicates by id", () => {
    const existing = [review("review:1", "第一页"), review("review:2", "第一页重复")];
    const incoming = [
      review("review:2", "第二页重复"),
      review("review:3", "第二页新"),
    ];
    expect(mergePublicReviewPages(existing, incoming)).toEqual([
      review("review:1", "第一页"),
      review("review:2", "第一页重复"),
      review("review:3", "第二页新"),
    ]);
  });
});
