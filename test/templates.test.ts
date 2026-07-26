import { describe, expect, it } from "vitest";
import { reviewFieldsMarkup } from "../src/templates";

describe("reviewFieldsMarkup", () => {
  it("keeps all five public-elective dimensions optional", () => {
    const markup = reviewFieldsMarkup("general");

    for (const name of [
      "interest",
      "practicality",
      "workloadScore",
      "fairness",
      "organization",
    ]) {
      expect(markup).toContain(`name="${name}"`);
    }
    expect(markup).not.toContain("required");
  });

  it("preserves the optional major-course fields", () => {
    const markup = reviewFieldsMarkup("major");

    for (const name of [
      "attendance",
      "grading",
      "rescue",
      "teaching",
      "clarity",
      "knowledge",
    ]) {
      expect(markup).toContain(`name="${name}"`);
    }
    expect(markup).not.toContain("required");
  });

  it("preserves the optional physical-education fields", () => {
    const markup = reviewFieldsMarkup("pe");

    for (const name of [
      "attendance",
      "workload",
      "assessment",
      "grading",
      "gradingScore",
    ]) {
      expect(markup).toContain(`name="${name}"`);
    }
    expect(markup).not.toContain("required");
  });
});
