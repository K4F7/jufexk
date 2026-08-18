import { describe, expect, it } from "vitest";
import {
  applicableDimensions,
  courseSchemeView,
  defaultSchemeKey,
  REVIEW_SCHEMES,
  snapshotReviewScores,
  validateSubmittedScores,
} from "../src/lib/review-schemes";

describe("review scheme defaults and applicable questions", () => {
  it("defaults unclassified sports courses to pe and others to major", () => {
    expect(defaultSchemeKey("sports")).toBe("pe");
    expect(defaultSchemeKey("general")).toBe("major");
    expect(defaultSchemeKey("pe")).toBe("major");
  });

  it("drops attendance only when the course has the mooc tag", () => {
    const offline = applicableDimensions("major", []).map((item) => item.id);
    const mooc = applicableDimensions("major", ["mooc"]).map((item) => item.id);
    expect(offline).toEqual(["teaching", "attendance", "grading", "workload"]);
    expect(mooc).toEqual(["teaching", "grading", "workload"]);
    expect(
      applicableDimensions("pe", ["mooc"]).map((item) => item.id),
    ).toEqual(["teaching", "grading", "workload"]);
  });

  it("keeps the first-version core shared across scheme keys", () => {
    for (const scheme of Object.values(REVIEW_SCHEMES)) {
      expect(scheme.version).toBe(1);
      expect(scheme.dimensions.map((item) => item.id)).toEqual([
        "teaching",
        "attendance",
        "grading",
        "workload",
      ]);
    }
  });

  it("exposes resolved scheme, tags and questions for course reads", () => {
    expect(courseSchemeView(null, "general", [])).toMatchObject({
      schemeKey: "major",
      schemeVersion: 1,
      tags: [],
    });
    expect(courseSchemeView(null, "sports", ["mooc"]).applicableQuestions.map((item) => item.id)).toEqual([
      "teaching",
      "grading",
      "workload",
    ]);
    expect(courseSchemeView("ideology", "general", []).schemeKey).toBe("ideology");
  });
});

describe("submitted score validation", () => {
  const offline = applicableDimensions("major", []);
  const mooc = applicableDimensions("major", ["mooc"]);

  it("rejects missing dimensions and out-of-range scores", () => {
    expect(validateSubmittedScores(undefined, offline).ok).toBe(false);
    expect(
      validateSubmittedScores(
        { teaching: 4, attendance: 3, grading: 5 },
        offline,
      ).ok,
    ).toBe(false);
    expect(
      validateSubmittedScores(
        { teaching: 4, attendance: 3, grading: 5, workload: 9 },
        offline,
      ),
    ).toEqual({ ok: false, error: "评分必须在 1 到 5 之间" });
  });

  it("rejects attendance on mooc courses and accepts the rest", () => {
    expect(
      validateSubmittedScores(
        { teaching: 4, attendance: 3, grading: 5, workload: 2 },
        mooc,
      ),
    ).toEqual({ ok: false, error: "提交了不适用的评分维度" });
    expect(
      validateSubmittedScores(
        { teaching: 4, grading: 5, workload: 2 },
        mooc,
      ),
    ).toEqual({
      ok: true,
      scores: { teaching: 4, grading: 5, workload: 2 },
    });
  });

  it("snapshots the resolved scheme and ignores a client-supplied key", () => {
    const snapshot = snapshotReviewScores({
      schemeKey: "ideology",
      category: "general",
      tags: ["mooc"],
      scores: { teaching: 4, grading: 5, workload: 2 },
    });
    expect(snapshot).toMatchObject({
      ok: true,
      schemeKey: "ideology",
      schemeVersion: 1,
    });
  });
});
