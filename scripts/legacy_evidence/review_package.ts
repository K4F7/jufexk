import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type FormulaBarEvidence, readFormulaBarEvidence } from "./formula_bar";
import { buildFrozenFormulaBarMatrixPlan } from "./formula_bar_locator";
import { formulaBarEvidencePath } from "./formula_bar_locator_store";

export const REVIEW_PACKAGE_CONTRACT_VERSION = "legacy-review-package-v1" as const;
export const MAX_BATCH_CELLS = 8;
export const LONG_TEXT_BATCH_CELLS = 4;
export const VERY_LONG_TEXT_BATCH_CELLS = 1;
export const LONG_TEXT_CHARS = 400;
export const VERY_LONG_TEXT_CHARS = 800;
export const DEFAULT_MAX_BATCHES = 8;

export type ContextRow = { row: number; course: string; teacher: string; worksheet?: string };
export type ImageOverride = { cell?: string; conflict?: string };
export type OcrEvidence = {
  text?: string;
  confidence?: number | null;
  tokens?: unknown[];
  suspected_miss?: boolean;
};

export type CourseStatus = "clear" | "blank" | "unclear" | "inherited_anchor";
export type TeacherStatus = "clear" | "blank" | "unclear";
export type OverflowStatus = "none" | "extends_right" | "unreadable";
export type VisualCorrespondence = "matches_formula" | "formula_truncated_visible" | "conflict" | "unreadable";

export type CellAnalysis = {
  key: string;
  visible_course: string;
  visible_teacher: string;
  course_status: CourseStatus;
  teacher_status: TeacherStatus;
  overflow: OverflowStatus;
  visual_correspondence: VisualCorrespondence;
  uncertainty_markers: unknown[];
};

export type CellArbitration = {
  key: string;
  selected: "analysis_a" | "analysis_b" | null;
  reason: string;
};

export type ReviewAttempt = {
  task_id: string;
  side: "analysis_a" | "analysis_b" | "arbitration" | "approval";
  status: "completed" | "failed";
  cell_keys: string[];
  error?: string;
};

export type CellApproval = {
  key: string;
  approve: boolean;
  body_matches_source: boolean;
  mapping_supported: boolean;
  evidence: string;
};

export type RoutedCell = {
  key: string;
  worksheet: string;
  row: number;
  column: string;
  terminal_status: FormulaBarEvidence["terminal_status"] | "missing_evidence";
  routing: "not_applicable" | "pending_review" | "unresolved";
  unresolved_reason: string | null;
  recovery_condition: string | null;
  formula_bar_value: string | null;
  formula_bar_text_sha256: string | null;
  formula_bar_visual_conflict: boolean;
  body_source: "formula_bar" | null;
  context: ContextRow | null;
  cell_image: string | null;
  conflict_image: string | null;
  ocr: OcrEvidence | null;
  analysis_a?: CellAnalysis | { unresolved: "agent_exhausted" | "review_not_run" };
  analysis_b?: CellAnalysis | { unresolved: "agent_exhausted" | "review_not_run" };
  arbitration?: CellArbitration | { unresolved: "agent_exhausted" } | null;
  conclusion?: "agreed" | "arbitrated" | "unresolved" | "not_applicable";
  selected?: "analysis_a" | "analysis_b" | null;
  approval?: CellApproval | { unresolved: "agent_exhausted" } | null;
  approved?: boolean;
  visible_course?: string | null;
  visible_teacher?: string | null;
};

export type ReviewBatch = {
  task_id: string;
  worksheet: string;
  keys: string[];
  cells: RoutedCell[];
};

export type ReviewInventory = {
  contract_version: typeof REVIEW_PACKAGE_CONTRACT_VERSION;
  status: "ready" | "empty" | "needs_ocr" | "blocked";
  reason: string;
  input_sha256: string;
  ocr_command: string | null;
  planned_cells: number;
  routed_cells: number;
  pending_cells: number;
  unresolved_cells: number;
  not_applicable_cells: number;
  ocr_missing_cells: number;
  pending_verify_cells: number;
  cells: RoutedCell[];
  pending_batches: ReviewBatch[];
  pending_verify: ReviewBatch[];
};

export type CompiledCell = RoutedCell & {
  conclusion: NonNullable<RoutedCell["conclusion"]>;
  selected: RoutedCell["selected"];
  approved: boolean;
  visible_course?: string | null;
  visible_teacher?: string | null;
};

