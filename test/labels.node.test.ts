import { describe, expect, it } from "vitest";
import { formatCredits, formatSidebarScore } from "../src/lib/labels";

describe("formatCredits", () => {
  it("shows exactly one decimal for finite credits", () => {
    expect(formatCredits(3)).toBe("3.0");
    expect(formatCredits(3.0)).toBe("3.0");
    expect(formatCredits(2)).toBe("2.0");
    expect(formatCredits(2.5)).toBe("2.5");
    expect(formatCredits(0.5)).toBe("0.5");
    expect(formatCredits(0)).toBe("0.0");
  });

  it("shows an em dash when credits are missing or not finite", () => {
    expect(formatCredits(null)).toBe("—");
    expect(formatCredits(undefined)).toBe("—");
    expect(formatCredits(Number.NaN)).toBe("—");
    expect(formatCredits(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatSidebarScore", () => {
  it("shows one decimal for a positive teacher rating", () => {
    expect(formatSidebarScore(4.6)).toBe("4.6");
    expect(formatSidebarScore(5)).toBe("5.0");
  });

  it("shows '-' when a teacher score is missing or not usable", () => {
    expect(formatSidebarScore(null)).toBe("-");
    expect(formatSidebarScore(undefined)).toBe("-");
    expect(formatSidebarScore(0)).toBe("-");
    expect(formatSidebarScore(Number.NaN)).toBe("-");
  });
});
