import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { D13_DIRTY_COMPOSITION_SHA256 } from "./composition_qa";
import { captureFormulaBarCell, type FormulaBarTarget } from "./formula_bar";
import {
  buildFrozenFormulaBarMatrixPlan,
  type FormulaBarLocatorStore,
  type FormulaBarMatrixSource,
} from "./formula_bar_locator";
import {
  MATRIX_FREEZE_DEFAULT_WORKSHEETS,
  assertMatrixFreezeOutputPath,
  buildMatrixFreezePlan,
  evaluateMatrixFreezeQa,
  freezeMatrixManifest,
  locateMatrixFreezeRange,
  scanMatrixFreezeExtents,
} from "./matrix_freeze";

describe("legacy matrix freeze extents", () => {
  it("scans the seven named sheets to the frozen last used row and excludes 外教", () => {
    const frozen = buildFrozenFormulaBarMatrixPlan();
    const extent = scanMatrixFreezeExtents();
    const plan = buildMatrixFreezePlan(extent);
    const frozenKeys = new Set(frozen.sheets.flatMap((sheet) => (
      sheet.rows.flatMap((row) => row.columns.map((column) => `${sheet.worksheet}|${row.row}|${column}`))
    )));
    const keys = plan.sheets.flatMap((sheet) => (
      sheet.rows.flatMap((row) => row.columns.map((column) => `${sheet.worksheet}|${row.row}|${column}`))
    ));

    expect(MATRIX_FREEZE_DEFAULT_WORKSHEETS).toEqual([
      "主要课程",
      "数学课",
      "美育",
      "大英和视听说",
      "思政课",
      "MOOC",
      "体育课",
    ]);
    expect(extent.worksheets).toEqual([...MATRIX_FREEZE_DEFAULT_WORKSHEETS]);
    expect(extent.sheets.map((sheet) => [
      sheet.worksheet,
      sheet.first_row,
      sheet.last_row,
      sheet.first_column,
      sheet.last_column,
      sheet.planned_cells,
    ])).toEqual([
      ["主要课程", 19, 480, "F", "M", 3696],
      ["数学课", 8, 240, "D", "J", 1631],
      ["美育", 8, 201, "E", "M", 1746],
      ["大英和视听说", 8, 203, "H", "O", 1568],
      ["思政课", 8, 205, "G", "N", 1584],
      ["MOOC", 8, 199, "G", "N", 1536],
      ["体育课", 6, 211, "D", "K", 1648],
    ]);
    expect(extent.planned_cells).toBe(13_409);
    expect(extent.sheets.every((sheet) => sheet.scan_to_end)).toBe(true);
    expect(plan.planned_cells).toBe(13_409);
    expect(keys).toHaveLength(13_409);
    expect(keys.every((key) => frozenKeys.has(key))).toBe(true);
    expect(keys.some((key) => key.startsWith("外教|"))).toBe(false);
    expect(extent.click_grid).toBe(false);
    expect(JSON.stringify(extent)).not.toMatch(/click the grid|page\.click|locator\.click/);
  });

  it("refuses to guess beyond the already scanned frozen last row", () => {
    expect(() => scanMatrixFreezeExtents({ worksheets: ["数学课"], last_row: 241 })).toThrow(/outside the scanned frozen extent/);
    const clipped = scanMatrixFreezeExtents({ worksheets: ["数学课"], last_row: 14 });
    expect(clipped.sheets[0]).toMatchObject({ first_row: 8, last_row: 14, scan_to_end: false });
  });
});

