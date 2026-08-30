import { describe, expect, it } from "vitest";
import {
  expandOverallStarBucket,
  expandOverallStarFilter,
  formatReviewRatingFilterLabel,
  nextReviewRatingFilter,
  overallCaption,
  parseOverallRating,
  parseReviewRatingFilter,
} from "../src/lib/review-overall";

describe("parseOverallRating", () => {
  it("accepts whole and half stars from 1 to 5", () => {
    expect(parseOverallRating(1)).toBe(1);
    expect(parseOverallRating("4.5")).toBe(4.5);
    expect(parseOverallRating(5)).toBe(5);
  });

  it("rejects values outside the scale or not on a half-star step", () => {
    expect(parseOverallRating(0.5)).toBeNull();
    expect(parseOverallRating(4.2)).toBeNull();
    expect(parseOverallRating(6)).toBeNull();
    expect(parseOverallRating("")).toBeNull();
  });
});

describe("overallCaption", () => {
  it("returns the label for a selected star value", () => {
    expect(overallCaption("1")).toBe("较差");
    expect(overallCaption("3.5")).toBe("很推荐");
    expect(overallCaption("4.5")).toBe("非常推荐");
    expect(overallCaption("5")).toBe("必选");
    expect(overallCaption(String(3.5))).toBe("很推荐");
    expect(overallCaption("")).toBe("");
  });
});

describe("overall star filter buckets", () => {
  it("expands a whole star to that value and the half step above", () => {
    expect(expandOverallStarBucket(4)).toEqual([4, 4.5]);
    expect(expandOverallStarBucket(1)).toEqual([1, 1.5]);
    expect(expandOverallStarBucket(5)).toEqual([5]);
  });

  it("expands a multi-select list into the union of buckets", () => {
    expect(expandOverallStarFilter([4, 5])).toEqual([4, 4.5, 5]);
  });

  it("parses comma-separated integer stars and rejects half-star tokens", () => {
    expect(parseReviewRatingFilter("")).toBeNull();
    expect(parseReviewRatingFilter("4")).toEqual([4]);
    expect(parseReviewRatingFilter("5,4,4")).toEqual([4, 5]);
    expect(parseReviewRatingFilter("4.5")).toBeNull();
    expect(parseReviewRatingFilter("0,4")).toBeNull();
  });

  it("formats the trigger label and treats 全部 as exclusive", () => {
    expect(formatReviewRatingFilterLabel([])).toBe("全部");
    expect(formatReviewRatingFilterLabel([4, 5])).toBe("5 星、4 星");
    expect(nextReviewRatingFilter([], ["all", "4"])).toEqual([4]);
    expect(nextReviewRatingFilter([4], ["4", "all"])).toEqual([]);
    expect(nextReviewRatingFilter([4], [])).toEqual([]);
    expect(nextReviewRatingFilter([4, 5], ["5"])).toEqual([5]);
  });
});
