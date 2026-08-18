import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFormulaBarMatrixPlan } from "./formula_bar_locator";
import {
  buildProductionGapInventory,
  type FormulaBarGapEvidence,
  type ProductionGapInventory,
} from "./production_gap";
import { SMOKE_MANIFEST_VERSION } from "./smoke_recapture";
import {
  BOUND_PRODUCTION_GAP_INVENTORY_SHA256,
  REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS,
  REST_SHEETS_BOUND_NEVER_PACKAGED_TOTAL,
  REST_SHEETS_CAPTURE_INVENTORY_VERSION,
  REST_SHEETS_CAPTURE_MANIFEST_VERSION,
  REST_SHEETS_CAPTURE_ORDER,
  REST_SHEETS_CAPTURE_QA_VERSION,
  REST_SHEETS_CONTEXT_INDEX_VERSION,
  REST_SHEETS_LOCATOR_TARGETS,
  REST_SHEETS_OUTPUT_RELATIVE,
  REST_SHEETS_ROW_PLAN_VERSION,
  assertRestSheetsOutputPath,
  bindRestSheetsCaptureInventory,
  buildRestSheetsCaptureQa,
  buildRestSheetsContextIndex,
  classifyRestSheetsAction,
  freezeRestSheetsManifest,
  planRestSheetsLocator,
  planRestSheetsRowCapture,
  restSheetsCaptureUsage,
  runRestSheetsCaptureCli,
  type RestSheetsSyntheticCapture,
} from "./rest_sheets_capture";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

