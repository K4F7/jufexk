import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const OCR_FIRST_CONTRACT_VERSION = "ocr-first-cell-review-v2";

type ReviewColumn = { column: string; display_header: string };
type ContextRow = { row: number; course: string; teacher: string; [key: string]: unknown };
type OcrCell = {
  row: number;
  column: string;
  tokens?: unknown[];
  text?: string;
  confidence?: number | null;
  suspected_miss?: boolean;
  crop?: unknown;
};

type CaptureGap = {
  key: string;
  row: number;
  column: string;
  reason: string;
  recovery_condition: string;
  manifest_sha256: string;
};

type ReviewTaskCell = {
  key: string;
  worksheet: string;
  row: number;
  source_column: string;
  display_header: string;
  context_row: number;
  context: ContextRow;
  image: string;
  ocr?: OcrCell;
};

type ArbitrationTaskCell = Omit<ReviewTaskCell, "ocr"> & {
  analysis_a: CellAnalysis;
  analysis_b: CellAnalysis;
};

type CellAnalysis = {
  key: string;
  raw_transcription: string;
  corrected_text: string;
  edits: unknown[];
  uncertainty_markers: unknown[];
};

export type CellReviewRunnerRequest = {
  contract_version: string;
  task_id: string;
  side: "analysis_a" | "analysis_b";
  model: "gpt-5.6-luna" | "gpt-5.5" | "gpt-5.4";
  attempt: number;
  cells: ReviewTaskCell[];
};

export type CellReviewRunner = (request: CellReviewRunnerRequest) => Promise<{ cells: CellAnalysis[]; session_id?: string }>;

type CellArbitration = {
  key: string;
  selected: "analysis_a" | "analysis_b" | null;
  reason: string;
};

export type CellArbitrationRunnerRequest = {
  contract_version: string;
  task_id: string;
  side: "arbitration";
  model: CellReviewRunnerRequest["model"];
  attempt: number;
  cells: ArbitrationTaskCell[];
};

export type CellArbitrationRunner = (request: CellArbitrationRunnerRequest) => Promise<{ cells: CellArbitration[]; session_id?: string }>;

type CellReviewInput = {
  worksheet: string;
  rows: [number, number];
  review_columns: ReviewColumn[];
  context_index: ContextRow[];
  ocr_cells: OcrCell[];
  capture_gaps: CaptureGap[];
};

