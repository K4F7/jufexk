import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureFormulaBarCell, type FormulaBarCellSource } from "./formula_bar";
import { compileConfirmedLiveLayout, type LiveLayout } from "./live_layout";
import { compileLiveLayoutContextIndex } from "./live_layout_context_index";
import { OTHER_SMOKE_INVENTORY_VERSION, OTHER_SMOKE_MANIFEST_VERSION } from "./other_smoke";
import {
  ISOLATED_SPORTS_SMOKE_REVIEW,
  NO_REVIEWS_TO_PACKAGE,
  analysisPayload,
  applyAnalyses,
  applyApprovals,
  applyArbitration,
  assertReviewOcrInputIsCellCrop,
  assertReviewPackageOutputPath,
  batchSizeForCells,
  buildReviewBatches,
  buildReviewInventory,
  classifyReviewOcrImage,
  compileReviewPackage,
  detectSmokeCaptureRoot,
  disagreements,
  eligibleForApproval,
  loadSmokeImageOverrides,
  loadSmokeInventoryScopes,
  resolveReviewEvidenceScopes,
  markIsolatedSportsSmokeReviewPackage,
  parseContextDocument,
  reviewPackageCountsAsPass,
  resolveSmokeEvidenceDir,
  routeFormulaBarCell,
  validateAnalysisResponse,
  type CellAnalysis,
  type RoutedCell,
} from "./review_package";
import { SMOKE_MANIFEST_VERSION } from "./smoke_recapture";

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

