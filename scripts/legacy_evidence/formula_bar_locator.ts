import { createHash } from "node:crypto";
import {
  captureFormulaBarCell,
  type FormulaBarCellSource,
  type FormulaBarEvidence,
  type FormulaBarTarget,
  validateFormulaBarEvidence,
} from "./formula_bar";

export const FORMULA_BAR_MATRIX_PLAN_VERSION = "formula-bar-matrix-plan-v1" as const;
export const FORMULA_BAR_CHECKPOINT_VERSION = "formula-bar-locator-checkpoint-v1" as const;
export const FORMULA_BAR_LOCATOR_REPORT_VERSION = "formula-bar-locator-report-v1" as const;

export const FROZEN_SHEET_EXTENTS = [
  { worksheet: "主要课程", first_row: 19, last_row: 480, first_column: "F", last_column: "M" },
  { worksheet: "数学课", first_row: 8, last_row: 240, first_column: "D", last_column: "J" },
  { worksheet: "美育", first_row: 8, last_row: 201, first_column: "E", last_column: "M" },
  { worksheet: "大英和视听说", first_row: 8, last_row: 203, first_column: "H", last_column: "O" },
  { worksheet: "思政课", first_row: 8, last_row: 205, first_column: "G", last_column: "N" },
  { worksheet: "外教", first_row: 3, last_row: 199, first_column: "G", last_column: "N" },
  { worksheet: "MOOC", first_row: 8, last_row: 199, first_column: "G", last_column: "N" },
  { worksheet: "体育课", first_row: 6, last_row: 211, first_column: "D", last_column: "K" },
] as const;

export type FormulaBarMatrixRow = {
  row: number;
  columns: string[];
};

export type FormulaBarMatrixSheet = {
  worksheet: string;
  rows: FormulaBarMatrixRow[];
  planned_cells: number;
};

export type FormulaBarMatrixPlan = {
  contract_version: typeof FORMULA_BAR_MATRIX_PLAN_VERSION;
  sheets: FormulaBarMatrixSheet[];
  planned_rows: number;
  planned_cells: number;
  plan_sha256: string;
};

export interface FormulaBarMatrixSource extends FormulaBarCellSource {
  moveRight(target: FormulaBarTarget): Promise<void>;
}

export interface FormulaBarLocatorStore {
  loadEvidence(target: FormulaBarTarget): Promise<FormulaBarEvidence | null>;
  persistEvidence(target: FormulaBarTarget, evidence: FormulaBarEvidence): Promise<void>;
  persistCheckpoint(checkpoint: FormulaBarLocatorCheckpoint): Promise<void>;
}

export type FormulaBarLocatorCheckpoint = {
  contract_version: typeof FORMULA_BAR_CHECKPOINT_VERSION;
  plan_sha256: string;
  sequence: number;
  worksheet: string;
  first_row: number;
  last_row: number;
  first_address: string;
  last_address: string;
  planned_rows: number;
  planned_cells: number;
  completed_cells: number;
  nonempty_cells: number;
  conflict_cells: number;
  evidence_record_sha256s: string[];
  content_sha256: string;
  checkpoint_sha256: string;
};

export function validateFormulaBarLocatorCheckpoint(value: unknown): asserts value is FormulaBarLocatorCheckpoint {
  if (!isRecord(value) || value.contract_version !== FORMULA_BAR_CHECKPOINT_VERSION
    || typeof value.plan_sha256 !== "string" || !Number.isInteger(value.sequence)
    || typeof value.worksheet !== "string" || typeof value.checkpoint_sha256 !== "string"
    || !Array.isArray(value.evidence_record_sha256s)) {
    throw new Error("invalid formula-bar locator checkpoint");
  }
  const { checkpoint_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.checkpoint_sha256
    || value.content_sha256 !== sha256(stableJson(value.evidence_record_sha256s))
    || value.planned_cells !== value.completed_cells
    || value.completed_cells !== value.evidence_record_sha256s.length) {
    throw new Error("formula-bar locator checkpoint hash or counts mismatch");
  }
}

export function buildFrozenFormulaBarMatrixPlan(): FormulaBarMatrixPlan {
  return buildFormulaBarMatrixPlan(FROZEN_SHEET_EXTENTS.map((sheet) => ({
    worksheet: sheet.worksheet,
    rows: range(sheet.first_row, sheet.last_row).map((row) => ({
      row,
      columns: columnRange(sheet.first_column, sheet.last_column),
    })),
  })));
}

