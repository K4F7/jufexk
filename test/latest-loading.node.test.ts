import { describe, expect, it } from "vitest";
import {
  LATEST_FEED_COLUMN_CLASS,
  LATEST_PAGE_SIZE,
  LATEST_REVIEW_RESERVED_MIN_CLASS,
  LATEST_REVIEW_RESERVED_ROW_CLASS,
  LATEST_REVIEW_ROW_CLASS,
  latestReservedSpacerCount,
} from "../src/lib/latest-loading";

describe("latestReservedSpacerCount", () => {
  it("pads a short first page to the 20-row shell", () => {
    expect(latestReservedSpacerCount(3, 3)).toBe(LATEST_PAGE_SIZE - 3);
    expect(latestReservedSpacerCount(10, 10)).toBe(LATEST_PAGE_SIZE - 10);
    expect(latestReservedSpacerCount(10, 6)).toBe(LATEST_PAGE_SIZE - 6);
  });

  it("drops spacers once the feed is taller than the first page", () => {
    expect(latestReservedSpacerCount(20, 20)).toBe(0);
    expect(latestReservedSpacerCount(24, 24)).toBe(0);
    expect(latestReservedSpacerCount(24, 6)).toBe(18);
  });
});

describe("latest review row classes", () => {
  it("keeps reservation off loaded rows and on the loading shell", () => {
    expect(LATEST_REVIEW_ROW_CLASS).not.toContain("min-h-[22rem]");
    expect(LATEST_REVIEW_ROW_CLASS).not.toContain("min-h-[12rem]");
    expect(LATEST_REVIEW_RESERVED_MIN_CLASS).toContain("min-h-[12rem]");
    expect(LATEST_REVIEW_RESERVED_ROW_CLASS).toContain(LATEST_REVIEW_ROW_CLASS);
    expect(LATEST_REVIEW_RESERVED_ROW_CLASS).toContain("min-h-[12rem]");
    expect(LATEST_FEED_COLUMN_CLASS).toContain("max-w-[720px]");
  });
});