function boundInventory(input: Parameters<typeof buildReviewInventory>[0]) {
  return buildReviewInventory({
    ...input,
    layout: input.layout === undefined ? compileConfirmedLiveLayout() : input.layout,
  });
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

    const inventory = boundInventory({
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
    const inventory = boundInventory({
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
    const inventory = boundInventory({
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
    const inventory = boundInventory({
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
    const inventory = boundInventory({
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
    const inventory = boundInventory({
      evidence: [evidence],
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      inventory_path: "scripts/legacy_evidence/output/smoke/inventory.json",
      ocr_dir: "scripts/legacy_evidence/output/smoke/ocr",
    });
    expect(inventory).toMatchObject({ status: "needs_ocr", pending_batches: [] });
    expect(inventory.ocr_command).toContain("ocr_review_cells.py");
  });

  it("keeps frozen context when A/B leave course or teacher blank", async () => {
    const evidence = await origin();
    const inventory = boundInventory({
      evidence: [evidence],
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      ocr_by_key: { "体育课|6|D": { text: "这门课很好" } },
    });
    const blankTeacher = mapping("体育课|6|D", { visible_teacher: "", teacher_status: "unclear" });
    const compiled = compileReviewPackage(inventory, applyAnalyses(
      inventory.cells,
      new Map([["体育课|6|D", blankTeacher]]),
      new Map([["体育课|6|D", blankTeacher]]),
    ));
    expect(compiled.cells[0]).toMatchObject({
      visible_course: "太极拳",
      visible_teacher: "甲",
      context: { course: "太极拳", teacher: "甲" },
    });
  });
});

describe("frozen smoke context", () => {
  it("parses smoke-context-index-v1 and does not mix same row numbers across worksheets", () => {
    const rows = parseContextDocument({
      contract_version: "smoke-context-index-v1",
      sheets: [
        { worksheet: "体育课", rows: [{ row: 8, visible_course: "健美操", visible_teacher: "刘璇" }] },
        { worksheet: "思政课", rows: [{ row: 8, visible_course: "马原", visible_teacher: "李凤丹" }] },
      ],
    });
    expect(rows).toEqual([
      { worksheet: "体育课", row: 8, course: "健美操", teacher: "刘璇" },
      { worksheet: "思政课", row: 8, course: "马原", teacher: "李凤丹" },
    ]);
  });

  it("uses a recapture image override without rewriting formula-bar evidence", async () => {
    const evidence = await captureFormulaBarCell(
      { worksheet: "体育课", address: "G7" },
      source("G7", "旧冲突正文", "画面对不上"),
    );
    const cell = routeFormulaBarCell(evidence, {
      context: { row: 7, course: "健美操", teacher: "陈军" },
      image_override: { cell: "D:/smoke/captures/体育课/G7-cell.jpg" },
    });
    expect(cell.cell_image).toBe("D:/smoke/captures/体育课/G7-cell.jpg");
    expect(cell.formula_bar_value).toBe("旧冲突正文");
    expect(cell.formula_bar_visual_conflict).toBe(true);
  });
});

describe("verifier-gated auto-approval", () => {
  it("approves only when image-text flags and evidence are all present", async () => {
    const evidence = await origin();
    const inventory = boundInventory({
      evidence: [evidence],
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      ocr_by_key: { "体育课|6|D": { text: "这门课很好" } },
    });
    const agreed = mapping("体育课|6|D");
    const compiled = compileReviewPackage(inventory, applyAnalyses(
      inventory.cells,
      new Map([["体育课|6|D", agreed]]),
      new Map([["体育课|6|D", agreed]]),
    ));
    expect(eligibleForApproval(compiled.cells[0])).toBe(true);
    const rejected = applyApprovals(compiled.cells, new Map([["体育课|6|D", {
      key: "体育课|6|D", approve: true, body_matches_source: true, mapping_supported: true, evidence: "",
    }]]));
    expect(rejected[0].approved).toBe(false);
    const missing = applyApprovals(compiled.cells, new Map());
    expect(missing[0].approved).toBe(false);
    const accepted = applyApprovals(compiled.cells, new Map([["体育课|6|D", {
      key: "体育课|6|D", approve: true, body_matches_source: true, mapping_supported: true, evidence: "D6 crop shows the formula-bar sentence",
    }]]));
    expect(compileReviewPackage(inventory, accepted)).toMatchObject({ approved_cells: 1 });
    expect(accepted[0].approved).toBe(true);
  });

  it("keeps an approved cell approved on resume and does not re-queue it", async () => {
    const evidence = await origin();
    const agreed = mapping("体育课|6|D");
    const inventory = boundInventory({
      evidence: [evidence],
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      ocr_by_key: { "体育课|6|D": { text: "这门课很好" } },
      prior_cells: [{
        key: "体育课|6|D",
        worksheet: "体育课",
        row: 6,
        column: "D",
        routing: "pending_review",
        conclusion: "agreed",
        approved: true,
        analysis_a: agreed,
        analysis_b: agreed,
        body_source: "formula_bar",
        formula_bar_value: "这门课很好",
        cell_image: "D6-cell.jpg",
        context: { row: 6, course: "太极拳", teacher: "甲" },
      } as RoutedCell],
    });
    expect(inventory.cells[0].approved).toBe(true);
    expect(inventory.pending_verify).toEqual([]);
    expect(inventory.pending_batches).toEqual([]);
  });
});

describe("legacy review package live-layout gate", () => {
  it("fails inventory when no live layout is bound or teacher letters drifted", async () => {
    const evidence = await origin();
    const context = [{ row: 6, course: "太极拳", teacher: "甲" }];
    expect(() => buildReviewInventory({
      evidence: [evidence],
      context_index: context,
    })).toThrow(/live layout SHA/);
    expect(() => boundInventory({
      evidence: [evidence],
      context_index: context,
      layout: null,
    })).toThrow(/live layout SHA/);

    const layout = compileConfirmedLiveLayout();
    const drifted = {
      ...layout,
      sheets: layout.sheets.map((sheet) => (
        sheet.worksheet === "体育课" ? { ...sheet, teacher_column: "C" } : sheet
      )),
    };
    expect(() => boundInventory({
      evidence: [evidence],
      context_index: context,
      layout: drifted as LiveLayout,
    })).toThrow(/体育课|unconfirmed|obsolete|hash/);

    const accepted = boundInventory({
      evidence: [evidence],
      context_index: context,
      ocr_by_key: { "体育课|6|D": { text: "这门课很好" } },
      layout,
    });
    expect(accepted.layout_sha256).toBe(layout.layout_sha256);
    expect(accepted.pending_batches.flatMap((batch) => batch.keys)).toEqual(["体育课|6|D"]);
    expect(accepted.wrote_tencent_or_business_db).toBe(false);
  });

  it("does not route a live-layout row that is missing peer context into A/B", async () => {
    const evidence = await origin();
    const index = compileLiveLayoutContextIndex({
      layout: compileConfirmedLiveLayout(),
      reads: [{ worksheet: "体育课", row: 7, role: "course", address: "A7", nonempty: true }],
    });
    const inventory = boundInventory({
      evidence: [evidence],
      context_index: parseContextDocument(index),
      ocr_by_key: { "体育课|6|D": { text: "这门课很好" } },
    });
    expect(inventory.cells[0]).toMatchObject({
      routing: "unresolved",
      unresolved_reason: "missing_context",
    });
    expect(inventory.pending_batches).toEqual([]);
  });

  it("rejects window chrome as OCR input and only accepts a cell crop", async () => {
    expect(classifyReviewOcrImage({ path: "D6-cell.jpg", kind: "cell" })).toBe("cell_crop");
    expect(classifyReviewOcrImage({ path: "D6-formula.jpg", kind: "conflict" })).toBe("window_chrome");
    expect(classifyReviewOcrImage({ path: "window-chrome.png" })).toBe("window_chrome");
    expect(() => assertReviewOcrInputIsCellCrop({ path: "D6-formula.jpg" })).toThrow(/window chrome/);
    expect(() => assertReviewOcrInputIsCellCrop({ path: "D6-cell.jpg", kind: "cell" })).not.toThrow();

    const evidence = await origin();
    const chrome = boundInventory({
      evidence: [evidence],
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      image_overrides: { "体育课|6|D": { cell: "D:/packs/体育课/D6-formula.jpg" } },
      ocr_by_key: { "体育课|6|D": { text: "这门课很好" } },
    });
    expect(chrome.cells[0]).toMatchObject({
      routing: "unresolved",
      unresolved_reason: "window_chrome_ocr_input",
    });
    expect(chrome.pending_batches).toEqual([]);
  });

  it("does not route in_production or packaged_not_imported cells", async () => {
    const [production, packaged, fresh] = await Promise.all(["D6", "E6", "F6"].map((address) => origin(address)));
    const inventory = boundInventory({
      evidence: [production, packaged, fresh],
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      ocr_by_key: {
        "体育课|6|D": { text: "这门课很好" },
        "体育课|6|E": { text: "这门课很好" },
        "体育课|6|F": { text: "这门课很好" },
      },
      gap_by_key: {
        "体育课|6|D": "in_production",
        "体育课|6|E": "packaged_not_imported",
        "体育课|6|F": "never_packaged",
      },
    });
    expect(inventory.cells.find((cell) => cell.key === "体育课|6|D")).toMatchObject({
      routing: "not_applicable",
      unresolved_reason: "in_production",
    });
    expect(inventory.cells.find((cell) => cell.key === "体育课|6|E")).toMatchObject({
      routing: "not_applicable",
      unresolved_reason: "packaged_not_imported",
    });
    expect(inventory.pending_batches.flatMap((batch) => batch.keys)).toEqual(["体育课|6|F"]);
    const missingGap = boundInventory({
      evidence: [fresh],
      context_index: [{ row: 6, course: "太极拳", teacher: "甲" }],
      ocr_by_key: { "体育课|6|F": { text: "这门课很好" } },
      gap_by_key: {},
    });
    expect(missingGap.cells[0]).toMatchObject({
      routing: "not_applicable",
      unresolved_reason: "not_never_packaged",
    });
    expect(missingGap.pending_batches).toEqual([]);
  });

  it("records 无评价可审 for 美育 smoke when nothing is never_packaged", async () => {
    const blank = await captureFormulaBarCell(
      { worksheet: "美育", address: "E8" },
      source("E8", "", ""),
    );
    const inventory = boundInventory({
      evidence: [blank],
      context_index: [{ worksheet: "美育", row: 8, course: "素描", teacher: "甲" }],
      worksheet: "美育",
      first_row: 8,
      last_row: 14,
      gap_by_key: { "美育|8|E": "never_packaged" },
    });
    expect(inventory).toMatchObject({
      status: "empty",
      reason: NO_REVIEWS_TO_PACKAGE,
      pending_batches: [],
      pending_verify: [],
    });
  });

  it("isolates the 体育 6-14 review package without changing its approved_cells", () => {
    const pkg = {
      contract_version: "legacy-review-package-v1" as const,
      status: "completed" as const,
      planned_cells: 72,
      routed_cells: 47,
      unresolved_cells: 0,
      approved_cells: 47,
      cells: [],
      input_sha256: "a".repeat(64),
    };
    const isolated = markIsolatedSportsSmokeReviewPackage(pkg);
    expect(isolated.approved_cells).toBe(47);
    expect(isolated.isolation).toBe(ISOLATED_SPORTS_SMOKE_REVIEW.isolation);
    expect(isolated.use_approved_count_as_pass).toBe(false);
    expect(reviewPackageCountsAsPass(isolated)).toBe(false);
    expect(reviewPackageCountsAsPass(pkg)).toBe(true);
    expect(reviewPackageCountsAsPass(pkg, "scripts/legacy_evidence/output/review-package-smoke-sports-20260818/package.json")).toBe(false);
    expect(() => assertReviewPackageOutputPath("scripts/legacy_evidence/output/review-package-smoke-sports-20260818/package.json")).toThrow(/isolated|wrong-layout|must not be rerun/i);
    expect(() => assertReviewPackageOutputPath("scripts/legacy_evidence/output/review-package-smoke-sports-oneshot/package.json")).toThrow(/isolated|wrong-layout|must not be rerun/i);
    expect(() => assertReviewPackageOutputPath("scripts/legacy_evidence/output/smoke-20260818-v1/package.json")).toThrow(/#180|#229|formula-bar|protected/i);
    expect(() => assertReviewPackageOutputPath("scripts/legacy_evidence/output/other-smoke-20260819-v1/package.json")).toThrow(/#180|#229|formula-bar|protected/i);
    expect(() => assertReviewPackageOutputPath("scripts/legacy_evidence/output/review-other-smoke-20260819-v1/package.json")).not.toThrow();
  });
});

describe("other-smoke capture handoff", () => {
  it("reads other-smoke manifest recapture overlays and formula-bar source root without rewriting the pack", async () => {
    const root = await mkdtemp(join(tmpdir(), "jufexk-other-smoke-handoff-"));
    try {
      const captureDir = join(root, "captures", "外教");
      await mkdir(captureDir, { recursive: true });
      const cell = join(captureDir, "K4-cell.jpg");
      const formula = join(captureDir, "K4-formula.jpg");
      await writeFile(cell, "cell");
      await writeFile(formula, "formula");
      await writeFile(join(root, "manifest.json"), `${JSON.stringify({
        contract_version: OTHER_SMOKE_MANIFEST_VERSION,
        recapture_keys: ["外教|4|K", "外教|4|L"],
      })}\n`);
      await writeFile(join(root, "inventory.json"), `${JSON.stringify({
        contract_version: OTHER_SMOKE_INVENTORY_VERSION,
        source_evidence_root: "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/evidence",
        sheets: [
          { worksheet: "外教", smoke_rows: [3, 6] },
          { worksheet: "MOOC", smoke_rows: [8, 14] },
          { worksheet: "美育", smoke_rows: [8, 14] },
        ],
      })}\n`);

      const overrides = await loadSmokeImageOverrides(root);
      expect(overrides["外教|4|K"]).toEqual({ cell, conflict: formula });
      expect(overrides["外教|4|L"]).toBeUndefined();
      expect(await resolveSmokeEvidenceDir(root)).toBe("scripts/legacy_evidence/output/formula-bar-full-20260729-v1");
      expect(await detectSmokeCaptureRoot([root])).toBe(root);
      expect(await loadSmokeInventoryScopes(root)).toEqual([
        { worksheet: "外教", first_row: 3, last_row: 6 },
        { worksheet: "MOOC", first_row: 8, last_row: 14 },
        { worksheet: "美育", first_row: 8, last_row: 14 },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still reads #180 smoke-manifest.json and reuse-recapture inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "jufexk-smoke-handoff-"));
    try {
      const captureDir = join(root, "captures", "体育课");
      await mkdir(captureDir, { recursive: true });
      const cell = join(captureDir, "D13-cell.jpg");
      await writeFile(cell, "cell");
      await writeFile(join(root, "smoke-manifest.json"), `${JSON.stringify({
        contract_version: SMOKE_MANIFEST_VERSION,
        recapture_keys: ["体育课|13|D"],
      })}\n`);
      await writeFile(join(root, "reuse-recapture-inventory.json"), `${JSON.stringify({
        contract_version: "smoke-reuse-recapture-v1",
        source_evidence_root: "D:/evidence/formula-bar-full-20260729-v1/evidence",
        sheets: [{ worksheet: "体育课", smoke_rows: [6, 14] }],
      })}\n`);

      expect(await loadSmokeImageOverrides(root)).toEqual({ "体育课|13|D": { cell } });
      expect(await resolveSmokeEvidenceDir(root)).toBe("D:/evidence/formula-bar-full-20260729-v1");
      expect(await detectSmokeCaptureRoot([join(root, "missing"), root])).toBe(root);
      expect(await loadSmokeInventoryScopes(root)).toEqual([
        { worksheet: "体育课", first_row: 6, last_row: 14 },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("clips --worksheet / row flags to the frozen smoke pack so leftover #198 rows stay out", () => {
    const pack = [
      { worksheet: "外教", first_row: 3, last_row: 6 },
      { worksheet: "主要课程", first_row: 19, last_row: 26 },
      { worksheet: "MOOC", first_row: 8, last_row: 14 },
    ];
    expect(resolveReviewEvidenceScopes({ pack_scopes: pack })).toEqual(pack);
    expect(resolveReviewEvidenceScopes({
      worksheet: "主要课程",
      pack_scopes: pack,
    })).toEqual([{ worksheet: "主要课程", first_row: 19, last_row: 26 }]);
    expect(resolveReviewEvidenceScopes({
      worksheet: "主要课程",
      first_row: 19,
      last_row: 480,
      pack_scopes: pack,
    })).toEqual([{ worksheet: "主要课程", first_row: 19, last_row: 26 }]);
    expect(resolveReviewEvidenceScopes({
      first_row: 20,
      last_row: 24,
      pack_scopes: pack,
    })).toEqual([
      { worksheet: "主要课程", first_row: 20, last_row: 24 },
    ]);
    expect(resolveReviewEvidenceScopes({
      worksheet: "主要课程",
      first_row: 56,
      last_row: 472,
      pack_scopes: pack,
    })).toEqual([]);
    expect(resolveReviewEvidenceScopes({
      worksheet: "思政课",
      first_row: 15,
      last_row: 40,
      pack_scopes: pack,
    })).toEqual([{ worksheet: "思政课", first_row: 15, last_row: 40 }]);
  });

  it("does not treat an unrelated inventory.json as a capture pack", async () => {
    const root = await mkdtemp(join(tmpdir(), "jufexk-not-smoke-"));
    try {
      await writeFile(join(root, "inventory.json"), `${JSON.stringify({
        contract_version: "legacy-review-package-v1",
        source_evidence_root: "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/evidence",
      })}\n`);
      expect(await detectSmokeCaptureRoot([root])).toBeUndefined();
      expect(await loadSmokeImageOverrides(root)).toEqual({});
      expect(await resolveSmokeEvidenceDir(root)).toBe(root);
      expect(await loadSmokeInventoryScopes(root)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
