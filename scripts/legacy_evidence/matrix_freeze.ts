import { createHash } from "node:crypto";
import { isKnownDirtyCompositionHash } from "./composition_qa";
import {
  validateFormulaBarEvidence,
  type FormulaBarEvidence,
  type FormulaBarTarget,
} from "./formula_bar";
import {
  FROZEN_SHEET_EXTENTS,
  buildFormulaBarMatrixPlan,
  buildFrozenFormulaBarMatrixPlan,
  runFormulaBarMatrixLocator,
  type FormulaBarLocatorStore,
  type FormulaBarMatrixPlan,
  type FormulaBarMatrixSource,
} from "./formula_bar_locator";
import { createFileFormulaBarLocatorStore } from "./formula_bar_locator_store";
import {
  LIVE_LAYOUT_WORKSHEETS,
  validateLiveLayout,
  type LiveLayout,
} from "./live_layout";

export const MATRIX_FREEZE_EXTENT_VERSION = "legacy-matrix-freeze-extent-v1" as const;
export const MATRIX_FREEZE_LOCATE_VERSION = "legacy-matrix-freeze-locate-v1" as const;
export const MATRIX_FREEZE_QA_VERSION = "legacy-matrix-freeze-qa-v1" as const;
export const MATRIX_FREEZE_MANIFEST_VERSION = "legacy-matrix-freeze-manifest-v1" as const;

export const MATRIX_FREEZE_DEFAULT_WORKSHEETS = LIVE_LAYOUT_WORKSHEETS;
export const MATRIX_FREEZE_REQUIRED_WINDOW = { width: 2560, height: 1440 } as const;

export const PROTECTED_FREEZE_OUTPUT_MARKERS = [
  "/smoke-20260818-v1",
  "/smoke-rest-20260818-v1",
  "/formula-bar-full-",
  "/formula-bar-rebuild-",
  "/other-smoke-20260819-v1",
] as const;

export type MatrixFreezeWorksheet = (typeof MATRIX_FREEZE_DEFAULT_WORKSHEETS)[number];

export type MatrixFreezeExtentSheet = {
  worksheet: string;
  first_row: number;
  last_row: number;
  first_column: string;
  last_column: string;
  planned_rows: number;
  planned_cells: number;
  scan_to_end: boolean;
};

export type MatrixFreezeExtent = {
  contract_version: typeof MATRIX_FREEZE_EXTENT_VERSION;
  worksheets: string[];
  sheets: MatrixFreezeExtentSheet[];
  planned_rows: number;
  planned_cells: number;
  layout_sha256: string;
  click_grid: false;
  wrote_tencent_or_business_db: false;
  extent_sha256: string;
};

export type MatrixFreezeCompositionPair = {
  key: string;
  formula_sha256: string;
  cell_sha256: string;
};

export type MatrixFreezeWindowObservation = {
  key: string;
  width?: number;
  height?: number;
  minimized?: boolean;
  method?: "print_window" | "playwright_page" | "copy_from_screen";
  formula_truncated?: boolean;
};

export type MatrixFreezeLocateResult = {
  contract_version: typeof MATRIX_FREEZE_LOCATE_VERSION;
  status: "accepted" | "recapture_required" | "blocked";
  worksheet: string;
  first_row: number;
  last_row: number;
  planned_cells: number;
  reused_cells: number;
  missing_keys: string[];
  stop_key: string | null;
  stop_reason: string | null;
  layout_sha256: string;
  click_grid: false;
  locate_sha256: string;
};

export type MatrixFreezeQa = {
  contract_version: typeof MATRIX_FREEZE_QA_VERSION;
  status: "accepted" | "recapture_required";
  issues: string[];
  recapture_keys: string[];
  formula_truncated_isolated: string[];
  planned_cells: number;
  reused_cells: number;
  layout_sha256: string;
  rewrite_source_json: false;
  click_grid: false;
  wrote_tencent_or_business_db: false;
  qa_sha256: string;
};

