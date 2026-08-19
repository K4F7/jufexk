import { describe, expect, it } from "vitest";
import { shouldFetchCatalogSuggestions } from "../src/lib/catalog-search-suggest";

describe("shouldFetchCatalogSuggestions", () => {
  it("requires at least one non-whitespace character", () => {
    expect(shouldFetchCatalogSuggestions("")).toBe(false);
    expect(shouldFetchCatalogSuggestions("   ")).toBe(false);
    expect(shouldFetchCatalogSuggestions("高")).toBe(true);
    expect(shouldFetchCatalogSuggestions(" 高等 ")).toBe(true);
  });
});
