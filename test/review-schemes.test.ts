import { describe, expect, it } from "vitest";
import {
  applicableDimensions,
  courseSchemeView,
  defaultSchemeKey,
  dimensionAverage,
  latestSchemeVersion,
  publicDimensionAverage,
  REVIEW_NOTE_MAX_LENGTH,
  REVIEW_SCHEMES,
  snapshotReviewScores,
  validateReviewNote,
  validateSubmittedScores,
} from "../src/lib/review-schemes";
import {
  CURRENT_SCORES,
  REQUIRED_NOTE,
  V1_MOOC_SCORES,
  V1_OFFLINE_SCORES,
} from "./review-score-fixtures";

const TIER3_IDS = ["difficulty", "homework", "grading", "gain"];

describe("review scheme defaults and applicable questions", () => {
  it("defaults unclassified sports courses to pe and others to major", () => {
    expect(defaultSchemeKey("sports")).toBe("pe");
    expect(defaultSchemeKey("general")).toBe("major");
    expect(defaultSchemeKey("pe")).toBe("major");
  });

  it("keeps the same latest four three-tier questions for major, pe and mooc", () => {
    const expected = TIER3_IDS;
    expect(applicableDimensions("major", []).map((item) => item.id)).toEqual(
      expected,
    );
    expect(
      applicableDimensions("pe", []).map((item) => item.id),
    ).toEqual(expected);
    expect(
      applicableDimensions("major", ["mooc"]).map((item) => item.id),
    ).toEqual(expected);
    expect(
      applicableDimensions("pe", ["mooc"]).map((item) => item.id),
    ).toEqual(expected);
  });

  it("keeps published v1 read-only and writes the latest version", () => {
    for (const scheme of Object.values(REVIEW_SCHEMES)) {
      expect(scheme.versions[0]?.version).toBe(1);
      expect(scheme.versions[0]?.averagesDimensions).toBe(true);
      expect(scheme.versions[0]?.dimensions.map((item) => item.id)).toEqual([
        "teaching",
        "attendance",
        "grading",
        "workload",
      ]);
      expect(latestSchemeVersion(scheme.key).version).toBe(2);
      expect(latestSchemeVersion(scheme.key).averagesDimensions).toBe(false);
      expect(latestSchemeVersion(scheme.key).dimensions.map((item) => item.id)).toEqual(
        TIER3_IDS,
      );
    }
  });

  it("exposes resolved scheme, tags and three-tier options for course reads", () => {
    const general = courseSchemeView(null, "general", []);
    expect(general).toMatchObject({
      schemeKey: "major",
      schemeVersion: 2,
      tags: [],
    });
    expect(general.applicableQuestions.map((item) => item.id)).toEqual(TIER3_IDS);
    expect(
      general.applicableQuestions.find((item) => item.id === "difficulty")?.options,
    ).toEqual([
      { value: 1, label: "简单" },
      { value: 2, label: "中等" },
      { value: 3, label: "困难" },
    ]);
    expect(
      courseSchemeView(null, "sports", ["mooc"]).applicableQuestions.map(
        (item) => item.id,
      ),
    ).toEqual(TIER3_IDS);
    expect(courseSchemeView("ideology", "general", []).schemeKey).toBe("ideology");
  });
});

describe("submitted score validation", () => {
  const latest = applicableDimensions("major", []);
  const mooc = applicableDimensions("major", ["mooc"]);

  it("rejects missing dimensions and scores outside that question's options", () => {
    expect(validateSubmittedScores(undefined, latest).ok).toBe(false);
    expect(
      validateSubmittedScores(
        { difficulty: 1, homework: 2, grading: 3 },
        latest,
      ).ok,
    ).toBe(false);
    expect(
      validateSubmittedScores({ ...CURRENT_SCORES, grading: 5 }, latest),
    ).toEqual({ ok: false, error: "评分必须是题目给出的选项" });
  });

  it("rejects leftover v1 dimension keys on mooc and latest courses", () => {
    expect(
      validateSubmittedScores(
        { ...CURRENT_SCORES, attendance: 3 },
        mooc,
      ),
    ).toEqual({ ok: false, error: "提交了不适用的评分维度" });
    expect(validateSubmittedScores(V1_OFFLINE_SCORES, latest)).toEqual({
      ok: false,
      error: "提交了不适用的评分维度",
    });
    expect(validateSubmittedScores(CURRENT_SCORES, mooc)).toEqual({
      ok: true,
      scores: { ...CURRENT_SCORES },
    });
  });

  it("snapshots the resolved scheme, latest version and ignores a client-supplied key", () => {
    const snapshot = snapshotReviewScores({
      schemeKey: "ideology",
      category: "general",
      tags: ["mooc"],
      scores: CURRENT_SCORES,
      comment: REQUIRED_NOTE,
    });
    expect(snapshot).toMatchObject({
      ok: true,
      schemeKey: "ideology",
      schemeVersion: 2,
      comment: REQUIRED_NOTE,
    });
  });

  it("rejects a trimmed note shorter than 10 or longer than 1200 characters", () => {
    expect(validateReviewNote("         ").ok).toBe(false);
    expect(validateReviewNote("123456789")).toEqual({
      ok: false,
      error: "请填写至少 10 字补充说明",
    });
    expect(validateReviewNote("  1234567890  ")).toEqual({
      ok: true,
      comment: "1234567890",
    });
    expect(validateReviewNote("x".repeat(REVIEW_NOTE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: "补充说明不能超过 1200 字",
    });
  });
});

describe("dimension average from a scheme snapshot", () => {
  it("averages the snapshot scores to one decimal", () => {
    expect(dimensionAverage({ ...V1_OFFLINE_SCORES })).toBe(3.5);
    expect(dimensionAverage({ ...V1_MOOC_SCORES })).toBe(3.7);
  });

  it("returns an average only for published versions that still average dimensions", () => {
    expect(
      publicDimensionAverage({
        schemeKey: "major",
        schemeVersion: 1,
        scores: JSON.stringify(V1_OFFLINE_SCORES),
      }),
    ).toBe(3.5);
    expect(
      publicDimensionAverage({
        schemeKey: "ideology",
        schemeVersion: 1,
        scores: JSON.stringify(V1_MOOC_SCORES),
      }),
    ).toBe(3.7);
    expect(
      publicDimensionAverage({
        schemeKey: "major",
        schemeVersion: 2,
        scores: JSON.stringify(CURRENT_SCORES),
      }),
    ).toBeNull();
    expect(
      publicDimensionAverage({
        schemeKey: null,
        schemeVersion: null,
        scores: JSON.stringify(V1_OFFLINE_SCORES),
      }),
    ).toBeNull();
  });
});