export type MatrixFreezeManifest = {
  contract_version: typeof MATRIX_FREEZE_MANIFEST_VERSION;
  plan_sha256: string;
  extent_sha256: string;
  qa_sha256: string;
  layout_sha256: string;
  worksheets: string[];
  planned_cells: number;
  reused_record_sha256s: Record<string, string>;
  formula_truncated_isolated: string[];
  click_grid: false;
  wrote_tencent_or_business_db: false;
  manifest_sha256: string;
};

export function frozenSheetExtent(worksheet: string) {
  const sheet = FROZEN_SHEET_EXTENTS.find((item) => item.worksheet === worksheet);
  if (!sheet) throw new Error(`unknown frozen worksheet: ${worksheet}`);
  return sheet;
}

export function requireMatrixFreezeLiveLayout(layout: LiveLayout | null | undefined): LiveLayout {
  if (layout == null) {
    throw new Error("live layout SHA is required before locate / freeze");
  }
  validateLiveLayout(layout);
  return layout;
}

export function assertMatrixFreezeRangeAllowed(
  sheets: readonly Pick<MatrixFreezeExtentSheet, "worksheet" | "first_row" | "last_row">[],
  layout: LiveLayout,
) {
  const mooc = layout.sheets.find((sheet) => sheet.worksheet === "MOOC");
  if (!mooc || mooc.g46_status !== "blocked_locator") return;
  const [smokeFirst, smokeLast] = mooc.smoke_rows;
  for (const sheet of sheets) {
    if (sheet.worksheet !== "MOOC") continue;
    if (sheet.first_row < smokeFirst || sheet.last_row > smokeLast) {
      throw new Error(
        `MOOC rows ${sheet.first_row}-${sheet.last_row} are rejected while G46 is blocked_locator; only smoke rows ${smokeFirst}-${smokeLast} are allowed`,
      );
    }
  }
}

export function bindMatrixFreezeLayout(options: {
  extent: Pick<MatrixFreezeExtent, "layout_sha256" | "sheets">;
  layout?: LiveLayout | null;
}): LiveLayout {
  if (!options.extent.layout_sha256) {
    throw new Error("live layout SHA is required before locate / freeze");
  }
  const layout = requireMatrixFreezeLiveLayout(options.layout);
  if (layout.layout_sha256 !== options.extent.layout_sha256) {
    throw new Error("live layout SHA does not match the bound extent");
  }
  assertMatrixFreezeRangeAllowed(options.extent.sheets, layout);
  return layout;
}

export function normalizeMatrixFreezeWorksheets(worksheets?: readonly string[]) {
  const requested = worksheets?.length ? [...worksheets] : [...MATRIX_FREEZE_DEFAULT_WORKSHEETS];
  const seen = new Set<string>();
  return requested.map((worksheet) => {
    if (!worksheet.trim()) throw new Error("worksheet is required");
    frozenSheetExtent(worksheet);
    if (seen.has(worksheet)) throw new Error(`duplicate worksheet: ${worksheet}`);
    seen.add(worksheet);
    return worksheet;
  });
}

