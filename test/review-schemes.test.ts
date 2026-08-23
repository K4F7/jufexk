import { describe, expect, it } from "vitest";
import {
  applicableDimensions,
  COMMON_CORE_QUESTIONS,
  courseSchemeView,
  defaultSchemeKey,
  dimensionAverage,
  latestSchemeVersion,
  publicDimensionAverage,
  publicDimensionLabels,
  REVIEW_NOTE_MAX_LENGTH,
  REVIEW_SCHEMES,
  snapshotReviewScores,
  validateReviewNote,
  validateSubmittedScores,
} from "../src/lib/review-schemes";
import {
  CURRENT_SCORES,
  REQUIRED_NOTE,
  TIER3_IDS,
  TIER3_QUESTIONS,
  V1_MOOC_SCORES,
  V1_OFFLINE_SCORES,
  V3_IDS,
  V3_OFFLINE_SCORES,
  V3_QUESTIONS,
} from "./review-score-fixtures";

const publicQuestions = (
  questions: ReadonlyArray<{
    id: string;
    label: string;
    prompt: string;
    scale: string;
    options: ReadonlyArray<{ value: number; label: string }>;
  }>,
) =>
  questions.map(({ id, label, prompt, scale, options }) => ({
    id,
    label,
    prompt,
    scale,
    options: options.map((option) => ({ ...option })),
  }));

