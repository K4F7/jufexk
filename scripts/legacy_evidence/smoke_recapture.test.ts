import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodePng, type RgbaImage } from "./composition_qa";
import { buildFrozenFormulaBarMatrixPlan } from "./formula_bar_locator";
import {
  buildSmokeCaptureQa,
  buildSmokeContextIndex,
  buildSmokeReuseRecaptureInventory,
  buildSmokeReviewMatrixPlan,
  classifySmokeReview,
  evaluateSportsRow6,
  freezeSmokeManifest,
  planSmokeRowCapture,
  renderSmokeInventoryMarkdown,
  runSmokeRowCapture,
  smokeFieldSequence,
  smokeReviewKeys,
  SMOKE_CAPTURE_ORDER,
  SMOKE_PROBE_TARGETS,
  type SmokeRowCaptureSource,
  type SmokeSourceReviewEvidence,
} from "./smoke_recapture";

describe("smoke matrix, inventory, and new-composition capture", () => {
  it("freezes the 184-cell smoke review matrix as a subset of the 14,985-cell plan", () => {
    const frozen = buildFrozenFormulaBarMatrixPlan();
    const smoke = buildSmokeReviewMatrixPlan();
    const keys = smokeReviewKeys(smoke);
    const frozenKeys = new Set(frozen.sheets.flatMap((sheet) => (
      sheet.rows.flatMap((row) => row.columns.map((column) => `${sheet.worksheet}|${row.row}|${column}`))
    )));

    expect(smoke.planned_cells).toBe(184);
    expect(keys).toHaveLength(184);
    expect(keys.every((key) => frozenKeys.has(key))).toBe(true);
    expect(smoke.sheets.map((sheet) => [sheet.worksheet, sheet.planned_cells, sheet.rows[0].columns[0], sheet.rows[0].columns.at(-1)])).toEqual([
      ["思政课", 56, "G", "N"],
      ["体育课", 72, "D", "K"],
      ["大英和视听说", 56, "H", "O"],
    ]);
    expect(SMOKE_CAPTURE_ORDER).toEqual(["体育课", "大英和视听说", "思政课"]);
    expect(smokeFieldSequence()[0]).toEqual({ worksheet: "体育课", row: 6 });
  });

  it("classifies reuse, overflow, recapture, and missing without copying formula values", () => {
    const evidence = new Map<string, SmokeSourceReviewEvidence>([
      [key("体育课", 6, "D"), review("体育课", 6, "D", "review_origin", "visible_text_matches_formula", null, "hash-d6", "cell-d6", null)],
      [key("体育课", 6, "H"), review("体育课", 6, "H", "ordinary_blank", "both_empty", null, "hash-h6", null, null)],
      [key("体育课", 7, "G"), review("体育课", 7, "G", "evidence_conflict", "visible_text_conflicts_with_formula", "visible_text_formula_mismatch", "hash-g7", "same", "same")],
      [key("思政课", 14, "H"), review("思政课", 14, "H", "horizontal_overflow_blank", "formula_empty_visible_text", null, "hash-h14", null, null)],
    ]);
    const inventory = buildSmokeReuseRecaptureInventory({
      evidenceByKey: evidence,
      sourceEvidenceRoot: "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/evidence",
      generatedAt: "2026-08-18T00:00:00.000Z",
    });
    const sports6 = inventory.sheets.find((sheet) => sheet.worksheet === "体育课")!.rows.find((row) => row.row === 6)!;
    const sports7 = inventory.sheets.find((sheet) => sheet.worksheet === "体育课")!.rows.find((row) => row.row === 7)!;
    const politics14 = inventory.sheets.find((sheet) => sheet.worksheet === "思政课")!.rows.find((row) => row.row === 14)!;

    expect(sports6.reviews.find((item) => item.address === "D6")).toMatchObject({
      action: "reuse",
      reason: "formula-bar origin, hashes stable",
      record_sha256: "hash-d6",
    });
    expect(sports6.reviews.find((item) => item.address === "H6")).toMatchObject({
      action: "reuse",
      reason: "ordinary blank, no cell image needed",
    });
    expect(sports7.reviews.find((item) => item.address === "G7")).toMatchObject({
      action: "recapture",
      reason: "visible_text_formula_mismatch",
      cell_image_same_as_conflict: true,
    });
    expect(politics14.reviews.find((item) => item.address === "H14")).toMatchObject({
      action: "reuse_as_overflow",
      reason: "formula empty, visible text present",
    });
    expect(inventory.totals).toMatchObject({
      review_cells: 184,
      reuse: 2,
      reuse_as_overflow: 1,
      recapture: 1,
      missing_evidence: 180,
      context_missing: 46,
    });
    expect(inventory.inventory_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(inventory)).not.toMatch(/formula_bar_value|visible_cell_text|给分好/);
    expect(inventory.sheets[2].rows[0].context[1]).toMatchObject({
      role: "teacher",
      address: "G8",
      reason: "teacher column inferred as last context column; confirm via formula bar",
    });
    expect(renderSmokeInventoryMarkdown(inventory)).toMatch(/体育课[\s\S]*\| 7 \| 0 \| 1 \| 0 \| 7 \| G7 \|/);
  });

  it("writes a per-row context index with teacher cells, review keys, and inherited course spans", () => {
    const inventory = tinyInventory();
    const pending = buildSmokeContextIndex(inventory);
    expect(pending.pending_walk_up_rows).toBeGreaterThan(0);
    expect(pending.sheets.find((sheet) => sheet.worksheet === "体育课")?.rows[0]).toMatchObject({
      row: 6,
      teacher_cell: "C6",
      review_keys: ["体育课|6|D", "体育课|6|E", "体育课|6|F", "体育课|6|G", "体育课|6|H", "体育课|6|I", "体育课|6|J", "体育课|6|K"],
      course_span: { pending_walk_up: true },
    });

    const frozen = buildSmokeContextIndex(
      inventory,
      [
        { worksheet: "体育课", row: 5, address: "A5", formula_bar_value: "篮球" },
        { worksheet: "体育课", row: 6, address: "A6", formula_bar_value: "" },
        { worksheet: "体育课", row: 7, address: "A7", formula_bar_value: "" },
      ],
      [
        { worksheet: "体育课", row: 6, address: "C6", formula_bar_value: "甲老师" },
        { worksheet: "体育课", row: 7, address: "C7", formula_bar_value: "乙老师" },
      ],
    );
    const sports = frozen.sheets.find((sheet) => sheet.worksheet === "体育课")!;
    expect(sports.rows.find((row) => row.row === 6)).toMatchObject({
      course_cell: "A5",
      course_anchor_row: 5,
      visible_course: "篮球",
      visible_teacher: "甲老师",
      course_span: { first_row: 5, last_row: 7 },
    });
    expect(sports.rows.find((row) => row.row === 7)).toMatchObject({
      course_anchor_row: 5,
      teacher_cell: "C7",
      course_span: { first_row: 5, last_row: 7 },
    });
    expect(frozen.sheets.find((sheet) => sheet.worksheet === "思政课")?.rows[0].course_span).toEqual({ pending_walk_up: true });
  });

  it("plans 体育课 row 6 as an address-box rehearsal and later rows as recapture-only", () => {
    const inventory = tinyInventory();
    const row6 = planSmokeRowCapture(inventory, "体育课", 6);
    const row7 = planSmokeRowCapture(inventory, "体育课", 7);

    expect(row6).toMatchObject({ click_grid: false, mode: "protocol_rehearsal" });
    expect(row6.steps.map((step) => step.type)).toEqual([
      "assert_view_only",
      "select_worksheet",
      "locate",
      "capture_pair",
      "locate",
      "capture_pair",
      "locate",
      "capture_pair",
      "move_right",
      "capture_pair",
      "move_right",
      "capture_pair",
      "move_right",
      "capture_pair",
      "move_right",
      "confirm_blank",
      "move_right",
      "confirm_blank",
      "move_right",
      "confirm_blank",
      "move_right",
      "confirm_blank",
      "capture_context_group",
    ]);
    expect(row6.steps.flatMap((step) => "address" in step ? [step.address] : [])).toEqual([
      "A6", "A6", "C6", "C6", "D6", "D6", "E6", "E6", "F6", "F6", "G6", "G6", "H6", "H6", "I6", "I6", "J6", "J6", "K6", "K6",
    ]);
    expect(row7.mode).toBe("recapture_only");
    expect(row7.steps.filter((step) => step.type === "capture_pair" && step.role === "review")).toEqual([
      expect.objectContaining({ address: "G7", recapture: true }),
    ]);
    expect(row7.steps.some((step) => step.type === "locate" && step.address === "G7")).toBe(true);
  });

  it("captures row 6 via the address box and right-arrow, never clicking the grid", async () => {
    const inventory = tinyInventory();
    const plan = planSmokeRowCapture(inventory, "体育课", 6);
    const source = fakeSource({
      formulas: {
        A6: "",
        A5: "篮球",
        C6: "甲老师",
        D6: "给分好",
        E6: "一般",
        F6: "还行",
        G6: "可以",
        H6: "",
        I6: "",
        J6: "",
        K6: "",
      },
    });
    const result = await runSmokeRowCapture(plan, source);

    expect(result.status).toBe("completed");
    expect(result.course_anchor_address).toBe("A5");
    expect(result.actions.filter((action) => action.startsWith("click:"))).toEqual([]);
    expect(result.actions.filter((action) => action.startsWith("locate:"))).toEqual([
      "locate:A6",
      "locate:A5",
      "locate:C6",
      "locate:D6",
    ]);
    expect(result.actions.filter((action) => action.startsWith("move:"))).toEqual([
      "move:E6",
      "move:F6",
      "move:G6",
      "move:H6",
      "move:I6",
      "move:J6",
      "move:K6",
    ]);
    expect(result.blanks_confirmed).toEqual(["H6", "I6", "J6", "K6"]);
    expect(result.context_group?.path).toBe("rows005-006_context-A-C.jpg");
    expect(result.captures.filter((item) => item.role === "review").map((item) => [
      item.address,
      item.rewrite_source_json,
      item.formula_image?.sha256 !== item.cell_image?.sha256,
      item.formula_bar_text_sha256,
    ])).toEqual([
      ["D6", false, true, sha("给分好")],
      ["E6", false, true, sha("一般")],
      ["F6", false, true, sha("还行")],
      ["G6", false, true, sha("可以")],
    ]);
    expect(evaluateSportsRow6(result, inventory).passed).toBe(true);
  });

  it("expands every nonempty formula bar, including short text", async () => {
    const inventory = tinyInventory();
    const plan = planSmokeRowCapture(inventory, "体育课", 6);
    const expanded: string[] = [];
    const source = fakeSource({
      formulas: { A6: "篮球", C6: "甲老师", D6: "给分好", E6: "一般", F6: "还行", G6: "可以", H6: "", I6: "", J6: "", K6: "" },
    });
    source.expandFormulaBar = async () => { expanded.push("expanded"); };
    const result = await runSmokeRowCapture(plan, source);
    expect(result.status).toBe("completed");
    expect(result.actions.filter((action) => action.startsWith("expand:"))).toEqual([
      "expand:A6",
      "expand:C6",
      "expand:D6",
      "expand:E6",
      "expand:F6",
      "expand:G6",
    ]);
    expect(expanded).toHaveLength(6);
    expect(result.formula_truncated_isolated).toEqual([]);
  });

  it("isolates leftover formula-bar overflow after expand and still completes the row", async () => {
    const inventory = tinyInventory();
    const plan = planSmokeRowCapture(inventory, "体育课", 6);
    const source = fakeSource({
      formulas: { A6: "篮球", C6: "甲老师", D6: "给分好", E6: "一般", F6: "还行", G6: "可以", H6: "", I6: "", J6: "", K6: "" },
    });
    source.expandFormulaBar = async () => {};
    source.isFormulaBarTruncated = async () => (await source.readActiveAddress()) === "D6";
    const result = await runSmokeRowCapture(plan, source);
    expect(result.status).toBe("completed");
    expect(result.actions).toContain("expand:D6");
    expect(result.actions).toContain("truncated_isolated:D6");
    expect(result.captures.find((item) => item.address === "D6")?.formula_truncated_dom_authoritative).toBe(true);
    expect(result.captures.find((item) => item.address === "E6")?.formula_truncated_dom_authoritative).toBe(false);
    expect(result.formula_truncated_isolated).toEqual(["D6"]);
    expect(evaluateSportsRow6(result, inventory).passed).toBe(true);
  });

  it("stops the row when the active address drifts instead of guessing the next cell", async () => {
    const inventory = tinyInventory();
    const plan = planSmokeRowCapture(inventory, "体育课", 6);
    const source = fakeSource({
      formulas: { A6: "篮球", C6: "甲老师", D6: "给分好", E6: "一般" },
      mismatchAt: "E6",
    });
    const result = await runSmokeRowCapture(plan, source);

    expect(result).toMatchObject({
      status: "blocked",
      stop_reason: "active_address_mismatch",
      target_address: "E6",
      active_address: "Z999",
    });
    expect(result.actions.some((action) => action.startsWith("move:F6"))).toBe(false);
    expect(result.conflict_image?.path).toBe("冲突-E6-Z999.jpg");
  });

  it("rejects identical formula/cell hashes and refuses to freeze a non-accepted manifest", async () => {
    const inventory = tinyInventory();
    const source = fakeSource({
      formulas: { A6: "篮球", C6: "甲老师", D6: "给分好", E6: "一般", F6: "还行", G6: "可以", H6: "", I6: "", J6: "", K6: "" },
      collideHashes: true,
    });
    const blocked = await runSmokeRowCapture(planSmokeRowCapture(inventory, "体育课", 6), source);
    expect(blocked.status).toBe("completed");
    expect(blocked.captures).toEqual([]);
    expect(blocked.recapture_required_addresses).toEqual(["A6", "C6", "D6", "E6", "F6", "G6"]);
    expect(blocked.actions.filter((action) => action.startsWith("recapture_required:"))).toEqual([
      "recapture_required:A6",
      "recapture_required:C6",
      "recapture_required:D6",
      "recapture_required:E6",
      "recapture_required:F6",
      "recapture_required:G6",
    ]);

    const qa = buildSmokeCaptureQa({
      inventory,
      contextIndex: buildSmokeContextIndex(inventory),
      captures: [],
      sportsRow6: null,
      probeNotes: [],
    });
    expect(qa.status).toBe("recapture_required");
    expect(qa.review_workflow_implemented).toBe(false);
    expect(qa.wrote_tencent_or_business_db).toBe(false);
    expect(qa.full_sheet_recapture).toBe(false);
    expect(() => freezeSmokeManifest({
      matrix: buildSmokeReviewMatrixPlan(),
      inventory,
      contextIndex: buildSmokeContextIndex(inventory),
      qa,
    })).toThrow("accepted Capture QA");
    expect(SMOKE_PROBE_TARGETS).toHaveLength(6);
    expect(classifySmokeReview(null)).toEqual({ action: "missing", reason: "no formula-bar evidence record" });
  });

  it("freezes a SHA-256 smoke manifest only after Capture QA is accepted", async () => {
    const inventory = completeReuseInventory();
    const courseReads = inventory.sheets.flatMap((sheet) => sheet.rows.map((row) => ({
      worksheet: sheet.worksheet,
      row: row.row,
      address: `${sheet.context_layout.course}${row.row}`,
      formula_bar_value: row.row === sheet.smoke_rows[0] ? `${sheet.worksheet}-course` : "",
    })));
    const teacherReads = inventory.sheets.flatMap((sheet) => sheet.rows.map((row) => ({
      worksheet: sheet.worksheet,
      row: row.row,
      address: `${sheet.context_layout.teacher}${row.row}`,
      formula_bar_value: `${sheet.worksheet}-teacher-${row.row}`,
    })));
    const contextIndex = buildSmokeContextIndex(inventory, courseReads, teacherReads);
    const source = fakeSource({
      formulas: { A6: "篮球", C6: "甲老师", D6: "给分好", E6: "一般", F6: "还行", G6: "可以", H6: "", I6: "", J6: "", K6: "" },
    });
    const sportsRow6 = await runSmokeRowCapture(planSmokeRowCapture(inventory, "体育课", 6), source);
    const qa = buildSmokeCaptureQa({
      inventory,
      contextIndex,
      captures: sportsRow6.captures,
      sportsRow6,
      probeNotes: [{
        purpose: "halt_batch_row",
        target_address: "G46",
        active_address: "G46",
        formula_reads_agree: true,
        formula_and_address_visible: true,
        old_failure: "整行 halt_batch",
        new_result: "address box stays on G46",
      }],
    });
    expect(contextIndex.pending_walk_up_rows).toBe(0);
    expect(qa.status).toBe("accepted");
    expect(qa.sports_row6_passed).toBe(true);
    const manifest = freezeSmokeManifest({
      matrix: buildSmokeReviewMatrixPlan(),
      inventory,
      contextIndex,
      qa,
    });
    expect(manifest.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.recapture_keys).toEqual([]);
    expect(manifest.reuse_record_sha256s["体育课|6|D"]).toBe("rec-D6");
  });

  it("stops a dirty cell after limited same-address retries and continues the rest of the row", async () => {
    const inventory = tinyInventory();
    const source = fakeSource({
      formulas: { A6: "篮球", C6: "甲老师", D6: "给分好", E6: "一般", F6: "还行", G6: "可以", H6: "", I6: "", J6: "", K6: "" },
      dirtyAt: "D6",
    });
    const result = await runSmokeRowCapture(planSmokeRowCapture(inventory, "体育课", 6), source);

    expect(result.status).toBe("completed");
    expect(result.recapture_required_addresses).toEqual(["D6"]);
    expect(result.captures.filter((item) => item.role === "review").map((item) => item.address)).toEqual(["E6", "F6", "G6"]);
    expect(result.captures.some((item) => item.address === "D6")).toBe(false);
    expect(source.writes).not.toContain("D6-formula.jpg");
    expect(source.writes).toContain("E6-cell.jpg");
    expect(source.formulaGrabs.filter((address) => address === "D6")).toHaveLength(3);
    expect(evaluateSportsRow6(result, inventory).passed).toBe(false);

    const qa = buildSmokeCaptureQa({
      inventory,
      contextIndex: buildSmokeContextIndex(inventory),
      captures: result.captures,
      sportsRow6: result,
      compositionFailures: [{ address: "D6", issues: ["cell image looks like a terminal or other dark overlay, not a sheet grid"] }],
    });
    expect(qa.status).toBe("recapture_required");
    expect(qa.issues.some((issue) => issue.includes("composition rejected: D6"))).toBe(true);
  });

  it("does not treat a missing 只能查看 observation as an accepted formula clip", async () => {
    const inventory = tinyInventory();
    const source = fakeSource({
      formulas: { A6: "篮球", C6: "甲老师", D6: "给分好", E6: "一般", F6: "还行", G6: "可以", H6: "", I6: "", J6: "", K6: "" },
    });
    source.readCompositionObservation = async () => ({ view_only_visible: false, address_box_present: true });
    const result = await runSmokeRowCapture(planSmokeRowCapture(inventory, "体育课", 6), source);
    expect(result.captures).toEqual([]);
    expect(result.recapture_required_addresses.length).toBeGreaterThan(0);
    expect(source.writes).toEqual([]);
  });
});