export function buildFormulaBarMatrixPlan(
  sheets: Array<{ worksheet: string; rows: FormulaBarMatrixRow[] }>,
): FormulaBarMatrixPlan {
  const keys = new Set<string>();
  const normalizedSheets = sheets.map((sheet) => {
    if (!sheet.worksheet.trim() || sheet.rows.length === 0) throw new Error("matrix sheet must contain rows");
    let previousRow = 0;
    const rows = sheet.rows.map((entry) => {
      if (!Number.isInteger(entry.row) || entry.row <= previousRow || entry.columns.length === 0) {
        throw new Error(`invalid matrix row order: ${sheet.worksheet}|${entry.row}`);
      }
      previousRow = entry.row;
      let previousColumn = 0;
      const columns = entry.columns.map((column) => {
        const normalized = column.toUpperCase();
        const number = columnNumber(normalized);
        if (!/^[A-Z]+$/.test(normalized) || number !== previousColumn + 1 && previousColumn !== 0) {
          throw new Error(`matrix columns must be contiguous: ${sheet.worksheet}|${entry.row}|${normalized}`);
        }
        previousColumn = number;
        const key = `${sheet.worksheet}|${entry.row}|${normalized}`;
        if (keys.has(key)) throw new Error(`duplicate matrix key: ${key}`);
        keys.add(key);
        return normalized;
      });
      return { row: entry.row, columns };
    });
    return { worksheet: sheet.worksheet, rows, planned_cells: rows.reduce((total, row) => total + row.columns.length, 0) };
  });
  const content = {
    contract_version: FORMULA_BAR_MATRIX_PLAN_VERSION,
    sheets: normalizedSheets,
    planned_rows: normalizedSheets.reduce((total, sheet) => total + sheet.rows.length, 0),
    planned_cells: normalizedSheets.reduce((total, sheet) => total + sheet.planned_cells, 0),
  };
  return { ...content, plan_sha256: sha256(stableJson(content)) };
}

export function validateFormulaBarMatrixPlan(value: unknown): asserts value is FormulaBarMatrixPlan {
  if (!isRecord(value) || value.contract_version !== FORMULA_BAR_MATRIX_PLAN_VERSION
    || !Array.isArray(value.sheets) || typeof value.plan_sha256 !== "string") {
    throw new Error("invalid formula-bar matrix plan");
  }
  const rebuilt = buildFormulaBarMatrixPlan(value.sheets as FormulaBarMatrixSheet[]);
  if (rebuilt.plan_sha256 !== value.plan_sha256 || rebuilt.planned_cells !== value.planned_cells
    || rebuilt.planned_rows !== value.planned_rows) {
    throw new Error("formula-bar matrix plan hash or counts mismatch");
  }
}

export async function runFormulaBarMatrixLocator(options: {
  plan: FormulaBarMatrixPlan;
  source: FormulaBarMatrixSource;
  store: FormulaBarLocatorStore;
  checkpoint_rows?: number;
  force_cell_image_keys?: ReadonlySet<string>;
  acknowledged_halt_keys?: ReadonlySet<string>;
}) {
  validateFormulaBarMatrixPlan(options.plan);
  const checkpointRows = options.checkpoint_rows ?? 25;
  if (!Number.isInteger(checkpointRows) || checkpointRows < 1) throw new Error("checkpoint_rows must be positive");
  const allEvidence: FormulaBarEvidence[] = [];
  const worksheetReports: Array<{ worksheet: string; planned_cells: number; completed_cells: number; conflicts: number }> = [];
  const checkpoints: FormulaBarLocatorCheckpoint[] = [];
  let capturedCells = 0;
  let reusedCells = 0;

  for (const sheet of options.plan.sheets) {
    const sheetEvidence: FormulaBarEvidence[] = [];
    for (let batchStart = 0; batchStart < sheet.rows.length; batchStart += checkpointRows) {
      const batchRows = sheet.rows.slice(batchStart, batchStart + checkpointRows);
      const batchEvidence: FormulaBarEvidence[] = [];
      for (const row of batchRows) {
        let browserPositionKnown = false;
        for (const column of row.columns) {
          const target = { worksheet: sheet.worksheet, address: `${column}${row.row}` };
          const existing = await options.store.loadEvidence(target);
          if (existing) {
            validateFormulaBarEvidence(existing);
            if (existing.key !== `${sheet.worksheet}|${row.row}|${column}`) {
              throw new Error(`stored formula-bar evidence identity mismatch: ${existing.key}`);
            }
            batchEvidence.push(existing);
            sheetEvidence.push(existing);
            allEvidence.push(existing);
            reusedCells += 1;
            browserPositionKnown = false;
            if (existing.halt_batch && !options.acknowledged_halt_keys?.has(existing.key)) {
              return buildLocatorReport(options.plan, worksheetReports, allEvidence, checkpoints, capturedCells, reusedCells, {
                status: "blocked",
                stop_key: existing.key,
                stop_reason: existing.conflict_reason,
              });
            }
            continue;
          }
          if (browserPositionKnown) await options.source.moveRight(target);
          const key = `${sheet.worksheet}|${row.row}|${column}`;
          const evidence = await captureFormulaBarCell(target, options.source, {
            already_located: browserPositionKnown,
            force_cell_image: options.force_cell_image_keys?.has(key) ?? false,
          });
          await options.store.persistEvidence(target, evidence);
          batchEvidence.push(evidence);
          sheetEvidence.push(evidence);
          allEvidence.push(evidence);
          capturedCells += 1;
          browserPositionKnown = true;
          if (evidence.halt_batch) {
            return buildLocatorReport(options.plan, worksheetReports, allEvidence, checkpoints, capturedCells, reusedCells, {
              status: "blocked",
              stop_key: evidence.key,
              stop_reason: evidence.conflict_reason,
            });
          }
        }
      }
      const checkpoint = buildCheckpoint(
        options.plan.plan_sha256,
        checkpoints.length + 1,
        sheet.worksheet,
        batchRows,
        batchEvidence,
      );
      await options.store.persistCheckpoint(checkpoint);
      checkpoints.push(checkpoint);
    }
    if (sheetEvidence.length !== sheet.planned_cells) {
      throw new Error(`worksheet formula-bar count mismatch: ${sheet.worksheet}`);
    }
    worksheetReports.push({
      worksheet: sheet.worksheet,
      planned_cells: sheet.planned_cells,
      completed_cells: sheetEvidence.length,
      conflicts: sheetEvidence.filter((evidence) => evidence.terminal_status === "evidence_conflict").length,
    });
  }
  return buildLocatorReport(options.plan, worksheetReports, allEvidence, checkpoints, capturedCells, reusedCells, {
    status: "completed",
    stop_key: null,
    stop_reason: null,
  });
}

