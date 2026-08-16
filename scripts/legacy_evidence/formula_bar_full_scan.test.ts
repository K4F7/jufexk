import { describe, expect, it } from "vitest";
import { auditFormulaBarFullScan } from "./formula_bar_full_scan";
import {
  buildFormulaBarMatrixPlan,
  runFormulaBarMatrixLocator,
  type FormulaBarLocatorCheckpoint,
  type FormulaBarLocatorStore,
  type FormulaBarMatrixSource,
} from "./formula_bar_locator";
import type { FormulaBarEvidence } from "./formula_bar";

describe("formula-bar full-scan audit", () => {
  it("proves frozen coverage, screenshot policy, checkpoints, and read-only closure", async () => {
    const plan = buildFormulaBarMatrixPlan([{
      worksheet: "数学课",
      rows: [
        { row: 8, columns: ["D", "E"] },
        { row: 9, columns: ["D", "E"] },
      ],
    }]);
    const store = memoryStore();
    await runFormulaBarMatrixLocator({
      plan,
      source: source(),
      store,
      checkpoint_rows: 1,
      force_cell_image_keys: new Set(["数学课|8|E"]),
    });

    const audit = auditFormulaBarFullScan({
      plan,
      evidence: [...store.evidence.values()],
      checkpoints: store.checkpoints,
      strong_keys: new Set(["数学课|8|E"]),
      expected_strong_key_count: 1,
      checkpoint_rows: 1,
    });

    expect(audit).toMatchObject({
      status: "completed",
      planned_cells: 4,
      completed_cells: 4,
      strong_suspect_cells: 1,
      nonempty_cells: 2,
      checkpoint_count: 2,
      read_only: true,
    });
    expect(audit.audit_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects missing matrix cells and incomplete strong-suspect screenshot scope", async () => {
    const plan = buildFormulaBarMatrixPlan([{
      worksheet: "数学课",
      rows: [{ row: 8, columns: ["D", "E"] }],
    }]);
    const store = memoryStore();
    await runFormulaBarMatrixLocator({ plan, source: source(), store, checkpoint_rows: 1 });
    const evidence = [...store.evidence.values()];

    expect(() => auditFormulaBarFullScan({
      plan,
      evidence: evidence.slice(0, 1),
      checkpoints: store.checkpoints,
      strong_keys: new Set(),
      checkpoint_rows: 1,
    })).toThrow("full-scan evidence coverage mismatch");
    expect(() => auditFormulaBarFullScan({
      plan,
      evidence,
      checkpoints: store.checkpoints,
      strong_keys: new Set(["数学课|8|E"]),
      checkpoint_rows: 1,
    })).toThrow("strong-suspect cell lacks forced screenshot");
  });

  it("accepts an acknowledged address conflict as a complete read-only terminal record", async () => {
    const plan = buildFormulaBarMatrixPlan([{
      worksheet: "数学课",
      rows: [{ row: 8, columns: ["D", "E"] }],
    }]);
    const store = memoryStore();
    await runFormulaBarMatrixLocator({
      plan,
      source: conflictSource("D8"),
      store,
      checkpoint_rows: 1,
    });
    await runFormulaBarMatrixLocator({
      plan,
      source: source(),
      store,
      checkpoint_rows: 1,
      acknowledged_halt_keys: new Set(["数学课|8|D"]),
    });

    const audit = auditFormulaBarFullScan({
      plan,
      evidence: [...store.evidence.values()],
      checkpoints: store.checkpoints,
      strong_keys: new Set(),
      checkpoint_rows: 1,
    });
    expect(audit).toMatchObject({
      status: "completed",
      completed_cells: 2,
      conflict_cells: 1,
      halt_batch_cells: 1,
      terminal_counts: { evidence_conflict: 1 },
    });
  });
});

function source(): FormulaBarMatrixSource {
  let address = "D8";
  return {
    async locateByAddressBox(target) { address = target.address; },
    async moveRight(target) { address = target.address; },
    async readActiveAddress() { return address; },
    async readFormulaBar() { return address.endsWith("8") ? "" : `value-${address}`; },
    async readVisibleCellText() { return address.endsWith("8") ? "" : `value-${address}`; },
    async captureEvidence({ kind, target }) {
      return { kind, path: `${target.address}-${kind}.jpg`, sha256: "a".repeat(64) };
    },
    now: () => "2026-07-29T08:00:00.000Z",
  };
}

function conflictSource(mismatchAt: string): FormulaBarMatrixSource {
  const base = source();
  const read = base.readActiveAddress.bind(base);
  base.readActiveAddress = async () => {
    const address = await read();
    return address === mismatchAt ? "Z999" : address;
  };
  return base;
}

function memoryStore(): FormulaBarLocatorStore & {
  evidence: Map<string, FormulaBarEvidence>;
  checkpoints: FormulaBarLocatorCheckpoint[];
} {
  const evidence = new Map<string, FormulaBarEvidence>();
  const checkpoints: FormulaBarLocatorCheckpoint[] = [];
  return {
    evidence,
    checkpoints,
    async loadEvidence(target) { return evidence.get(key(target.worksheet, target.address)) ?? null; },
    async persistEvidence(_target, item) { evidence.set(item.key, item); },
    async persistCheckpoint(checkpoint) { checkpoints.push(checkpoint); },
  };
}

function key(worksheet: string, address: string) {
  const match = address.match(/^([A-Z]+)(\d+)$/)!;
  return `${worksheet}|${Number(match[2])}|${match[1]}`;
}