describe("rest-sheets capture scaffolding", () => {
  it("keeps the smoke capture manifest contract name unchanged", () => {
    expect(SMOKE_MANIFEST_VERSION).toBe("smoke-capture-manifest-v1");
    expect(REST_SHEETS_CAPTURE_MANIFEST_VERSION).toBe("rest-sheets-capture-manifest-v1");
    expect(REST_SHEETS_CAPTURE_MANIFEST_VERSION).not.toBe(SMOKE_MANIFEST_VERSION);
  });

  it("freezes the rest-sheets contract names, bind SHA, order, and 112-cell bound counts", () => {
    expect(REST_SHEETS_CAPTURE_INVENTORY_VERSION).toBe("rest-sheets-capture-inventory-v1");
    expect(REST_SHEETS_CONTEXT_INDEX_VERSION).toBe("rest-sheets-context-index-v1");
    expect(REST_SHEETS_ROW_PLAN_VERSION).toBe("rest-sheets-row-plan-v1");
    expect(REST_SHEETS_CAPTURE_QA_VERSION).toBe("rest-sheets-capture-qa-v1");
    expect(BOUND_PRODUCTION_GAP_INVENTORY_SHA256).toBe("86cfa237d58c8ad8f4554e96a1a8c4bfc968c66494c502d8c7f4faaccbc4162c");
    expect(REST_SHEETS_CAPTURE_ORDER).toEqual(["外教", "数学课", "MOOC", "主要课程", "美育"]);
    expect(REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS).toEqual({
      外教: 10,
      数学课: 1,
      MOOC: 24,
      主要课程: 77,
      美育: 0,
    });
    expect(REST_SHEETS_BOUND_NEVER_PACKAGED_TOTAL).toBe(112);
    expect(
      REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS.外教
      + REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS.数学课
      + REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS.MOOC
      + REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS.主要课程
      + REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS.美育,
    ).toBe(112);
  });

  it("maps partitions to recapture, reuse, do_not_recapture, and skip", () => {
    expect(classifyRestSheetsAction("never_packaged")).toBe("recapture");
    expect(classifyRestSheetsAction("in_production")).toBe("reuse");
    expect(classifyRestSheetsAction("packaged_not_imported")).toBe("do_not_recapture");
    expect(classifyRestSheetsAction("not_a_review")).toBe("skip");
  });

  it("requires the bound production-gap SHA unless --allow-unbound-sha is set", () => {
    const gap = restGap();
    expect(gap.inventory_sha256).not.toBe(BOUND_PRODUCTION_GAP_INVENTORY_SHA256);
    expect(() => bindRestSheetsCaptureInventory(gap)).toThrow(
      /bind requires production-gap inventory SHA-256 86cfa237d58c8ad8f4554e96a1a8c4bfc968c66494c502d8c7f4faaccbc4162c/,
    );
    expect(() => bindRestSheetsCaptureInventory(gap)).toThrow(/--allow-unbound-sha/);
    const inventory = bindRestSheetsCaptureInventory(gap, { allowUnboundSha: true });
    expect(inventory.bound).toBe(false);
    expect(inventory.source_inventory_sha256).toBe(gap.inventory_sha256);
    expect(inventory.bound_production_gap_inventory_sha256).toBe(BOUND_PRODUCTION_GAP_INVENTORY_SHA256);
    expect(inventory.click_grid).toBe(false);
  });

  it("closes recapture keys 1:1 with later_capture.non_smoke and keeps production hashes", () => {
    const gap = restGap();
    const inventory = bindRestSheetsCaptureInventory(gap, { allowUnboundSha: true });
    expect(inventory.sheets.map((sheet) => sheet.worksheet)).toEqual(REST_SHEETS_CAPTURE_ORDER);
    expect(inventory.recapture_keys).toEqual([
      "外教|4|K",
      "数学课|8|D",
      "MOOC|46|G",
      "主要课程|19|F",
    ]);
    expect(inventory.later_capture_non_smoke_keys).toEqual(gap.later_capture.non_smoke.keys);
    expect([...inventory.recapture_keys].sort()).toEqual([...gap.later_capture.non_smoke.keys].sort());
    expect(inventory.do_not_recapture_keys).toEqual(["外教|4|L"]);
    expect(inventory.reuse_record_sha256s).toEqual({
      "主要课程|19|G": HASH_A,
      "美育|8|E": HASH_C,
    });
    expect(inventory.totals).toMatchObject({
      cells: 10,
      never_packaged: 4,
      recapture: 4,
      reuse: 2,
      do_not_recapture: 1,
      skip: 3,
    });
    expect(inventory.course_anchor).toBe("missing_context");
    expect(inventory.sheets.every((sheet) => sheet.course_anchor === "missing_context")).toBe(true);
    expect(inventory.sheets.flatMap((sheet) => sheet.cells).every((cell) => cell.course_anchor === "missing_context")).toBe(true);

    const tampered = withLaterKeys(gap, ["外教|4|K"]);
    expect(() => bindRestSheetsCaptureInventory(tampered, { allowUnboundSha: true })).toThrow(
      "later_capture.non_smoke is not closed 1:1",
    );
  });

  it("writes a context index that keeps missing_context and does not guess letters", () => {
    const inventory = bindRestSheetsCaptureInventory(restGap(), { allowUnboundSha: true });
    const index = buildRestSheetsContextIndex(inventory);
    expect(index.course_anchor).toBe("missing_context");
    expect(index.sheets.map((sheet) => [sheet.worksheet, sheet.course_column, sheet.teacher_column, sheet.rows.map((row) => row.row)])).toEqual([
      ["外教", "missing_context", "missing_context", [4]],
      ["数学课", "missing_context", "missing_context", [8]],
      ["MOOC", "missing_context", "missing_context", [46]],
      ["主要课程", "missing_context", "missing_context", [19]],
      ["美育", "missing_context", "missing_context", [8]],
    ]);
    expect(index.sheets.find((sheet) => sheet.worksheet === "美育")?.rows[0]).toMatchObject({
      row: 8,
      review_keys: ["美育|8|E"],
      course_cell: "missing_context",
      teacher_cell: "missing_context",
      course_anchor: "missing_context",
    });
    expect(JSON.stringify(index)).not.toMatch(/"course_column":"[A-Z]+"|"teacher_column":"[A-Z]+"/);
    expect(JSON.stringify(index)).not.toMatch(/formula_bar_value|visible_cell_text|"comment"/);
  });

  it("plans address-box recapture only and never clicks the grid", () => {
    const inventory = bindRestSheetsCaptureInventory(restGap(), { allowUnboundSha: true });
    const row = planRestSheetsRowCapture(inventory, "外教", 4);
    expect(row).toMatchObject({
      contract_version: REST_SHEETS_ROW_PLAN_VERSION,
      click_grid: false,
      mode: "recapture_only",
    });
    expect(row.steps.map((step) => step.type)).toEqual([
      "assert_view_only",
      "select_worksheet",
      "locate",
      "capture_pair",
    ]);
    expect(row.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "locate", address: "K4", role: "review" }),
      expect.objectContaining({ type: "capture_pair", address: "K4", recapture: true }),
    ]));
    expect(row.steps.some((step) => "address" in step && step.address === "L4")).toBe(false);
    expect(JSON.stringify(row.steps)).not.toMatch(/click/);
  });

  it("plans MOOC G46 first and refuses G-N when the active address is not G46", () => {
    const inventory = bindRestSheetsCaptureInventory(restGap(), { allowUnboundSha: true });
    const locator = planRestSheetsLocator("MOOC", "G46");
    expect(locator.mode).toBe("locator_only");
    expect(locator.click_grid).toBe(false);
    expect(locator.steps).toEqual([
      { type: "assert_view_only" },
      { type: "select_worksheet", worksheet: "MOOC" },
      { type: "locate", address: "G46", role: "locator" },
    ]);
    expect(locator.steps.some((step) => step.type === "capture_pair")).toBe(false);
    expect(() => planRestSheetsRowCapture(inventory, "MOOC", 46)).toThrow("MOOC G46 locator is required before planning G-N");

    const stopped = planRestSheetsRowCapture(inventory, "MOOC", 46, {
      worksheet: "MOOC",
      target_address: "G46",
      active_address: "G47",
    });
    expect(stopped.mode).toBe("locator_only");
    expect(stopped.steps.some((step) => step.type === "capture_pair")).toBe(false);
    expect(stopped.steps.some((step) => step.type === "move_right")).toBe(false);
    expect(stopped.steps.at(-1)).toEqual({
      type: "stop",
      reason: "active_address_mismatch",
      target_address: "G46",
      active_address: "G47",
    });
    expect(stopped.steps.filter((step) => step.type !== "stop").flatMap((step) => (
      "address" in step ? [step.address] : []
    ))).toEqual(["G46"]);
    expect(JSON.stringify(stopped.steps)).not.toMatch(/H46|N46/);

    const aligned = planRestSheetsRowCapture(inventory, "MOOC", 46, {
      worksheet: "MOOC",
      target_address: "G46",
      active_address: "G46",
    });
    expect(aligned.mode).toBe("recapture_only");
    expect(aligned.steps.filter((step) => step.type === "capture_pair")).toEqual([
      expect.objectContaining({ address: "G46", recapture: true }),
    ]);
    expect(aligned.steps.some((step) => "address" in step && step.address === "H46")).toBe(false);
  });

  it("treats F23/F25 as locate-only and does not screenshot empty 美育 cells", () => {
    expect(REST_SHEETS_LOCATOR_TARGETS).toEqual([
      { worksheet: "MOOC", address: "G46", purpose: "halt_batch_row" },
      { worksheet: "主要课程", address: "F23", purpose: "navigation_misclick" },
      { worksheet: "主要课程", address: "F25", purpose: "navigation_misclick" },
    ]);
    for (const address of ["F23", "F25"]) {
      const plan = planRestSheetsLocator("主要课程", address);
      expect(plan.mode).toBe("locator_only");
      expect(plan.click_grid).toBe(false);
      expect(plan.steps.some((step) => step.type === "capture_pair")).toBe(false);
      expect(plan.steps).toContainEqual({ type: "locate", address, role: "locator" });
    }
    expect(() => planRestSheetsLocator("主要课程", "F24")).toThrow("not a rest-sheets locator target");

    const inventory = bindRestSheetsCaptureInventory(restGap(), { allowUnboundSha: true });
    const aesthetic = planRestSheetsRowCapture(inventory, "美育", 8);
    expect(aesthetic.steps.filter((step) => step.type === "capture_pair")).toEqual([]);
    expect(aesthetic.steps.map((step) => step.type)).toEqual(["assert_view_only", "select_worksheet"]);
    const major23 = planRestSheetsRowCapture(inventory, "主要课程", 23);
    expect(major23.steps.some((step) => step.type === "capture_pair")).toBe(false);
  });

  it("does not put formula bodies or comments in inventory, QA, or manifest", () => {
    const inventory = bindRestSheetsCaptureInventory(restGap(), { allowUnboundSha: true });
    const contextIndex = buildRestSheetsContextIndex(inventory);
    const qa = buildRestSheetsCaptureQa({
      inventory,
      contextIndex,
      captures: capturesFor(inventory.recapture_keys),
      locatorNotes: [{ worksheet: "MOOC", target_address: "G46", active_address: "G46" }],
    });
    const manifest = freezeRestSheetsManifest({ inventory, contextIndex, qa });
    const encoded = `${JSON.stringify(inventory)}\n${JSON.stringify(contextIndex)}\n${JSON.stringify(qa)}\n${JSON.stringify(manifest)}`;
    expect(encoded).not.toMatch(/formula_bar_value|visible_cell_text|"comment"/);
    expect(qa.status).toBe("accepted");
    expect(qa.click_grid).toBe(false);
    expect(qa.full_sheet_recapture).toBe(false);
    expect(qa.review_workflow_implemented).toBe(false);
    expect(qa.wrote_tencent_or_business_db).toBe(false);
    expect(qa.live_tencent_capture).toBe(false);
    expect(manifest.recapture_keys).toEqual(inventory.recapture_keys);
    expect(manifest.reuse_record_sha256s["主要课程|19|G"]).toBe(HASH_A);
  });

  it("returns recapture_required, manifest_mismatch, and refuses to freeze a non-accepted QA", () => {
    const inventory = bindRestSheetsCaptureInventory(restGap(), { allowUnboundSha: true });
    const contextIndex = buildRestSheetsContextIndex(inventory);
    const missing = buildRestSheetsCaptureQa({ inventory, contextIndex });
    expect(missing.status).toBe("recapture_required");
    expect(missing.mooc_g46_aligned).toBe(false);
    expect(missing.issues.some((issue) => issue.includes("MOOC G46"))).toBe(true);

    const misaligned = buildRestSheetsCaptureQa({
      inventory,
      contextIndex,
      captures: capturesFor(inventory.recapture_keys),
      locatorNotes: [{ worksheet: "MOOC", target_address: "G46", active_address: "G47" }],
    });
    expect(misaligned.status).toBe("recapture_required");
    expect(misaligned.mooc_g46_aligned).toBe(false);

    const emptyAesthetic = buildRestSheetsCaptureQa({
      inventory,
      contextIndex,
      captures: [
        ...capturesFor(inventory.recapture_keys),
        {
          key: "美育|8|F",
          worksheet: "美育",
          address: "F8",
          recapture: false,
          formula_image_sha256: sha("empty-formula"),
          cell_image_sha256: sha("empty-cell"),
        },
      ],
      locatorNotes: [{ worksheet: "MOOC", target_address: "G46", active_address: "G46" }],
    });
    expect(emptyAesthetic.status).toBe("recapture_required");
    expect(emptyAesthetic.aesthetic_empty_screenshots).toBe(1);

    const dirty = buildRestSheetsCaptureQa({
      inventory,
      contextIndex,
      captures: capturesFor(inventory.recapture_keys),
      locatorNotes: [{ worksheet: "MOOC", target_address: "G46", active_address: "G46" }],
      compositionFailures: [{
        key: "外教|4|K",
        issues: ["cell image looks like a terminal or other dark overlay, not a sheet grid"],
      }],
    });
    expect(dirty.status).toBe("recapture_required");
    expect(dirty.issues.some((issue) => issue.includes("composition rejected: 外教|4|K"))).toBe(true);

    const mismatched = buildRestSheetsCaptureQa({
      inventory,
      contextIndex,
      captures: capturesFor(inventory.recapture_keys),
      locatorNotes: [{ worksheet: "MOOC", target_address: "G46", active_address: "G46" }],
      reusedRecordSha256s: new Map([["主要课程|19|G", "d".repeat(64)]]),
    });
    expect(mismatched.status).toBe("manifest_mismatch");
    expect(() => freezeRestSheetsManifest({ inventory, contextIndex, qa: missing })).toThrow("accepted Capture QA");
  });

  it("restricts CLI writes to the rest-sheets output directory and rejects smoke or formula-bar-full paths", async () => {
    expect(REST_SHEETS_OUTPUT_RELATIVE).toBe("scripts/legacy_evidence/output/rest-sheets-20260818-v1");
    expect(() => assertRestSheetsOutputPath(resolve(REST_SHEETS_OUTPUT_RELATIVE, "inventory.json"))).not.toThrow();
    expect(() => assertRestSheetsOutputPath(resolve("scripts/legacy_evidence/output/other/inventory.json"))).toThrow(
      "rest-sheets output must stay inside scripts/legacy_evidence/output/rest-sheets-20260818-v1",
    );
    expect(() => assertRestSheetsOutputPath(resolve(REST_SHEETS_OUTPUT_RELATIVE, "formula-bar-full-evil.json"))).toThrow(
      "must not overwrite an existing formula-bar pack",
    );
    expect(() => assertRestSheetsOutputPath(resolve(REST_SHEETS_OUTPUT_RELATIVE, "smoke-capture.json"))).toThrow(
      "must not overwrite a smoke pack",
    );

    const root = await mkdtemp(join(tmpdir(), "rest-sheets-"));
    try {
      const gapPath = join(root, "gap.json");
      await writeFile(gapPath, `${JSON.stringify(restGap(), null, 2)}\n`);
      await expect(runRestSheetsCaptureCli([
        "bind-inventory",
        gapPath,
        join(root, "inventory.json"),
        "--allow-unbound-sha",
      ])).rejects.toThrow("rest-sheets output must stay inside");
      await expect(runRestSheetsCaptureCli([
        "bind-inventory",
        gapPath,
        resolve("scripts/legacy_evidence/output/formula-bar-full-20260729-v1/inventory.json"),
        "--allow-unbound-sha",
      ])).rejects.toThrow("rest-sheets output must stay inside");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes bind-inventory, context-index, plan-row, plan-locator, qa, and freeze-manifest", async () => {
    expect(restSheetsCaptureUsage()).toMatch(/bind-inventory/);
    expect(restSheetsCaptureUsage()).toMatch(/context-index/);
    expect(restSheetsCaptureUsage()).toMatch(/plan-row/);
    expect(restSheetsCaptureUsage()).toMatch(/plan-locator/);
    expect(restSheetsCaptureUsage()).toMatch(/qa/);
    expect(restSheetsCaptureUsage()).toMatch(/composition-failures\.json/);
    expect(restSheetsCaptureUsage()).toMatch(/freeze-manifest/);
    expect(restSheetsCaptureUsage()).toMatch(/--allow-unbound-sha/);

    const locator = await runRestSheetsCaptureCli(["plan-locator", "MOOC", "G46"]);
    expect(locator).toMatchObject({
      worksheet: "MOOC",
      mode: "locator_only",
      click_grid: false,
    });

    const root = await mkdtemp(join(tmpdir(), "rest-sheets-cli-"));
    const outputRoot = resolve(REST_SHEETS_OUTPUT_RELATIVE);
    const stamp = `test-${Date.now()}-${process.pid}`;
    const inventoryPath = join(outputRoot, `${stamp}-inventory.json`);
    const contextPath = join(outputRoot, `${stamp}-context.json`);
    const capturesPath = join(root, "captures.json");
    const notesPath = join(root, "locator.json");
    const qaPath = join(outputRoot, `${stamp}-qa.json`);
    const manifestPath = join(outputRoot, `${stamp}-manifest.json`);
    const gapPath = join(root, "gap.json");
    try {
      const gap = restGap();
      await writeFile(gapPath, `${JSON.stringify(gap, null, 2)}\n`);
      const bound = await runRestSheetsCaptureCli([
        "bind-inventory",
        gapPath,
        inventoryPath,
        "--allow-unbound-sha",
      ]);
      expect(bound).toMatchObject({ recapture_keys: 4, bound: false });
      await runRestSheetsCaptureCli(["context-index", inventoryPath, contextPath]);
      const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
      await writeFile(capturesPath, `${JSON.stringify(capturesFor(inventory.recapture_keys), null, 2)}\n`);
      await writeFile(notesPath, `${JSON.stringify([{ worksheet: "MOOC", target_address: "G46", active_address: "G46" }], null, 2)}\n`);
      const planned = await runRestSheetsCaptureCli(["plan-row", inventoryPath, "外教", "4"]);
      expect(planned).toMatchObject({ worksheet: "外教", click_grid: false });
      const qa = await runRestSheetsCaptureCli(["qa", inventoryPath, contextPath, qaPath, capturesPath, notesPath]);
      expect(qa).toMatchObject({ status: "accepted" });
      const frozen = await runRestSheetsCaptureCli(["freeze-manifest", inventoryPath, contextPath, qaPath, manifestPath]);
      expect(frozen).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(JSON.stringify(JSON.parse(await readFile(qaPath, "utf8")))).not.toMatch(/formula_bar_value|visible_cell_text|"comment"/);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(inventoryPath, { force: true });
      await rm(contextPath, { force: true });
      await rm(qaPath, { force: true });
      await rm(manifestPath, { force: true });
    }
  });

  it("does not add live Tencent write, D1, review workflow, or AuthBridge code", async () => {
    const library = await readFile(new URL("./rest_sheets_capture.ts", import.meta.url), "utf8");
    const cli = await readFile(new URL("./rest_sheets_capture_cli.ts", import.meta.url), "utf8");
    const combined = `${library}\n${cli}`;
    expect(combined).not.toMatch(/AuthBridge|formula_bar_tencent|smoke_recapture_tencent|page\.click|locator\.click/);
    expect(combined).not.toMatch(/\bD1\b|wrangler d1|writeTencent|review workflow/);
    expect(combined).not.toMatch(/#199|#200|#196|#206|issue-199|issue-200|pull\/196|pull\/206/);
    expect(combined).not.toMatch(/SMOKE_MANIFEST_VERSION|smoke-capture-manifest-v1/);
  });
});