export type ReviewPackage = {
  contract_version: typeof REVIEW_PACKAGE_CONTRACT_VERSION;
  input_sha256: string;
  status: "completed" | "completed_with_exceptions";
  planned_cells: number;
  routed_cells: number;
  unresolved_cells: number;
  approved_cells: number;
  cells: CompiledCell[];
};

const COURSE_STATUSES = new Set<CourseStatus>(["clear", "blank", "unclear", "inherited_anchor"]);
const TEACHER_STATUSES = new Set<TeacherStatus>(["clear", "blank", "unclear"]);
const OVERFLOW_STATUSES = new Set<OverflowStatus>(["none", "extends_right", "unreadable"]);
const VISUAL_STATUSES = new Set<VisualCorrespondence>([
  "matches_formula", "formula_truncated_visible", "conflict", "unreadable",
]);

function resolveRef(path: string | null | undefined, baseDir?: string) {
  if (!path) return null;
  if (!baseDir || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/")) return path;
  return resolve(baseDir, path);
}

export function parseContextDocument(raw: unknown): ContextRow[] {
  if (Array.isArray(raw)) return raw.map((item) => normalizeContextRow(item));
  if (!isRecord(raw)) throw new Error("context file must be an array or object");
  if (Array.isArray(raw.context_index)) return raw.context_index.map((item) => normalizeContextRow(item));
  if (raw.contract_version === "smoke-context-index-v1" && Array.isArray(raw.sheets)) {
    return raw.sheets.flatMap((sheet) => {
      if (!isRecord(sheet) || typeof sheet.worksheet !== "string" || !Array.isArray(sheet.rows)) {
        throw new Error("invalid smoke context sheet");
      }
      return sheet.rows.map((item) => {
        if (!isRecord(item) || !Number.isInteger(item.row)) throw new Error("invalid smoke context row");
        return normalizeContextRow({
          worksheet: sheet.worksheet,
          row: item.row,
          course: item.visible_course ?? item.course ?? "",
          teacher: item.visible_teacher ?? item.teacher ?? "",
        });
      });
    });
  }
  throw new Error("context file must be an array, {context_index:[]}, or smoke-context-index-v1");
}

function normalizeContextRow(item: unknown): ContextRow {
  if (!isRecord(item) || !Number.isInteger(item.row) || typeof item.course !== "string" || typeof item.teacher !== "string") {
    throw new Error("invalid context row");
  }
  return {
    row: item.row,
    course: item.course,
    teacher: item.teacher,
    ...(typeof item.worksheet === "string" && item.worksheet ? { worksheet: item.worksheet } : {}),
  };
}

function contextFor(item: { worksheet: string; row: number }, rows: ContextRow[]): ContextRow | undefined {
  return rows.find((row) => row.worksheet === item.worksheet && row.row === item.row)
    ?? rows.find((row) => row.worksheet == null && row.row === item.row);
}

function nonemptyText(value: string | null | undefined) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function routeFormulaBarCell(
  evidence: FormulaBarEvidence | { key: string; worksheet: string; row: number; column: string; missing: true },
  options: { context?: ContextRow; ocr?: OcrEvidence | null; image_base_dir?: string; image_override?: ImageOverride } = {},
): RoutedCell {
  if ("missing" in evidence) {
    return baseCell(evidence, {
      terminal_status: "missing_evidence",
      routing: "unresolved",
      unresolved_reason: "missing_review_capture",
      recovery_condition: "recapture this cell in a new frozen formula-bar package",
    });
  }

  const context = options.context && options.context.row === evidence.row ? options.context : options.context ?? null;
  const visualConflict = evidence.correspondence === "visible_text_conflicts_with_formula";
  const cell = baseCell(evidence, {
    terminal_status: evidence.terminal_status,
    formula_bar_value: typeof evidence.formula_bar_value === "string" ? evidence.formula_bar_value : null,
    formula_bar_text_sha256: typeof evidence.formula_bar_text_sha256 === "string" ? evidence.formula_bar_text_sha256 : null,
    formula_bar_visual_conflict: visualConflict,
    body_source: evidence.formula_bar_nonempty === true ? "formula_bar" : null,
    context,
    cell_image: options.image_override?.cell ?? resolveRef(evidence.evidence.cell_image?.path, options.image_base_dir),
    conflict_image: options.image_override?.conflict ?? resolveRef(evidence.evidence.conflict_image?.path, options.image_base_dir),
    ocr: options.ocr ?? null,
  });

  if (evidence.halt_batch === true) {
    return {
      ...cell,
      routing: "unresolved",
      unresolved_reason: evidence.conflict_reason ?? "halt_batch",
      recovery_condition: "relocate by address box, recapture, and freeze a new evidence version",
    };
  }
  if (evidence.terminal_status === "ordinary_blank" || evidence.terminal_status === "horizontal_overflow_blank") {
    return { ...cell, routing: "not_applicable", conclusion: "not_applicable" };
  }
  if (evidence.formula_bar_nonempty !== true) {
    return {
      ...cell,
      routing: "unresolved",
      unresolved_reason: evidence.conflict_reason ?? "formula_bar_empty_conflict",
      recovery_condition: "inspect formula-bar evidence and recapture if the origin cell was missed",
    };
  }
  if (!context) {
    return {
      ...cell,
      routing: "unresolved",
      unresolved_reason: "missing_context",
      recovery_condition: "build the row context index from the frozen course-anchor capture",
    };
  }
  if (!cell.cell_image) {
    return {
      ...cell,
      routing: "unresolved",
      unresolved_reason: "missing_review_capture",
      recovery_condition: "capture the origin cell image in a new frozen package",
    };
  }
  return { ...cell, routing: "pending_review" };
}

export function batchSizeForCells(cells: RoutedCell[]): number {
  const longest = cells.reduce((max, cell) => Math.max(max, cell.formula_bar_value?.length ?? 0), 0);
  if (longest >= VERY_LONG_TEXT_CHARS) return VERY_LONG_TEXT_BATCH_CELLS;
  if (longest >= LONG_TEXT_CHARS) return LONG_TEXT_BATCH_CELLS;
  return MAX_BATCH_CELLS;
}

export function buildReviewBatches(pending: RoutedCell[], options: { max_batches?: number; attempts?: ReviewAttempt[] } = {}): ReviewBatch[] {
  const maxBatches = options.max_batches ?? DEFAULT_MAX_BATCHES;
  const exhausted = exhaustedKeys(options.attempts ?? []);
  const shrinkByKey = shrinkLimits(options.attempts ?? []);
  const available = [...pending]
    .filter((cell) => cell.routing === "pending_review" && !exhausted.has(cell.key))
    .sort(compareCells);
  const batches: ReviewBatch[] = [];
  let index = 0;
  let sequence = 1;
  while (index < available.length && batches.length < maxBatches) {
    const worksheet = available[index].worksheet;
    const take: RoutedCell[] = [];
    let limit = MAX_BATCH_CELLS;
    while (index + take.length < available.length) {
      const next = available[index + take.length];
      if (next.worksheet !== worksheet) break;
      const candidate = [...take, next];
      limit = Math.min(limit, batchSizeForCells(candidate), ...candidate.map((cell) => shrinkByKey.get(cell.key) ?? MAX_BATCH_CELLS));
      if (candidate.length > limit) break;
      take.push(next);
    }
    if (take.length === 0) break;
    batches.push({
      task_id: `batch-${String(sequence).padStart(4, "0")}`,
      worksheet,
      keys: take.map((cell) => cell.key),
      cells: take,
    });
    sequence += 1;
    index += take.length;
  }
  return batches;
}

export function buildReviewInventory(input: {
  evidence: Array<FormulaBarEvidence | { key: string; worksheet: string; row: number; column: string; missing: true }>;
  context_index: ContextRow[];
  ocr_by_key?: Record<string, OcrEvidence>;
  image_base_by_key?: Record<string, string>;
  image_overrides?: Record<string, ImageOverride>;
  worksheet?: string;
  first_row?: number;
  last_row?: number;
  max_batches?: number;
  require_ocr?: boolean;
  inventory_path?: string;
  ocr_dir?: string;
  attempts?: ReviewAttempt[];
  prior_cells?: RoutedCell[];
}): ReviewInventory {
  const priorByKey = new Map((input.prior_cells ?? []).map((cell) => [cell.key, cell]));
  const scoped = input.evidence.filter((item) => inScope(item, input));
  if (scoped.length === 0) {
    return emptyInventory("blocked", "no formula-bar evidence in the requested scope", input);
  }

  const cells = scoped.map((item) => {
    const routed = routeFormulaBarCell(item, {
      context: contextFor(item, input.context_index),
      ocr: input.ocr_by_key?.[item.key] ?? null,
      image_base_dir: input.image_base_by_key?.[item.key],
      image_override: input.image_overrides?.[item.key],
    });
    const prior = priorByKey.get(routed.key);
    if (!prior) return routed;
    return {
      ...routed,
      analysis_a: prior.analysis_a,
      analysis_b: prior.analysis_b,
      arbitration: prior.arbitration,
      conclusion: prior.conclusion,
      selected: prior.selected,
      approval: prior.approval,
      approved: prior.approved === true,
    };
  });

  const exhausted = exhaustedKeys(input.attempts ?? []);
  for (const cell of cells) {
    if (cell.routing !== "pending_review" || exhausted.has(cell.key) === false) continue;
    if (isCompletedAnalysis(cell.analysis_a) && isCompletedAnalysis(cell.analysis_b)) continue;
    cell.routing = "unresolved";
    cell.unresolved_reason = "agent_exhausted";
    cell.recovery_condition = "inspect the failed attempt and rerun only this cell after the payload is fixed";
    cell.analysis_a = cell.analysis_a ?? { unresolved: "agent_exhausted" };
    cell.analysis_b = cell.analysis_b ?? { unresolved: "agent_exhausted" };
    cell.conclusion = "unresolved";
  }

  const pending = cells.filter((cell) => (
    cell.routing === "pending_review"
    && (!isCompletedAnalysis(cell.analysis_a) || !isCompletedAnalysis(cell.analysis_b))
  ));
  const ocrMissing = pending.filter((cell) => cell.ocr == null).length;
  const requireOcr = input.require_ocr !== false;
  const pendingBatches = buildReviewBatches(pending, { max_batches: input.max_batches, attempts: input.attempts });
  const pendingVerify = cells.filter((cell) => eligibleForApproval(cell) && cell.approved !== true);
  const pendingVerifyBatches = buildReviewBatches(pendingVerify, {
    max_batches: input.max_batches,
    attempts: (input.attempts ?? []).filter((attempt) => attempt.side === "approval"),
  });
  const inputSha = inputSha256(scoped, input.context_index, input);
  const ocrCommand = ocrMissing > 0
    ? `uv run --directory scripts/legacy_ocr python ocr_review_cells.py --inventory ${input.inventory_path ?? "<out>/inventory.json"} --out ${input.ocr_dir ?? "<ocr-dir>"}`
    : null;

  let status: ReviewInventory["status"] = pendingBatches.length > 0 || pendingVerifyBatches.length > 0
    ? "ready"
    : pending.length > 0 || pendingVerify.length > 0
      ? "ready"
      : "empty";
  let reason = pendingBatches.length > 0
    ? `${pendingBatches.length} pending review batches`
    : pendingVerifyBatches.length > 0
      ? `${pendingVerifyBatches.length} pending image-text verification batches`
      : pending.length > 0 || pendingVerify.length > 0
        ? "pending cells remain but no batch was emitted"
        : "no pending review cells";
  if (requireOcr && ocrMissing > 0 && pending.length > 0) {
    status = "needs_ocr";
    reason = `${ocrMissing} routed cells are missing CUDA RapidOCR evidence`;
  }

  return {
    contract_version: REVIEW_PACKAGE_CONTRACT_VERSION,
    status,
    reason,
    input_sha256: inputSha,
    ocr_command: ocrCommand,
    planned_cells: cells.length,
    routed_cells: cells.filter((cell) => cell.routing === "pending_review" || cell.conclusion === "agreed" || cell.conclusion === "arbitrated").length,
    pending_cells: pending.length,
    unresolved_cells: cells.filter((cell) => cell.routing === "unresolved" || cell.conclusion === "unresolved").length,
    not_applicable_cells: cells.filter((cell) => cell.routing === "not_applicable").length,
    ocr_missing_cells: ocrMissing,
    pending_verify_cells: pendingVerify.length,
    cells,
    pending_batches: status === "needs_ocr" ? [] : pendingBatches,
    pending_verify: pendingVerifyBatches,
  };
}

export function analysisPayload(batch: ReviewBatch, side: "analysis_a" | "analysis_b") {
  return {
    contract_version: REVIEW_PACKAGE_CONTRACT_VERSION,
    task_id: batch.task_id,
    side,
    cells: batch.cells.map((cell) => {
      const payload: Record<string, unknown> = {
        key: cell.key,
        worksheet: cell.worksheet,
        row: cell.row,
        column: cell.column,
        context: cell.context,
        formula_bar_value: cell.formula_bar_value,
        formula_bar_visual_conflict: cell.formula_bar_visual_conflict,
        images: { cell: cell.cell_image, conflict: cell.conflict_image },
      };
      if (side === "analysis_b") payload.ocr = cell.ocr;
      return payload;
    }),
  };
}

export function eligibleForApproval(cell: RoutedCell) {
  return (cell.conclusion === "agreed" || cell.conclusion === "arbitrated")
    && cell.body_source === "formula_bar"
    && nonemptyText(cell.formula_bar_value) != null
    && nonemptyText(cell.cell_image) != null
    && nonemptyText(cell.context?.course) != null
    && cell.routing !== "unresolved";
}

export function approvalPayload(batch: ReviewBatch) {
  return {
    contract_version: REVIEW_PACKAGE_CONTRACT_VERSION,
    task_id: batch.task_id,
    side: "approval",
    cells: batch.cells.map((cell) => ({
      key: cell.key,
      worksheet: cell.worksheet,
      row: cell.row,
      column: cell.column,
      formula_bar_value: cell.formula_bar_value,
      formula_bar_visual_conflict: cell.formula_bar_visual_conflict,
      visible_course: nonemptyText(cell.visible_course) ?? nonemptyText(cell.context?.course),
      visible_teacher: nonemptyText(cell.visible_teacher) ?? nonemptyText(cell.context?.teacher),
      context: cell.context,
      images: { cell: cell.cell_image, conflict: cell.conflict_image },
    })),
  };
}

export function validateApprovalResponse(keys: string[], response: unknown): CellApproval[] {
  if (!isRecord(response) || !Array.isArray(response.cells)) throw new Error("approval response must contain cells");
  const expected = new Set(keys);
  const seen = new Set<string>();
  const cells: CellApproval[] = [];
  for (const item of response.cells) {
    if (!isRecord(item) || typeof item.key !== "string") throw new Error("invalid approval cell");
    if (!expected.has(item.key)) continue;
    if (seen.has(item.key)) throw new Error(`duplicate approval key: ${item.key}`);
    if (typeof item.approve !== "boolean" || typeof item.body_matches_source !== "boolean"
      || typeof item.mapping_supported !== "boolean" || typeof item.evidence !== "string") {
      throw new Error(`invalid approval cell: ${item.key}`);
    }
    seen.add(item.key);
    cells.push(item as CellApproval);
  }
  return cells;
}

export function applyApprovals(cells: RoutedCell[], verdicts: Map<string, CellApproval | { unresolved: "agent_exhausted" }>): RoutedCell[] {
  return cells.map((cell) => {
    if (cell.approved) return { ...cell, approved: true };
    const verdict = verdicts.get(cell.key);
    if (!verdict) return { ...cell, approved: Boolean(cell.approved) };
    if (isCompletedApproval(verdict) && verdict.approve && verdict.body_matches_source
      && verdict.mapping_supported && nonemptyText(verdict.evidence) != null && eligibleForApproval(cell)) {
      return { ...cell, approval: verdict, approved: true };
    }
    return { ...cell, approval: verdict, approved: false };
  });
}

function isCompletedApproval(value: unknown): value is CellApproval {
  return isRecord(value)
    && typeof value.key === "string"
    && typeof value.approve === "boolean"
    && typeof value.body_matches_source === "boolean"
    && typeof value.mapping_supported === "boolean"
    && typeof value.evidence === "string";
}

export function validateAnalysisResponse(keys: string[], response: unknown): CellAnalysis[] {
  if (!isRecord(response) || !Array.isArray(response.cells)) throw new Error("analysis response must contain cells");
  const expected = new Set(keys);
  const seen = new Set<string>();
  const cells = response.cells.map((item) => {
    if (!isRecord(item) || typeof item.key !== "string" || !expected.has(item.key) || seen.has(item.key)) {
      throw new Error(`unexpected or duplicate analysis key: ${String((item as { key?: string }).key)}`);
    }
    if (typeof item.visible_course !== "string" || typeof item.visible_teacher !== "string"
      || !COURSE_STATUSES.has(item.course_status as CourseStatus)
      || !TEACHER_STATUSES.has(item.teacher_status as TeacherStatus)
      || !OVERFLOW_STATUSES.has(item.overflow as OverflowStatus)
      || !VISUAL_STATUSES.has(item.visual_correspondence as VisualCorrespondence)
      || !Array.isArray(item.uncertainty_markers)) {
      throw new Error(`invalid analysis cell: ${item.key}`);
    }
    seen.add(item.key);
    return item as CellAnalysis;
  });
  if (seen.size !== expected.size) throw new Error("analysis response is missing cells");
  return cells;
}

export function validateArbitrationResponse(keys: string[], response: unknown): CellArbitration[] {
  if (!isRecord(response) || !Array.isArray(response.cells)) throw new Error("arbitration response must contain cells");
  const expected = new Set(keys);
  const seen = new Set<string>();
  const cells: CellArbitration[] = [];
  for (const item of response.cells) {
    if (!isRecord(item) || typeof item.key !== "string") throw new Error("invalid arbitration cell");
    if (!expected.has(item.key)) continue;
    if (seen.has(item.key)) throw new Error(`duplicate arbitration key: ${item.key}`);
    if ((item.selected !== "analysis_a" && item.selected !== "analysis_b" && item.selected !== null)
      || typeof item.reason !== "string") {
      throw new Error(`invalid arbitration cell: ${item.key}`);
    }
    seen.add(item.key);
    cells.push(item as CellArbitration);
  }
  return cells;
}

export function isCompletedAnalysis(value: unknown): value is CellAnalysis {
  return isRecord(value)
    && typeof value.key === "string"
    && typeof value.visible_course === "string"
    && typeof value.visible_teacher === "string"
    && COURSE_STATUSES.has(value.course_status as CourseStatus)
    && TEACHER_STATUSES.has(value.teacher_status as TeacherStatus)
    && OVERFLOW_STATUSES.has(value.overflow as OverflowStatus)
    && VISUAL_STATUSES.has(value.visual_correspondence as VisualCorrespondence)
    && Array.isArray(value.uncertainty_markers);
}

export function isStrictAgreement(left: unknown, right: unknown): boolean {
  if (!isCompletedAnalysis(left) || !isCompletedAnalysis(right)) return false;
  return left.visible_course === right.visible_course
    && left.visible_teacher === right.visible_teacher
    && left.course_status === right.course_status
    && left.teacher_status === right.teacher_status
    && left.overflow === right.overflow
    && left.visual_correspondence === right.visual_correspondence
    && left.uncertainty_markers.length === 0
    && right.uncertainty_markers.length === 0;
}

export function applyAnalyses(
  cells: RoutedCell[],
  analysisA: Map<string, CellAnalysis | { unresolved: "agent_exhausted" }>,
  analysisB: Map<string, CellAnalysis | { unresolved: "agent_exhausted" }>,
): RoutedCell[] {
  return cells.map((cell) => {
    if (cell.routing !== "pending_review" && cell.conclusion !== "agreed" && cell.conclusion !== "arbitrated") {
      return { ...cell, approved: cell.approved === true, conclusion: cell.conclusion ?? (cell.routing === "not_applicable" ? "not_applicable" : "unresolved") };
    }
    const nextA = analysisA.get(cell.key) ?? cell.analysis_a ?? { unresolved: "review_not_run" as const };
    const nextB = analysisB.get(cell.key) ?? cell.analysis_b ?? { unresolved: "review_not_run" as const };
    if (isStrictAgreement(nextA, nextB)) {
      return { ...cell, analysis_a: nextA, analysis_b: nextB, conclusion: "agreed", selected: "analysis_a", approved: cell.approved === true };
    }
    return { ...cell, analysis_a: nextA, analysis_b: nextB, conclusion: cell.conclusion === "arbitrated" ? "arbitrated" : "unresolved", selected: cell.selected ?? null, approved: cell.approved === true };
  });
}

export function disagreements(cells: RoutedCell[]): RoutedCell[] {
  return cells.filter((cell) => (
    cell.routing === "pending_review"
    && isCompletedAnalysis(cell.analysis_a)
    && isCompletedAnalysis(cell.analysis_b)
    && !isStrictAgreement(cell.analysis_a, cell.analysis_b)
    && !(isCompletedArbitration(cell.arbitration) && cell.arbitration.selected)
  ));
}

export function applyArbitration(
  cells: RoutedCell[],
  verdicts: Map<string, CellArbitration | { unresolved: "agent_exhausted" }>,
): RoutedCell[] {
  return cells.map((cell) => {
    const verdict = verdicts.get(cell.key) ?? cell.arbitration ?? null;
    if (!verdict) return { ...cell, approved: cell.approved === true };
    if (isCompletedArbitration(verdict) && verdict.selected && (verdict.selected === "analysis_a" || verdict.selected === "analysis_b")) {
      return { ...cell, arbitration: verdict, conclusion: "arbitrated", selected: verdict.selected, approved: cell.approved === true };
    }
    return {
      ...cell,
      arbitration: verdict,
      conclusion: cell.conclusion === "agreed" ? "agreed" : "unresolved",
      unresolved_reason: cell.conclusion === "agreed" ? cell.unresolved_reason : cell.unresolved_reason ?? "arbitration_unresolved",
      approved: cell.approved === true,
    };
  });
}

export function compileReviewPackage(inventory: ReviewInventory, cells: RoutedCell[]): ReviewPackage {
  const compiled: CompiledCell[] = cells.map((cell) => {
    const selectedAnalysis = selectedMapping(cell);
    return {
      ...cell,
      conclusion: cell.conclusion ?? (cell.routing === "not_applicable" ? "not_applicable" : "unresolved"),
      selected: cell.selected ?? null,
      approved: cell.approved === true,
      visible_course: nonemptyText(selectedAnalysis?.visible_course) ?? nonemptyText(cell.context?.course),
      visible_teacher: nonemptyText(selectedAnalysis?.visible_teacher) ?? nonemptyText(cell.context?.teacher),
    };
  });
  const unresolved = compiled.filter((cell) => cell.conclusion === "unresolved").length;
  const approvedCells = compiled.filter((cell) => cell.approved === true).length;
  return {
    contract_version: REVIEW_PACKAGE_CONTRACT_VERSION,
    input_sha256: inventory.input_sha256,
    status: unresolved > 0 ? "completed_with_exceptions" : "completed",
    planned_cells: compiled.length,
    routed_cells: compiled.filter((cell) => cell.conclusion === "agreed" || cell.conclusion === "arbitrated").length,
    unresolved_cells: unresolved,
    approved_cells: approvedCells,
    cells: compiled,
  };
}

export function selectedMapping(cell: RoutedCell): CellAnalysis | null {
  if (cell.selected === "analysis_a" && isCompletedAnalysis(cell.analysis_a)) return cell.analysis_a;
  if (cell.selected === "analysis_b" && isCompletedAnalysis(cell.analysis_b)) return cell.analysis_b;
  if (cell.conclusion === "agreed" && isCompletedAnalysis(cell.analysis_a)) return cell.analysis_a;
  return null;
}

export async function loadScopedEvidence(options: {
  evidence_dir: string;
  worksheet?: string;
  first_row?: number;
  last_row?: number;
}): Promise<{
  evidence: Array<FormulaBarEvidence | { key: string; worksheet: string; row: number; column: string; missing: true }>;
  image_base_by_key: Record<string, string>;
}> {
  const root = await resolveEvidenceRoot(options.evidence_dir);
  const plan = buildFrozenFormulaBarMatrixPlan();
  const evidence: Array<FormulaBarEvidence | { key: string; worksheet: string; row: number; column: string; missing: true }> = [];
  const image_base_by_key: Record<string, string> = {};
  for (const sheet of plan.sheets) {
    if (options.worksheet && sheet.worksheet !== options.worksheet) continue;
    for (const row of sheet.rows) {
      if (options.first_row != null && row.row < options.first_row) continue;
      if (options.last_row != null && row.row > options.last_row) continue;
      for (const column of row.columns) {
        const target = { worksheet: sheet.worksheet, address: `${column}${row.row}` };
        const path = formulaBarEvidencePath(root, target);
        const key = `${sheet.worksheet}|${row.row}|${column}`;
        try {
          evidence.push(await readFormulaBarEvidence(path));
          image_base_by_key[key] = dirname(path);
        } catch {
          evidence.push({ key, worksheet: sheet.worksheet, row: row.row, column, missing: true });
        }
      }
    }
  }
  return { evidence, image_base_by_key };
}

export async function loadSmokeImageOverrides(smokeRoot: string): Promise<Record<string, ImageOverride>> {
  const root = resolve(smokeRoot);
  const manifest = await readJsonIfExists(join(root, "smoke-manifest.json"));
  const recapture = Array.isArray(manifest?.recapture_keys) ? manifest.recapture_keys as string[] : [];
  const overrides: Record<string, ImageOverride> = {};
  for (const key of recapture) {
    const parts = key.split("|");
    if (parts.length !== 3) continue;
    const [worksheet, row, column] = parts;
    const cell = join(root, "captures", worksheet, `${column}${row}-cell.jpg`);
    const formula = join(root, "captures", worksheet, `${column}${row}-formula.jpg`);
    if (!await fileExists(cell)) continue;
    overrides[key] = { cell, ...(await fileExists(formula) ? { conflict: formula } : {}) };
  }
  return overrides;
}

export async function resolveSmokeEvidenceDir(smokeRoot: string) {
  const inventory = await readJsonIfExists(join(resolve(smokeRoot), "reuse-recapture-inventory.json"));
  const source = typeof inventory?.source_evidence_root === "string" ? inventory.source_evidence_root : "";
  if (!source) return smokeRoot;
  return source.replace(/[\\/]+evidence[\\/]*$/, "") || source;
}

async function fileExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function writeReviewJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

function baseCell(
  source: { key: string; worksheet: string; row: number; column: string },
  overrides: Partial<RoutedCell>,
): RoutedCell {
  return {
    key: source.key,
    worksheet: source.worksheet,
    row: source.row,
    column: source.column,
    terminal_status: "ordinary_blank",
    routing: "unresolved",
    unresolved_reason: null,
    recovery_condition: null,
    formula_bar_value: null,
    formula_bar_text_sha256: null,
    formula_bar_visual_conflict: false,
    body_source: null,
    context: null,
    cell_image: null,
    conflict_image: null,
    ocr: null,
    approved: false,
    ...overrides,
  };
}

function inScope(
  item: { worksheet: string; row: number },
  input: { worksheet?: string; first_row?: number; last_row?: number },
) {
  if (input.worksheet && item.worksheet !== input.worksheet) return false;
  if (input.first_row != null && item.row < input.first_row) return false;
  if (input.last_row != null && item.row > input.last_row) return false;
  return true;
}

function compareCells(left: RoutedCell, right: RoutedCell) {
  if (left.worksheet !== right.worksheet) return left.worksheet.localeCompare(right.worksheet, "zh-CN");
  if (left.row !== right.row) return left.row - right.row;
  return columnRank(left.column) - columnRank(right.column);
}

function columnRank(column: string) {
  let rank = 0;
  for (const char of column.toUpperCase()) rank = rank * 26 + (char.charCodeAt(0) - 64);
  return rank;
}

function exhaustedKeys(attempts: ReviewAttempt[]): Set<string> {
  const failedCounts = new Map<string, number>();
  const recovered = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.cell_keys.length !== 1) continue;
    const key = attempt.cell_keys[0];
    if (attempt.status === "failed") failedCounts.set(key, (failedCounts.get(key) ?? 0) + 1);
    if (attempt.status === "completed") recovered.add(key);
  }
  return new Set([...failedCounts.entries()].filter(([key, count]) => count >= 2 && !recovered.has(key)).map(([key]) => key));
}

