import { describe, expect, it } from "vitest";
import { captureFormulaBarCell, type FormulaBarCellSource } from "./formula_bar";
import {
  analysisPayload,
  applyAnalyses,
  applyArbitration,
  batchSizeForCells,
  buildReviewBatches,
  buildReviewInventory,
  compileReviewPackage,
  disagreements,
  routeFormulaBarCell,
  validateAnalysisResponse,
  type CellAnalysis,
  type RoutedCell,
} from "./review_package";

const CELL_IMAGE = { kind: "cell" as const, path: "G8-cell.jpg", sha256: "1".repeat(64) };
const CONFLICT_IMAGE = { kind: "conflict" as const, path: "G8-conflict.jpg", sha256: "2".repeat(64) };

function source(address: string, formula: string, visible: string, extras: Partial<FormulaBarCellSource> = {}): FormulaBarCellSource {
  return {
    locateByAddressBox: async () => undefined,
    readActiveAddress: async () => address,
    readFormulaBar: async () => formula,
    readVisibleCellText: async () => visible,
    captureEvidence: async ({ kind }) => (kind === "conflict" ? CONFLICT_IMAGE : CELL_IMAGE),
    now: () => "2026-08-18T00:00:00.000Z",
    ...extras,
  };
}

async function origin(address = "D6", formula = "这门课很好", visible = "这门课很") {
  return captureFormulaBarCell({ worksheet: "体育课", address }, source(address, formula, visible));
}

function mapping(key: string, overrides: Partial<CellAnalysis> = {}): CellAnalysis {
  return {
    key,
    visible_course: "太极拳",
    visible_teacher: "甲",
    course_status: "clear",
    teacher_status: "clear",
    overflow: "none",
    visual_correspondence: "matches_formula",
    uncertainty_markers: [],
    ...overrides,
  };
}

describe("legacy review package routing", () => {
  it("routes a formula-bar origin to pending review and keeps the formula bar as body", async () => {
    const evidence = await origin();
    const cell = routeFormulaBarCell(evidence, { context: { row: 6, course: "太极拳", teacher: "甲" } });
    expect(cell).toMatchObject({
      key: "体育课|6|D",
      routing: "pending_review",
      body_source: "formula_bar",
      formula_bar_value: "这门课很好",
      formula_bar_visual_conflict: false,
    });
  });

  it("does not route ordinary blanks or overflow blanks to agents", async () => {
    const blank = await captureFormulaBarCell({ worksheet: "体育课", address: "H6" }, source("H6", "", ""));
    const overflow = await captureFormulaBarCell({ worksheet: "体育课", address: "E6" }, source("E6", "", "好"));
    expect(routeFormulaBarCell(blank)).toMatchObject({ routing: "not_applicable", conclusion: "not_applicable" });
    expect(routeFormulaBarCell(overflow)).toMatchObject({
      routing: "not_applicable",
      terminal_status: "horizontal_overflow_blank",
    });
  });

  it("adopts the formula bar on 思政课 visual conflict and still reviews mapping", async () => {
    const evidence = await captureFormulaBarCell(
      { worksheet: "思政课", address: "G8" },
      source("G8", "系统冲突的公式栏全文", "画面对不上"),
    );
    const cell = routeFormulaBarCell(evidence, { context: { row: 8, course: "思想道德与法治", teacher: "乙" } });
    expect(cell).toMatchObject({
      routing: "pending_review",
      body_source: "formula_bar",
      formula_bar_value: "系统冲突的公式栏全文",
      formula_bar_visual_conflict: true,
      terminal_status: "evidence_conflict",
    });
  });

  it("keeps halt_batch cells unresolved and does not invent a body", async () => {
    const evidence = await captureFormulaBarCell(
      { worksheet: "主要课程", address: "F23" },
      source("F23", "x", "x", { readActiveAddress: async () => "M22" }),
    );
    expect(routeFormulaBarCell(evidence)).toMatchObject({
      routing: "unresolved",
      unresolved_reason: "active_address_mismatch",
      formula_bar_value: null,
      body_source: null,
    });
  });

  it("does not route an origin without row context", async () => {
    const evidence = await origin();
    expect(routeFormulaBarCell(evidence)).toMatchObject({
      routing: "unresolved",
      unresolved_reason: "missing_context",
    });
  });
});

