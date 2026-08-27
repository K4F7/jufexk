import { describe, expect, it } from "vitest";
import { buildCatalogSearchRanking } from "../src/lib/catalog-search-ranking";

describe("catalog search ranking", () => {
  it("aggregates each term by its weakest bucket before the sum", () => {
    const ranking = buildCatalogSearchRanking(
      ["高等数学", "张三"],
      { exact: ["c.name"], prefix: ["c.name"], substring: ["c.name"], pinyin: "pcc.pinyin_text" },
      "course",
    );
    expect(ranking.sql).toContain("262144");
    expect(ranking.sql).toContain("+");
    expect(ranking.args).toHaveLength(2);
  });

  it("uses token-boundary pinyin checks and keeps FTS below prefix", () => {
    const ranking = buildCatalogSearchRanking(
      ["gaoshu"],
      { exact: ["c.name"], prefix: ["c.name"], substring: ["c.name"], pinyin: "pcc.pinyin_text", fts: "pcc.fts_hit=1" },
      "option",
    );
    expect(ranking.sql).toContain("instr(' ' || COALESCE(pcc.pinyin_text");
    expect(ranking.sql.indexOf("THEN 2")).toBeLessThan(ranking.sql.indexOf("THEN 4"));
    expect(ranking.args).toContain("gaoshu");
  });

  it("returns a neutral ranking for an empty query", () => {
    expect(buildCatalogSearchRanking([], { exact: ["c.name"] }, "course")).toEqual({ sql: "0.0", args: [] });
  });
});
