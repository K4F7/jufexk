import { describe, expect, it } from "vitest";
import {
  shouldFetchCatalogSuggestions,
  shouldOpenCatalogSuggestions,
} from "../src/lib/catalog-search-suggest";

describe("shouldFetchCatalogSuggestions", () => {
  it("requires at least one non-whitespace character", () => {
    expect(shouldFetchCatalogSuggestions("")).toBe(false);
    expect(shouldFetchCatalogSuggestions("   ")).toBe(false);
    expect(shouldFetchCatalogSuggestions("高")).toBe(true);
    expect(shouldFetchCatalogSuggestions(" 高等 ")).toBe(true);
  });
});

describe("shouldOpenCatalogSuggestions", () => {
  const readyHits = {
    focused: true,
    query: "高等",
    ready: true,
    failed: false,
  };

  it("opens after a focused query is ready", () => {
    expect(shouldOpenCatalogSuggestions(readyHits)).toBe(true);
  });

  it("stays closed while the current query is still loading", () => {
    expect(shouldOpenCatalogSuggestions({ ...readyHits, ready: false })).toBe(
      false,
    );
  });

  it("stays closed without focus, without a query, after dismiss, or after a failed request", () => {
    expect(shouldOpenCatalogSuggestions({ ...readyHits, focused: false })).toBe(
      false,
    );
    expect(shouldOpenCatalogSuggestions({ ...readyHits, query: "   " })).toBe(
      false,
    );
    expect(shouldOpenCatalogSuggestions({ ...readyHits, dismissed: true })).toBe(
      false,
    );
    expect(shouldOpenCatalogSuggestions({ ...readyHits, failed: true })).toBe(
      false,
    );
  });
});
