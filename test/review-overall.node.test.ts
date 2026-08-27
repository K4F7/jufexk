import { describe, expect, it } from "vitest";
import {
  overallCaption,
  parseOverallRating,
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