export async function runCellReviewWorkflow(options: { inputPath: string; outDir: string; runner?: CellReviewRunner; arbitrator?: CellArbitrationRunner }) {
  const inputPath = resolve(options.inputPath);
  const outDir = resolve(options.outDir);
  const rawInput = await readFile(inputPath, "utf8");
  const input = validateInput(JSON.parse(rawInput));
  const contextByRow = new Map(input.context_index.map((item) => [item.row, item]));
  const ocrByKey = new Map(input.ocr_cells.map((cell) => [`${cell.row}|${cell.column.toUpperCase()}`, cell]));
  const gapByKey = new Map(input.capture_gaps.map((gap) => [`${gap.row}|${gap.column.toUpperCase()}`, gap]));
  const cells: any[] = [];

  for (let row = input.rows[0]; row <= input.rows[1]; row += 1) {
    for (const reviewColumn of input.review_columns) {
      const column = reviewColumn.column.toUpperCase();
      const ocr = ocrByKey.get(`${row}|${column}`);
      const captureGap = gapByKey.get(`${row}|${column}`);
      cells.push({
        key: `${input.worksheet}|${row}|${column}`,
        worksheet: input.worksheet,
        row,
        source_column: column,
        display_header: reviewColumn.display_header,
        context_row: row,
        context: contextByRow.get(row),
        status: captureGap ? "capture_gap" : ocr ? "pending_review" : "blank",
        routing_reason: captureGap ? "missing_capture" : ocr ? "ocr_evidence" : "deterministic_blank",
        ocr: ocr ?? null,
        capture_gap: captureGap ?? null,
      });
    }
  }

  const inputSha256 = createHash("sha256").update(rawInput).digest("hex");
  const expectedCells = (input.rows[1] - input.rows[0] + 1) * input.review_columns.length;
  const uniqueKeys = new Set(cells.map((cell) => cell.key)).size;
  const routedCells = cells.filter((cell) => cell.status === "pending_review").length;
  const captureGapCells = cells.filter((cell) => cell.status === "capture_gap").length;
  const priorMatrix = await readJsonIfExists(resolve(outDir, "matrix.json"));
  const canResume = isRecord(priorMatrix) && priorMatrix.contract_version === OCR_FIRST_CONTRACT_VERSION && priorMatrix.input_sha256 === inputSha256 && Array.isArray(priorMatrix.cells);
  const priorByKey = new Map<string, any>(canResume ? priorMatrix.cells.map((cell: any) => [cell.key, cell]) : []);
  const priorAttempts = canResume ? await readJsonIfExists(resolve(outDir, "attempts.json")) : [];
  const attempts: any[] = Array.isArray(priorAttempts) ? priorAttempts : [];
  const matrix = {
    contract_version: OCR_FIRST_CONTRACT_VERSION,
    input_sha256: inputSha256,
    worksheet: input.worksheet,
    rows: input.rows,
    review_columns: input.review_columns,
    cells,
  };
  if (!canResume) {
    await writeJson(resolve(outDir, "matrix.json"), matrix);
    await writeJson(resolve(outDir, "attempts.json"), attempts);
    await writeJson(resolve(outDir, "status.json"), { status: "running", expected_cells: expectedCells, routed_cells: routedCells, unresolved_cells: routedCells + captureGapCells, capture_gap_cells: captureGapCells });
  }
  const checkpointAttempts = async () => writeJson(resolve(outDir, "attempts.json"), attempts);
  if (routedCells > 0) {
    const routed = cells.filter((cell) => cell.status === "pending_review");
    const sideResults = {
      analysis_a: new Map<string, CellAnalysis | { unresolved: "agent_exhausted" }>(),
      analysis_b: new Map<string, CellAnalysis | { unresolved: "agent_exhausted" }>(),
    };
    for (const side of ["analysis_a", "analysis_b"] as const) {
      for (const cell of routed) {
        const cached = priorByKey.get(cell.key)?.[side];
        if (isCompletedAnalysis(cached)) sideResults[side].set(cell.key, cached);
      }
      for (const attempt of attempts) {
        if (attempt?.side !== side || !isRecord(attempt.raw_response) || !Array.isArray(attempt.raw_response.cells)) continue;
        for (const cached of attempt.raw_response.cells) if (isCompletedAnalysis(cached)) sideResults[side].set(cached.key, cached);
      }
      const pending = routed.filter((cell) => !sideResults[side].has(cell.key));
      if (options.runner) for (let index = 0; index < pending.length; index += 8) {
        await executeReviewBatch(pending.slice(index, index + 8), side, options.runner, sideResults[side], attempts, `batch-${String(index / 8 + 1).padStart(4, "0")}`, checkpointAttempts);
        for (const cell of routed) {
          const completed = sideResults[side].get(cell.key);
          if (isCompletedAnalysis(completed)) cell[side] = completed;
        }
        await writeJson(resolve(outDir, "matrix.json"), matrix);
      }
    }
    const arbitrationResults = new Map<string, CellArbitration | { unresolved: "agent_exhausted" }>();
    for (const attempt of attempts) {
      if (attempt?.side !== "arbitration" || !isRecord(attempt.raw_response) || !Array.isArray(attempt.raw_response.cells)) continue;
      for (const cached of attempt.raw_response.cells) if (isCompletedArbitration(cached) && cached.selected) arbitrationResults.set(cached.key, cached);
    }
    const disagreements = routed.filter((cell) => {
      const analysisA = sideResults.analysis_a.get(cell.key);
      const analysisB = sideResults.analysis_b.get(cell.key);
      if (isStrictAgreement(analysisA, analysisB) || !isCompletedAnalysis(analysisA) || !isCompletedAnalysis(analysisB)) return false;
      const cached = priorByKey.get(cell.key)?.arbitration;
      if (isCompletedArbitration(cached) && cached.selected) arbitrationResults.set(cell.key, cached);
      return !arbitrationResults.has(cell.key);
    });
    if (options.arbitrator) for (let index = 0; index < disagreements.length; index += 8) {
      await executeArbitrationBatch(
        disagreements.slice(index, index + 8), sideResults.analysis_a, sideResults.analysis_b,
        options.arbitrator, arbitrationResults, attempts, `arbitration-${String(index / 8 + 1).padStart(4, "0")}`, checkpointAttempts,
      );
      for (const cell of routed) {
        const completed = arbitrationResults.get(cell.key);
        if (isCompletedArbitration(completed) && completed.selected) cell.arbitration = completed;
      }
      await writeJson(resolve(outDir, "matrix.json"), matrix);
    }
    for (const cell of routed) {
      const analysisA = sideResults.analysis_a.get(cell.key);
      const analysisB = sideResults.analysis_b.get(cell.key);
      const arbitration = arbitrationResults.get(cell.key);
      cell.analysis_a = analysisA ?? { unresolved: "review_not_run" };
      cell.analysis_b = analysisB ?? { unresolved: "review_not_run" };
      cell.arbitration = arbitration ?? null;
      cell.conclusion = isStrictAgreement(analysisA, analysisB) ? "agreed" : isCompletedArbitration(arbitration) && arbitration.selected ? "arbitrated" : "unresolved";
      cell.selected = cell.conclusion === "agreed" ? "analysis_a" : isCompletedArbitration(arbitration) ? arbitration.selected : null;
      cell.unresolved_reason = cell.conclusion === "unresolved"
        ? (isExhausted(analysisA) || isExhausted(analysisB) || isExhausted(arbitration) ? "agent_exhausted" : "arbitration_not_run_or_unresolved")
        : null;
      cell.status = "review";
    }
  }
  for (const cell of cells) if (cell.status === "blank") cell.conclusion = "not_applicable";
  for (const cell of cells) if (cell.status === "capture_gap") {
    cell.conclusion = "unresolved";
    cell.unresolved_reason = cell.capture_gap.reason;
    cell.recovery_condition = cell.capture_gap.recovery_condition;
  }
  const unresolvedCells = cells.filter((cell) => cell.conclusion === "unresolved").length;
  const status = captureGapCells > 0 ? "capture_blocked" : unresolvedCells > 0 ? "completed_with_exceptions" : "completed";
  const validation = {
    valid: uniqueKeys === expectedCells,
    expected_cells: expectedCells,
    actual_cells: cells.length,
    unique_keys: uniqueKeys,
    references_valid: cells.every((cell) => contextByRow.has(cell.context_row)),
  };
  if (!validation.valid || !validation.references_valid) throw new Error("generated matrix failed validation");

  await writeJson(resolve(outDir, "matrix.json"), matrix);
  await writeJson(resolve(outDir, "attempts.json"), attempts);
  await writeJson(resolve(outDir, "validation.json"), validation);
  await writeJson(resolve(outDir, "status.json"), { status, expected_cells: expectedCells, routed_cells: routedCells, unresolved_cells: unresolvedCells, capture_gap_cells: captureGapCells });
  return { status, expected_cells: expectedCells, routed_cells: routedCells, unresolved_cells: unresolvedCells, capture_gap_cells: captureGapCells };
}

