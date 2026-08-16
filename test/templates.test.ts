import { describe, expect, it } from "vitest";
import { reviewFieldsMarkup, teacherCourseRowMarkup } from "../src/templates";

describe("reviewFieldsMarkup", () => {
  it("renders the compact general template without retired specialized fields", () => {
    const markup = reviewFieldsMarkup("general");

    for (const name of [
      "clarity",
      "knowledge",
      "workloadScore",
      "fairness",
      "assessment",
      "teaching",
    ]) {
      expect(markup).toContain(`name="${name}"`);
    }
    for (const retired of ["interest", "practicality", "organization", "rescue"])
      expect(markup).not.toContain(`name="${retired}"`);
  });

  it("preserves the optional physical-education fields", () => {
    const markup = reviewFieldsMarkup("sports");

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

describe("teacherCourseRowMarkup", () => {
  it("renders a clickable course row with aligned rating and review count", () => {
    const markup = teacherCourseRowMarkup({
      id: 17,
      code: "GEC101",
      name: "大学写作",
      rating: 4.6,
      review_count: 23,
    });

    expect(markup).toContain('<tr data-course="17">');
    expect(markup).toContain('<td class="code num">GEC101</td>');
    expect(markup).toContain('<td class="name">大学写作</td>');
    expect(markup).toContain('<td class="num">4.6</td>');
    expect(markup).toContain('<td class="num">23</td>');
  });
});