describe("legacy review package batches", () => {
  it("caps a batch at 8 adjacent routed cells and shrinks long formula-bar text", async () => {
    const short = Array.from({ length: 10 }, (_, index) => ({
      key: `体育课|6|${"DEFGHIJKLM"[index]}`,
      worksheet: "体育课",
      row: 6,
      column: "DEFGHIJKLM"[index],
      routing: "pending_review",
      formula_bar_value: "短评",
    } as RoutedCell));
    expect(buildReviewBatches(short, { max_batches: 2 }).map((batch) => batch.keys)).toEqual([
      ["体育课|6|D", "体育课|6|E", "体育课|6|F", "体育课|6|G", "体育课|6|H", "体育课|6|I", "体育课|6|J", "体育课|6|K"],
      ["体育课|6|L", "体育课|6|M"],
    ]);
    expect(batchSizeForCells([{ formula_bar_value: "x".repeat(400) } as RoutedCell])).toBe(4);
    expect(batchSizeForCells([{ formula_bar_value: "x".repeat(800) } as RoutedCell])).toBe(1);
  });

  it("halves a failed batch and exhausts a failed single cell", async () => {
    const pending = ["D", "E", "F", "G"].map((column) => ({
      key: `体育课|6|${column}`,
      worksheet: "体育课",
      row: 6,
      column,
      routing: "pending_review",
      formula_bar_value: "短评",
    } as RoutedCell));
    const once = buildReviewBatches(pending, {
      attempts: [{ task_id: "batch-0001", side: "analysis_a", status: "failed", cell_keys: pending.map((cell) => cell.key) }],
    });
    expect(once.map((batch) => batch.keys)).toEqual([["体育课|6|D", "体育课|6|E", "体育课|6|F", "体育课|6|G"]]);
    const halved = buildReviewBatches(pending, {
      attempts: [
        { task_id: "batch-0001", side: "analysis_a", status: "failed", cell_keys: pending.map((cell) => cell.key) },
        { task_id: "batch-0001-retry", side: "analysis_a", status: "failed", cell_keys: pending.map((cell) => cell.key) },
      ],
    });
    expect(halved.map((batch) => batch.keys)).toEqual([
      ["体育课|6|D", "体育课|6|E"],
      ["体育课|6|F", "体育课|6|G"],
    ]);

    const inventory = buildReviewInventory({
      evidence: await Promise.all(["D6", "E6"].map((address) => origin(address))),
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      ocr_by_key: { "体育课|6|D": { text: "这门课很好" }, "体育课|6|E": { text: "这门课很好" } },
      attempts: [
        { task_id: "batch-0001-a", side: "analysis_a", status: "failed", cell_keys: ["体育课|6|D"] },
        { task_id: "batch-0001-a2", side: "analysis_a", status: "failed", cell_keys: ["体育课|6|D"] },
      ],
    });
    expect(inventory.cells.find((cell) => cell.key === "体育课|6|D")).toMatchObject({
      routing: "unresolved",
      unresolved_reason: "agent_exhausted",
    });
    expect(inventory.pending_batches.flatMap((batch) => batch.keys)).toEqual(["体育课|6|E"]);
  });

  it("re-queues a cell when only one side is complete", async () => {
    const evidence = await origin();
    const inventory = buildReviewInventory({
      evidence: [evidence],
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      ocr_by_key: { "体育课|6|D": { text: "这门课很好" } },
      prior_cells: [{
        key: "体育课|6|D",
        worksheet: "体育课",
        row: 6,
        column: "D",
        routing: "pending_review",
        analysis_a: mapping("体育课|6|D"),
      } as RoutedCell],
    });
    expect(inventory.pending_batches.flatMap((batch) => batch.keys)).toEqual(["体育课|6|D"]);
  });
});

