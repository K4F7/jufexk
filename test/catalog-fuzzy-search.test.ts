import { describe, expect, it } from "vitest";
import {
  CATALOG_FUZZY_CANDIDATE_LIMIT,
  isCatalogFuzzyQueryEligible,
  rankCatalogFuzzyCandidates,
  type CourseSearchCandidate,
  type TeacherSearchCandidate,
} from "../src/lib/catalog-fuzzy-search";
import { buildCatalogCandidateFtsQuery } from "../src/lib/catalog-search-candidates";

const courses: CourseSearchCandidate[] = [
  {
    id: 1,
    name: "高等数学",
    code: "MAT100",
    department: "统计与数据科学学院",
    teachers: ["张三"],
    pinyin: "gaodengshuxue gdsx gaoshu",
  },
  {
    id: 2,
    name: "高等代数",
    code: "MAT200",
    department: "统计与数据科学学院",
    teachers: ["李四"],
    pinyin: "gaodengdaishu gdds gaodai",
  },
];

const teachers: TeacherSearchCandidate[] = [
  {
    id: 9,
    name: "张三丰",
    department: "人文学院",
    pinyin: "zhangsanfeng zsf zhangsan",
  },
  {
    id: 10,
    name: "张三峰",
    department: "体育学院",
    pinyin: "zhangsanfeng zsf zhangsan",
  },
];

describe("isCatalogFuzzyQueryEligible", () => {
  it("keeps single characters and two-character Chinese queries out of fuzzy fallback", () => {
    expect(isCatalogFuzzyQueryEligible("高")).toBe(false);
    expect(isCatalogFuzzyQueryEligible("高数")).toBe(false);
    expect(isCatalogFuzzyQueryEligible("高等数雪")).toBe(true);
    expect(isCatalogFuzzyQueryEligible("mat10")).toBe(true);
  });
});

describe("buildCatalogCandidateFtsQuery", () => {
  it("quotes FTS operators and wildcard characters as literals", () => {
    const query = buildCatalogCandidateFtsQuery(`C++ %_\\ "语法"`);
    expect(query).toContain('"c++"');
    expect(query).toContain('"%_\\"');
    expect(query).toContain('"""语法"');
    expect(query).toMatch(/^".*"(?: OR ".*")*$/);
  });
});

describe("rankCatalogFuzzyCandidates", () => {
  it.each([
    ["course", "高等数雪", courses, 1],
    ["course", "MTA100", courses, 1],
    ["course", "gaodengshuxe", courses, 1],
    ["teacher", "张三凤", teachers, 9],
  ] as const)("ranks the intended %s typo first", (kind, query, candidates, expectedId) => {
    const [first] =
      kind === "course"
        ? rankCatalogFuzzyCandidates(kind, query, candidates as CourseSearchCandidate[])
        : rankCatalogFuzzyCandidates(kind, query, candidates as TeacherSearchCandidate[]);
    expect(first?.item.id).toBe(expectedId);
  });

  it("does not let a weak department match outrank an obvious name typo", () => {
    const candidates: CourseSearchCandidate[] = [
      ...courses,
      {
        id: 3,
        name: "大学语文",
        code: "CHN100",
        department: "高等数学系",
        teachers: ["王五"],
        pinyin: "daxueyuwen dxyw",
      },
    ];

    const [first] = rankCatalogFuzzyCandidates("course", "高等数雪", candidates);
    expect(first?.item.id).toBe(1);
  });

  it("never sends more than the hard candidate limit into Fuse", () => {
    const candidates = Array.from(
      { length: CATALOG_FUZZY_CANDIDATE_LIMIT + 10 },
      (_, index): TeacherSearchCandidate => ({
        id: index + 1,
        name: `教师${index + 1}`,
        department: "测试学院",
        pinyin: `jiaoshi${index + 1}`,
      }),
    );

    const results = rankCatalogFuzzyCandidates("teacher", "jiaoshi", candidates);
    expect(results.length).toBeLessThanOrEqual(CATALOG_FUZZY_CANDIDATE_LIMIT);
    expect(results.some((result) => result.item.id > CATALOG_FUZZY_CANDIDATE_LIMIT)).toBe(
      false,
    );
  });
});