function tinyInventory() {
  const evidence = new Map<string, SmokeSourceReviewEvidence>();
  for (const column of ["D", "E", "F", "G"]) {
    evidence.set(key("体育课", 6, column), review("体育课", 6, column, "review_origin", "visible_text_matches_formula", null, `rec-${column}6`, `cell-${column}6`, null));
  }
  for (const column of ["H", "I", "J", "K"]) {
    evidence.set(key("体育课", 6, column), review("体育课", 6, column, "ordinary_blank", "both_empty", null, `rec-${column}6`, null, null));
  }
  evidence.set(key("体育课", 7, "G"), review("体育课", 7, "G", "evidence_conflict", "visible_text_conflicts_with_formula", "visible_text_formula_mismatch", "rec-G7", "same", "same"));
  evidence.get(key("体育课", 6, "D"))!.formula_bar_text_sha256 = sha("给分好");
  evidence.get(key("体育课", 6, "E"))!.formula_bar_text_sha256 = sha("一般");
  evidence.get(key("体育课", 6, "F"))!.formula_bar_text_sha256 = sha("还行");
  evidence.get(key("体育课", 6, "G"))!.formula_bar_text_sha256 = sha("可以");
  return buildSmokeReuseRecaptureInventory({
    evidenceByKey: evidence,
    sourceEvidenceRoot: "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/evidence",
    generatedAt: "2026-08-18T00:00:00.000Z",
  });
}

