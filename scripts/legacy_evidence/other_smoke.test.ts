import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodePng, type RgbaImage } from "./composition_qa";
import { buildFrozenFormulaBarMatrixPlan } from "./formula_bar_locator";
import {
  OTHER_SMOKE_CAPTURE_ORDER,
  OTHER_SMOKE_OUTPUT_RELATIVE,
  OTHER_SMOKE_REVIEW_CELLS,
  OTHER_SMOKE_SHEETS,
  buildOtherSmokeCaptureQa,
  buildOtherSmokeInventory,
  buildOtherSmokeReviewMatrixPlan,
  freezeOtherSmokeManifest,
  otherSmokeReviewKeys,
  planOtherSmokeRowCapture,
} from "./other_smoke";
import {
  buildSmokeReviewMatrixPlan,
  runSmokeRowCapture,
  smokeReviewKeys,
  type SmokeRowCaptureSource,
  type SmokeSourceReviewEvidence,
} from "./smoke_recapture";

describe("other-sheet smoke matrix freeze", () => {
  it("freezes the 264-cell other-smoke matrix as a subset of the 14,985-cell plan and leaves #180's 184 keys untouched", () => {
    const frozen = buildFrozenFormulaBarMatrixPlan();
    const other = buildOtherSmokeReviewMatrixPlan();
    const existing = new Set(smokeReviewKeys(buildSmokeReviewMatrixPlan()));
    const keys = otherSmokeReviewKeys(other);
    const frozenKeys = new Set(frozen.sheets.flatMap((sheet) => (
      sheet.rows.flatMap((row) => row.columns.map((column) => `${sheet.worksheet}|${row.row}|${column}`))
    )));

    expect(other.planned_cells).toBe(OTHER_SMOKE_REVIEW_CELLS);
    expect(keys).toHaveLength(OTHER_SMOKE_REVIEW_CELLS);
    expect(keys.every((key) => frozenKeys.has(key))).toBe(true);
    expect(keys.some((key) => existing.has(key))).toBe(false);
    expect(OTHER_SMOKE_CAPTURE_ORDER).toEqual(["外教", "数学课", "MOOC", "主要课程", "美育"]);
    expect(other.sheets.map((sheet) => [
      sheet.worksheet,
      sheet.planned_cells,
      sheet.rows[0].row,
      sheet.rows.at(-1)?.row,
      sheet.rows[0].columns[0],
      sheet.rows[0].columns.at(-1),
    ])).toEqual([
      ["外教", 32, 3, 6, "G", "N"],
      ["数学课", 49, 8, 14, "D", "J"],
      ["MOOC", 56, 8, 14, "G", "N"],
      ["主要课程", 64, 19, 26, "F", "M"],
      ["美育", 63, 8, 14, "E", "M"],
    ]);
    expect(OTHER_SMOKE_SHEETS.map((sheet) => sheet.worksheet)).toEqual([...OTHER_SMOKE_CAPTURE_ORDER]);
    expect(OTHER_SMOKE_OUTPUT_RELATIVE).toBe("scripts/legacy_evidence/output/other-smoke-20260819-v1");
  });

  it("classifies reuse/recapture without guessing course letters or copying formula text", () => {
    const evidence = new Map<string, SmokeSourceReviewEvidence>([
      [key("外教", 4, "K"), review("外教", 4, "K", "review_origin", "visible_text_matches_formula", null, "hash-k4")],
      [key("外教", 4, "L"), review("外教", 4, "L", "evidence_conflict", "visible_text_conflicts_with_formula", "visible_text_formula_mismatch", "hash-l4")],
    ]);
    const inventory = buildOtherSmokeInventory({
      evidenceByKey: evidence,
      sourceEvidenceRoot: "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/evidence",
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    const foreign4 = inventory.sheets.find((sheet) => sheet.worksheet === "外教")!.rows.find((row) => row.row === 4)!;
    expect(foreign4.reviews.find((item) => item.address === "K4")).toMatchObject({
      action: "reuse",
      record_sha256: "hash-k4",
    });
    expect(foreign4.reviews.find((item) => item.address === "L4")).toMatchObject({
      action: "recapture",
      reason: "visible_text_formula_mismatch",
    });
    expect(inventory.totals.review_cells).toBe(264);
    expect(inventory.course_column).toBe("missing_context");
    expect(inventory.teacher_column).toBe("missing_context");
    expect(JSON.stringify(inventory)).not.toMatch(/formula_bar_value|visible_cell_text|"comment"/);
    expect(JSON.stringify(inventory)).not.toMatch(/"course_column":"[A-Z]+"/);

    const plan = planOtherSmokeRowCapture(inventory, "外教", 4);
    expect(plan.click_grid).toBe(false);
    expect(plan.mode).toBe("recapture_only");
    expect(plan.steps).toEqual([
      { type: "assert_view_only" },
      { type: "select_worksheet", worksheet: "外教" },
      { type: "locate", address: "L4", role: "review" },
      { type: "capture_pair", address: "L4", role: "review", recapture: true, bind_reuse_sha256: "hash-l4" },
    ]);
  });

  it("lists leftover formula-bar truncation without failing Capture QA", () => {
    const evidence = filledOtherEvidence();
    evidence.set(key("外教", 4, "L"), review("外教", 4, "L", "evidence_conflict", "visible_text_conflicts_with_formula", "visible_text_formula_mismatch", "hash-l4"));
    const inventory = buildOtherSmokeInventory({
      evidenceByKey: evidence,
      sourceEvidenceRoot: "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/evidence",
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    const qa = buildOtherSmokeCaptureQa({
      inventory,
      captures: [{
        worksheet: "外教",
        address: "L4",
        recapture: true,
        role: "review",
        rewrite_source_json: false,
        formula_image: { sha256: "a".repeat(64) },
        cell_image: { sha256: "b".repeat(64) },
        formula_truncated_dom_authoritative: true,
      }],
    });
    expect(qa.status).toBe("accepted");
    expect(qa.formula_truncated_isolated).toEqual(["外教|4|L"]);
    expect(qa.live_tencent_capture).toBe(false);
    const manifest = freezeOtherSmokeManifest({
      matrix: buildOtherSmokeReviewMatrixPlan(),
      inventory,
      qa,
    });
    expect(manifest.contract_version).toBe("other-smoke-capture-manifest-v1");
    expect(manifest.formula_truncated_isolated).toEqual(["外教|4|L"]);
    expect(manifest.recapture_keys).toEqual(["外教|4|L"]);
  });

  it("expands a short nonempty formula bar when executing an other-smoke row plan", async () => {
    const evidence = filledOtherEvidence();
    evidence.set(key("外教", 4, "L"), review("外教", 4, "L", "evidence_conflict", "visible_text_conflicts_with_formula", "visible_text_formula_mismatch", "hash-l4"));
    const inventory = buildOtherSmokeInventory({
      evidenceByKey: evidence,
      sourceEvidenceRoot: "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/evidence",
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    const expanded: string[] = [];
    const source = otherRowSource("L4", "给分好", expanded);
    const result = await runSmokeRowCapture(planOtherSmokeRowCapture(inventory, "外教", 4), source);
    expect(result.status).toBe("completed");
    expect(result.actions).toContain("expand:L4");
    expect(expanded).toEqual(["L4"]);
    expect(result.captures).toHaveLength(1);
  });

  it("refuses to freeze when a recapture key is missing images", () => {
    const evidence = new Map<string, SmokeSourceReviewEvidence>([
      [key("外教", 4, "L"), review("外教", 4, "L", "evidence_conflict", "visible_text_conflicts_with_formula", "visible_text_formula_mismatch", "hash-l4")],
    ]);
    const inventory = buildOtherSmokeInventory({
      evidenceByKey: evidence,
      sourceEvidenceRoot: "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/evidence",
      generatedAt: "2026-08-19T00:00:00.000Z",
    });
    const qa = buildOtherSmokeCaptureQa({ inventory, captures: [] });
    expect(qa.status).toBe("recapture_required");
    expect(qa.issues.some((issue) => issue.includes("外教|4|L"))).toBe(true);
    expect(() => freezeOtherSmokeManifest({
      matrix: buildOtherSmokeReviewMatrixPlan(),
      inventory,
      qa,
    })).toThrow("accepted Capture QA");
  });
});

function filledOtherEvidence() {
  const evidence = new Map<string, SmokeSourceReviewEvidence>();
  for (const keyName of otherSmokeReviewKeys()) {
    const [worksheet, rowText, column] = keyName.split("|");
    evidence.set(keyName, review(worksheet, Number(rowText), column, "ordinary_blank", "both_empty", null, `rec-${keyName}`));
  }
  return evidence;
}

function otherRowSource(address: string, value: string, expanded: string[]): SmokeRowCaptureSource {
  return {
    async assertViewOnly() {},
    async selectWorksheet() {},
    async locateByAddressBox() {},
    async moveRight() {},
    async readActiveAddress() { return address; },
    async readFormulaBar() { return value; },
    async grabFormulaImage() {
      return { method: "playwright_page", bytes: encodePng(paint(240, 96, (x, y) => (
        x >= 10 && x <= 56 && y >= 14 && y <= 34 ? [255, 255, 255] : [230, 232, 236]
      ))) };
    },
    async grabCellImage() {
      return { method: "playwright_page", bytes: encodePng(paint(240, 160, (x, y) => (
        x % 32 < 2 || y % 24 < 2 ? [80, 86, 92] : [255, 255, 255]
      ))) };
    },
    async writeFrozenImage({ filename, bytes }) {
      return { path: filename, sha256: createHash("sha256").update(bytes).digest("hex") };
    },
    async readCompositionObservation() {
      return { view_only_visible: true, address_box_present: true };
    },
    async captureContextGroup(name) { return { path: name, sha256: "c".repeat(64) }; },
    async captureConflictImage(name) { return { path: name, sha256: "d".repeat(64) }; },
    async expandFormulaBar() { expanded.push(address); },
    now: () => "2026-08-19T00:00:00.000Z",
  };
}

function paint(width: number, height: number, color: (x: number, y: number) => [number, number, number]): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = color(x, y);
      const index = (y * width + x) * 4;
      rgba[index] = r;
      rgba[index + 1] = g;
      rgba[index + 2] = b;
      rgba[index + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function key(worksheet: string, row: number, column: string) {
  return `${worksheet}|${row}|${column}`;
}

function review(
  worksheet: string,
  row: number,
  column: string,
  terminalStatus: SmokeSourceReviewEvidence["terminal_status"],
  correspondence: string,
  conflictReason: string | null,
  recordSha: string,
): SmokeSourceReviewEvidence {
  return {
    key: key(worksheet, row, column),
    worksheet,
    row,
    column,
    target_address: `${column}${row}`,
    terminal_status: terminalStatus,
    correspondence,
    conflict_reason: conflictReason,
    halt_batch: false,
    formula_bar_nonempty: terminalStatus === "review_origin" || terminalStatus === "evidence_conflict",
    formula_bar_text_sha256: null,
    record_sha256: recordSha,
    evidence: { cell_image: null, conflict_image: null },
  };
}
