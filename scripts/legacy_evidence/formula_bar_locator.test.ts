import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FormulaBarEvidence, FormulaBarTarget } from "./formula_bar";
import {
  buildFormulaBarMatrixPlan,
  buildFrozenFormulaBarMatrixPlan,
  runFormulaBarMatrixLocator,
  type FormulaBarLocatorCheckpoint,
  type FormulaBarLocatorStore,
  type FormulaBarMatrixSource,
} from "./formula_bar_locator";
import { createFileFormulaBarLocatorStore } from "./formula_bar_locator_store";

describe("recoverable formula-bar matrix locator", () => {
  it("generates the frozen 14,985-cell matrix in authoritative sheet/row/column order", () => {
    const plan = buildFrozenFormulaBarMatrixPlan();

    expect(plan).toMatchObject({
      contract_version: "formula-bar-matrix-plan-v1",
      planned_cells: 14_985,
      planned_rows: 1_878,
    });
    expect(plan.sheets.map((sheet) => [sheet.worksheet, sheet.planned_cells])).toEqual([
      ["主要课程", 3696],
      ["数学课", 1631],
      ["美育", 1746],
      ["大英和视听说", 1568],
      ["思政课", 1584],
      ["外教", 1576],
      ["MOOC", 1536],
      ["体育课", 1648],
    ]);
    expect(plan.sheets[0].rows[0]).toEqual({ row: 19, columns: ["F", "G", "H", "I", "J", "K", "L", "M"] });
    expect(plan.sheets.at(-1)?.rows.at(-1)).toEqual({ row: 211, columns: ["D", "E", "F", "G", "H", "I", "J", "K"] });
    expect(plan.plan_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("direct-addresses the first cell of each row, moves right thereafter, and checkpoints row batches", async () => {
    const plan = restrictedPlan();
    const actions: string[] = [];
    const store = memoryStore();
    const report = await runFormulaBarMatrixLocator({
      plan,
      source: source(actions),
      store,
      checkpoint_rows: 1,
    });

    expect(actions).toEqual([
      "locate:D8", "move:E8", "move:F8",
      "locate:D9", "move:E9", "move:F9",
    ]);
    expect(store.checkpoints).toHaveLength(2);
    expect(store.checkpoints[0]).toMatchObject({
      contract_version: "formula-bar-locator-checkpoint-v1",
      sequence: 1,
      worksheet: "数学课",
      first_row: 8,
      last_row: 8,
      first_address: "D8",
      last_address: "F8",
      planned_rows: 1,
      planned_cells: 3,
      completed_cells: 3,
      nonempty_cells: 3,
      conflict_cells: 0,
    });
    expect(report).toMatchObject({
      contract_version: "formula-bar-locator-report-v1",
      status: "completed",
      planned_cells: 6,
      completed_cells: 6,
      captured_cells: 6,
      reused_cells: 0,
      checkpoint_count: 2,
      read_only: true,
      worksheets: [{ worksheet: "数学课", planned_cells: 6, completed_cells: 6, conflicts: 0 }],
    });
  });

  it("forces screenshots only for explicitly scoped blank cells", async () => {
    const plan = restrictedPlan(8, 8);
    const captures: string[] = [];
    const blankSource = source([]);
    blankSource.readFormulaBar = async () => "";
    blankSource.readVisibleCellText = async () => "";
    blankSource.captureEvidence = async ({ kind, target }) => {
      captures.push(target.address);
      return { kind, path: `${target.address}.png`, sha256: "a".repeat(64) };
    };
    const report = await runFormulaBarMatrixLocator({
      plan,
      source: blankSource,
      store: memoryStore(),
      force_cell_image_keys: new Set(["数学课|8|E"]),
    });

    expect(report.status).toBe("completed");
    expect(captures).toEqual(["E8"]);
  });

  it("stops the current batch on address drift and writes no incomplete checkpoint", async () => {
    const plan = restrictedPlan(8, 8);
    const actions: string[] = [];
    const store = memoryStore();
    const report = await runFormulaBarMatrixLocator({
      plan,
      source: source(actions, { mismatchAt: "E8" }),
      store,
    });

    expect(report).toMatchObject({
      status: "blocked",
      stop_key: "数学课|8|E",
      stop_reason: "active_address_mismatch",
      completed_cells: 2,
      captured_cells: 2,
      checkpoint_count: 0,
    });
    expect(store.checkpoints).toEqual([]);
    expect(store.evidence.get("数学课|8|E")).toMatchObject({ halt_batch: true });
  });

  it("resumes from verified evidence without overwriting it and direct-addresses the first missing cell", async () => {
    const plan = restrictedPlan(8, 8);
    const firstActions: string[] = [];
    const firstStore = memoryStore();
    await runFormulaBarMatrixLocator({
      plan,
      source: source(firstActions, { mismatchAt: "E8" }),
      store: firstStore,
    });
    const firstEvidence = firstStore.evidence.get("数学课|8|D")!;
    const resumeStore = memoryStore(new Map([["数学课|8|D", firstEvidence]]));
    const resumeActions: string[] = [];
    const report = await runFormulaBarMatrixLocator({
      plan,
      source: source(resumeActions),
      store: resumeStore,
    });

    expect(resumeActions).toEqual(["locate:E8", "move:F8"]);
    expect(resumeStore.persistedKeys).toEqual(["数学课|8|E", "数学课|8|F"]);
    expect(resumeStore.evidence.get("数学课|8|D")).toBe(firstEvidence);
    expect(report).toMatchObject({
      status: "completed",
      planned_cells: 3,
      completed_cells: 3,
      captured_cells: 2,
      reused_cells: 1,
      checkpoint_count: 1,
    });
  });

  it("does not cross a persisted halt record until that evidence is explicitly retaken", async () => {
    const plan = restrictedPlan(8, 8);
    const interruptedStore = memoryStore();
    await runFormulaBarMatrixLocator({
      plan,
      source: source([], { mismatchAt: "E8" }),
      store: interruptedStore,
    });
    const resumeActions: string[] = [];
    const report = await runFormulaBarMatrixLocator({
      plan,
      source: source(resumeActions),
      store: interruptedStore,
    });

    expect(resumeActions).toEqual([]);
    expect(report).toMatchObject({
      status: "blocked",
      stop_key: "数学课|8|E",
      stop_reason: "active_address_mismatch",
      completed_cells: 2,
      captured_cells: 0,
      reused_cells: 2,
      checkpoint_count: 0,
    });
  });

  it("continues past an explicitly acknowledged persisted halt as a terminal conflict", async () => {
    const plan = restrictedPlan(8, 8);
    const interruptedStore = memoryStore();
    await runFormulaBarMatrixLocator({
      plan,
      source: source([], { mismatchAt: "E8" }),
      store: interruptedStore,
    });
    const resumeActions: string[] = [];
    const report = await runFormulaBarMatrixLocator({
      plan,
      source: source(resumeActions),
      store: interruptedStore,
      acknowledged_halt_keys: new Set(["数学课|8|E"]),
    });

    expect(resumeActions).toEqual(["locate:F8"]);
    expect(report).toMatchObject({
      status: "completed",
      completed_cells: 3,
      captured_cells: 1,
      reused_cells: 2,
      checkpoint_count: 1,
      worksheets: [{ conflicts: 1 }],
    });
    expect(interruptedStore.checkpoints[0].conflict_cells).toBe(1);
  });

  it("rejects noncontiguous columns and stored evidence bound to another key", async () => {
    expect(() => buildFormulaBarMatrixPlan([{ worksheet: "数学课", rows: [{ row: 8, columns: ["D", "F"] }] }]))
      .toThrow("matrix columns must be contiguous");

    const plan = restrictedPlan(8, 8);
    const wrong = await createEvidence({ worksheet: "数学课", address: "D9" }, source([]));
    const store = memoryStore(new Map([["数学课|8|D", wrong]]));
    await expect(runFormulaBarMatrixLocator({ plan, source: source([]), store }))
      .rejects.toThrow("stored formula-bar evidence identity mismatch");
  });

  it("atomically persists checkpoints, reuses verified evidence, and rejects changed checkpoint bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "jufexk-formula-locator-"));
    const image = join(root, "cell.png");
    const plan = buildFormulaBarMatrixPlan([{
      worksheet: "数学课",
      rows: [{ row: 8, columns: ["D"] }],
    }]);
    const fileSource = source([]);
    fileSource.captureEvidence = async ({ kind }) => ({
      kind,
      path: image,
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
    try {
      await writeFile(image, Uint8Array.from([1, 2, 3]));
      const first = await runFormulaBarMatrixLocator({
        plan,
        source: fileSource,
        store: createFileFormulaBarLocatorStore(root),
      });
      const resumed = await runFormulaBarMatrixLocator({
        plan,
        source: source([]),
        store: createFileFormulaBarLocatorStore(root),
      });
      expect(first).toMatchObject({ captured_cells: 1, reused_cells: 0 });
      expect(resumed).toMatchObject({
        captured_cells: 0,
        reused_cells: 1,
        evidence_content_sha256: first.evidence_content_sha256,
        checkpoint_sha256s: first.checkpoint_sha256s,
      });

      const checkpointPath = join(root, "checkpoints", "0001-数学课-rows8-8.json");
      const tampered = JSON.parse(await readFile(checkpointPath, "utf8"));
      tampered.completed_cells = 0;
      await writeFile(checkpointPath, JSON.stringify(tampered));
      await expect(runFormulaBarMatrixLocator({
        plan,
        source: source([]),
        store: createFileFormulaBarLocatorStore(root),
      })).rejects.toThrow("formula-bar locator checkpoint hash or counts mismatch");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function restrictedPlan(firstRow = 8, lastRow = 9) {
  return buildFormulaBarMatrixPlan([{
    worksheet: "数学课",
    rows: Array.from({ length: lastRow - firstRow + 1 }, (_, index) => ({
      row: firstRow + index,
      columns: ["D", "E", "F"],
    })),
  }]);
}

function source(actions: string[], options: { mismatchAt?: string } = {}): FormulaBarMatrixSource {
  let address = "D8";
  return {
    async locateByAddressBox(target) { address = target.address; actions.push(`locate:${target.address}`); },
    async moveRight(target) { address = target.address; actions.push(`move:${target.address}`); },
    async readActiveAddress() { return address === options.mismatchAt ? "Z999" : address; },
    async readFormulaBar() { return `value-${address}`; },
    async readVisibleCellText() { return `value-${address}`; },
    async captureEvidence({ kind, target }) {
      return { kind, path: `${kind}/${target.worksheet}/${target.address}.png`, sha256: "a".repeat(64) };
    },
    now: () => "2026-07-29T08:00:00.000Z",
  };
}

async function createEvidence(target: FormulaBarTarget, matrixSource: FormulaBarMatrixSource) {
  const { captureFormulaBarCell } = await import("./formula_bar");
  return captureFormulaBarCell(target, matrixSource);
}

function memoryStore(initial = new Map<string, FormulaBarEvidence>()) {
  const evidence = new Map(initial);
  const checkpoints: FormulaBarLocatorCheckpoint[] = [];
  const persistedKeys: string[] = [];
  const store: FormulaBarLocatorStore & {
    evidence: Map<string, FormulaBarEvidence>;
    checkpoints: FormulaBarLocatorCheckpoint[];
    persistedKeys: string[];
  } = {
    evidence,
    checkpoints,
    persistedKeys,
    async loadEvidence(target) {
      const match = /^([A-Z]+)(\d+)$/.exec(target.address)!;
      return evidence.get(`${target.worksheet}|${Number(match[2])}|${match[1]}`) ?? null;
    },
    async persistEvidence(_target, item) {
      if (evidence.has(item.key)) throw new Error(`attempted evidence overwrite: ${item.key}`);
      evidence.set(item.key, item);
      persistedKeys.push(item.key);
    },
    async persistCheckpoint(checkpoint) { checkpoints.push(checkpoint); },
  };
  return store;
}