export function scanMatrixFreezeExtents(options: {
  worksheets?: readonly string[];
  first_row?: number;
  last_row?: number;
  layout?: LiveLayout | null;
} = {}): MatrixFreezeExtent {
  const layout = requireMatrixFreezeLiveLayout(options.layout);
  const worksheets = normalizeMatrixFreezeWorksheets(options.worksheets);
  if (options.first_row != null && (!Number.isInteger(options.first_row) || options.first_row < 1)) {
    throw new Error("first_row must be a positive integer");
  }
  if (options.last_row != null && (!Number.isInteger(options.last_row) || options.last_row < 1)) {
    throw new Error("last_row must be a positive integer");
  }
  if (options.first_row != null && options.last_row != null && options.last_row < options.first_row) {
    throw new Error("last_row must be at or after first_row");
  }

  const sheets = worksheets.map((worksheet) => {
    const frozen = frozenSheetExtent(worksheet);
    const firstRow = options.first_row ?? frozen.first_row;
    const clipped = clipBlockedMoocLastRow(worksheet, options.last_row ?? frozen.last_row, options.last_row == null, layout);
    const lastRow = clipped.last_row;
    if (lastRow < firstRow) {
      throw new Error("last_row must be at or after first_row");
    }
    if (firstRow < frozen.first_row || lastRow > frozen.last_row) {
      throw new Error(`row range is outside the scanned frozen extent: ${worksheet} ${firstRow}-${lastRow}`);
    }
    const plannedRows = lastRow - firstRow + 1;
    const plannedCells = plannedRows * columnCount(frozen.first_column, frozen.last_column);
    return {
      worksheet,
      first_row: firstRow,
      last_row: lastRow,
      first_column: frozen.first_column,
      last_column: frozen.last_column,
      planned_rows: plannedRows,
      planned_cells: plannedCells,
      scan_to_end: clipped.scan_to_end,
    };
  });
  assertMatrixFreezeRangeAllowed(sheets, layout);
  const content = {
    contract_version: MATRIX_FREEZE_EXTENT_VERSION,
    worksheets,
    sheets,
    planned_rows: sheets.reduce((total, sheet) => total + sheet.planned_rows, 0),
    planned_cells: sheets.reduce((total, sheet) => total + sheet.planned_cells, 0),
    layout_sha256: layout.layout_sha256,
    click_grid: false as const,
    wrote_tencent_or_business_db: false as const,
  };
  assertNoReviewBodies(content);
  return { ...content, extent_sha256: sha256(stableJson(content)) };
}

export function buildMatrixFreezePlan(extent: MatrixFreezeExtent): FormulaBarMatrixPlan {
  const frozen = buildFrozenFormulaBarMatrixPlan();
  const sheets = extent.sheets.map((layout) => {
    const frozenSheet = frozen.sheets.find((sheet) => sheet.worksheet === layout.worksheet);
    if (!frozenSheet) throw new Error(`frozen matrix is missing sheet: ${layout.worksheet}`);
    const rows = frozenSheet.rows.filter((row) => row.row >= layout.first_row && row.row <= layout.last_row);
    if (rows.length !== layout.last_row - layout.first_row + 1) {
      throw new Error(`freeze rows are not a contiguous frozen subset: ${layout.worksheet}`);
    }
    if (rows[0]?.columns[0] !== layout.first_column || rows[0]?.columns.at(-1) !== layout.last_column) {
      throw new Error(`freeze columns drift from frozen matrix: ${layout.worksheet}`);
    }
    return { worksheet: layout.worksheet, rows };
  });
  return buildFormulaBarMatrixPlan(sheets);
}

export function createMatrixFreezeLocatorStore(options: {
  writeRoot: string;
  reuseRoot?: string;
}): FormulaBarLocatorStore {
  const write = createFileFormulaBarLocatorStore(options.writeRoot);
  const reuse = options.reuseRoot && options.reuseRoot !== options.writeRoot
    ? createFileFormulaBarLocatorStore(options.reuseRoot)
    : null;
  return {
    async loadEvidence(target) {
      return await write.loadEvidence(target) ?? (reuse ? await reuse.loadEvidence(target) : null);
    },
    persistEvidence: (target, evidence) => write.persistEvidence(target, evidence),
    persistCheckpoint: (checkpoint) => write.persistCheckpoint(checkpoint),
  };
}

export function reuseOnlyMatrixSource(): FormulaBarMatrixSource {
  const fail = async () => {
    throw new Error("live locate requires a read-only Tencent session; this skeleton only reuses stored locator evidence");
  };
  return {
    locateByAddressBox: fail,
    moveRight: fail,
    readActiveAddress: fail,
    readFormulaBar: fail,
    readVisibleCellText: fail,
    captureEvidence: fail,
    now: () => {
      throw new Error("live locate requires a read-only Tencent session; this skeleton only reuses stored locator evidence");
    },
  };
}