function completeReuseInventory() {
  const texts: Record<string, string> = { D: "给分好", E: "一般", F: "还行", G: "可以" };
  const evidence = new Map<string, SmokeSourceReviewEvidence>();
  for (const itemKey of smokeReviewKeys()) {
    const [worksheet, rowText, column] = itemKey.split("|");
    const row = Number(rowText);
    if (worksheet === "体育课" && row === 6 && texts[column]) {
      const item = review(worksheet, row, column, "review_origin", "visible_text_matches_formula", null, `rec-${column}6`, `cell-${column}6`, null);
      item.formula_bar_text_sha256 = sha(texts[column]);
      evidence.set(itemKey, item);
      continue;
    }
    if (worksheet === "体育课" && row === 6) {
      evidence.set(itemKey, review(worksheet, row, column, "ordinary_blank", "both_empty", null, `rec-${column}6`, null, null));
      continue;
    }
    evidence.set(itemKey, review(worksheet, row, column, "ordinary_blank", "both_empty", null, `rec-${worksheet}-${column}${row}`, null, null));
  }
  return buildSmokeReuseRecaptureInventory({
    evidenceByKey: evidence,
    sourceEvidenceRoot: "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/evidence",
    generatedAt: "2026-08-18T00:00:00.000Z",
  });
}

