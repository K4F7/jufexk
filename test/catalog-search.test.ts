import { describe, expect, it } from "vitest";
import { isAsciiLetterTerm } from "../src/lib/catalog-pinyin";
import {
  andSearchTerms,
  andSearchTermsWithPinyin,
  andSearchTermsWithTrigram,
  ftsLiteral,
  isTrigramTerm,
  delimitedExactSql,
  likeEscape,
  likeSql,
  parseSearchTerms,
  prefixPattern,
} from "../src/lib/catalog-search";

describe("parseSearchTerms", () => {
  it("splits on half-width and full-width whitespace", () => {
    expect(parseSearchTerms("高等数学 张三")).toEqual(["高等数学", "张三"]);
    expect(parseSearchTerms("高等数学　张三")).toEqual(["高等数学", "张三"]);
    expect(parseSearchTerms("高等数学\t张三\n李四")).toEqual([
      "高等数学",
      "张三",
      "李四",
    ]);
  });

  it("returns no terms for an empty or whitespace-only query", () => {
    expect(parseSearchTerms("")).toEqual([]);
    expect(parseSearchTerms("   　 ")).toEqual([]);
  });

  it("drops duplicates and caps the term count", () => {
    expect(parseSearchTerms("张三 张三")).toEqual(["张三"]);
    expect(parseSearchTerms("a b c d e f g h")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });
});

describe("trigram search routing", () => {
  it("routes Unicode terms of three code points and quotes FTS operators", () => {
    expect(isTrigramTerm("财经大")).toBe(true);
    expect(isTrigramTerm("财")).toBe(false);
    expect(ftsLiteral("foo OR bar%\"baz")).toBe('"foo OR bar%""baz"');
    expect(
      andSearchTermsWithTrigram(
        ["财经大", "财"],
        (term) => ({ sql: "name LIKE ?", args: [`%${term}%`] }),
        "id IN (SELECT rowid FROM course_search_fts WHERE course_search_fts MATCH ?)",
      ),
    ).toEqual({
      sql: '((id IN (SELECT rowid FROM course_search_fts WHERE course_search_fts MATCH ?)) AND (name LIKE ?)) AND (name LIKE ?)',
      args: ['"财经大"', "%财经大%", "%财%"],
    });
  });
});

describe("likeEscape", () => {
  it("escapes wildcards and the escape character itself", () => {
    expect(likeEscape("100%")).toBe("100\\%");
    expect(likeEscape("C_语言")).toBe("C\\_语言");
    expect(likeEscape("a\\b")).toBe("a\\\\b");
    expect(likeEscape("高等数学")).toBe("高等数学");
  });

  it("keeps escaped wildcards inside contains and prefix patterns", () => {
    expect(andSearchTerms(["100%"], likeSql("c.name")).args).toEqual([
      "%100\\%%",
    ]);
    expect(prefixPattern("100%")).toBe("100\\%%");
  });
});

describe("likeSql", () => {
  it("always pairs LIKE with an ESCAPE clause", () => {
    expect(likeSql("c.name")).toBe("c.name LIKE ? ESCAPE '\\'");
  });
});

describe("delimitedExactSql", () => {
  it("matches a unit-separator wrapped value", () => {
    expect(delimitedExactSql("pcc.teacher_variant_text")).toBe(
      "instr(pcc.teacher_variant_text, char(31) || ? || char(31)) > 0",
    );
  });
});

describe("andSearchTerms", () => {
  it("returns an empty filter when there are no terms", () => {
    expect(andSearchTerms([], likeSql("c.name"))).toEqual({ sql: "", args: [] });
  });

  it("ands one parenthesised group per term", () => {
    const filter = andSearchTerms(["高等数学", "张三"], likeSql("c.name"));
    expect(filter.sql).toBe(
      "(c.name LIKE ? ESCAPE '\\') AND (c.name LIKE ? ESCAPE '\\')",
    );
    expect(filter.args).toEqual(["%高等数学%", "%张三%"]);
  });

  it("binds every placeholder of a term group to the same term", () => {
    const filter = andSearchTerms(
      ["张三"],
      `${likeSql("c.name")} OR ${likeSql("c.code")} OR ${likeSql("t.name")}`,
    );
    expect(filter.args).toEqual(["%张三%", "%张三%", "%张三%"]);
  });

  it("ignores question marks inside string literals when counting placeholders", () => {
    const filter = andSearchTerms(
      ["张三"],
      `c.name GLOB '?[0-9]*' OR ${likeSql("c.name")}`,
    );
    expect(filter.args).toEqual(["%张三%"]);
  });

  it("handles escaped single quotes inside literals", () => {
    const filter = andSearchTerms(
      ["张三"],
      `c.name='it''s ?' OR ${likeSql("c.name")}`,
    );
    expect(filter.args).toEqual(["%张三%"]);
  });

  it("refuses fragments whose placeholders it cannot count reliably", () => {
    // 数错占位符会让整条语句的绑定表错位，比语法错误难发现，所以宁可抛错。
    expect(() => andSearchTerms(["张三"], `${likeSql("c.name")} -- ?`)).toThrow(
      /无法可靠计数/,
    );
    expect(() =>
      andSearchTerms(["张三"], `${likeSql('"quoted"')} `),
    ).toThrow(/无法可靠计数/);
  });
});

describe("andSearchTermsWithPinyin", () => {
  it("only ORs the pinyin column for ASCII letter terms", () => {
    const ascii = andSearchTermsWithPinyin(
      ["gaoshu"],
      likeSql("pcc.match_text"),
      likeSql("pcc.pinyin_text"),
      isAsciiLetterTerm,
    );
    expect(ascii.sql).toBe(
      "(pcc.match_text LIKE ? ESCAPE '\\' OR pcc.pinyin_text LIKE ? ESCAPE '\\')",
    );
    expect(ascii.args).toEqual(["%gaoshu%", "%gaoshu%"]);

    const chinese = andSearchTermsWithPinyin(
      ["高等数学"],
      likeSql("pcc.match_text"),
      likeSql("pcc.pinyin_text"),
      isAsciiLetterTerm,
    );
    expect(chinese.sql).toBe("(pcc.match_text LIKE ? ESCAPE '\\')");
    expect(chinese.args).toEqual(["%高等数学%"]);
  });
});
