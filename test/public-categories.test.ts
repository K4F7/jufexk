import { describe, expect, it } from "vitest";
import {
  GENERAL_EDUCATION_FILTER,
  isGeneralEducationFilter,
  isPublicCatalogCategory,
  PUBLIC_CATEGORY_OPTIONS,
  publicCategoryOptionLabel,
  publicCategoryOptionSelected,
} from "../src/lib/public-categories";

describe("public catalog category options", () => {
  it("shows 通识课 instead of 专业课 and 公共课", () => {
    expect(PUBLIC_CATEGORY_OPTIONS.map((opt) => opt.id)).toEqual([
      "",
      "general",
      "sports",
      "english",
      "ideology",
      "math",
    ]);
    expect(PUBLIC_CATEGORY_OPTIONS.map((opt) => opt.label)).toEqual([
      "全部",
      "通识课",
      "体育课",
      "英语课",
      "思政课",
      "数学课",
    ]);
  });

  it("treats general, major, and public_basic as the same 通识 filter", () => {
    expect(GENERAL_EDUCATION_FILTER).toBe("general");
    expect(isGeneralEducationFilter("general")).toBe(true);
    expect(isGeneralEducationFilter("major")).toBe(true);
    expect(isGeneralEducationFilter("public_basic")).toBe(true);
    expect(isGeneralEducationFilter("english")).toBe(false);
    expect(isPublicCatalogCategory("general")).toBe(true);
    expect(isPublicCatalogCategory("major")).toBe(true);
    expect(isPublicCatalogCategory("public_basic")).toBe(true);
    expect(isPublicCatalogCategory("pe")).toBe(false);
    expect(publicCategoryOptionLabel("general")).toBe("通识课");
    expect(publicCategoryOptionLabel("major")).toBe("通识课");
    expect(publicCategoryOptionLabel("public_basic")).toBe("通识课");
    expect(publicCategoryOptionSelected("general", "major")).toBe(true);
    expect(publicCategoryOptionSelected("general", "public_basic")).toBe(true);
    expect(publicCategoryOptionSelected("general", "english")).toBe(false);
    expect(publicCategoryOptionSelected("english", "english")).toBe(true);
  });
});
