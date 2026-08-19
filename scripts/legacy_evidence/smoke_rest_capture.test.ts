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
  BOUND_SMOKE_CAPTURE_MANIFEST_SHA256,
  BOUND_SMOKE_RECAPTURE_KEYS,
  ENGLISH_TEACHER_REREAD_ROWS,
  SMOKE_CAPTURE_MANIFEST_VERSION,
  SMOKE_REST_BOUND_NEVER_PACKAGED_COUNTS,
  SMOKE_REST_BOUND_NEVER_PACKAGED_TOTAL,
  SMOKE_REST_CAPTURE_INVENTORY_VERSION,
  SMOKE_REST_CAPTURE_MANIFEST_VERSION,
  SMOKE_REST_CAPTURE_ORDER,
  SMOKE_REST_CAPTURE_QA_VERSION,
  SMOKE_REST_CONTEXT_INDEX_VERSION,
  SMOKE_REST_OUTPUT_RELATIVE,
  SMOKE_REST_ROW_PLAN_VERSION,
  SMOKE_REST_SHEET_LAYOUTS,
  assertSmokeRestOutputPath,
  bindSmokeRestCaptureInventory,
  buildSmokeRestCaptureQa,
  buildSmokeRestContextIndex,
  classifySmokeRestAction,
  freezeSmokeRestManifest,
  planSmokeRestRowCapture,
  runSmokeRestCaptureCli,
  smokeRestCaptureUsage,
  type SmokeRestSyntheticCapture,
} from "./smoke_rest_capture";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

