import { describe, expect, it } from "vitest";
import { shouldOfferCatalogRescue } from "../src/lib/catalog-empty-rescue";

describe("shouldOfferCatalogRescue", () => {
  it("offers rescue only for an empty catalog with a committed query", () => {
    expect(
      shouldOfferCatalogRescue({
        itemCount: 0,
        query: "张三",
      }),
    ).toBe(true);
  });

  it("does not offer when the current catalog has results", () => {
    expect(
      shouldOfferCatalogRescue({
        itemCount: 3,
        query: "张三",
      }),
    ).toBe(false);
  });

  it("does not offer without a non-empty committed query", () => {
    expect(
      shouldOfferCatalogRescue({
        itemCount: 0,
        query: "",
      }),
    ).toBe(false);
    expect(
      shouldOfferCatalogRescue({
        itemCount: 0,
        query: "   ",
      }),
    ).toBe(false);
  });

  it("does not offer when extra filters would empty the other catalog", () => {
    expect(
      shouldOfferCatalogRescue({
        itemCount: 0,
        query: "张三",
        extraFilters: true,
      }),
    ).toBe(false);
  });
});