async function executeArbitrationBatch(
  sourceCells: any[],
  analysisA: Map<string, CellAnalysis | { unresolved: "agent_exhausted" }>,
  analysisB: Map<string, CellAnalysis | { unresolved: "agent_exhausted" }>,
  runner: CellArbitrationRunner,
  results: Map<string, CellArbitration | { unresolved: "agent_exhausted" }>,
  attempts: any[],
  taskId: string,
  checkpoint: () => Promise<void>,
): Promise<void> {
  sourceCells = sourceCells.filter((cell) => !results.has(cell.key));
  if (sourceCells.length === 0) return;
  const cells: ArbitrationTaskCell[] = sourceCells.map((cell) => ({
    key: cell.key,
    worksheet: cell.worksheet,
    row: cell.row,
    source_column: cell.source_column,
    display_header: cell.display_header,
    context_row: cell.context_row,
    context: cell.context,
    image: typeof cell.ocr?.crop === "string" ? cell.ocr.crop : "",
    analysis_a: analysisA.get(cell.key) as CellAnalysis,
    analysis_b: analysisB.get(cell.key) as CellAnalysis,
  }));
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (await tryArbitrationTask(cells, "gpt-5.6-luna", attempt, taskId, runner, results, attempts, checkpoint)) return;
  }
  if (cells.length > 1) {
    const midpoint = Math.ceil(cells.length / 2);
    await executeArbitrationBatch(sourceCells.slice(0, midpoint), analysisA, analysisB, runner, results, attempts, `${taskId}-a`, checkpoint);
    await executeArbitrationBatch(sourceCells.slice(midpoint), analysisA, analysisB, runner, results, attempts, `${taskId}-b`, checkpoint);
    return;
  }
  if (await tryArbitrationTask(cells, "gpt-5.5", 1, `${taskId}-fallback-55`, runner, results, attempts, checkpoint)) return;
  if (await tryArbitrationTask(cells, "gpt-5.4", 1, `${taskId}-fallback-54`, runner, results, attempts, checkpoint)) return;
  results.set(cells[0].key, { unresolved: "agent_exhausted" });
}