describe("smoke-rest capture scaffolding", () => {
  it("keeps the smoke capture manifest contract name unchanged and adds a new lineage contract", () => {
    expect(SMOKE_MANIFEST_VERSION).toBe("smoke-capture-manifest-v1");
    expect(SMOKE_CAPTURE_MANIFEST_VERSION).toBe("smoke-capture-manifest-v1");
    expect(SMOKE_REST_CAPTURE_MANIFEST_VERSION).toBe("smoke-rest-capture-manifest-v1");
    expect(SMOKE_REST_CAPTURE_MANIFEST_VERSION).not.toBe(SMOKE_MANIFEST_VERSION);
  });

  it("freezes the smoke-rest contract names, lineage SHAs, order, field-notes letters, and 531-cell bound counts", () => {
    expect(SMOKE_REST_CAPTURE_INVENTORY_VERSION).toBe("smoke-rest-capture-inventory-v1");
    expect(SMOKE_REST_CONTEXT_INDEX_VERSION).toBe("smoke-rest-context-index-v1");
    expect(SMOKE_REST_ROW_PLAN_VERSION).toBe("smoke-rest-row-plan-v1");
    expect(SMOKE_REST_CAPTURE_QA_VERSION).toBe("smoke-rest-capture-qa-v1");
    expect(BOUND_PRODUCTION_GAP_INVENTORY_SHA256).toBe("86cfa237d58c8ad8f4554e96a1a8c4bfc968c66494c502d8c7f4faaccbc4162c");
    expect(BOUND_SMOKE_CAPTURE_MANIFEST_SHA256).toBe("59688167b27cc57fdcc8223cb8f47799ef706853d188652285d093d2040339b4");
    expect(SMOKE_REST_CAPTURE_ORDER).toEqual(["体育课", "大英和视听说", "思政课"]);
    expect(SMOKE_REST_SHEET_LAYOUTS.map((sheet) => [
      sheet.worksheet,
      sheet.course_column,
      sheet.teacher_column,
      sheet.smoke_first_row,
      sheet.smoke_last_row,
      sheet.first_rest_row,
    ])).toEqual([
      ["体育课", "A", "B", 6, 14, 15],
      ["大英和视听说", "B", "E", 8, 14, 15],
      ["思政课", "A", "F", 8, 14, 15],
    ]);
    expect(SMOKE_REST_BOUND_NEVER_PACKAGED_COUNTS).toEqual({
      体育课: 157,
      大英和视听说: 198,
      思政课: 176,
    });
    expect(SMOKE_REST_BOUND_NEVER_PACKAGED_TOTAL).toBe(531);
    expect(BOUND_SMOKE_RECAPTURE_KEYS).toHaveLength(37);
    expect(ENGLISH_TEACHER_REREAD_ROWS).toEqual([9, 10, 11, 12, 13, 14]);
  });

  it("maps remaining never_packaged to recapture and keeps smoke-row plus packaged keys frozen", () => {
    expect(classifySmokeRestAction("never_packaged", "体育课", 15)).toBe("recapture");
    expect(classifySmokeRestAction("never_packaged", "体育课", 6)).toBe("do_not_recapture");
    expect(classifySmokeRestAction("never_packaged", "大英和视听说", 9)).toBe("do_not_recapture");
    expect(classifySmokeRestAction("in_production", "体育课", 15)).toBe("reuse");
    expect(classifySmokeRestAction("packaged_not_imported", "思政课", 15)).toBe("do_not_recapture");
    expect(classifySmokeRestAction("not_a_review", "大英和视听说", 15)).toBe("skip");
  });

  it("requires the bound production-gap SHA unless --allow-unbound-sha is set", () => {
    const gap = smokeRestGap();
    expect(gap.inventory_sha256).not.toBe(BOUND_PRODUCTION_GAP_INVENTORY_SHA256);
    expect(() => bindSmokeRestCaptureInventory(gap)).toThrow(
      /bind requires production-gap inventory SHA-256 86cfa237d58c8ad8f4554e96a1a8c4bfc968c66494c502d8c7f4faaccbc4162c/,
    );
    expect(() => bindSmokeRestCaptureInventory(gap)).toThrow(/--allow-unbound-sha/);
    const inventory = bindSmokeRestCaptureInventory(gap, { allowUnboundSha: true });
    expect(inventory.bound).toBe(false);
    expect(inventory.source_inventory_sha256).toBe(gap.inventory_sha256);
    expect(inventory.bound_production_gap_inventory_sha256).toBe(BOUND_PRODUCTION_GAP_INVENTORY_SHA256);
    expect(inventory.bound_smoke_capture_manifest_sha256).toBe(BOUND_SMOKE_CAPTURE_MANIFEST_SHA256);
    expect(inventory.bound_smoke_capture_manifest_version).toBe("smoke-capture-manifest-v1");
    expect(inventory.click_grid).toBe(false);
  });

  it("closes remaining recapture keys 1:1 with later_capture.smoke minus smoke rows", () => {
    const gap = smokeRestGap();
    const inventory = bindSmokeRestCaptureInventory(gap, { allowUnboundSha: true });
    expect(inventory.sheets.map((sheet) => sheet.worksheet)).toEqual(SMOKE_REST_CAPTURE_ORDER);
    expect(inventory.recapture_keys).toEqual([
      "体育课|15|D",
      "大英和视听说|15|H",
      "思政课|15|G",
    ]);
    expect(inventory.later_capture_smoke_keys).toEqual(gap.later_capture.smoke.keys);
    expect(inventory.later_capture_smoke_remaining_keys).toEqual([
      "体育课|15|D",
      "大英和视听说|15|H",
      "思政课|15|G",
    ]);
    expect(inventory.smoke_row_never_packaged_keys).toEqual([
      "体育课|6|D",
      "体育课|7|G",
      "大英和视听说|8|H",
      "大英和视听说|9|H",
      "思政课|8|G",
    ]);
    expect(inventory.do_not_recapture_keys).toEqual([
      "体育课|6|D",
      "体育课|7|G",
      "大英和视听说|8|H",
      "大英和视听说|9|H",
      "思政课|8|G",
      "思政课|15|H",
    ]);
    expect(inventory.reuse_record_sha256s).toEqual({
      "体育课|15|E": HASH_A,
    });
    expect(inventory.smoke_frozen_recapture_keys).toEqual(BOUND_SMOKE_RECAPTURE_KEYS);
    expect(inventory.bound_worksheet).toBe(null);
    expect(inventory.recapture_keys.some((key) => BOUND_SMOKE_RECAPTURE_KEYS.includes(key as typeof BOUND_SMOKE_RECAPTURE_KEYS[number]))).toBe(false);
    expect(inventory.totals).toMatchObject({
      recapture: 3,
      reuse: 1,
      do_not_recapture: 6,
      smoke_row_never_packaged: 5,
    });

    const tampered = withLaterSmokeKeys(gap, ["体育课|15|D"]);
    expect(() => bindSmokeRestCaptureInventory(tampered, { allowUnboundSha: true })).toThrow(
      "later_capture.smoke remaining is not closed 1:1",
    );
  });

  it("writes field-notes letters and 大英 9-14 teacher E reread rows into the new context index", () => {
    const inventory = bindSmokeRestCaptureInventory(smokeRestGap(), { allowUnboundSha: true });
    const index = buildSmokeRestContextIndex(inventory, [
      { worksheet: "大英和视听说", row: 9, column: "E", value: "张老师" },
    ]);
    expect(index.bound_smoke_capture_manifest_sha256).toBe(BOUND_SMOKE_CAPTURE_MANIFEST_SHA256);
    expect(index.english_teacher_reread_rows).toEqual([9, 10, 11, 12, 13, 14]);
    expect(index.sheets.map((sheet) => [sheet.worksheet, sheet.course_column, sheet.teacher_column])).toEqual([
      ["体育课", "A", "B"],
      ["大英和视听说", "B", "E"],
      ["思政课", "A", "F"],
    ]);
    const english = index.sheets.find((sheet) => sheet.worksheet === "大英和视听说")!;
    expect(english.rows.map((row) => [row.row, row.teacher_cell, row.teacher_reread, row.visible_teacher])).toEqual([
      [9, "E9", true, "张老师"],
      [10, "E10", true, null],
      [11, "E11", true, null],
      [12, "E12", true, null],
      [13, "E13", true, null],
      [14, "E14", true, null],
      [15, "E15", false, null],
    ]);
    expect(english.rows.find((row) => row.row === 15)?.review_keys).toEqual(["大英和视听说|15|H"]);
    expect(english.rows.find((row) => row.row === 9)?.review_keys).toEqual([]);
    expect(() => buildSmokeRestContextIndex(inventory, [
      { worksheet: "大英和视听说", row: 9, column: "G", value: "旧列" },
    ])).toThrow(/obsolete 大英和视听说 teacher column G/);
    expect(JSON.stringify(index)).not.toMatch(/formula_bar_value|visible_cell_text|"comment"/);
  });

  it("plans address-box recapture from row 15 and teacher-only reread for 大英 9-14", () => {
    const inventory = bindSmokeRestCaptureInventory(smokeRestGap(), { allowUnboundSha: true });
    const sports = planSmokeRestRowCapture(inventory, "体育课", 15);
    expect(sports).toMatchObject({
      contract_version: SMOKE_REST_ROW_PLAN_VERSION,
      click_grid: false,
      mode: "recapture_only",
    });
    expect(sports.steps.map((step) => step.type)).toEqual([
      "assert_view_only",
      "select_worksheet",
      "locate",
      "capture_pair",
      "locate",
      "capture_pair",
      "locate",
      "capture_pair",
    ]);
    expect(sports.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "locate", address: "A15", role: "course" }),
      expect.objectContaining({ type: "locate", address: "B15", role: "teacher" }),
      expect.objectContaining({ type: "capture_pair", address: "D15", recapture: true }),
    ]));
    expect(sports.steps.some((step) => "address" in step && step.address === "E15" && step.type === "capture_pair" && step.recapture)).toBe(false);
    expect(JSON.stringify(sports.steps)).not.toMatch(/click/);

    const english = planSmokeRestRowCapture(inventory, "大英和视听说", 9);
    expect(english.mode).toBe("teacher_reread");
    expect(english.steps).toEqual([
      { type: "assert_view_only" },
      { type: "select_worksheet", worksheet: "大英和视听说" },
      { type: "locate", address: "E9", role: "teacher" },
      { type: "capture_pair", address: "E9", role: "teacher", recapture: false, bind_reuse_sha256: null },
    ]);
    expect(JSON.stringify(english.steps)).not.toMatch(/H9|O9|G9/);

    expect(() => planSmokeRestRowCapture(inventory, "思政课", 8)).toThrow(/smoke rows are frozen/);
    const politics = planSmokeRestRowCapture(inventory, "思政课", 15);
    expect(politics.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "locate", address: "A15", role: "course" }),
      expect.objectContaining({ type: "locate", address: "F15", role: "teacher" }),
      expect.objectContaining({ type: "capture_pair", address: "G15", recapture: true }),
    ]));
    expect(politics.steps.some((step) => "address" in step && step.address === "H15")).toBe(false);
  });

  it("does not put formula bodies or comments in inventory, QA, or manifest", () => {
    const inventory = bindSmokeRestCaptureInventory(smokeRestGap(), { allowUnboundSha: true });
    const contextIndex = buildSmokeRestContextIndex(inventory, englishTeacherReads());
    const qa = buildSmokeRestCaptureQa({
      inventory,
      contextIndex,
      captures: capturesFor(inventory.recapture_keys),
    });
    const manifest = freezeSmokeRestManifest({ inventory, contextIndex, qa });
    const encoded = `${JSON.stringify(inventory)}\n${JSON.stringify(contextIndex)}\n${JSON.stringify(qa)}\n${JSON.stringify(manifest)}`;
    expect(encoded).not.toMatch(/formula_bar_value|visible_cell_text|"comment"/);
    expect(qa.status).toBe("accepted");
    expect(qa.click_grid).toBe(false);
    expect(qa.rewrote_smoke_pack).toBe(false);
    expect(qa.wrote_tencent_or_business_db).toBe(false);
    expect(qa.live_tencent_capture).toBe(false);
    expect(qa.smoke_frozen_keys_excluded).toBe(true);
    expect(qa.english_teacher_column).toBe("E");
    expect(qa.english_teacher_reread_rows).toBe(6);
    expect(manifest.bound_smoke_capture_manifest_sha256).toBe(BOUND_SMOKE_CAPTURE_MANIFEST_SHA256);
    expect(manifest.recapture_keys).toEqual(inventory.recapture_keys);
    expect(manifest.reuse_record_sha256s["体育课|15|E"]).toBe(HASH_A);
    expect(manifest.english_teacher_reread_rows).toEqual([9, 10, 11, 12, 13, 14]);
  });

  it("returns recapture_required, manifest_mismatch, and refuses to freeze a non-accepted QA", () => {
    const inventory = bindSmokeRestCaptureInventory(smokeRestGap(), { allowUnboundSha: true });
    const unread = buildSmokeRestContextIndex(inventory);
    expect(buildSmokeRestCaptureQa({
      inventory,
      contextIndex: unread,
      captures: capturesFor(inventory.recapture_keys),
    }).status).toBe("recapture_required");
    const contextIndex = buildSmokeRestContextIndex(inventory, englishTeacherReads());
    const missing = buildSmokeRestCaptureQa({ inventory, contextIndex });
    expect(missing.status).toBe("recapture_required");
    expect(missing.issues.some((issue) => issue.includes("missing formula/cell"))).toBe(true);
    expect(unread.sheets.find((sheet) => sheet.worksheet === "大英和视听说")?.rows.some((row) => (
      row.teacher_reread && row.visible_teacher === null
    ))).toBe(true);

    const dirty = buildSmokeRestCaptureQa({
      inventory,
      contextIndex,
      captures: capturesFor(inventory.recapture_keys),
      compositionFailures: [{
        key: "思政课|15|G",
        issues: ["cell image looks like a terminal or other dark overlay, not a sheet grid"],
      }],
    });
    expect(dirty.status).toBe("recapture_required");
    expect(dirty.issues.some((issue) => issue.includes("composition rejected: 思政课|15|G"))).toBe(true);

    const mismatched = buildSmokeRestCaptureQa({
      inventory,
      contextIndex,
      captures: capturesFor(inventory.recapture_keys),
      reusedRecordSha256s: new Map([["体育课|15|E", "d".repeat(64)]]),
    });
    expect(mismatched.status).toBe("manifest_mismatch");
    expect(() => freezeSmokeRestManifest({ inventory, contextIndex, qa: missing })).toThrow("accepted Capture QA");
  });

  it("restricts CLI writes to the smoke-rest output directory and rejects smoke or formula-bar-full paths", async () => {
    expect(SMOKE_REST_OUTPUT_RELATIVE).toBe("scripts/legacy_evidence/output/smoke-rest-20260818-v1");
    expect(() => assertSmokeRestOutputPath(resolve(SMOKE_REST_OUTPUT_RELATIVE, "inventory.json"))).not.toThrow();
    expect(() => assertSmokeRestOutputPath(resolve("scripts/legacy_evidence/output/other/inventory.json"))).toThrow(
      "smoke-rest output must stay inside scripts/legacy_evidence/output/smoke-rest-20260818-v1",
    );
    expect(() => assertSmokeRestOutputPath(resolve("scripts/legacy_evidence/output/smoke-20260818-v1/inventory.json"))).toThrow(
      "must stay inside",
    );
    expect(() => assertSmokeRestOutputPath(resolve("scripts/legacy_evidence/output/formula-bar-full-20260729-v1/inventory.json"))).toThrow(
      "must stay inside",
    );

    const root = await mkdtemp(join(tmpdir(), "smoke-rest-"));
    try {
      const gapPath = join(root, "gap.json");
      await writeFile(gapPath, `${JSON.stringify(smokeRestGap(), null, 2)}\n`);
      await expect(runSmokeRestCaptureCli([
        "bind-inventory",
        gapPath,
        join(root, "inventory.json"),
        "--allow-unbound-sha",
      ])).rejects.toThrow("smoke-rest output must stay inside");
      await expect(runSmokeRestCaptureCli([
        "bind-inventory",
        gapPath,
        resolve("scripts/legacy_evidence/output/smoke-20260818-v1/inventory.json"),
        "--allow-unbound-sha",
      ])).rejects.toThrow("smoke-rest output must stay inside");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes bind-inventory, context-index, plan-row, qa, and freeze-manifest", async () => {
    expect(smokeRestCaptureUsage()).toMatch(/bind-inventory/);
    expect(smokeRestCaptureUsage()).toMatch(/context-index/);
    expect(smokeRestCaptureUsage()).toMatch(/teacher-reads\.json/);
    expect(smokeRestCaptureUsage()).toMatch(/plan-row/);
    expect(smokeRestCaptureUsage()).toMatch(/qa/);
    expect(smokeRestCaptureUsage()).toMatch(/composition-failures\.json/);
    expect(smokeRestCaptureUsage()).toMatch(/freeze-manifest/);
    expect(smokeRestCaptureUsage()).toMatch(/--allow-unbound-sha/);
    expect(smokeRestCaptureUsage()).toMatch(/--worksheet/);

    const root = await mkdtemp(join(tmpdir(), "smoke-rest-cli-"));
    const outputRoot = resolve(SMOKE_REST_OUTPUT_RELATIVE);
    const stamp = `test-${Date.now()}-${process.pid}`;
    const inventoryPath = join(outputRoot, `${stamp}-inventory.json`);
    const contextPath = join(outputRoot, `${stamp}-context.json`);
    const capturesPath = join(root, "captures.json");
    const qaPath = join(outputRoot, `${stamp}-qa.json`);
    const manifestPath = join(outputRoot, `${stamp}-manifest.json`);
    const gapPath = join(root, "gap.json");
    try {
      const gap = smokeRestGap();
      await writeFile(gapPath, `${JSON.stringify(gap, null, 2)}\n`);
      const bound = await runSmokeRestCaptureCli([
        "bind-inventory",
        gapPath,
        inventoryPath,
        "--allow-unbound-sha",
      ]);
      expect(bound).toMatchObject({ recapture_keys: 3, bound: false });
      const readsPath = join(root, "teacher-reads.json");
      await writeFile(readsPath, `${JSON.stringify(englishTeacherReads(), null, 2)}\n`);
      await runSmokeRestCaptureCli(["context-index", inventoryPath, contextPath, readsPath]);
      const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
      await writeFile(capturesPath, `${JSON.stringify(capturesFor(inventory.recapture_keys), null, 2)}\n`);
      const planned = await runSmokeRestCaptureCli(["plan-row", inventoryPath, "体育课", "15"]);
      expect(planned).toMatchObject({ worksheet: "体育课", click_grid: false });
      const qa = await runSmokeRestCaptureCli(["qa", inventoryPath, contextPath, qaPath, capturesPath]);
      expect(qa).toMatchObject({ status: "accepted" });
      const frozen = await runSmokeRestCaptureCli(["freeze-manifest", inventoryPath, contextPath, qaPath, manifestPath]);
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
    const library = await readFile(new URL("./smoke_rest_capture.ts", import.meta.url), "utf8");
    const cli = await readFile(new URL("./smoke_rest_capture_cli.ts", import.meta.url), "utf8");
    const combined = `${library}\n${cli}`;
    expect(combined).not.toMatch(/AuthBridge|formula_bar_tencent|smoke_recapture_tencent|page\.click|locator\.click/);
    expect(combined).not.toMatch(/\bD1\b|wrangler d1|writeTencent|review workflow/);
    expect(combined).not.toMatch(/#199|#200|#196|#206|issue-199|issue-200|pull\/196|pull\/206/);
  });

  it("can bind and freeze one worksheet so 体育课 can ship before 大英 E reread", () => {
    const inventory = bindSmokeRestCaptureInventory(smokeRestGap(), {
      allowUnboundSha: true,
      worksheet: "体育课",
    });
    expect(inventory.bound_worksheet).toBe("体育课");
    expect(inventory.sheets.map((sheet) => sheet.worksheet)).toEqual(["体育课"]);
    expect(inventory.recapture_keys).toEqual(["体育课|15|D"]);
    expect(inventory.later_capture_smoke_remaining_keys).toEqual(["体育课|15|D"]);
    const contextIndex = buildSmokeRestContextIndex(inventory);
    expect(contextIndex.sheets.map((sheet) => sheet.worksheet)).toEqual(["体育课"]);
    const qa = buildSmokeRestCaptureQa({
      inventory,
      contextIndex,
      captures: capturesFor(inventory.recapture_keys),
    });
    expect(qa.status).toBe("accepted");
    expect(qa.english_teacher_reread_rows).toBe(0);
    const manifest = freezeSmokeRestManifest({ inventory, contextIndex, qa });
    expect(manifest.bound_worksheet).toBe("体育课");
    expect(manifest.recapture_keys).toEqual(["体育课|15|D"]);
  });
});

function smokeRestGap(): ProductionGapInventory {
  return buildProductionGapInventory({
    plan: tinyPlan([
      "体育课|6|D",
      "体育课|7|G",
      "体育课|15|D",
      "体育课|15|E",
      "大英和视听说|8|H",
      "大英和视听说|9|H",
      "大英和视听说|15|H",
      "大英和视听说|15|I",
      "思政课|8|G",
      "思政课|15|G",
      "思政课|15|H",
      "主要课程|19|F",
    ]),
    evidence: [
      gap("体育课|6|D", "review_origin", true, false, HASH_A),
      gap("体育课|7|G", "evidence_conflict", true, false, HASH_B),
      gap("体育课|15|D", "review_origin", true, false, HASH_C),
      gap("体育课|15|E", "review_origin", true, false, HASH_A),
      gap("大英和视听说|8|H", "review_origin", true, false, HASH_B),
      gap("大英和视听说|9|H", "review_origin", true, false, HASH_C),
      gap("大英和视听说|15|H", "review_origin", true, false, HASH_A),
      gap("大英和视听说|15|I", "ordinary_blank", false, false, HASH_B),
      gap("思政课|8|G", "evidence_conflict", true, false, HASH_C),
      gap("思政课|15|G", "evidence_conflict", true, false, HASH_A),
      gap("思政课|15|H", "evidence_conflict", true, false, HASH_B),
      gap("主要课程|19|F", "review_origin", true, false, HASH_C),
    ],
    production: [
      { name: "pe", records: [identity("体育课", 15, "E")] },
    ],
    unimported: [
      { name: "catalog-identity-unresolved", records: [identity("思政课", 15, "H")] },
    ],
  });
}

function withLaterSmokeKeys(gap: ProductionGapInventory, keys: string[]): ProductionGapInventory {
  const { inventory_sha256: _ignored, ...content } = gap;
  const next = {
    ...content,
    later_capture: {
      ...content.later_capture,
      smoke: {
        ...content.later_capture.smoke,
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

function englishTeacherReads() {
  return ENGLISH_TEACHER_REREAD_ROWS.map((row) => ({
    worksheet: "大英和视听说",
    row,
    column: "E",
    value: `老师${row}`,
  }));
}

function capturesFor(keys: string[]): SmokeRestSyntheticCapture[] {
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