describe("legacy matrix freeze locate and QA", () => {
  it("reuses stored locator evidence and stops a missing range as recapture_required", async () => {
    const extent = scanMatrixFreezeExtents({ worksheets: ["数学课"], first_row: 8, last_row: 8 });
    const store = memoryStore();
    const source = liveSource();
    await store.persistEvidence({ worksheet: "数学课", address: "D8" }, await createEvidence({ worksheet: "数学课", address: "D8" }, source));
    const original = (await store.loadEvidence({ worksheet: "数学课", address: "D8" }))!.record_sha256;

    const missing = await locateMatrixFreezeRange({ extent, worksheet: "数学课", store });
    expect(missing.status).toBe("recapture_required");
    expect(missing.missing_keys).toEqual([
      "数学课|8|E",
      "数学课|8|F",
      "数学课|8|G",
      "数学课|8|H",
      "数学课|8|I",
      "数学课|8|J",
    ]);
    expect(missing.reused_cells).toBe(1);
    expect((await store.loadEvidence({ worksheet: "数学课", address: "D8" }))!.record_sha256).toBe(original);

    for (const column of ["E", "F", "G", "H", "I", "J"]) {
      const target = { worksheet: "数学课", address: `${column}8` };
      await store.persistEvidence(target, await createEvidence(target, source));
    }
    const complete = await locateMatrixFreezeRange({ extent, worksheet: "数学课", store });
    expect(complete.status).toBe("accepted");
    expect(complete.reused_cells).toBe(7);
    expect((await store.loadEvidence({ worksheet: "数学课", address: "D8" }))!.record_sha256).toBe(original);
  });

  it("rejects D13 dirty hashes and identical formula/cell hashes without rewriting record_sha256", async () => {
    const extent = scanMatrixFreezeExtents({ worksheets: ["体育课"], first_row: 13, last_row: 13 });
    const source = liveSource();
    const evidence = [await createEvidence({ worksheet: "体育课", address: "D13" }, source)];
    const original = evidence[0]!.record_sha256;
    const dirty = evaluateMatrixFreezeQa({
      extent,
      locates: [{
        contract_version: "legacy-matrix-freeze-locate-v1",
        status: "accepted",
        worksheet: "体育课",
        first_row: 13,
        last_row: 13,
        planned_cells: 8,
        reused_cells: 8,
        missing_keys: [],
        stop_key: null,
        stop_reason: null,
        click_grid: false,
        locate_sha256: "a".repeat(64),
      }],
      evidence,
      pairs: [{
        key: "体育课|13|D",
        formula_sha256: D13_DIRTY_COMPOSITION_SHA256["体育课|13|D|formula"],
        cell_sha256: D13_DIRTY_COMPOSITION_SHA256["体育课|13|D|cell"],
      }],
    });
    expect(dirty.status).toBe("recapture_required");
    expect(dirty.rewrite_source_json).toBe(false);
    expect(dirty.issues.some((issue) => issue.includes("dirty composition fixture"))).toBe(true);
    expect(evidence[0]!.record_sha256).toBe(original);

    const dirtySource = liveSource();
    dirtySource.captureEvidence = async ({ kind, target }) => ({
      kind,
      path: `${kind}/${target.worksheet}/${target.address}.png`,
      sha256: D13_DIRTY_COMPOSITION_SHA256["体育课|13|D|cell"],
    });
    const dirtyEvidence = [await createEvidence({ worksheet: "体育课", address: "D13" }, dirtySource)];
    const fromEvidence = evaluateMatrixFreezeQa({
      extent,
      locates: [{
        contract_version: "legacy-matrix-freeze-locate-v1",
        status: "accepted",
        worksheet: "体育课",
        first_row: 13,
        last_row: 13,
        planned_cells: 8,
        reused_cells: 8,
        missing_keys: [],
        stop_key: null,
        stop_reason: null,
        click_grid: false,
        locate_sha256: "a".repeat(64),
      }],
      evidence: dirtyEvidence,
    });
    expect(fromEvidence.status).toBe("recapture_required");
    expect(fromEvidence.issues.some((issue) => issue.includes("dirty composition fixture"))).toBe(true);
    expect(() => freezeMatrixManifest({ extent, qa: dirty, evidence })).toThrow(/recapture_required/);

    const sameHash = evaluateMatrixFreezeQa({
      extent,
      locates: [{
        contract_version: "legacy-matrix-freeze-locate-v1",
        status: "accepted",
        worksheet: "体育课",
        first_row: 13,
        last_row: 13,
        planned_cells: 8,
        reused_cells: 8,
        missing_keys: [],
        stop_key: null,
        stop_reason: null,
        click_grid: false,
        locate_sha256: "a".repeat(64),
      }],
      evidence,
      pairs: [{ key: "体育课|13|D", formula_sha256: "b".repeat(64), cell_sha256: "b".repeat(64) }],
    });
    expect(sameHash.status).toBe("recapture_required");
    expect(sameHash.issues.some((issue) => issue.includes("identical"))).toBe(true);
  });

  it("freezes a new SHA-256 manifest from reused records and refuses protected output paths", async () => {
    const extent = scanMatrixFreezeExtents({ worksheets: ["数学课"], first_row: 8, last_row: 8 });
    const store = memoryStore();
    const source = liveSource();
    for (const column of ["D", "E", "F", "G", "H", "I", "J"]) {
      const target = { worksheet: "数学课", address: `${column}8` };
      await store.persistEvidence(target, await createEvidence(target, source));
    }
    const locate = await locateMatrixFreezeRange({ extent, worksheet: "数学课", store });
    const evidence = await Promise.all(["D", "E", "F", "G", "H", "I", "J"].map((column) => (
      store.loadEvidence({ worksheet: "数学课", address: `${column}8` })
    )));
    const present = evidence.filter((item): item is NonNullable<typeof item> => item !== null);
    const qa = evaluateMatrixFreezeQa({ extent, locates: [locate], evidence: present });
    const manifest = freezeMatrixManifest({ extent, qa, evidence: present });
    expect(qa.status).toBe("accepted");
    expect(manifest.planned_cells).toBe(7);
    expect(manifest.worksheets).toEqual(["数学课"]);
    expect(manifest.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(manifest.reused_record_sha256s)).toHaveLength(7);
    expect(manifest.click_grid).toBe(false);
    expect(() => assertMatrixFreezeOutputPath("scripts/legacy_evidence/output/matrix-freeze-20260819-v1/manifest.json")).not.toThrow();
    expect(() => assertMatrixFreezeOutputPath("scripts/legacy_evidence/output/smoke-20260818-v1/manifest.json")).toThrow(/#180/);
    expect(() => assertMatrixFreezeOutputPath("scripts/legacy_evidence/output/formula-bar-full-20260729-v1/x.json")).toThrow(/formula-bar/);
  });

  it("keeps the workflow on CLI execution and forbids clicking or logging in", async () => {
    const workflow = await readFile(join(dirname(fileURLToPath(import.meta.url)), "../../.grok/workflows/legacy-matrix-freeze.rhai"), "utf8");
    expect(workflow).toContain("matrix_freeze_cli.ts");
    expect(workflow).toContain("scan-extent");
    expect(workflow).toContain("view_only_ready");
    expect(workflow).toContain("Do not click grid cells");
    expect(workflow).toContain("Do not log in");
    expect(workflow).toContain("Do not treat screenshots as review body");
    expect(workflow).not.toMatch(/page\.click|locator\.click|navigation\.jsonl/);
  });
});

function liveSource(): FormulaBarMatrixSource {
  let address = "D8";
  return {
    async locateByAddressBox(target) { address = target.address; },
    async moveRight(target) { address = target.address; },
    async readActiveAddress() { return address; },
    async readFormulaBar() { return `value-${address}`; },
    async readVisibleCellText() { return `value-${address}`; },
    async captureEvidence({ kind, target }) {
      return { kind, path: `${kind}/${target.worksheet}/${target.address}.png`, sha256: "a".repeat(64) };
    },
    now: () => "2026-08-19T00:00:00.000Z",
  };
}

async function createEvidence(target: FormulaBarTarget, source: FormulaBarMatrixSource) {
  return captureFormulaBarCell(target, source);
}

function memoryStore() {
  const evidence = new Map();
  const store: FormulaBarLocatorStore & { evidence: Map<string, Awaited<ReturnType<typeof createEvidence>>> } = {
    evidence,
    async loadEvidence(target) {
      const match = /^([A-Z]+)(\d+)$/.exec(target.address)!;
      return evidence.get(`${target.worksheet}|${Number(match[2])}|${match[1]}`) ?? null;
    },
    async persistEvidence(_target, item) {
      if (evidence.has(item.key)) return;
      evidence.set(item.key, item);
    },
    async persistCheckpoint() {},
  };
  return store;
}
