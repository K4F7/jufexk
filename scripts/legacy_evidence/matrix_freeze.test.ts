import { createHash } from "node:crypto";
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
import { LIVE_LAYOUT_WORKSHEETS, compileConfirmedLiveLayout, type LiveLayout } from "./live_layout";
import {
  MATRIX_FREEZE_DEFAULT_WORKSHEETS,
  assertMatrixFreezeOutputPath,
  evaluateMatrixFreezeQa,
  freezeMatrixManifest,
  locateMatrixFreezeRange,
  scanMatrixFreezeExtents,
  type MatrixFreezeExtent,
  type MatrixFreezeLocateResult,
} from "./matrix_freeze";

describe("legacy matrix freeze extents", () => {
  it("defaults to the eight live-layout worksheets including 外教", () => {
    const layout = compileConfirmedLiveLayout();
    const frozen = buildFrozenFormulaBarMatrixPlan();
    const frozenForeign = frozen.sheets.find((sheet) => sheet.worksheet === "外教");
    expect(MATRIX_FREEZE_DEFAULT_WORKSHEETS).toEqual([...LIVE_LAYOUT_WORKSHEETS]);
    expect(MATRIX_FREEZE_DEFAULT_WORKSHEETS).toContain("外教");

    const extent = scanMatrixFreezeExtents({ layout });
    const foreign = extent.sheets.find((sheet) => sheet.worksheet === "外教");
    const mooc = extent.sheets.find((sheet) => sheet.worksheet === "MOOC");
    expect(extent.worksheets).toEqual([...LIVE_LAYOUT_WORKSHEETS]);
    expect(foreign).toMatchObject({
      worksheet: "外教",
      first_row: frozenForeign?.rows[0]?.row,
      last_row: frozenForeign?.rows.at(-1)?.row,
      planned_cells: frozenForeign?.planned_cells,
      scan_to_end: true,
    });
    expect(mooc).toMatchObject({ first_row: 8, last_row: 20, scan_to_end: false });
    expect(extent.layout_sha256).toBe(layout.layout_sha256);
    expect(extent.click_grid).toBe(false);
    expect(JSON.stringify(extent)).not.toMatch(/click the grid|page\.click|locator\.click/);
  });

  it("refuses to guess beyond the already scanned frozen last row", () => {
    expect(() => scanBound({ worksheets: ["数学课"], last_row: 241 })).toThrow(/outside the scanned frozen extent/);
    const clipped = scanBound({ worksheets: ["数学课"], last_row: 14 });
    expect(clipped.sheets[0]).toMatchObject({ first_row: 8, last_row: 14, scan_to_end: false });
  });

  it("fails locate, QA, and freeze when no live layout SHA is bound", async () => {
    const layout = compileConfirmedLiveLayout();
    expect(() => scanMatrixFreezeExtents()).toThrow(/live layout SHA/);
    const bound = scanBound({ worksheets: ["数学课"], first_row: 8, last_row: 8 });
    expect(() => evaluateMatrixFreezeQa({ extent: bound, locates: [] })).toThrow(/live layout SHA/);
    expect(() => evaluateMatrixFreezeQa({
      extent: unboundExtent(bound),
      locates: [],
      layout,
    })).toThrow(/live layout SHA/);
    await expect(locateMatrixFreezeRange({
      extent: bound,
      worksheet: "数学课",
      store: memoryStore(),
    })).rejects.toThrow(/live layout SHA/);
    expect(() => freezeMatrixManifest({
      extent: bound,
      qa: {
        contract_version: "legacy-matrix-freeze-qa-v1",
        status: "accepted",
        issues: [],
        recapture_keys: [],
        formula_truncated_isolated: [],
        planned_cells: 7,
        reused_cells: 7,
        layout_sha256: bound.layout_sha256,
        rewrite_source_json: false,
        click_grid: false,
        wrote_tencent_or_business_db: false,
        qa_sha256: "a".repeat(64),
      },
      evidence: [],
    })).toThrow(/live layout SHA/);
  });

  it("rejects a bound layout whose teacher letters drifted", () => {
    const layout = compileConfirmedLiveLayout();
    const drifted = {
      ...layout,
      sheets: layout.sheets.map((sheet) => (
        sheet.worksheet === "体育课" ? { ...sheet, teacher_column: "C" } : sheet
      )),
    };
    expect(() => scanMatrixFreezeExtents({
      worksheets: ["体育课"],
      layout: drifted as LiveLayout,
    })).toThrow(/体育课|unconfirmed|obsolete|hash/);
  });

  it("allows MOOC 8-20 while G46 is blocked_locator and rejects row 46", () => {
    const layout = compileConfirmedLiveLayout();
    expect(layout.sheets.find((sheet) => sheet.worksheet === "MOOC")?.g46_status).toBe("blocked_locator");
    const clipped = scanBound({ worksheets: ["MOOC"] });
    expect(clipped.sheets[0]).toMatchObject({ first_row: 8, last_row: 20, scan_to_end: false });
    const live = scanBound({ worksheets: ["MOOC"], last_row: 20 });
    expect(live.sheets[0]).toMatchObject({ first_row: 8, last_row: 20, scan_to_end: false });
    expect(scanBound({ worksheets: ["MOOC"], first_row: 8, last_row: 15 }).sheets[0]).toMatchObject({
      first_row: 8,
      last_row: 15,
    });
    expect(() => scanBound({ worksheets: ["MOOC"], last_row: 21 })).toThrow(/G46|live table is 8-20/);
    expect(() => scanBound({ worksheets: ["MOOC"], first_row: 8, last_row: 46 })).toThrow(/G46|live table is 8-20/);
    const smoke = scanBound({ worksheets: ["MOOC"], first_row: 8, last_row: 14 });
    expect(smoke.sheets[0]).toMatchObject({ first_row: 8, last_row: 14, scan_to_end: false });
    expect(smoke.layout_sha256).toBe(layout.layout_sha256);
  });

  it("applies per-sheet last rows from a last-row spec", () => {
    const extent = scanMatrixFreezeExtents({
      layout: compileConfirmedLiveLayout(),
      sheet_last_rows: {
        主要课程: 478,
        数学课: 101,
        美育: 14,
        大英和视听说: 72,
        思政课: 62,
        外教: 7,
        MOOC: 20,
        体育课: 55,
      },
    });
    expect(extent.sheets.map((sheet) => [sheet.worksheet, sheet.last_row, sheet.scan_to_end])).toEqual([
      ["主要课程", 478, false],
      ["数学课", 101, false],
      ["美育", 14, false],
      ["大英和视听说", 72, false],
      ["思政课", 62, false],
      ["外教", 7, false],
      ["MOOC", 20, false],
      ["体育课", 55, false],
    ]);
  });
});