function shrinkLimits(attempts: ReviewAttempt[]): Map<string, number> {
  const failures = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.status !== "failed" || attempt.cell_keys.length <= 1) continue;
    const group = [...attempt.cell_keys].sort().join("\n");
    failures.set(group, (failures.get(group) ?? 0) + 1);
  }
  const limits = new Map<string, number>();
  for (const [group, count] of failures) {
    if (count < 2) continue;
    const keys = group.split("\n");
    const next = Math.max(1, Math.floor(keys.length / 2));
    for (const key of keys) limits.set(key, Math.min(limits.get(key) ?? MAX_BATCH_CELLS, next));
  }
  return limits;
}

function isCompletedArbitration(value: unknown): value is CellArbitration {
  return isRecord(value)
    && typeof value.key === "string"
    && (value.selected === "analysis_a" || value.selected === "analysis_b" || value.selected === null)
    && typeof value.reason === "string";
}

function inputSha256(
  evidence: Array<{ record_sha256?: string; key: string }>,
  context: ContextRow[],
  scope: { worksheet?: string; first_row?: number; last_row?: number; require_ocr?: boolean },
) {
  return createHash("sha256").update(JSON.stringify({
    evidence: evidence.map((item) => item.record_sha256 ?? `missing:${item.key}`).sort(),
    context,
    scope: { worksheet: scope.worksheet ?? null, first_row: scope.first_row ?? null, last_row: scope.last_row ?? null },
  })).digest("hex");
}

function emptyInventory(status: ReviewInventory["status"], reason: string, input: { context_index: ContextRow[] }): ReviewInventory {
  return {
    contract_version: REVIEW_PACKAGE_CONTRACT_VERSION,
    status,
    reason,
    input_sha256: inputSha256([], input.context_index, {}),
    ocr_command: null,
    planned_cells: 0,
    routed_cells: 0,
    pending_cells: 0,
    unresolved_cells: 0,
    not_applicable_cells: 0,
    ocr_missing_cells: 0,
    pending_verify_cells: 0,
    cells: [],
    pending_batches: [],
    pending_verify: [],
  };
}

async function resolveEvidenceRoot(evidenceDir: string) {
  const resolved = resolve(evidenceDir);
  const entries = await readdir(resolved, { withFileTypes: true }).catch(() => []);
  if (entries.some((entry) => entry.isDirectory() && entry.name === "evidence")) return resolved;
  if (resolved.replaceAll("\\", "/").endsWith("/evidence")) return dirname(resolved);
  return resolved;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readJsonIfExists(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