export async function locateMatrixFreezeRange(options: {
  extent: MatrixFreezeExtent;
  worksheet: string;
  store: FormulaBarLocatorStore;
  source?: FormulaBarMatrixSource;
  layout?: LiveLayout | null;
}): Promise<MatrixFreezeLocateResult> {
  bindMatrixFreezeLayout({ extent: options.extent, layout: options.layout });
  const sheet = options.extent.sheets.find((item) => item.worksheet === options.worksheet);
  if (!sheet) throw new Error(`extent is missing worksheet: ${options.worksheet}`);
  const plan = buildMatrixFreezePlan({
    ...options.extent,
    worksheets: [sheet.worksheet],
    sheets: [sheet],
    planned_rows: sheet.planned_rows,
    planned_cells: sheet.planned_cells,
    extent_sha256: options.extent.extent_sha256,
  });
  const missingKeys: string[] = [];
  let reusedCells = 0;
  for (const row of plan.sheets[0]!.rows) {
    for (const column of row.columns) {
      const target = { worksheet: sheet.worksheet, address: `${column}${row.row}` };
      const existing = await options.store.loadEvidence(target);
      if (!existing) {
        missingKeys.push(`${sheet.worksheet}|${row.row}|${column}`);
        continue;
      }
      validateFormulaBarEvidence(existing);
      reusedCells += 1;
    }
  }

  if (missingKeys.length > 0 && !options.source) {
    return hashLocate({
      contract_version: MATRIX_FREEZE_LOCATE_VERSION,
      status: "recapture_required",
      worksheet: sheet.worksheet,
      first_row: sheet.first_row,
      last_row: sheet.last_row,
      planned_cells: sheet.planned_cells,
      reused_cells: reusedCells,
      missing_keys: missingKeys,
      stop_key: missingKeys[0]!,
      stop_reason: "recapture_required",
      layout_sha256: options.extent.layout_sha256,
      click_grid: false,
    });
  }

  const report = await runFormulaBarMatrixLocator({
    plan,
    source: options.source ?? reuseOnlyMatrixSource(),
    store: options.store,
  });
  return hashLocate({
    contract_version: MATRIX_FREEZE_LOCATE_VERSION,
    status: report.status === "completed" ? "accepted" : "blocked",
    worksheet: sheet.worksheet,
    first_row: sheet.first_row,
    last_row: sheet.last_row,
    planned_cells: sheet.planned_cells,
    reused_cells: report.reused_cells,
    missing_keys: [],
    stop_key: report.stop_key,
    stop_reason: report.stop_reason,
    layout_sha256: options.extent.layout_sha256,
    click_grid: false,
  });
}

