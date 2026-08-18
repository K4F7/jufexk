import { describe, expect, it } from "vitest";
import {
  escapeRegExp,
  highlightTermsFromSearch,
  splitSearchHighlights,
} from "../src/lib/catalog-search-highlight";

describe("splitSearchHighlights", () => {
  it("returns plain text when there are no terms", () => {
    expect(splitSearchHighlights("高等数学", [])).toEqual([
      { text: "高等数学", highlight: false },
    ]);
  });

  it("highlights multiple terms case-insensitively", () => {
    expect(
      splitSearchHighlights("高等数学 · 张三", ["高等数学", "张三"]),
    ).toEqual([
      { text: "高等数学", highlight: true },
      { text: " · ", highlight: false },
      { text: "张三", highlight: true },
    ]);
    expect(splitSearchHighlights("ABC123", ["abc"])).toEqual([
      { text: "ABC", highlight: true },
      { text: "123", highlight: false },
    ]);
  });

  it("treats % and _ as literal match substrings", () => {
    expect(splitSearchHighlights("100% done", ["%"])).toEqual([
      { text: "100", highlight: false },
      { text: "%", highlight: true },
      { text: " done", highlight: false },
    ]);
    expect(splitSearchHighlights("C_语言基础", ["_"])).toEqual([
      { text: "C", highlight: false },
      { text: "_", highlight: true },
      { text: "语言基础", highlight: false },
    ]);
  });

  it("does not highlight when nothing matches", () => {
    expect(splitSearchHighlights("线性代数", ["高等数学"])).toEqual([
      { text: "线性代数", highlight: false },
    ]);
  });
});

describe("escapeRegExp", () => {
  it("escapes regex metacharacters in user terms", () => {
    expect(escapeRegExp("a.b")).toBe("a\\.b");
    expect(escapeRegExp("100\\")).toBe("100\\\\");
  });
});

describe("highlightTermsFromSearch", () => {
  it("returns no terms when q is absent", () => {
    expect(highlightTermsFromSearch("?page=2")).toEqual([]);
    expect(highlightTermsFromSearch("")).toEqual([]);
  });

  it("parses q with the same rules as catalog search", () => {
    expect(
      highlightTermsFromSearch("?q=" + encodeURIComponent("高等数学 张三")),
    ).toEqual(["高等数学", "张三"]);
  });
});
