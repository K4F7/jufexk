import { createHash } from "node:crypto";
import { validateFormulaBarEvidence, type FormulaBarEvidence } from "./formula_bar";
import {
  validateFormulaBarLocatorCheckpoint,
  validateFormulaBarMatrixPlan,
  type FormulaBarLocatorCheckpoint,
  type FormulaBarMatrixPlan,
  type FormulaBarMatrixRow,
  type FormulaBarMatrixSheet,
} from "./formula_bar_locator";

export const FORMULA_BAR_FULL_SCAN_AUDIT_VERSION = "formula-bar-full-scan-audit-v1" as const;

export function auditFormulaBarFullScan(options: {
  plan: FormulaBarMatrixPlan;
  evidence: FormulaBarEvidence[];
  checkpoints: FormulaBarLocatorCheckpoint[];
  strong_keys: ReadonlySet<string>;
  expected_strong_key_count?: number;
  checkpoint_rows?: number;
}) {
  validateFormulaBarMatrixPlan(options.plan);
  const checkpointRows = options.checkpoint_rows ?? 25;
  if (!Number.isInteger(checkpointRows) || checkpointRows < 1) throw new Error("checkpoint_rows must be positive");
  if (options.expected_strong_key_count !== undefined
    && options.strong_keys.size !== options.expected_strong_key_count) {
    throw new Error("strong-suspect key count mismatch");
  }

  const expectedKeys: string[] = [];
  const expectedBySheet = new Map<string, string[]>();
  for (const sheet of options.plan.sheets) {
    const keys = sheet.rows.flatMap((row) => row.columns.map((column) => `${sheet.worksheet}|${row.row}|${column}`));
    expectedBySheet.set(sheet.worksheet, keys);
    expectedKeys.push(...keys);
  }
  const expectedSet = new Set(expectedKeys);
  for (const key of options.strong_keys) {
    if (!expectedSet.has(key)) throw new Error(`strong-suspect key is outside frozen plan: ${key}`);
  }

  const byKey = new Map<string, FormulaBarEvidence>();
  for (const item of options.evidence) {
    validateFormulaBarEvidence(item);
    if (byKey.has(item.key)) throw new Error(`duplicate full-scan evidence key: ${item.key}`);
    if (!expectedSet.has(item.key)) throw new Error(`full-scan evidence is outside frozen plan: ${item.key}`);
    byKey.set(item.key, item);
  }
  if (byKey.size !== expectedKeys.length) {
    const firstMissing = expectedKeys.find((key) => !byKey.has(key));
    throw new Error(`full-scan evidence coverage mismatch${firstMissing ? `: missing ${firstMissing}` : ""}`);
  }

  let nonemptyCells = 0;
  let conflictCells = 0;
  let cellImages = 0;
  let conflictImages = 0;
  let haltBatchCells = 0;
  const terminalCounts: Record<string, number> = {};
  for (const key of expectedKeys) {
    const item = byKey.get(key)! as FormulaBarEvidence & Record<string, any>;
    const acknowledgedHalt = item.halt_batch === true
      && item.terminal_status === "evidence_conflict"
      && (item.conflict_reason === "active_address_mismatch"
        || item.conflict_reason === "formula_bar_reads_mismatch");
    if ((item.halt_batch !== false && !acknowledgedHalt) || item.read_only !== true) {
      throw new Error(`full-scan evidence is not a terminal read-only record: ${key}`);
    }
    const cellImage = item.evidence.cell_image;
    const conflictImage = item.evidence.conflict_image;
    const strong = options.strong_keys.has(key);
    if (acknowledgedHalt) {
      haltBatchCells += 1;
      if (cellImage !== null) {
        throw new Error(`halted conflict has redundant cell screenshot: ${key}`);
      }
    } else if (item.formula_bar_nonempty === true) {
      nonemptyCells += 1;
      if (!cellImage || item.cell_image_reason !== "formula_nonempty") {
        throw new Error(`nonempty formula lacks original screenshot: ${key}`);
      }
    } else if (strong) {
      if (!cellImage || item.cell_image_reason !== "forced_scope") {
        throw new Error(`strong-suspect cell lacks forced screenshot: ${key}`);
      }
    } else if (cellImage !== null || item.cell_image_reason !== null) {
      throw new Error(`ordinary formula-empty cell has redundant screenshot: ${key}`);
    }
    if (item.terminal_status === "evidence_conflict") {
      conflictCells += 1;
      if (!conflictImage) throw new Error(`visual conflict lacks conflict screenshot: ${key}`);
    } else if (conflictImage !== null) {
      throw new Error(`non-conflict cell has redundant conflict screenshot: ${key}`);
    }
    if (cellImage) cellImages += 1;
    if (conflictImage) conflictImages += 1;
    terminalCounts[item.terminal_status] = (terminalCounts[item.terminal_status] ?? 0) + 1;
  }

  const expectedBatches = options.plan.sheets.flatMap((sheet) => {
    const batches: Array<{ sheet: FormulaBarMatrixSheet; rows: FormulaBarMatrixRow[] }> = [];
    for (let start = 0; start < sheet.rows.length; start += checkpointRows) {
      batches.push({ sheet, rows: sheet.rows.slice(start, start + checkpointRows) });
    }
    return batches;
  });
  if (options.checkpoints.length !== expectedBatches.length) {
    throw new Error("full-scan checkpoint coverage mismatch");
  }
  const checkpointHashes: string[] = [];
  expectedBatches.forEach(({ sheet, rows }, index) => {
    const checkpoint = options.checkpoints[index];
    validateFormulaBarLocatorCheckpoint(checkpoint);
    const keys = rows.flatMap((row) => row.columns.map((column) => `${sheet.worksheet}|${row.row}|${column}`));
    const hashes = keys.map((key) => byKey.get(key)!.record_sha256);
    if (checkpoint.sequence !== index + 1 || checkpoint.plan_sha256 !== options.plan.plan_sha256
      || checkpoint.worksheet !== sheet.worksheet || checkpoint.first_row !== rows[0].row
      || checkpoint.last_row !== rows.at(-1)!.row || checkpoint.planned_rows !== rows.length
      || checkpoint.completed_cells !== keys.length
      || stableJson(checkpoint.evidence_record_sha256s) !== stableJson(hashes)) {
      throw new Error(`full-scan checkpoint does not bind its frozen matrix batch: ${index + 1}`);
    }
    checkpointHashes.push(checkpoint.checkpoint_sha256);
  });

  const worksheets = options.plan.sheets.map((sheet) => {
    const keys = expectedBySheet.get(sheet.worksheet)!;
    return {
      worksheet: sheet.worksheet,
      planned_cells: sheet.planned_cells,
      completed_cells: keys.length,
      nonempty_cells: keys.filter((key) => byKey.get(key)!.formula_bar_nonempty === true).length,
      conflict_cells: keys.filter((key) => byKey.get(key)!.terminal_status === "evidence_conflict").length,
    };
  });
  const content = {
    contract_version: FORMULA_BAR_FULL_SCAN_AUDIT_VERSION,
    status: "completed" as const,
    plan_sha256: options.plan.plan_sha256,
    planned_rows: options.plan.planned_rows,
    planned_cells: options.plan.planned_cells,
    completed_cells: expectedKeys.length,
    strong_suspect_cells: options.strong_keys.size,
    strong_suspect_keys_sha256: sha256(stableJson([...options.strong_keys].sort())),
    nonempty_cells: nonemptyCells,
    conflict_cells: conflictCells,
    halt_batch_cells: haltBatchCells,
    terminal_counts: terminalCounts,
    cell_image_count: cellImages,
    conflict_image_count: conflictImages,
    worksheets,
    checkpoint_count: checkpointHashes.length,
    checkpoint_sha256s: checkpointHashes,
    evidence_content_sha256: sha256(stableJson(expectedKeys.map((key) => byKey.get(key)!.record_sha256))),
    read_only: true,
  };
  return { ...content, audit_sha256: sha256(stableJson(content)) };
}

function sha256(value: string) {
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