describe("legacy matrix freeze locate and QA", () => {
  it("reuses stored locator evidence and stops a missing range as recapture_required", async () => {
    const extent = scanBound({ worksheets: ["数学课"], first_row: 8, last_row: 8 });
    const store = memoryStore();
    const source = liveSource();
    await store.persistEvidence({ worksheet: "数学课", address: "D8" }, await createEvidence({ worksheet: "数学课", address: "D8" }, source));
    const original = (await store.loadEvidence({ worksheet: "数学课", address: "D8" }))!.record_sha256;

    const missing = await locateMatrixFreezeRange({
      extent,
      worksheet: "数学课",
      store,
      layout: compileConfirmedLiveLayout(),
    });
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
    expect(missing.layout_sha256).toBe(extent.layout_sha256);
    expect((await store.loadEvidence({ worksheet: "数学课", address: "D8" }))!.record_sha256).toBe(original);

    for (const column of ["E", "F", "G", "H", "I", "J"]) {
      const target = { worksheet: "数学课", address: `${column}8` };
      await store.persistEvidence(target, await createEvidence(target, source));
    }
    const complete = await locateMatrixFreezeRange({
      extent,
      worksheet: "数学课",
      store,
      layout: compileConfirmedLiveLayout(),
    });
    expect(complete.status).toBe("accepted");
    expect(complete.reused_cells).toBe(7);
    expect((await store.loadEvidence({ worksheet: "数学课", address: "D8" }))!.record_sha256).toBe(original);
  });

  it("rejects D13 dirty hashes and identical formula/cell hashes without rewriting record_sha256", async () => {
    const extent = scanBound({ worksheets: ["体育课"], first_row: 13, last_row: 13 });
    const source = liveSource();
    const evidence = [await createEvidence({ worksheet: "体育课", address: "D13" }, source)];
    const original = evidence[0]!.record_sha256;
    const locate = acceptedLocate(extent);
    const dirty = evaluateMatrixFreezeQa({
      extent,
      layout: compileConfirmedLiveLayout(),
      locates: [locate],
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
      layout: compileConfirmedLiveLayout(),
      locates: [locate],
      evidence: dirtyEvidence,
    });
    expect(fromEvidence.status).toBe("recapture_required");
    expect(fromEvidence.issues.some((issue) => issue.includes("dirty composition fixture"))).toBe(true);
    expect(() => freezeMatrixManifest({
      extent,
      qa: dirty,
      evidence,
      layout: compileConfirmedLiveLayout(),
    })).toThrow(/recapture_required/);

    const sameHash = evaluateMatrixFreezeQa({
      extent,
      layout: compileConfirmedLiveLayout(),
      locates: [locate],
      evidence,
      pairs: [{ key: "体育课|13|D", formula_sha256: "b".repeat(64), cell_sha256: "b".repeat(64) }],
    });
    expect(sameHash.status).toBe("recapture_required");
    expect(sameHash.issues.some((issue) => issue.includes("identical"))).toBe(true);
  });

  it("marks non-2K, minimized, and CopyFromScreen windows recapture_required without failing the pack on a truncated column", async () => {
    const extent = scanBound({ worksheets: ["体育课"], first_row: 13, last_row: 13 });
    const locate = acceptedLocate(extent);
    const not2k = evaluateMatrixFreezeQa({
      extent,
      layout: compileConfirmedLiveLayout(),
      locates: [locate],
      windows: [{ key: "体育课|13|D", width: 2576, height: 1416, method: "print_window" }],
    });
    expect(not2k.status).toBe("recapture_required");
    expect(not2k.recapture_keys).toEqual(["体育课|13|D"]);
    expect(not2k.issues.some((issue) => issue.includes("not 2K"))).toBe(true);

    const minimized = evaluateMatrixFreezeQa({
      extent,
      layout: compileConfirmedLiveLayout(),
      locates: [locate],
      windows: [{ key: "体育课|13|D", width: 2560, height: 1440, minimized: true, method: "print_window" }],
    });
    expect(minimized.status).toBe("recapture_required");
    expect(minimized.issues.some((issue) => issue.includes("minimized"))).toBe(true);

    const desktop = evaluateMatrixFreezeQa({
      extent,
      layout: compileConfirmedLiveLayout(),
      locates: [locate],
      windows: [{ key: "体育课|13|D", width: 2560, height: 1440, method: "copy_from_screen" }],
    });
    expect(desktop.status).toBe("recapture_required");
    expect(desktop.issues.some((issue) => issue.includes("CopyFromScreen"))).toBe(true);

    const store = memoryStore();
    const source = liveSource();
    const evidence = await Promise.all(["D", "E", "F", "G", "H", "I", "J", "K"].map(async (column) => {
      const target = { worksheet: "体育课", address: `${column}13` };
      const item = await createEvidence(target, source);
      await store.persistEvidence(target, item);
      return item;
    }));
    const truncated = evaluateMatrixFreezeQa({
      extent,
      layout: compileConfirmedLiveLayout(),
      locates: [locate],
      evidence,
      windows: [{ key: "体育课|13|E", width: 2560, height: 1440, method: "print_window", formula_truncated: true }],
    });
    expect(truncated.status).toBe("accepted");
    expect(truncated.formula_truncated_isolated).toEqual(["体育课|13|E"]);
    expect(truncated.recapture_keys).toEqual([]);
    const manifest = freezeMatrixManifest({
      extent,
      qa: truncated,
      evidence,
      layout: compileConfirmedLiveLayout(),
    });
    expect(manifest.formula_truncated_isolated).toEqual(["体育课|13|E"]);
    expect(manifest.layout_sha256).toBe(extent.layout_sha256);
    expect(manifest.wrote_tencent_or_business_db).toBe(false);
  });

  it("freezes a new SHA-256 manifest from reused records and refuses protected output paths", async () => {
    const extent = scanBound({ worksheets: ["数学课"], first_row: 8, last_row: 8 });
    const store = memoryStore();
    const source = liveSource();
    for (const column of ["D", "E", "F", "G", "H", "I", "J"]) {
      const target = { worksheet: "数学课", address: `${column}8` };
      await store.persistEvidence(target, await createEvidence(target, source));
    }
    const locate = await locateMatrixFreezeRange({
      extent,
      worksheet: "数学课",
      store,
      layout: compileConfirmedLiveLayout(),
    });
    const evidence = await Promise.all(["D", "E", "F", "G", "H", "I", "J"].map((column) => (
      store.loadEvidence({ worksheet: "数学课", address: `${column}8` })
    )));
    const present = evidence.filter((item): item is NonNullable<typeof item> => item !== null);
    const qa = evaluateMatrixFreezeQa({
      extent,
      locates: [locate],
      evidence: present,
      layout: compileConfirmedLiveLayout(),
    });
    const manifest = freezeMatrixManifest({
      extent,
      qa,
      evidence: present,
      layout: compileConfirmedLiveLayout(),
    });
    expect(qa.status).toBe("accepted");
    expect(manifest.planned_cells).toBe(7);
    expect(manifest.worksheets).toEqual(["数学课"]);
    expect(manifest.layout_sha256).toBe(extent.layout_sha256);
    expect(manifest.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(manifest.reused_record_sha256s)).toHaveLength(7);
    expect(manifest.click_grid).toBe(false);
    expect(manifest.wrote_tencent_or_business_db).toBe(false);
    const protectedPaths = [
      "scripts/legacy_evidence/output/smoke-20260818-v1/manifest.json",
      "scripts/legacy_evidence/output/smoke-rest-20260818-v1/manifest.json",
      "scripts/legacy_evidence/output/other-smoke-20260819-v1/manifest.json",
      "scripts/legacy_evidence/output/formula-bar-full-20260729-v1/audit.json",
    ];
    const before = await Promise.all(protectedPaths.map(fileSha256IfPresent));
    expect(() => assertMatrixFreezeOutputPath("scripts/legacy_evidence/output/matrix-freeze-20260819-v1/manifest.json")).not.toThrow();
    expect(() => assertMatrixFreezeOutputPath(protectedPaths[0]!)).toThrow(/#180/);
    expect(() => assertMatrixFreezeOutputPath(protectedPaths[1]!)).toThrow(/#180|smoke-rest|formula-bar/);
    expect(() => assertMatrixFreezeOutputPath(protectedPaths[2]!)).toThrow(/#180|smoke-rest|formula-bar/);
    expect(() => assertMatrixFreezeOutputPath(protectedPaths[3]!)).toThrow(/formula-bar/);
    expect(await Promise.all(protectedPaths.map(fileSha256IfPresent))).toEqual(before);
  });

  it("keeps the workflow on CLI execution and forbids clicking or logging in", async () => {
    const workflow = await readFile(join(dirname(fileURLToPath(import.meta.url)), "../../.grok/workflows/legacy-matrix-freeze.rhai"), "utf8");
    expect(workflow).toContain("matrix_freeze_cli.ts");
    expect(workflow).toContain("scan-extent");
    expect(workflow).toContain("view_only_ready");
    expect(workflow).toContain("--layout");
    expect(workflow).toContain("外教");
    expect(workflow).toContain("bound layout SHA");
    expect(workflow).toContain("Do not click grid cells");
    expect(workflow).toContain("Do not log in");
    expect(workflow).toContain("Do not treat screenshots as review body");
    expect(workflow).not.toMatch(/page\.click|locator\.click|navigation\.jsonl/);
  });
});

function scanBound(options: { worksheets?: string[]; first_row?: number; last_row?: number } = {}) {
  return scanMatrixFreezeExtents({ ...options, layout: compileConfirmedLiveLayout() });
}

function unboundExtent(extent: MatrixFreezeExtent): MatrixFreezeExtent {
  return { ...extent, layout_sha256: "" };
}

function acceptedLocate(extent: MatrixFreezeExtent): MatrixFreezeLocateResult {
  const sheet = extent.sheets[0]!;
  return {
    contract_version: "legacy-matrix-freeze-locate-v1",
    status: "accepted",
    worksheet: sheet.worksheet,
    first_row: sheet.first_row,
    last_row: sheet.last_row,
    planned_cells: sheet.planned_cells,
    reused_cells: sheet.planned_cells,
    missing_keys: [],
    stop_key: null,
    stop_reason: null,
    layout_sha256: extent.layout_sha256,
    click_grid: false,
    locate_sha256: "a".repeat(64),
  };
}

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

async function fileSha256IfPresent(path: string) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return null;
  }
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