async function tryArbitrationTask(
  cells: ArbitrationTaskCell[], model: CellReviewRunnerRequest["model"], attempt: number, taskId: string,
  runner: CellArbitrationRunner, results: Map<string, CellArbitration | { unresolved: "agent_exhausted" }>, attempts: any[],
  checkpoint: () => Promise<void>,
) {
  const request: CellArbitrationRunnerRequest = { contract_version: OCR_FIRST_CONTRACT_VERSION, task_id: taskId, side: "arbitration", model, attempt, cells };
  const record: any = {
    task_id: taskId, side: "arbitration", model, attempt, cell_keys: cells.map((cell) => cell.key),
    input_sha256: createHash("sha256").update(JSON.stringify(request)).digest("hex"), started_at: new Date().toISOString(),
  };
  try {
    const response = await runner(request);
    const validated = validateArbitrationResponse(cells, response);
    for (const cell of validated) if (cell.selected) results.set(cell.key, cell);
    const unresolved = validated.filter((cell) => !cell.selected).map((cell) => cell.key);
    attempts.push({
      ...record,
      completed_at: new Date().toISOString(),
      status: unresolved.length ? "completed_with_exceptions" : "completed",
      session_id: response.session_id ?? null,
      unresolved_cell_keys: unresolved,
      raw_response: response,
    });
    await checkpoint();
    return unresolved.length === 0;
  } catch (error) {
    attempts.push({ ...record, completed_at: new Date().toISOString(), status: "failed", error: error instanceof Error ? error.message : String(error) });
    await checkpoint();
    return false;
  }
}

async function executeReviewBatch(
  sourceCells: any[],
  side: "analysis_a" | "analysis_b",
  runner: CellReviewRunner,
  results: Map<string, CellAnalysis | { unresolved: "agent_exhausted" }>,
  attempts: any[],
  taskId: string,
  checkpoint: () => Promise<void>,
): Promise<void> {
  const cells: ReviewTaskCell[] = sourceCells.map((cell) => ({
    key: cell.key,
    worksheet: cell.worksheet,
    row: cell.row,
    source_column: cell.source_column,
    display_header: cell.display_header,
    context_row: cell.context_row,
    context: cell.context,
    image: typeof cell.ocr?.crop === "string" ? cell.ocr.crop : "",
    ...(side === "analysis_b" ? { ocr: cell.ocr } : {}),
  }));
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (await tryReviewTask(cells, side, "gpt-5.6-luna", attempt, taskId, runner, results, attempts, checkpoint)) return;
  }
  if (cells.length > 1) {
    const midpoint = Math.ceil(cells.length / 2);
    await executeReviewBatch(sourceCells.slice(0, midpoint), side, runner, results, attempts, `${taskId}-a`, checkpoint);
    await executeReviewBatch(sourceCells.slice(midpoint), side, runner, results, attempts, `${taskId}-b`, checkpoint);
    return;
  }
  if (await tryReviewTask(cells, side, "gpt-5.5", 1, `${taskId}-fallback-55`, runner, results, attempts, checkpoint)) return;
  if (await tryReviewTask(cells, side, "gpt-5.4", 1, `${taskId}-fallback-54`, runner, results, attempts, checkpoint)) return;
  results.set(cells[0].key, { unresolved: "agent_exhausted" });
}