function restGap(): ProductionGapInventory {
  return buildProductionGapInventory({
    plan: tinyPlan([
      "外教|4|K",
      "外教|4|L",
      "数学课|8|D",
      "MOOC|46|G",
      "MOOC|46|H",
      "主要课程|19|F",
      "主要课程|19|G",
      "主要课程|23|F",
      "美育|8|E",
      "美育|8|F",
      "思政课|8|G",
    ]),
    evidence: [
      gap("外教|4|K", "review_origin", true, false, HASH_A),
      gap("外教|4|L", "review_origin", true, false, HASH_B),
      gap("数学课|8|D", "review_origin", true, false, HASH_C),
      gap("MOOC|46|G", "evidence_conflict", true, true, HASH_A),
      gap("MOOC|46|H", "ordinary_blank", false, false, HASH_B),
      gap("主要课程|19|F", "review_origin", true, false, HASH_C),
      gap("主要课程|19|G", "review_origin", true, false, HASH_A),
      gap("主要课程|23|F", "ordinary_blank", false, false, HASH_B),
      gap("美育|8|E", "review_origin", true, false, HASH_C),
      gap("美育|8|F", "ordinary_blank", false, false, HASH_A),
      gap("思政课|8|G", "review_origin", true, false, HASH_B),
    ],
    production: [
      { name: "v2", records: [identity("主要课程", 19, "G"), identity("美育", 8, "E")] },
    ],
    unimported: [
      { name: "catalog-identity-unresolved", records: [identity("外教", 4, "L")] },
    ],
  });
}

