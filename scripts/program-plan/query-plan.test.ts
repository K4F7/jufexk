import { describe, expect, it } from "vitest";
import {
  coverageFromQueries,
  freezeQueryPlan,
  freezeSourceDictionary,
  isPlaceholderOption,
  selectCurrentUndergraduateGrades,
  type CascadeNode,
} from "./query-plan";

const cascade: CascadeNode[] = [
  {
    grade: { id: "2024", label: "2024" },
    department: { id: "11", label: "会计学院" },
    majors: [{ id: "1202", label: "会计学" }],
  },
  {
    grade: { id: "2025", label: "2025" },
    department: { id: "14", label: "软件与物联网工程学院" },
    majors: [{ id: "080902", label: "软件工程" }, { id: "080901", label: "计算机科学与技术" }],
  },
  {
    grade: { id: "2025", label: "2025" },
    department: { id: "99", label: "空专业院系" },
    majors: [],
  },
];

describe("program plan query matrix", () => {
  it("picks the current four undergraduate grades from the page dropdown", () => {
    const options = [
      { id: "2020", label: "2020" },
      { id: "2023", label: "2023" },
      { id: "2024", label: "2024" },
      { id: "2025", label: "2025" },
      { id: "2026", label: "2026" },
    ];
    expect(selectCurrentUndergraduateGrades(options, new Date("2026-08-26")).map((option) => option.id)).toEqual([
      "2023", "2024", "2025", "2026",
    ]);
  });

  it("builds one 主修 query per grade × department × major and records empty departments", () => {
    const dictionary = freezeSourceDictionary(cascade);
    const { queries, coverage } = freezeQueryPlan(dictionary);

    expect(queries).toHaveLength(3);
    expect(queries.every((query) => query.dimensions.studyKind === "主修" && query.dimensions.majorDirection === "")).toBe(true);
    expect(queries.map((query) => query.queryId)).toEqual([
      "main-2024-11-1202",
      "main-2025-14-080902",
      "main-2025-14-080901",
    ]);
    expect(coverage.filter((entry) => entry.reason === "department_has_no_majors")).toEqual([
      expect.objectContaining({ grade: "2025", departmentCode: "99", status: "exception", majorCode: "" }),
    ]);
    expect(coverage).toHaveLength(4);
  });

  it("keeps empty search results distinct from query failures", () => {
    const dictionary = freezeSourceDictionary(cascade.slice(0, 2));
    const coverage = coverageFromQueries("batch", dictionary, [
      { queryId: "main-2024-11-1202", status: "complete", declaredRecordCount: 0 },
      { queryId: "main-2025-14-080902", status: "exception", declaredRecordCount: 0 },
      { queryId: "main-2025-14-080901", status: "complete", declaredRecordCount: 12 },
    ]);
    expect(coverage.entries.map((entry) => `${entry.queryId}:${entry.status}`)).toEqual([
      "main-2024-11-1202:empty",
      "main-2025-14-080902:exception",
      "main-2025-14-080901:complete",
    ]);
  });

  it("ignores placeholder dropdown options", () => {
    expect(isPlaceholderOption({ id: "", label: "请选择" })).toBe(true);
    expect(isPlaceholderOption({ id: "080902", label: "软件工程" })).toBe(false);
  });
});
