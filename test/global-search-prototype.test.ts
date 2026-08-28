import { describe, expect, it } from "vitest";
import {
  catalogDetailHref,
  catalogSearchHref,
  parseGlobalSearchVariant,
  takeSuggestions,
} from "../src/prototype/global-search";

describe("parseGlobalSearchVariant", () => {
  it("reads A/B/C only in DEV for module=global-search", () => {
    expect(parseGlobalSearchVariant(false, "global-search", "B")).toBeNull();
    expect(parseGlobalSearchVariant(true, "catalog-search", "B")).toBeNull();
    expect(parseGlobalSearchVariant(true, "global-search", "b")).toBe("B");
    expect(parseGlobalSearchVariant(true, "global-search", null)).toBe("A");
    expect(parseGlobalSearchVariant(true, "global-search", "Z")).toBe("A");
  });
});

describe("catalog navigation hrefs", () => {
  it("builds a course catalog ?q= link that keeps prototype params and drops filters", () => {
    const params = new URLSearchParams(
      "q=旧词&category=sports&page=3&module=global-search&variant=B",
    );
    expect(catalogSearchHref(" 张三 ", params)).toBe(
      "/courses?q=%E5%BC%A0%E4%B8%89&module=global-search&variant=B",
    );
    expect(catalogSearchHref("", params)).toBe(
      "/courses?module=global-search&variant=B",
    );
  });

  it("builds a detail link that keeps prototype params", () => {
    const params = new URLSearchParams("module=global-search&variant=B");
    expect(catalogDetailHref("courses", 8, params)).toBe(
      "/courses/8?module=global-search&variant=B",
    );
    expect(catalogDetailHref("teachers", 12, params)).toBe(
      "/teachers/12?module=global-search&variant=B",
    );
  });
});

describe("takeSuggestions", () => {
  it("keeps at most five items from each API page", () => {
    expect(takeSuggestions([1, 2, 3, 4, 5, 6, 7], 5)).toEqual([1, 2, 3, 4, 5]);
    expect(takeSuggestions(["a", "b"], 5)).toEqual(["a", "b"]);
  });
});