describe("legacy review package compile", () => {
  it("agrees on exact mapping, arbitrates a disagreement, and never marks approved", async () => {
    const evidence = await Promise.all(["D6", "E6"].map((address) => origin(address)));
    const inventory = buildReviewInventory({
      evidence,
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      ocr_by_key: { "体育课|6|D": { text: "这门课很好" }, "体育课|6|E": { text: "这门课很好" } },
    });
    const agreed = mapping("体育课|6|D");
    const left = mapping("体育课|6|E", { visible_teacher: "甲" });
    const right = mapping("体育课|6|E", { visible_teacher: "乙" });
    const afterAnalysis = applyAnalyses(
      inventory.cells,
      new Map([["体育课|6|D", agreed], ["体育课|6|E", left]]),
      new Map([["体育课|6|D", agreed], ["体育课|6|E", right]]),
    );
    expect(afterAnalysis.find((cell) => cell.key === "体育课|6|D")?.conclusion).toBe("agreed");
    expect(disagreements(afterAnalysis).map((cell) => cell.key)).toEqual(["体育课|6|E"]);

    const compiled = compileReviewPackage(inventory, applyArbitration(
      afterAnalysis,
      new Map([["体育课|6|E", { key: "体育课|6|E", selected: "analysis_b", reason: "visible teacher is 乙" }]]),
    ));
    expect(compiled.status).toBe("completed");
    expect(compiled.approved_cells).toBe(0);
    expect(compiled.cells.every((cell) => cell.approved === false)).toBe(true);
    expect(compiled.cells.find((cell) => cell.key === "体育课|6|E")).toMatchObject({
      conclusion: "arbitrated",
      selected: "analysis_b",
      formula_bar_value: "这门课很好",
      visible_course: "太极拳",
      visible_teacher: "乙",
      context: { row: 6, course: "太极拳", teacher: "甲" },
    });
  });

  it("keeps 思政课 formula-bar body when A/B only agree on mapping", async () => {
    const evidence = await captureFormulaBarCell(
      { worksheet: "思政课", address: "G8" },
      source("G8", "系统冲突的公式栏全文", "画面对不上"),
    );
    const inventory = buildReviewInventory({
      evidence: [evidence],
      context_index: [{ row: 8, course: "思想道德与法治", teacher: "乙" }],
      ocr_by_key: { "思政课|8|G": { text: "画面对不上" } },
    });
    const agreed = mapping("思政课|8|G", {
      visible_course: "思想道德与法治",
      visible_teacher: "乙",
      visual_correspondence: "conflict",
    });
    const compiled = compileReviewPackage(inventory, applyAnalyses(
      inventory.cells,
      new Map([["思政课|8|G", agreed]]),
      new Map([["思政课|8|G", agreed]]),
    ));
    expect(compiled.cells[0]).toMatchObject({
      conclusion: "agreed",
      formula_bar_value: "系统冲突的公式栏全文",
      formula_bar_visual_conflict: true,
      approved: false,
    });
  });

  it("omits OCR from analysis A payloads and requires it on B", async () => {
    const evidence = await origin();
    const inventory = buildReviewInventory({
      evidence: [evidence],
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      ocr_by_key: { "体育课|6|D": { text: "这门课很好", confidence: 0.99 } },
    });
    const batch = inventory.pending_batches[0];
    expect(analysisPayload(batch, "analysis_a").cells[0]).not.toHaveProperty("ocr");
    expect(analysisPayload(batch, "analysis_b").cells[0]).toMatchObject({ ocr: { text: "这门课很好" } });
    expect(() => validateAnalysisResponse(batch.keys, { cells: [mapping("体育课|6|D")] })).not.toThrow();
  });

  it("blocks inventory when CUDA OCR is required and missing", async () => {
    const evidence = await origin();
    const inventory = buildReviewInventory({
      evidence: [evidence],
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      inventory_path: "scripts/legacy_evidence/output/smoke/inventory.json",
      ocr_dir: "scripts/legacy_evidence/output/smoke/ocr",
    });
    expect(inventory).toMatchObject({ status: "needs_ocr", pending_batches: [] });
    expect(inventory.ocr_command).toContain("ocr_review_cells.py");
  });
});