async function tryReviewTask(
  cells: ReviewTaskCell[],
  side: "analysis_a" | "analysis_b",
  model: CellReviewRunnerRequest["model"],
  attempt: number,
  taskId: string,
  runner: CellReviewRunner,
  results: Map<string, CellAnalysis | { unresolved: "agent_exhausted" }>,
  attempts: any[],
  checkpoint: () => Promise<void>,
) {
  const request: CellReviewRunnerRequest = { contract_version: OCR_FIRST_CONTRACT_VERSION, task_id: taskId, side, model, attempt, cells };
  const record: any = {
    task_id: taskId,
    side,
    model,
    attempt,
    cell_keys: cells.map((cell) => cell.key),
    input_sha256: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
    started_at: new Date().toISOString(),
  };
  try {
    const response = await runner(request);
    const validated = validateRunnerResponse(cells, response);
    for (const cell of validated) results.set(cell.key, cell);
    attempts.push({ ...record, completed_at: new Date().toISOString(), status: "completed", session_id: response.session_id ?? null, raw_response: response });
    await checkpoint();
    return true;
  } catch (error) {
    attempts.push({ ...record, completed_at: new Date().toISOString(), status: "failed", error: error instanceof Error ? error.message : String(error) });
    await checkpoint();
    return false;
  }
}

function validateRunnerResponse(cells: ReviewTaskCell[], response: unknown): CellAnalysis[] {
  if (!isRecord(response) || !Array.isArray(response.cells)) throw new Error("review response must contain cells");
  const expected = new Set(cells.map((cell) => cell.key));
  const seen = new Set<string>();
  const validated = response.cells.map((cell) => {
    if (!isRecord(cell) || typeof cell.key !== "string" || typeof cell.raw_transcription !== "string" || typeof cell.corrected_text !== "string" || !Array.isArray(cell.edits) || !Array.isArray(cell.uncertainty_markers)) throw new Error("invalid review response cell");
    if (!expected.has(cell.key) || seen.has(cell.key)) throw new Error(`unexpected or duplicate review response key: ${cell.key}`);
    seen.add(cell.key);
    return cell as CellAnalysis;
  });
  if (seen.size !== expected.size) throw new Error("review response is missing cells");
  return validated;
}

function validateArbitrationResponse(cells: ArbitrationTaskCell[], response: unknown): CellArbitration[] {
  if (!isRecord(response) || !Array.isArray(response.cells)) throw new Error("arbitration response must contain cells");
  const expected = new Set(cells.map((cell) => cell.key));
  const seen = new Set<string>();
  const validated = response.cells.map((cell) => {
    if (!isRecord(cell) || typeof cell.key !== "string" || !["analysis_a", "analysis_b", null].includes(cell.selected) || typeof cell.reason !== "string") throw new Error("invalid arbitration response cell");
    if (!expected.has(cell.key) || seen.has(cell.key)) throw new Error(`unexpected or duplicate arbitration response key: ${cell.key}`);
    seen.add(cell.key);
    return cell as CellArbitration;
  });
  if (seen.size !== expected.size) throw new Error("arbitration response is missing cells");
  return validated;
}

function isExhausted(value: unknown): value is { unresolved: "agent_exhausted" } {
  return isRecord(value) && value.unresolved === "agent_exhausted";
}

function isCompletedAnalysis(value: unknown): value is CellAnalysis {
  return isRecord(value)
    && typeof value.key === "string"
    && typeof value.raw_transcription === "string"
    && typeof value.corrected_text === "string"
    && Array.isArray(value.edits)
    && Array.isArray(value.uncertainty_markers);
}

function isCompletedArbitration(value: unknown): value is CellArbitration {
  return isRecord(value)
    && typeof value.key === "string"
    && ["analysis_a", "analysis_b", null].includes(value.selected)
    && typeof value.reason === "string";
}