describe("review scheme defaults and applicable questions", () => {
  it("defaults unclassified sports courses to pe and others to major", () => {
    expect(defaultSchemeKey("sports")).toBe("pe");
    expect(defaultSchemeKey("general")).toBe("major");
    expect(defaultSchemeKey("pe")).toBe("major");
  });

  it("asks the same latest five questions offline and hides only attendance for mooc", () => {
    const offline = publicQuestions(V3_QUESTIONS);
    const mooc = publicQuestions(TIER3_QUESTIONS);
    for (const scheme of Object.values(REVIEW_SCHEMES)) {
      expect(publicQuestions(applicableDimensions(scheme.key, []))).toEqual(
        offline,
      );
      expect(
        publicQuestions(applicableDimensions(scheme.key, ["mooc"])),
      ).toEqual(mooc);
    }
    expect(COMMON_CORE_QUESTIONS).toEqual(offline);
  });

  it("keeps published v1/v2 read-only and writes the latest version", () => {
    for (const scheme of Object.values(REVIEW_SCHEMES)) {
      expect(scheme.versions[0]?.version).toBe(1);
      expect(scheme.versions[0]?.averagesDimensions).toBe(true);
      expect(scheme.versions[0]?.dimensions.map((item) => item.id)).toEqual([
        "teaching",
        "attendance",
        "grading",
        "workload",
      ]);
      expect(scheme.versions[1]?.version).toBe(2);
      expect(scheme.versions[1]?.averagesDimensions).toBe(false);
      expect(scheme.versions[1]?.dimensions.map((item) => item.id)).toEqual(
        TIER3_IDS,
      );
      expect(latestSchemeVersion(scheme.key).version).toBe(3);
      expect(latestSchemeVersion(scheme.key).averagesDimensions).toBe(false);
      expect(latestSchemeVersion(scheme.key).dimensions.map((item) => item.id)).toEqual(
        V3_IDS,
      );
      const attendance = latestSchemeVersion(scheme.key).dimensions.find(
        (item) => item.id === "attendance",
      );
      expect(attendance).toMatchObject({
        label: "考勤松紧",
        offlineOnly: true,
        options: [
          { value: 1, label: "宽松" },
          { value: 2, label: "一般" },
          { value: 3, label: "严苛" },
        ],
      });
    }
  });

  it("exposes resolved scheme, tags and three-tier options for course reads", () => {
    const general = courseSchemeView(null, "general", []);
    expect(general).toMatchObject({
      schemeKey: "major",
      schemeVersion: 3,
      tags: [],
    });
    expect(general.applicableQuestions).toEqual(publicQuestions(V3_QUESTIONS));
    expect(
      courseSchemeView(null, "sports", ["mooc"]).applicableQuestions,
    ).toEqual(publicQuestions(TIER3_QUESTIONS));
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
    // v3 线下课必答考勤：缺 attendance 的四维提交被拒。
    expect(validateSubmittedScores(CURRENT_SCORES, latest)).toEqual({
      ok: false,
      error: "请答完本次适用的评分题",
    });
    expect(
      validateSubmittedScores({ ...V3_OFFLINE_SCORES, grading: 5 }, latest),
    ).toEqual({ ok: false, error: "评分必须是题目给出的选项" });
    expect(
      validateSubmittedScores({ ...V3_OFFLINE_SCORES, attendance: 5 }, latest),
    ).toEqual({ ok: false, error: "评分必须是题目给出的选项" });
  });

  it("rejects attendance on mooc courses and leftover v1 keys everywhere", () => {
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
    expect(validateSubmittedScores(V3_OFFLINE_SCORES, latest)).toEqual({
      ok: true,
      scores: { ...V3_OFFLINE_SCORES },
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
      schemeVersion: 3,
      comment: REQUIRED_NOTE,
    });
    const offline = snapshotReviewScores({
      schemeKey: "pe",
      category: "sports",
      tags: [],
      scores: V3_OFFLINE_SCORES,
      comment: REQUIRED_NOTE,
    });
    expect(offline).toMatchObject({
      ok: true,
      schemeKey: "pe",
      schemeVersion: 3,
      scores: { ...V3_OFFLINE_SCORES },
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
      commentFormat: null,
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
        schemeKey: "major",
        schemeVersion: 3,
        scores: JSON.stringify(V3_OFFLINE_SCORES),
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

describe("dimension tier labels from a scheme snapshot", () => {
  it("translates a current four-question snapshot to Chinese option labels in definition order", () => {
    expect(
      publicDimensionLabels({
        schemeKey: "major",
        schemeVersion: 2,
        scores: JSON.stringify(CURRENT_SCORES),
      }),
    ).toEqual([
      { id: "difficulty", label: "课程难度", option: "简单" },
      { id: "homework", label: "作业多少", option: "中等" },
      { id: "grading", label: "给分好坏", option: "杀手" },
      { id: "gain", label: "收获多少", option: "一般" },
    ]);
    expect(
      publicDimensionLabels({
        schemeKey: "pe",
        schemeVersion: 2,
        scores: { ...CURRENT_SCORES, difficulty: 3, gain: 1 },
      }),
    ).toEqual([
      { id: "difficulty", label: "课程难度", option: "困难" },
      { id: "homework", label: "作业多少", option: "中等" },
      { id: "grading", label: "给分好坏", option: "杀手" },
      { id: "gain", label: "收获多少", option: "很多" },
    ]);
  });

  it("walks the row's own version: five labels for v3, four for v2", () => {
    expect(
      publicDimensionLabels({
        schemeKey: "major",
        schemeVersion: 3,
        scores: JSON.stringify(V3_OFFLINE_SCORES),
      }),
    ).toEqual([
      { id: "difficulty", label: "课程难度", option: "简单" },
      { id: "homework", label: "作业多少", option: "中等" },
      { id: "grading", label: "给分好坏", option: "杀手" },
      { id: "gain", label: "收获多少", option: "一般" },
      { id: "attendance", label: "考勤松紧", option: "一般" },
    ]);
    // v2 快照不伪造考勤：即使 scores 里混入 attendance 键也只译四维。
    expect(
      publicDimensionLabels({
        schemeKey: "major",
        schemeVersion: 2,
        scores: JSON.stringify({ ...CURRENT_SCORES, attendance: 1 }),
      }),
    ).toEqual([
      { id: "difficulty", label: "课程难度", option: "简单" },
      { id: "homework", label: "作业多少", option: "中等" },
      { id: "grading", label: "给分好坏", option: "杀手" },
      { id: "gain", label: "收获多少", option: "一般" },
    ]);
  });

  it("returns no labels for a v3 snapshot missing attendance or with a bad option", () => {
    expect(
      publicDimensionLabels({
        schemeKey: "major",
        schemeVersion: 3,
        scores: JSON.stringify(CURRENT_SCORES),
      }),
    ).toBeNull();
    expect(
      publicDimensionLabels({
        schemeKey: "major",
        schemeVersion: 3,
        scores: JSON.stringify({ ...V3_OFFLINE_SCORES, attendance: 5 }),
      }),
    ).toBeNull();
  });

  it("never translates an old 1–5 snapshot into the new tier copy", () => {
    expect(
      publicDimensionLabels({
        schemeKey: "major",
        schemeVersion: 1,
        scores: JSON.stringify(V1_OFFLINE_SCORES),
      }),
    ).toBeNull();
    expect(
      publicDimensionLabels({
        schemeKey: "ideology",
        schemeVersion: 1,
        scores: JSON.stringify(V1_MOOC_SCORES),
      }),
    ).toBeNull();
  });

  it("returns no labels without a usable snapshot or with an incomplete one", () => {
    expect(
      publicDimensionLabels({
        schemeKey: null,
        schemeVersion: null,
        scores: JSON.stringify(CURRENT_SCORES),
      }),
    ).toBeNull();
    expect(
      publicDimensionLabels({
        schemeKey: "major",
        schemeVersion: 99,
        scores: JSON.stringify(CURRENT_SCORES),
      }),
    ).toBeNull();
    expect(
      publicDimensionLabels({
        schemeKey: "major",
        schemeVersion: 2,
        scores: "not-json",
      }),
    ).toBeNull();
    expect(
      publicDimensionLabels({
        schemeKey: "major",
        schemeVersion: 2,
        scores: JSON.stringify({ difficulty: 1, homework: 2, grading: 3 }),
      }),
    ).toBeNull();
    expect(
      publicDimensionLabels({
        schemeKey: "major",
        schemeVersion: 2,
        scores: JSON.stringify({ ...CURRENT_SCORES, grading: 5 }),
      }),
    ).toBeNull();
  });
});
