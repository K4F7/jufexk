import { describe, expect, it } from "vitest";
import {
  extraMergedIndexes,
  mergedNameRealWindow,
} from "../src/lib/catalog-merge-page";

describe("mergedNameRealWindow", () => {
  it("keeps a bounded real-row window when extras land on the first page", () => {
    const extraIndexes = extraMergedIndexes([2, 15]);
    expect(extraIndexes).toEqual([2, 16]);
    expect(mergedNameRealWindow(0, 20, extraIndexes)).toEqual({
      offset: 0,
      limit: 18,
      extraIndexesOnPage: [2, 16],
    });
  });

  it("shifts OFFSET when extras occupy earlier pages", () => {
    const extraIndexes = extraMergedIndexes([2, 24]);
    expect(extraIndexes).toEqual([2, 25]);
    expect(mergedNameRealWindow(20, 20, extraIndexes)).toEqual({
      offset: 19,
      limit: 19,
      extraIndexesOnPage: [25],
    });
  });

  it("can return LIMIT 0 when the page is only virtual rows", () => {
    expect(mergedNameRealWindow(0, 1, [0])).toEqual({
      offset: 0,
      limit: 0,
      extraIndexesOnPage: [0],
    });
  });
});