export function evaluateMatrixFreezeQa(options: {
  extent: MatrixFreezeExtent;
  locates: readonly MatrixFreezeLocateResult[];
  evidence?: readonly FormulaBarEvidence[];
  pairs?: readonly MatrixFreezeCompositionPair[];
  windows?: readonly MatrixFreezeWindowObservation[];
  layout?: LiveLayout | null;
}): MatrixFreezeQa {
  bindMatrixFreezeLayout({ extent: options.extent, layout: options.layout });
  const issues: string[] = [];
  const recaptureKeys = new Set<string>();
  const locateBySheet = new Map(options.locates.map((item) => [item.worksheet, item]));
  for (const sheet of options.extent.sheets) {
    const locate = locateBySheet.get(sheet.worksheet);
    if (!locate) {
      issues.push(`missing locate report: ${sheet.worksheet}`);
      continue;
    }
    if (locate.status === "recapture_required") {
      issues.push(`${sheet.worksheet} stopped as recapture_required`);
      for (const key of locate.missing_keys) recaptureKeys.add(key);
    } else if (locate.status !== "accepted") {
      issues.push(`${sheet.worksheet} locate is ${locate.status}`);
    }
  }
  for (const item of options.evidence ?? []) {
    validateFormulaBarEvidence(item);
    const cellSha = item.evidence.cell_image?.sha256 ?? null;
    const conflictSha = item.evidence.conflict_image?.sha256 ?? null;
    if (cellSha && isKnownDirtyCompositionHash(cellSha)) {
      issues.push(`dirty composition fixture: ${item.key}`);
      recaptureKeys.add(item.key);
    }
    if (conflictSha && isKnownDirtyCompositionHash(conflictSha)) {
      issues.push(`dirty composition fixture: ${item.key}`);
      recaptureKeys.add(item.key);
    }
    if (cellSha && conflictSha && cellSha === conflictSha) {
      issues.push(`formula and cell hashes are identical: ${item.key}`);
      recaptureKeys.add(item.key);
    }
  }
  for (const pair of options.pairs ?? []) {
    if (isKnownDirtyCompositionHash(pair.formula_sha256) || isKnownDirtyCompositionHash(pair.cell_sha256)) {
      issues.push(`dirty composition fixture: ${pair.key}`);
      recaptureKeys.add(pair.key);
    }
    if (pair.formula_sha256 === pair.cell_sha256) {
      issues.push(`formula and cell hashes are identical: ${pair.key}`);
      recaptureKeys.add(pair.key);
    }
  }
  const truncated = new Set<string>();
  for (const window of options.windows ?? []) {
    if (window.formula_truncated) truncated.add(window.key);
    if (window.minimized) {
      issues.push(`window is minimized: ${window.key}`);
      recaptureKeys.add(window.key);
    }
    if (
      (window.width != null || window.height != null)
      && (window.width !== MATRIX_FREEZE_REQUIRED_WINDOW.width
        || window.height !== MATRIX_FREEZE_REQUIRED_WINDOW.height)
    ) {
      issues.push(`window is not 2K: ${window.key} ${window.width ?? "?"}x${window.height ?? "?"}`);
      recaptureKeys.add(window.key);
    }
    if (window.method === "copy_from_screen") {
      issues.push(`CopyFromScreen is not evidence: ${window.key}`);
      recaptureKeys.add(window.key);
    }
  }
  const reusedCells = options.locates.reduce((total, item) => total + item.reused_cells, 0);
  const content = {
    contract_version: MATRIX_FREEZE_QA_VERSION,
    status: issues.length === 0 ? "accepted" as const : "recapture_required" as const,
    issues,
    recapture_keys: [...recaptureKeys].sort(),
    formula_truncated_isolated: [...truncated].sort(),
    planned_cells: options.extent.planned_cells,
    reused_cells: reusedCells,
    layout_sha256: options.extent.layout_sha256,
    rewrite_source_json: false as const,
    click_grid: false as const,
    wrote_tencent_or_business_db: false as const,
  };
  assertNoReviewBodies(content);
  return { ...content, qa_sha256: sha256(stableJson(content)) };
}

export function freezeMatrixManifest(options: {
  extent: MatrixFreezeExtent;
  qa: MatrixFreezeQa;
  evidence: readonly FormulaBarEvidence[];
  layout?: LiveLayout | null;
}): MatrixFreezeManifest {
  bindMatrixFreezeLayout({ extent: options.extent, layout: options.layout });
  if (options.qa.status !== "accepted") {
    throw new Error("cannot freeze a matrix whose composition QA is recapture_required");
  }
  const plan = buildMatrixFreezePlan(options.extent);
  const expectedKeys = plan.sheets.flatMap((sheet) => (
    sheet.rows.flatMap((row) => row.columns.map((column) => `${sheet.worksheet}|${row.row}|${column}`))
  ));
  const byKey = new Map<string, FormulaBarEvidence>();
  for (const item of options.evidence) {
    validateFormulaBarEvidence(item);
    if (byKey.has(item.key)) throw new Error(`duplicate freeze evidence: ${item.key}`);
    byKey.set(item.key, item);
  }
  const reused: Record<string, string> = {};
  for (const key of expectedKeys) {
    const item = byKey.get(key);
    if (!item) throw new Error(`freeze evidence missing: ${key}`);
    reused[key] = item.record_sha256;
  }
  const content = {
    contract_version: MATRIX_FREEZE_MANIFEST_VERSION,
    plan_sha256: plan.plan_sha256,
    extent_sha256: options.extent.extent_sha256,
    qa_sha256: options.qa.qa_sha256,
    layout_sha256: options.extent.layout_sha256,
    worksheets: options.extent.worksheets,
    planned_cells: plan.planned_cells,
    reused_record_sha256s: reused,
    formula_truncated_isolated: options.qa.formula_truncated_isolated,
    click_grid: false as const,
    wrote_tencent_or_business_db: false as const,
  };
  assertNoReviewBodies(content);
  return { ...content, manifest_sha256: sha256(stableJson(content)) };
}