function withLaterKeys(gap: ProductionGapInventory, keys: string[]): ProductionGapInventory {
  const { inventory_sha256: _ignored, ...content } = gap;
  const next = {
    ...content,
    later_capture: {
      ...content.later_capture,
      non_smoke: {
        ...content.later_capture.non_smoke,
        cell_count: keys.length,
        keys,
      },
    },
  };
  return { ...next, inventory_sha256: sha(stableJson(next)) };
}

function tinyPlan(keys: string[]) {
  const sheets = new Map<string, Map<number, string[]>>();
  for (const key of keys) {
    const [worksheet, rowText, column] = key.split("|");
    const rows = sheets.get(worksheet) ?? new Map<number, string[]>();
    const columns = rows.get(Number(rowText)) ?? [];
    columns.push(column);
    rows.set(Number(rowText), columns);
    sheets.set(worksheet, rows);
  }
  return buildFormulaBarMatrixPlan([...sheets.entries()].map(([worksheet, rows]) => ({
    worksheet,
    rows: [...rows.entries()].map(([row, columns]) => ({ row, columns })),
  })));
}

function gap(
  key: string,
  terminal_status: FormulaBarGapEvidence["terminal_status"],
  formula_bar_nonempty: boolean | null,
  halt_batch: boolean,
  record_sha256: string,
): FormulaBarGapEvidence {
  return { key, terminal_status, formula_bar_nonempty, halt_batch, record_sha256 };
}

function identity(worksheet: string, source_row: number, source_column: string) {
  return { worksheet, source_row, source_column };
}

function capturesFor(keys: string[]): RestSheetsSyntheticCapture[] {
  return keys.map((key) => {
    const [worksheet, rowText, column] = key.split("|");
    return {
      key,
      worksheet,
      address: `${column}${rowText}`,
      recapture: true,
      formula_image_sha256: sha(`${key}-formula`),
      cell_image_sha256: sha(`${key}-cell`),
    };
  });
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