function isStrictAgreement(a: CellAnalysis | { unresolved: "agent_exhausted" } | undefined, b: CellAnalysis | { unresolved: "agent_exhausted" } | undefined) {
  if (!a || !b || isExhausted(a) || isExhausted(b)) return false;
  return a.raw_transcription === b.raw_transcription
    && a.corrected_text === a.raw_transcription
    && b.corrected_text === b.raw_transcription
    && a.edits.length === 0
    && b.edits.length === 0
    && a.uncertainty_markers.length === 0
    && b.uncertainty_markers.length === 0;
}

function validateInput(source: unknown): CellReviewInput {
  if (!isRecord(source)) throw new Error("cell review input must be an object");
  if (typeof source.worksheet !== "string" || !source.worksheet) throw new Error("worksheet is required");
  if (!Array.isArray(source.rows) || source.rows.length !== 2 || !source.rows.every(Number.isInteger) || source.rows[0] > source.rows[1]) throw new Error("rows must be an ascending [first,last] pair");
  if (!Array.isArray(source.review_columns) || source.review_columns.length === 0) throw new Error("review_columns are required");
  const columns = source.review_columns.map((item) => {
    if (!isRecord(item) || typeof item.column !== "string" || !/^[A-Z]+$/i.test(item.column) || typeof item.display_header !== "string") throw new Error("invalid review column");
    return { column: item.column.toUpperCase(), display_header: item.display_header };
  });
  if (new Set(columns.map((item) => item.column)).size !== columns.length) throw new Error("duplicate source column");
  if (!Array.isArray(source.context_index)) throw new Error("context_index is required");
  const context = source.context_index.map((item) => {
    if (!isRecord(item) || !Number.isInteger(item.row) || typeof item.course !== "string" || typeof item.teacher !== "string") throw new Error("invalid context row");
    return item as ContextRow;
  });
  const expectedRows = source.rows[1] - source.rows[0] + 1;
  if (context.length !== expectedRows || new Set(context.map((item) => item.row)).size !== expectedRows) throw new Error("context index must cover each source row exactly once");
  for (let row = source.rows[0]; row <= source.rows[1]; row += 1) if (!context.some((item) => item.row === row)) throw new Error(`context row ${row} is missing`);
  if (!Array.isArray(source.ocr_cells)) throw new Error("ocr_cells is required");
  const ocrCells = source.ocr_cells.map((item) => {
    if (!isRecord(item) || !Number.isInteger(item.row) || typeof item.column !== "string") throw new Error("invalid OCR cell");
    const column = item.column.toUpperCase();
    if (item.row < source.rows[0] || item.row > source.rows[1] || !columns.some((candidate) => candidate.column === column)) throw new Error("OCR cell is outside the declared matrix");
    return { ...item, column } as OcrCell;
  });
  const ocrKeys = ocrCells.map((cell) => `${cell.row}|${cell.column}`);
  if (new Set(ocrKeys).size !== ocrKeys.length) throw new Error("duplicate OCR cell");
  const captureGaps = (source.capture_gaps ?? []).map((item) => {
    if (!isRecord(item) || !Number.isInteger(item.row) || typeof item.column !== "string" || typeof item.key !== "string"
      || typeof item.reason !== "string" || typeof item.recovery_condition !== "string" || typeof item.manifest_sha256 !== "string") throw new Error("invalid capture gap");
    const column = item.column.toUpperCase();
    const key = `${source.worksheet}|${item.row}|${column}`;
    if (item.key !== key || item.row < source.rows[0] || item.row > source.rows[1] || !columns.some((candidate) => candidate.column === column)) throw new Error("capture gap is outside the declared matrix");
    return { ...item, column } as CaptureGap;
  });
  const gapKeys = captureGaps.map((gap) => `${gap.row}|${gap.column}`);
  if (new Set(gapKeys).size !== gapKeys.length) throw new Error("duplicate capture gap");
  if (gapKeys.some((key) => ocrKeys.includes(key))) throw new Error("capture gap cannot also contain OCR evidence");
  return { worksheet: source.worksheet, rows: source.rows as [number, number], review_columns: columns, context_index: context, ocr_cells: ocrCells, capture_gaps: captureGaps };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

async function readJsonIfExists(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
}