export async function loadPlanEvidence(
  store: FormulaBarLocatorStore,
  plan: FormulaBarMatrixPlan,
): Promise<FormulaBarEvidence[]> {
  const evidence: FormulaBarEvidence[] = [];
  for (const sheet of plan.sheets) {
    for (const row of sheet.rows) {
      for (const column of row.columns) {
        const target: FormulaBarTarget = { worksheet: sheet.worksheet, address: `${column}${row.row}` };
        const item = await store.loadEvidence(target);
        if (item) evidence.push(item);
      }
    }
  }
  return evidence;
}

export function validateMatrixFreezeExtent(value: unknown): asserts value is MatrixFreezeExtent {
  if (!isRecord(value) || value.contract_version !== MATRIX_FREEZE_EXTENT_VERSION
    || !Array.isArray(value.sheets) || typeof value.extent_sha256 !== "string") {
    throw new Error("invalid matrix freeze extent");
  }
  const { extent_sha256: hash, ...content } = value;
  if (sha256(stableJson(content)) !== hash) {
    throw new Error("matrix freeze extent hash mismatch");
  }
}

export function validateMatrixFreezeQa(value: unknown): asserts value is MatrixFreezeQa {
  assertNoReviewBodies(value);
  if (!isRecord(value) || value.contract_version !== MATRIX_FREEZE_QA_VERSION
    || (value.status !== "accepted" && value.status !== "recapture_required")
    || typeof value.qa_sha256 !== "string") {
    throw new Error("invalid matrix freeze QA");
  }
  const { qa_sha256: hash, ...content } = value;
  if (sha256(stableJson(content)) !== hash) {
    throw new Error("matrix freeze QA hash mismatch");
  }
  if (value.wrote_tencent_or_business_db !== false) {
    throw new Error("matrix freeze must not write Tencent sheets or the business database");
  }
}

export function assertMatrixFreezeOutputPath(path: string) {
  const resolved = path.replaceAll("\\", "/");
  if (!resolved.includes("scripts/legacy_evidence/output/")) {
    throw new Error("matrix freeze output must stay inside scripts/legacy_evidence/output");
  }
  if (PROTECTED_FREEZE_OUTPUT_MARKERS.some((marker) => resolved.includes(marker))) {
    throw new Error("matrix freeze output must not overwrite #180, smoke-rest, or an existing formula-bar pack");
  }
}

function clipBlockedMoocLastRow(
  worksheet: string,
  lastRow: number,
  scanToEnd: boolean,
  layout: LiveLayout,
): { last_row: number; scan_to_end: boolean } {
  if (!scanToEnd || worksheet !== "MOOC") return { last_row: lastRow, scan_to_end: scanToEnd };
  const mooc = layout.sheets.find((sheet) => sheet.worksheet === "MOOC");
  if (mooc?.g46_status !== "blocked_locator") return { last_row: lastRow, scan_to_end: scanToEnd };
  return { last_row: mooc.smoke_rows[1], scan_to_end: false };
}

function assertNoReviewBodies(value: unknown) {
  const encoded = JSON.stringify(value);
  if (
    encoded.includes("formula_bar_value")
    || encoded.includes("visible_cell_text")
    || encoded.includes('"comment"')
    || encoded.includes('"body"')
  ) {
    throw new Error("matrix freeze must not include formula text, visible-cell text, comments, or review body");
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashLocate(content: Omit<MatrixFreezeLocateResult, "locate_sha256">): MatrixFreezeLocateResult {
  return { ...content, locate_sha256: sha256(stableJson(content)) };
}

function columnCount(first: string, last: string) {
  return columnNumber(last) - columnNumber(first) + 1;
}

function columnNumber(column: string) {
  return [...column.toUpperCase()].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0);
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