function review(
  worksheet: string,
  row: number,
  column: string,
  terminalStatus: SmokeSourceReviewEvidence["terminal_status"],
  correspondence: string,
  conflictReason: string | null,
  recordSha256: string,
  cellSha256: string | null,
  conflictSha256: string | null,
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
    formula_bar_text_sha256: recordSha256,
    record_sha256: recordSha256,
    evidence: {
      cell_image: cellSha256 ? { sha256: cellSha256.padEnd(64, "0") } : null,
      conflict_image: conflictSha256 ? { sha256: conflictSha256.padEnd(64, "0") } : null,
    },
  };
}

function key(worksheet: string, row: number, column: string) {
  return `${worksheet}|${row}|${column}`;
}

function fakeSource(options: {
  formulas: Record<string, string>;
  mismatchAt?: string;
  collideHashes?: boolean;
  dirtyAt?: string;
}): SmokeRowCaptureSource & { writes: string[]; formulaGrabs: string[]; readActiveAddress(): Promise<string> } {
  let address = "";
  const columns = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];
  const writes: string[] = [];
  const formulaGrabs: string[] = [];
  return {
    writes,
    formulaGrabs,
    async assertViewOnly() {},
    async selectWorksheet() {},
    async locateByAddressBox(target) { address = target; },
    async moveRight() {
      const match = /^([A-Z]+)(\d+)$/.exec(address)!;
      address = `${columns[columns.indexOf(match[1]) + 1]}${match[2]}`;
    },
    async readActiveAddress() { return address === options.mismatchAt ? "Z999" : address; },
    async readFormulaBar() { return options.formulas[address] ?? ""; },
    async grabFormulaImage(target) {
      formulaGrabs.push(target);
      if (options.dirtyAt === target) return { method: "playwright_page", bytes: encodePng(dirtyImage(0)) };
      return { method: "playwright_page", bytes: encodePng(options.collideHashes ? collidingImage(target) : cleanFormulaImage(target)) };
    },
    async grabCellImage(target) {
      if (options.dirtyAt === target) return { method: "playwright_page", bytes: encodePng(dirtyImage(18)) };
      return { method: "playwright_page", bytes: encodePng(options.collideHashes ? collidingImage(target) : cleanCellImage(target)) };
    },
    async writeFrozenImage({ filename, bytes }) {
      writes.push(filename);
      return { path: filename, sha256: createHash("sha256").update(bytes).digest("hex") };
    },
    async readCompositionObservation() {
      return { view_only_visible: true, address_box_present: true };
    },
    async captureContextGroup(name) { return { path: name, sha256: sha(name) }; },
    async captureConflictImage(name) { return { path: name, sha256: sha(name) }; },
    async expandFormulaBar() {},
    now: () => "2026-08-18T00:00:00.000Z",
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

function cleanFormulaImage(seed: string): RgbaImage {
  const tint = seed.charCodeAt(0) % 20;
  return paint(240, 96, (x, y) => {
    if (x >= 10 && x <= 56 && y >= 14 && y <= 34) return [255, 255, 255];
    if (x >= 64 && x <= 180 && y >= 14 && y <= 38) return [250, 250, 252];
    return [230 + tint, 232, 236];
  });
}

function cleanCellImage(seed: string): RgbaImage {
  const tint = seed.charCodeAt(seed.length - 1) % 12;
  return paint(240, 160, (x, y) => {
    if (x % 32 < 2 || y % 24 < 2) return [80, 86, 92];
    return [255, 255 - tint, 255];
  });
}

function collidingImage(seed: string): RgbaImage {
  const tint = seed.charCodeAt(0) % 15;
  return paint(240, 96, () => [240, 241, 242 + tint]);
}

function dirtyImage(shift: number): RgbaImage {
  return paint(240, 160, (x, y) => {
    if (x < 48) return [246, 246, 246];
    if (x >= 60 + shift && x <= 180 + shift && y >= 20 && y <= 120) return [16, 16, 18];
    return [252, 252, 252];
  });
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
