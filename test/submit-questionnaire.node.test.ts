import { describe, expect, it } from "vitest";
import { COMMON_CORE_QUESTIONS } from "../src/lib/review-schemes";
import {
  keepCurrentSchemaScores,
  questionsForSubmitForm,
} from "../src/lib/submit-questionnaire";
import { TIER3_QUESTIONS, V3_QUESTIONS } from "./review-score-fixtures";

const currentCourse = {
  applicableQuestions: TIER3_QUESTIONS.map((question) => ({
    ...question,
    options: question.options.map((option) => ({ ...option })),
  })),
};

describe("questionsForSubmitForm", () => {
  it("does not paint a fallback questionnaire while the course scheme is loading", () => {
    expect(questionsForSubmitForm(null, true)).toEqual([]);
  });

  it("uses the course scheme once it is ready", () => {
    expect(questionsForSubmitForm(currentCourse, false)).toEqual(
      currentCourse.applicableQuestions,
    );
    expect(questionsForSubmitForm(currentCourse, true)).toEqual(
      currentCourse.applicableQuestions,
    );
  });

  it("shows the current common core only when no course is expected", () => {
    expect(questionsForSubmitForm(null, false)).toEqual(COMMON_CORE_QUESTIONS);
    expect(
      questionsForSubmitForm(null, false).map((question) => question.id),
    ).toEqual(["difficulty", "homework", "grading", "gain"]);
    expect(
      questionsForSubmitForm(null, false).some(
        (question) => question.id === "attendance",
      ),
    ).toBe(false);
  });
});

describe("keepCurrentSchemaScores", () => {
  it("keeps in-progress answers that still belong to the current scheme", () => {
    expect(
      keepCurrentSchemaScores(
        { difficulty: "2", homework: "3", grading: "1", gain: "2" },
        currentCourse.applicableQuestions,
      ),
    ).toEqual({
      difficulty: "2",
      homework: "3",
      grading: "1",
      gain: "2",
    });
  });

  it("drops obsolete schema keys and illegal option values", () => {
    expect(
      keepCurrentSchemaScores(
        {
          difficulty: "2",
          attendance: "2",
          teaching: "5",
          grading: "5",
        },
        currentCourse.applicableQuestions,
      ),
    ).toEqual({ difficulty: "2" });
  });

  it("does not keep v3-only attendance when the live scheme is four questions", () => {
    const v3Scores = {
      difficulty: "1",
      homework: "2",
      grading: "3",
      gain: "2",
      attendance: "2",
    };
    expect(
      keepCurrentSchemaScores(v3Scores, V3_QUESTIONS).attendance,
    ).toBe("2");
    expect(
      keepCurrentSchemaScores(v3Scores, currentCourse.applicableQuestions),
    ).toEqual({
      difficulty: "1",
      homework: "2",
      grading: "3",
      gain: "2",
    });
  });
});
