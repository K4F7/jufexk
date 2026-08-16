import { describe, expect, it } from "vitest";
import { diffSourceDictionary, freezeQueryPlan, freezeSourceDictionary, type SourceDictionaryInput } from "./query-plan";

const source: SourceDictionaryInput = {
  semesters: [{ id: "2025-2", label: "2025-2026 第二学期" }, { id: "2026-1", label: "2026-2027 第一学期" }],
  educationLevels: [{ id: "ug", label: "本科" }, { id: "pg", label: "研究生" }],
  grades: [{ id: "2024", label: "2024" }, { id: "2025", label: "2025" }],
  homeUnits: [{ id: "01", label: "软件与物联网工程学院" }],
};

describe("frozen query plan", () => {
  it("uses only semester × education level × grade and keeps all wide filters blank", () => {
    const frozen = freezeSourceDictionary(source);
    const plan = freezeQueryPlan(frozen);

    expect(plan.queries).toHaveLength(8);
    expect(new Set(plan.queries.map((query) => query.queryId)).size).toBe(8);
    expect(plan.queries.every((query) => Object.values(query.filters).every((value) => value === ""))).toBe(true);
    expect(plan.sourceDictionarySha256).toBe(frozen.sha256);
  });

  it("creates supplemental queries only for units affected by source changes", () => {
    const before = freezeSourceDictionary(source);
    const after = freezeSourceDictionary({
      ...source,
      grades: [...source.grades, { id: "2026", label: "2026" }],
      homeUnits: [{ id: "01", label: "软件工程学院" }],
    });

    const change = diffSourceDictionary(before, after);
    expect(change.status).toBe("source_changed");
    expect(change.changes.map((item) => `${item.dictionary}:${item.kind}:${item.id}`)).toEqual([
      "grades:added:2026",
      "homeUnits:renamed:01",
    ]);
    expect(change.supplementalPlan.queries).toHaveLength(16);
    expect(change.supplementalPlan.queries.filter((query) => query.filters.homeUnit === "01")).toHaveLength(12);
    expect(change.supplementalPlan.queries.filter((query) => query.filters.homeUnit === "").every((query) => query.dimensions.grade === "2026")).toBe(true);
    const completedIds = new Set(freezeQueryPlan(before).queries.map((query) => query.queryId));
    expect(change.supplementalPlan.queries.every((query) => !completedIds.has(query.queryId))).toBe(true);
  });

  it("defines targeted counterexample queries separately from the main matrix", () => {
    const plan = freezeQueryPlan(freezeSourceDictionary(source), {
      counterexamples: [{ baseQueryId: "main-2026-1-ug-2025", dimension: "major", value: "software" }],
    });
    expect(plan.counterexamples).toEqual([
      expect.objectContaining({ kind: "counterexample", baseQueryId: "main-2026-1-ug-2025", filters: expect.objectContaining({ major: "software" }) }),
    ]);
    expect(plan.queries).toHaveLength(8);
  });
});
