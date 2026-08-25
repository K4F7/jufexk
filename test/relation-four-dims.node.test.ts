import { describe, expect, it } from "vitest";
import {
  CURRENT_SCORES,
  V1_OFFLINE_SCORES,
  V3_OFFLINE_SCORES,
} from "./review-score-fixtures";
import { aggregateRelationDimensionLabels } from "../src/lib/relation-four-dims";

describe("aggregateRelationDimensionLabels", () => {
  it("returns the mode of new four-dim snapshots and ignores v1 1–5 scores", () => {
    const labels = aggregateRelationDimensionLabels([
      { schemeKey: "major", schemeVersion: 1, scores: V1_OFFLINE_SCORES },
      { schemeKey: "major", schemeVersion: 2, scores: CURRENT_SCORES },
      {
        schemeKey: "major",
        schemeVersion: 2,
        scores: { difficulty: 1, homework: 1, grading: 1, gain: 1 },
      },
      {
        schemeKey: "major",
        schemeVersion: 2,
        scores: { difficulty: 1, homework: 1, grading: 1, gain: 1 },
      },
    ]);
    expect(labels).toEqual([
      { id: "difficulty", label: "课程难度", option: "简单" },
      { id: "homework", label: "作业多少", option: "不多" },
      { id: "grading", label: "给分好坏", option: "超好" },
      { id: "gain", label: "收获多少", option: "很多" },
    ]);
  });

  it("breaks a two-way mode tie using the scheme option order", () => {
    const labels = aggregateRelationDimensionLabels([
      {
        schemeKey: "major",
        schemeVersion: 2,
        scores: { difficulty: 3, homework: 3, grading: 3, gain: 3 },
      },
      {
        schemeKey: "major",
        schemeVersion: 2,
        scores: { difficulty: 1, homework: 1, grading: 1, gain: 1 },
      },
    ]);
    expect(labels).toEqual([
      { id: "difficulty", label: "课程难度", option: "简单" },
      { id: "homework", label: "作业多少", option: "不多" },
      { id: "grading", label: "给分好坏", option: "超好" },
      { id: "gain", label: "收获多少", option: "很多" },
    ]);
  });

  it("treats a v4 snapshot as the same four dims as v2", () => {
    expect(
      aggregateRelationDimensionLabels([
        { schemeKey: "major", schemeVersion: 4, scores: CURRENT_SCORES },
      ]),
    ).toEqual([
      { id: "difficulty", label: "课程难度", option: "简单" },
      { id: "homework", label: "作业多少", option: "中等" },
      { id: "grading", label: "给分好坏", option: "杀手" },
      { id: "gain", label: "收获多少", option: "一般" },
    ]);
  });

  it("returns null when there are no new four-dim snapshots", () => {
    expect(
      aggregateRelationDimensionLabels([
        { schemeKey: "major", schemeVersion: 1, scores: V1_OFFLINE_SCORES },
      ]),
    ).toBeNull();
  });

  it("keeps the relation aggregate at four dims when v3 snapshots carry attendance", () => {
    const labels = aggregateRelationDimensionLabels([
      { schemeKey: "major", schemeVersion: 2, scores: CURRENT_SCORES },
      { schemeKey: "major", schemeVersion: 3, scores: V3_OFFLINE_SCORES },
      {
        schemeKey: "major",
        schemeVersion: 3,
        scores: { ...V3_OFFLINE_SCORES, attendance: 3 },
      },
    ]);
    expect(labels).toEqual([
      { id: "difficulty", label: "课程难度", option: "简单" },
      { id: "homework", label: "作业多少", option: "中等" },
      { id: "grading", label: "给分好坏", option: "杀手" },
      { id: "gain", label: "收获多少", option: "一般" },
    ]);
    expect(labels?.some((item) => item.id === "attendance")).toBe(false);
  });
});
