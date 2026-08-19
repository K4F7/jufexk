import { describe, expect, it } from "vitest";
import {
  catalogPinyinText,
  isAsciiLetterTerm,
} from "../src/lib/catalog-pinyin";

describe("isAsciiLetterTerm", () => {
  it("accepts latin queries and rejects Chinese or letter-less ASCII", () => {
    expect(isAsciiLetterTerm("gaoshu")).toBe(true);
    expect(isAsciiLetterTerm("gdsx")).toBe(true);
    expect(isAsciiLetterTerm("zhang")).toBe(true);
    expect(isAsciiLetterTerm("高等数学")).toBe(false);
    expect(isAsciiLetterTerm("%")).toBe(false);
    expect(isAsciiLetterTerm("100")).toBe(false);
  });
});

describe("catalogPinyinText", () => {
  it("stores no-space full pinyin and initials", () => {
    const text = catalogPinyinText(["高数"]);
    expect(text).toContain("gaoshu");
    expect(text).toContain("gs");
  });

  it("lets gaoshu and gdsx reach 高等数学", () => {
    const text = catalogPinyinText(["高等数学"]);
    expect(text).toContain("gaodengshuxue");
    expect(text).toContain("gdsx");
    expect(text).toContain("gaoshu");
  });

  it("stores surname pinyin for teachers", () => {
    const text = catalogPinyinText(["张三"], { surname: true });
    expect(text).toContain("zhangsan");
    expect(text).toContain("zs");
  });
});
