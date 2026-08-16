import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { arbitrationPrompt, isolatedPrompt } from "./ocr_first_cli";
import type { CellArbitrationRunnerRequest, CellReviewRunnerRequest } from "./ocr_first";

const baseCell = {
  key: "主要课程|95|F",
  worksheet: "主要课程",
  row: 95,
  source_column: "F",
  display_header: "source column F",
  context_row: 95,
  context: { row: 95, course: "secret course", teacher: "secret teacher" },
  image: "crop.png",
};

describe("review-uncertain isolated prompts", () => {
  test("side A receives only key and image", () => {
    const request = {
      contract_version: "test",
      task_id: "a",
      side: "analysis_a",
      model: "gpt-5.6-luna",
      attempt: 1,
      cells: [{ ...baseCell }],
    } satisfies CellReviewRunnerRequest;
    const prompt = isolatedPrompt(request, ["cell-01.png"], "review-uncertain");
    assert.match(prompt, /"key": "主要课程\|95\|F"/);
    assert.match(prompt, /"image": "cell-01\.png"/);
    assert.doesNotMatch(prompt, /secret course/);
    assert.doesNotMatch(prompt, /"ocr"/);
  });

  test("side B receives OCR but no context", () => {
    const request = {
      contract_version: "test",
      task_id: "b",
      side: "analysis_b",
      model: "gpt-5.6-luna",
      attempt: 1,
      cells: [{ ...baseCell, ocr: { row: 95, column: "F", tokens: [{ text: "OCR_ONLY" }], confidence: 0.9 } }],
    } satisfies CellReviewRunnerRequest;
    const prompt = isolatedPrompt(request, ["cell-01.png"], "review-uncertain");
    assert.match(prompt, /OCR_ONLY/);
    assert.doesNotMatch(prompt, /secret teacher/);
  });

  test("arbitration receives image and candidates only", () => {
    const analysis = { key: baseCell.key, raw_transcription: "x", corrected_text: "x", edits: [], uncertainty_markers: [] };
    const request = {
      contract_version: "test",
      task_id: "arb",
      side: "arbitration",
      model: "gpt-5.6-luna",
      attempt: 1,
      cells: [{ ...baseCell, analysis_a: analysis, analysis_b: analysis }],
    } satisfies CellArbitrationRunnerRequest;
    const prompt = arbitrationPrompt(request, ["cell-01.png"], "review-uncertain");
    assert.match(prompt, /"analysis_a"/);
    assert.doesNotMatch(prompt, /secret course/);
    assert.doesNotMatch(prompt, /"ocr"/);
  });
});