function buildCheckpoint(
  planSha256: string,
  sequence: number,
  worksheet: string,
  rows: FormulaBarMatrixRow[],
  evidence: FormulaBarEvidence[],
): FormulaBarLocatorCheckpoint {
  const plannedCells = rows.reduce((total, row) => total + row.columns.length, 0);
  if (plannedCells !== evidence.length) throw new Error(`checkpoint evidence count mismatch: ${worksheet}`);
  const recordHashes = evidence.map((item) => item.record_sha256);
  const content = {
    contract_version: FORMULA_BAR_CHECKPOINT_VERSION,
    plan_sha256: planSha256,
    sequence,
    worksheet,
    first_row: rows[0].row,
    last_row: rows[rows.length - 1].row,
    first_address: `${rows[0].columns[0]}${rows[0].row}`,
    last_address: `${rows[rows.length - 1].columns.at(-1)}${rows[rows.length - 1].row}`,
    planned_rows: rows.length,
    planned_cells: plannedCells,
    completed_cells: evidence.length,
    nonempty_cells: evidence.filter((item) => item.formula_bar_nonempty === true).length,
    conflict_cells: evidence.filter((item) => item.terminal_status === "evidence_conflict").length,
    evidence_record_sha256s: recordHashes,
    content_sha256: sha256(stableJson(recordHashes)),
  };
  const checkpoint = { ...content, checkpoint_sha256: sha256(stableJson(content)) };
  validateFormulaBarLocatorCheckpoint(checkpoint);
  return checkpoint;
}

function buildLocatorReport(
  plan: FormulaBarMatrixPlan,
  worksheets: Array<{ worksheet: string; planned_cells: number; completed_cells: number; conflicts: number }>,
  evidence: FormulaBarEvidence[],
  checkpoints: FormulaBarLocatorCheckpoint[],
  capturedCells: number,
  reusedCells: number,
  conclusion: { status: "completed" | "blocked"; stop_key: string | null; stop_reason: string | null },
) {
  const content = {
    contract_version: FORMULA_BAR_LOCATOR_REPORT_VERSION,
    plan_sha256: plan.plan_sha256,
    status: conclusion.status,
    stop_key: conclusion.stop_key,
    stop_reason: conclusion.stop_reason,
    planned_cells: plan.planned_cells,
    completed_cells: evidence.length,
    captured_cells: capturedCells,
    reused_cells: reusedCells,
    nonempty_cells: evidence.filter((item) => item.formula_bar_nonempty === true).length,
    conflict_cells: evidence.filter((item) => item.terminal_status === "evidence_conflict").length,
    worksheets,
    checkpoint_count: checkpoints.length,
    checkpoint_sha256s: checkpoints.map((checkpoint) => checkpoint.checkpoint_sha256),
    evidence_content_sha256: sha256(stableJson(evidence.map((item) => item.record_sha256))),
    read_only: evidence.every((item) => item.read_only === true),
  };
  return { ...content, report_sha256: sha256(stableJson(content)) };
}

function range(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function columnRange(first: string, last: string) {
  return range(columnNumber(first), columnNumber(last)).map(columnName);
}

function columnNumber(column: string) {
  return [...column.toUpperCase()].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
}

function columnName(number: number) {
  let value = number;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
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

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
