import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  PRODUCTION_GAP_INVENTORY_VERSION,
  type ProductionGapCell,
  type ProductionGapInventory,
  type ProductionGapPartition,
} from "./production_gap";
import { SMOKE_MANIFEST_VERSION } from "./smoke_recapture";

export const SMOKE_REST_CAPTURE_INVENTORY_VERSION = "smoke-rest-capture-inventory-v1" as const;
export const SMOKE_REST_CONTEXT_INDEX_VERSION = "smoke-rest-context-index-v1" as const;
export const SMOKE_REST_ROW_PLAN_VERSION = "smoke-rest-row-plan-v1" as const;
export const SMOKE_REST_CAPTURE_QA_VERSION = "smoke-rest-capture-qa-v1" as const;
export const SMOKE_REST_CAPTURE_MANIFEST_VERSION = "smoke-rest-capture-manifest-v1" as const;
export { SMOKE_MANIFEST_VERSION as SMOKE_CAPTURE_MANIFEST_VERSION };

export const BOUND_PRODUCTION_GAP_INVENTORY_SHA256 = "86cfa237d58c8ad8f4554e96a1a8c4bfc968c66494c502d8c7f4faaccbc4162c" as const;
export const BOUND_SMOKE_CAPTURE_MANIFEST_SHA256 = "59688167b27cc57fdcc8223cb8f47799ef706853d188652285d093d2040339b4" as const;

export const SMOKE_REST_CAPTURE_ORDER = ["体育课", "大英和视听说", "思政课"] as const;
export const SMOKE_REST_OUTPUT_RELATIVE = "scripts/legacy_evidence/output/smoke-rest-20260818-v1" as const;

export const SMOKE_REST_BOUND_NEVER_PACKAGED_COUNTS = {
  体育课: 157,
  大英和视听说: 198,
  思政课: 176,
} as const;

export const SMOKE_REST_BOUND_NEVER_PACKAGED_TOTAL = (
  SMOKE_REST_BOUND_NEVER_PACKAGED_COUNTS.体育课
  + SMOKE_REST_BOUND_NEVER_PACKAGED_COUNTS.大英和视听说
  + SMOKE_REST_BOUND_NEVER_PACKAGED_COUNTS.思政课
);

export const SMOKE_REST_SHEET_LAYOUTS = [
  {
    worksheet: "体育课",
    course_column: "A",
    teacher_column: "B",
    review_first: "D",
    review_last: "K",
    smoke_first_row: 6,
    smoke_last_row: 14,
    first_rest_row: 15,
  },
  {
    worksheet: "大英和视听说",
    course_column: "B",
    teacher_column: "E",
    review_first: "H",
    review_last: "O",
    smoke_first_row: 8,
    smoke_last_row: 14,
    first_rest_row: 15,
  },
  {
    worksheet: "思政课",
    course_column: "A",
    teacher_column: "F",
    review_first: "G",
    review_last: "N",
    smoke_first_row: 8,
    smoke_last_row: 14,
    first_rest_row: 15,
  },
] as const;

export const ENGLISH_TEACHER_REREAD_ROWS = [9, 10, 11, 12, 13, 14] as const;

export const BOUND_SMOKE_RECAPTURE_KEYS = [
  "思政课|8|G",
  "思政课|8|H",
  "思政课|8|I",
  "思政课|8|J",
  "思政课|8|K",
  "思政课|8|L",
  "思政课|8|M",
  "思政课|9|G",
  "思政课|9|H",
  "思政课|9|I",
  "思政课|9|J",
  "思政课|9|K",
  "思政课|9|L",
  "思政课|10|G",
  "思政课|10|H",
  "思政课|10|I",
  "思政课|10|J",
  "思政课|11|G",
  "思政课|11|H",
  "思政课|11|I",
  "思政课|11|J",
  "思政课|12|G",
  "思政课|12|H",
  "思政课|12|I",
  "思政课|12|J",
  "思政课|13|G",
  "思政课|13|H",
  "思政课|13|I",
  "思政课|13|J",
  "思政课|13|K",
  "思政课|13|L",
  "思政课|14|G",
  "体育课|7|G",
  "体育课|10|E",
  "体育课|13|D",
  "大英和视听说|8|H",
  "大英和视听说|14|K",
] as const;

export type SmokeRestWorksheet = (typeof SMOKE_REST_CAPTURE_ORDER)[number];
export type SmokeRestSheetLayout = (typeof SMOKE_REST_SHEET_LAYOUTS)[number];
export type SmokeRestReviewAction = "recapture" | "reuse" | "do_not_recapture" | "skip";
export type SmokeRestQaStatus = "accepted" | "recapture_required" | "manifest_mismatch";
export type SmokeRestRowPlanMode = "recapture_only" | "teacher_reread";

export type SmokeRestInventoryCell = {
  key: string;
  worksheet: string;
  row: number;
  column: string;
  partition: ProductionGapPartition;
  action: SmokeRestReviewAction;
  record_sha256: string | null;
};

export type SmokeRestInventorySheet = {
  worksheet: SmokeRestWorksheet;
  course_column: string;
  teacher_column: string;
  never_packaged: number;
  recapture: number;
  in_production: number;
  packaged_not_imported: number;
  not_a_review: number;
  smoke_row_never_packaged: number;
  never_packaged_rows: number[];
  recapture_rows: number[];
  cells: SmokeRestInventoryCell[];
};

export type SmokeRestCaptureInventory = {
  contract_version: typeof SMOKE_REST_CAPTURE_INVENTORY_VERSION;
  bound_production_gap_inventory_sha256: typeof BOUND_PRODUCTION_GAP_INVENTORY_SHA256;
  bound_smoke_capture_manifest_sha256: typeof BOUND_SMOKE_CAPTURE_MANIFEST_SHA256;
  bound_smoke_capture_manifest_version: typeof SMOKE_MANIFEST_VERSION;
  source_inventory_sha256: string;
  bound: boolean;
  bound_worksheet: SmokeRestWorksheet | null;
  capture_order: typeof SMOKE_REST_CAPTURE_ORDER;
  notes: string[];
  sheets: SmokeRestInventorySheet[];
  recapture_keys: string[];
  later_capture_smoke_keys: string[];
  later_capture_smoke_remaining_keys: string[];
  smoke_row_never_packaged_keys: string[];
  smoke_frozen_recapture_keys: typeof BOUND_SMOKE_RECAPTURE_KEYS;
  reuse_record_sha256s: Record<string, string>;
  do_not_recapture_keys: string[];
  totals: {
    cells: number;
    never_packaged: number;
    recapture: number;
    reuse: number;
    do_not_recapture: number;
    skip: number;
    smoke_row_never_packaged: number;
  };
  click_grid: false;
  inventory_sha256: string;
};

export type SmokeRestTeacherRead = {
  worksheet: string;
  row: number;
  column: string;
  value: string;
};

export type SmokeRestContextRow = {
  row: number;
  review_keys: string[];
  course_column: string;
  teacher_column: string;
  course_cell: string;
  teacher_cell: string;
  teacher_reread: boolean;
  visible_teacher: string | null;
};

export type SmokeRestContextIndex = {
  contract_version: typeof SMOKE_REST_CONTEXT_INDEX_VERSION;
  bound_production_gap_inventory_sha256: typeof BOUND_PRODUCTION_GAP_INVENTORY_SHA256;
  bound_smoke_capture_manifest_sha256: typeof BOUND_SMOKE_CAPTURE_MANIFEST_SHA256;
  source_inventory_sha256: string;
  sheets: Array<{
    worksheet: SmokeRestWorksheet;
    course_column: string;
    teacher_column: string;
    rows: SmokeRestContextRow[];
  }>;
  english_teacher_reread_rows: typeof ENGLISH_TEACHER_REREAD_ROWS;
  context_index_sha256: string;
};

export type SmokeRestRowPlanStep =
  | { type: "assert_view_only" }
  | { type: "select_worksheet"; worksheet: string }
  | { type: "locate"; address: string; role: "course" | "teacher" | "review"; walk_up_if_empty?: boolean }
  | { type: "move_right"; address: string }
  | { type: "capture_pair"; address: string; role: "course" | "teacher" | "review"; recapture: boolean; bind_reuse_sha256: string | null };

export type SmokeRestRowPlan = {
  contract_version: typeof SMOKE_REST_ROW_PLAN_VERSION;
  worksheet: string;
  row: number;
  mode: SmokeRestRowPlanMode;
  click_grid: false;
  steps: SmokeRestRowPlanStep[];
  plan_sha256: string;
};

export type SmokeRestSyntheticCapture = {
  key: string;
  worksheet: string;
  address: string;
  recapture: boolean;
  formula_image_sha256: string;
  cell_image_sha256: string;
};

export type SmokeRestCaptureQa = {
  contract_version: typeof SMOKE_REST_CAPTURE_QA_VERSION;
  status: SmokeRestQaStatus;
  issues: string[];
  never_packaged: number;
  recapture_keys: number;
  later_capture_smoke_remaining_closed: boolean;
  bound_sha_matched: boolean;
  smoke_frozen_keys_excluded: boolean;
  english_teacher_column: "E";
  english_teacher_reread_rows: number;
  recapture_with_distinct_images: number;
  click_grid: false;
  rewrote_smoke_pack: false;
  wrote_tencent_or_business_db: false;
  live_tencent_capture: false;
  read_only: true;
  qa_sha256: string;
};

export type SmokeRestCaptureManifest = {
  contract_version: typeof SMOKE_REST_CAPTURE_MANIFEST_VERSION;
  bound_production_gap_inventory_sha256: typeof BOUND_PRODUCTION_GAP_INVENTORY_SHA256;
  bound_smoke_capture_manifest_sha256: typeof BOUND_SMOKE_CAPTURE_MANIFEST_SHA256;
  bound_smoke_capture_manifest_version: typeof SMOKE_MANIFEST_VERSION;
  inventory_sha256: string;
  context_index_sha256: string;
  qa_status: SmokeRestQaStatus;
  qa_sha256: string;
  recapture_keys: string[];
  reuse_record_sha256s: Record<string, string>;
  capture_order: typeof SMOKE_REST_CAPTURE_ORDER;
  bound_worksheet: SmokeRestWorksheet | null;
  english_teacher_reread_rows: typeof ENGLISH_TEACHER_REREAD_ROWS;
  manifest_sha256: string;
};

const SMOKE_REST_SHEET_SET = new Set<string>(SMOKE_REST_CAPTURE_ORDER);
const SMOKE_FROZEN_RECAPTURE_SET = new Set<string>(BOUND_SMOKE_RECAPTURE_KEYS);

export function smokeRestSheetLayout(worksheet: string): SmokeRestSheetLayout {
  const layout = SMOKE_REST_SHEET_LAYOUTS.find((item) => item.worksheet === worksheet);
  if (!layout) throw new Error(`not a smoke-rest worksheet: ${worksheet}`);
  return layout;
}

export function isSmokeCoveredRow(worksheet: string, row: number) {
  const layout = SMOKE_REST_SHEET_LAYOUTS.find((item) => item.worksheet === worksheet);
  return Boolean(layout && row >= layout.smoke_first_row && row <= layout.smoke_last_row);
}

export function isEnglishTeacherRereadRow(worksheet: string, row: number) {
  return worksheet === "大英和视听说" && (ENGLISH_TEACHER_REREAD_ROWS as readonly number[]).includes(row);
}

export function classifySmokeRestAction(
  partition: ProductionGapPartition,
  worksheet: string,
  row: number,
): SmokeRestReviewAction {
  if (partition === "in_production") return "reuse";
  if (partition === "packaged_not_imported") return "do_not_recapture";
  if (partition === "not_a_review") return "skip";
  if (isSmokeCoveredRow(worksheet, row)) return "do_not_recapture";
  return "recapture";
}

export function bindSmokeRestCaptureInventory(
  productionGap: unknown,
  options: { allowUnboundSha?: boolean; worksheet?: string } = {},
): SmokeRestCaptureInventory {
  const gap = readProductionGapInventory(productionGap);
  const bound = gap.inventory_sha256 === BOUND_PRODUCTION_GAP_INVENTORY_SHA256;
  if (!bound && !options.allowUnboundSha) {
    throw new Error(
      `bind requires production-gap inventory SHA-256 ${BOUND_PRODUCTION_GAP_INVENTORY_SHA256}; pass --allow-unbound-sha for tests`,
    );
  }
  const boundWorksheet = options.worksheet ? smokeRestSheetLayout(options.worksheet).worksheet : null;
  const selectedSheets = boundWorksheet ? [boundWorksheet] : [...SMOKE_REST_CAPTURE_ORDER];
  const selectedSet = new Set<string>(selectedSheets);

  const laterKeys = [...gap.later_capture.smoke.keys];
  if (new Set(laterKeys).size !== laterKeys.length) {
    throw new Error("later_capture.smoke has duplicate keys");
  }
  for (const key of laterKeys) {
    const parsed = parseMatrixKey(key);
    if (!SMOKE_REST_SHEET_SET.has(parsed.worksheet)) {
      throw new Error(`later_capture.smoke includes a non-smoke-rest sheet key: ${key}`);
    }
  }

  const remainingKeys = laterKeys.filter((key) => {
    const parsed = parseMatrixKey(key);
    if (!selectedSet.has(parsed.worksheet)) return false;
    return !isSmokeCoveredRow(parsed.worksheet, parsed.row);
  });

  const cellsBySheet = new Map<SmokeRestWorksheet, ProductionGapCell[]>();
  for (const worksheet of selectedSheets) cellsBySheet.set(worksheet, []);
  for (const cell of gap.cells) {
    if (!selectedSet.has(cell.worksheet) || !isSmokeRestSheet(cell.worksheet)) continue;
    cellsBySheet.get(cell.worksheet)!.push(cell);
  }

  const sheets: SmokeRestInventorySheet[] = [];
  const recaptureKeys: string[] = [];
  const reuseRecordSha256s: Record<string, string> = {};
  const doNotRecaptureKeys: string[] = [];
  const smokeRowNeverPackagedKeys: string[] = [];

  for (const worksheet of selectedSheets) {
    const layout = smokeRestSheetLayout(worksheet);
    rejectObsoleteLetters(layout.worksheet, layout.teacher_column);
    const sourceCells = cellsBySheet.get(worksheet) ?? [];
    if (sourceCells.length === 0 && !bound) continue;
    const cells = sourceCells.map((cell) => {
      const action = classifySmokeRestAction(cell.partition, cell.worksheet, cell.row);
      const mapped: SmokeRestInventoryCell = {
        key: cell.key,
        worksheet: cell.worksheet,
        row: cell.row,
        column: cell.column,
        partition: cell.partition,
        action,
        record_sha256: cell.record_sha256,
      };
      if (action === "recapture") recaptureKeys.push(mapped.key);
      if (action === "reuse" && mapped.record_sha256) reuseRecordSha256s[mapped.key] = mapped.record_sha256;
      if (action === "do_not_recapture") doNotRecaptureKeys.push(mapped.key);
      if (cell.partition === "never_packaged" && isSmokeCoveredRow(cell.worksheet, cell.row)) {
        smokeRowNeverPackagedKeys.push(mapped.key);
      }
      return mapped;
    });
    const recaptureRows = [...new Set(
      cells.filter((cell) => cell.action === "recapture").map((cell) => cell.row),
    )].sort((left, right) => left - right);
    const neverPackagedRows = [...new Set(
      cells.filter((cell) => cell.partition === "never_packaged" && !isSmokeCoveredRow(cell.worksheet, cell.row)).map((cell) => cell.row),
    )].sort((left, right) => left - right);
    sheets.push({
      worksheet,
      course_column: layout.course_column,
      teacher_column: layout.teacher_column,
      never_packaged: cells.filter((cell) => cell.partition === "never_packaged").length,
      recapture: recaptureRows.length === 0 ? 0 : cells.filter((cell) => cell.action === "recapture").length,
      in_production: cells.filter((cell) => cell.action === "reuse").length,
      packaged_not_imported: cells.filter((cell) => cell.partition === "packaged_not_imported").length,
      not_a_review: cells.filter((cell) => cell.action === "skip").length,
      smoke_row_never_packaged: cells.filter((cell) => (
        cell.partition === "never_packaged" && isSmokeCoveredRow(cell.worksheet, cell.row)
      )).length,
      never_packaged_rows: neverPackagedRows,
      recapture_rows: recaptureRows,
      cells,
    });
  }

  assertKeySetsClose(recaptureKeys, remainingKeys);
  for (const key of recaptureKeys) {
    if (SMOKE_FROZEN_RECAPTURE_SET.has(key)) {
      throw new Error(`must not recapture a frozen smoke key: ${key}`);
    }
  }
  if (bound) assertBoundNeverPackagedCounts(sheets, laterKeys.length, boundWorksheet);

  const inventory = {
    contract_version: SMOKE_REST_CAPTURE_INVENTORY_VERSION,
    bound_production_gap_inventory_sha256: BOUND_PRODUCTION_GAP_INVENTORY_SHA256,
    bound_smoke_capture_manifest_sha256: BOUND_SMOKE_CAPTURE_MANIFEST_SHA256,
    bound_smoke_capture_manifest_version: SMOKE_MANIFEST_VERSION,
    source_inventory_sha256: gap.inventory_sha256,
    bound,
    bound_worksheet: boundWorksheet,
    capture_order: SMOKE_REST_CAPTURE_ORDER,
    notes: [
      "No formula text, visible-cell text, or comments are included.",
      "Field-notes letters: 体育课 teacher B, 大英和视听说 course B / teacher E, 思政课 teacher F.",
      "never_packaged outside smoke rows is recapture; smoke-row never_packaged stays frozen; in_production is reuse; packaged_not_imported is do_not_recapture.",
      "Remaining never_packaged keys close 1:1 with later_capture.smoke minus smoke rows.",
      `Lineage smoke-capture-manifest-v1 ${BOUND_SMOKE_CAPTURE_MANIFEST_SHA256}.`,
    ],
    sheets,
    recapture_keys: recaptureKeys,
    later_capture_smoke_keys: laterKeys,
    later_capture_smoke_remaining_keys: remainingKeys,
    smoke_row_never_packaged_keys: smokeRowNeverPackagedKeys,
    smoke_frozen_recapture_keys: BOUND_SMOKE_RECAPTURE_KEYS,
    reuse_record_sha256s: reuseRecordSha256s,
    do_not_recapture_keys: doNotRecaptureKeys,
    totals: {
      cells: sheets.reduce((total, sheet) => total + sheet.cells.length, 0),
      never_packaged: sheets.reduce((total, sheet) => total + sheet.never_packaged, 0),
      recapture: recaptureKeys.length,
      reuse: Object.keys(reuseRecordSha256s).length + sheets.reduce((total, sheet) => (
        total + sheet.cells.filter((cell) => cell.action === "reuse" && !cell.record_sha256).length
      ), 0),
      do_not_recapture: doNotRecaptureKeys.length,
      skip: sheets.reduce((total, sheet) => total + sheet.not_a_review, 0),
      smoke_row_never_packaged: smokeRowNeverPackagedKeys.length,
    },
    click_grid: false as const,
  };
  assertNoReviewBodies(inventory);
  return { ...inventory, inventory_sha256: sha256(stableJson(inventory)) };
}

export function buildSmokeRestContextIndex(
  inventory: SmokeRestCaptureInventory,
  teacherReads: readonly SmokeRestTeacherRead[] = [],
): SmokeRestContextIndex {
  validateSmokeRestCaptureInventory(inventory);
  const readsByRow = new Map<string, SmokeRestTeacherRead>();
  for (const read of teacherReads) {
    const layout = smokeRestSheetLayout(read.worksheet);
    rejectObsoleteLetters(read.worksheet, read.column);
    if (read.column !== layout.teacher_column) {
      throw new Error(`teacher read must use field-notes column ${layout.teacher_column}: ${read.worksheet}|${read.row}|${read.column}`);
    }
    readsByRow.set(`${read.worksheet}|${read.row}`, read);
  }

  const sheets = inventory.sheets.map((sheet) => {
    const layout = smokeRestSheetLayout(sheet.worksheet);
    rejectObsoleteLetters(sheet.worksheet, sheet.teacher_column);
    if (sheet.course_column !== layout.course_column || sheet.teacher_column !== layout.teacher_column) {
      throw new Error(`context letters drifted from field-notes: ${sheet.worksheet}`);
    }
    const rowsByNumber = new Map<number, string[]>();
    for (const cell of sheet.cells) {
      if (cell.action !== "recapture") continue;
      const keys = rowsByNumber.get(cell.row) ?? [];
      keys.push(cell.key);
      rowsByNumber.set(cell.row, keys);
    }
    if (sheet.worksheet === "大英和视听说") {
      for (const row of ENGLISH_TEACHER_REREAD_ROWS) {
        if (!rowsByNumber.has(row)) rowsByNumber.set(row, []);
      }
    }
    const rows = [...rowsByNumber.entries()]
      .sort(([left], [right]) => left - right)
      .map(([row, reviewKeys]) => {
        const read = readsByRow.get(`${sheet.worksheet}|${row}`);
        return {
          row,
          review_keys: reviewKeys,
          course_column: layout.course_column,
          teacher_column: layout.teacher_column,
          course_cell: `${layout.course_column}${row}`,
          teacher_cell: `${layout.teacher_column}${row}`,
          teacher_reread: isEnglishTeacherRereadRow(sheet.worksheet, row),
          visible_teacher: read?.value && read.value.length > 0 ? read.value : null,
        };
      });
    return {
      worksheet: sheet.worksheet,
      course_column: layout.course_column,
      teacher_column: layout.teacher_column,
      rows,
    };
  });
  const content = {
    contract_version: SMOKE_REST_CONTEXT_INDEX_VERSION,
    bound_production_gap_inventory_sha256: BOUND_PRODUCTION_GAP_INVENTORY_SHA256,
    bound_smoke_capture_manifest_sha256: BOUND_SMOKE_CAPTURE_MANIFEST_SHA256,
    source_inventory_sha256: inventory.source_inventory_sha256,
    sheets,
    english_teacher_reread_rows: ENGLISH_TEACHER_REREAD_ROWS,
  };
  assertNoReviewBodies(content);
  return { ...content, context_index_sha256: sha256(stableJson(content)) };
}

export function planSmokeRestRowCapture(
  inventory: SmokeRestCaptureInventory,
  worksheet: string,
  row: number,
): SmokeRestRowPlan {
  validateSmokeRestCaptureInventory(inventory);
  const layout = smokeRestSheetLayout(worksheet);
  rejectObsoleteLetters(worksheet, layout.teacher_column);
  const sheet = inventory.sheets.find((item) => item.worksheet === worksheet);
  if (!sheet) throw new Error(`smoke-rest inventory has no ${worksheet}`);
  if (!Number.isInteger(row) || row < 1) throw new Error(`invalid smoke-rest row: ${row}`);

  const teacherReread = isEnglishTeacherRereadRow(worksheet, row);
  if (isSmokeCoveredRow(worksheet, row) && !teacherReread) {
    throw new Error(`smoke rows are frozen; do not recapture ${worksheet} row ${row}`);
  }

  const recaptures = sheet.cells.filter((cell) => cell.row === row && cell.action === "recapture");
  if (!teacherReread && recaptures.length === 0) {
    throw new Error(`smoke-rest inventory has no recapture cells on ${worksheet} row ${row}`);
  }
  if (teacherReread && recaptures.length > 0) {
    throw new Error(`must not recapture frozen smoke reviews on ${worksheet} row ${row}`);
  }

  const steps: SmokeRestRowPlanStep[] = [
    { type: "assert_view_only" },
    { type: "select_worksheet", worksheet },
  ];

  if (teacherReread) {
    steps.push({ type: "locate", address: `${layout.teacher_column}${row}`, role: "teacher" });
    steps.push({
      type: "capture_pair",
      address: `${layout.teacher_column}${row}`,
      role: "teacher",
      recapture: false,
      bind_reuse_sha256: null,
    });
  } else {
    steps.push({
      type: "locate",
      address: `${layout.course_column}${row}`,
      role: "course",
      walk_up_if_empty: true,
    });
    steps.push({
      type: "capture_pair",
      address: `${layout.course_column}${row}`,
      role: "course",
      recapture: false,
      bind_reuse_sha256: null,
    });
    steps.push({ type: "locate", address: `${layout.teacher_column}${row}`, role: "teacher" });
    steps.push({
      type: "capture_pair",
      address: `${layout.teacher_column}${row}`,
      role: "teacher",
      recapture: false,
      bind_reuse_sha256: null,
    });
    recaptures.forEach((cell, index) => {
      const previous = recaptures[index - 1];
      if (index === 0 || !previous || !contiguousWithPrevious(`${previous.column}${previous.row}`, `${cell.column}${cell.row}`)) {
        steps.push({ type: "locate", address: `${cell.column}${cell.row}`, role: "review" });
      } else {
        steps.push({ type: "move_right", address: `${cell.column}${cell.row}` });
      }
      steps.push({
        type: "capture_pair",
        address: `${cell.column}${cell.row}`,
        role: "review",
        recapture: true,
        bind_reuse_sha256: cell.record_sha256,
      });
    });
  }

  const content = {
    contract_version: SMOKE_REST_ROW_PLAN_VERSION,
    worksheet,
    row,
    mode: teacherReread ? "teacher_reread" as const : "recapture_only" as const,
    click_grid: false as const,
    steps,
  };
  return { ...content, plan_sha256: sha256(stableJson(content)) };
}

export function buildSmokeRestCaptureQa(options: {
  inventory: SmokeRestCaptureInventory;
  contextIndex: SmokeRestContextIndex;
  captures?: readonly SmokeRestSyntheticCapture[];
  reusedRecordSha256s?: ReadonlyMap<string, string>;
  compositionFailures?: readonly { key: string; issues: string[] }[];
}): SmokeRestCaptureQa {
  validateSmokeRestCaptureInventory(options.inventory);
  validateSmokeRestContextIndex(options.contextIndex);
  const issues: string[] = [];
  const inventory = options.inventory;
  const recaptureKeys = inventory.recapture_keys;
  const remainingClosed = sameKeySet(recaptureKeys, inventory.later_capture_smoke_remaining_keys);
  if (!remainingClosed) issues.push("later_capture.smoke remaining is not closed 1:1");
  if (new Set(recaptureKeys).size !== recaptureKeys.length) issues.push("duplicate recapture keys");

  const frozenExcluded = recaptureKeys.every((key) => !SMOKE_FROZEN_RECAPTURE_SET.has(key));
  if (!frozenExcluded) issues.push("frozen smoke recapture keys must not be recaptured");

  for (const sheet of inventory.sheets) {
    const layout = smokeRestSheetLayout(sheet.worksheet);
    if (sheet.course_column !== layout.course_column || sheet.teacher_column !== layout.teacher_column) {
      issues.push(`guessed or obsolete context letters on ${sheet.worksheet}`);
    }
    for (const cell of sheet.cells) {
      const expected = classifySmokeRestAction(cell.partition, cell.worksheet, cell.row);
      if (cell.action !== expected) issues.push(`action mismatch: ${cell.key}`);
    }
  }

  if (inventory.bound) {
    try {
      assertBoundNeverPackagedCounts(
        inventory.sheets,
        inventory.later_capture_smoke_keys.length,
        inventory.bound_worksheet,
      );
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
    if (inventory.source_inventory_sha256 !== BOUND_PRODUCTION_GAP_INVENTORY_SHA256) {
      issues.push("bound inventory SHA-256 does not match BOUND_PRODUCTION_GAP_INVENTORY_SHA256");
    }
  }
  if (inventory.bound_smoke_capture_manifest_sha256 !== BOUND_SMOKE_CAPTURE_MANIFEST_SHA256) {
    issues.push("lineage smoke manifest SHA-256 does not match BOUND_SMOKE_CAPTURE_MANIFEST_SHA256");
  }

  for (const [key, recordSha] of Object.entries(inventory.reuse_record_sha256s)) {
    const previous = options.reusedRecordSha256s?.get(key);
    if (previous && previous !== recordSha) issues.push(`reuse hash changed: ${key}`);
  }

  const captures = options.captures ?? [];
  const captureByKey = new Map<string, SmokeRestSyntheticCapture>();
  for (const capture of captures) {
    if (captureByKey.has(capture.key)) issues.push(`duplicate capture: ${capture.key}`);
    captureByKey.set(capture.key, capture);
  }

  let distinctRecaptureImages = 0;
  for (const key of recaptureKeys) {
    const capture = captureByKey.get(key);
    if (!capture?.formula_image_sha256 || !capture.cell_image_sha256) {
      issues.push(`recapture missing formula/cell images: ${key}`);
      continue;
    }
    if (capture.formula_image_sha256 === capture.cell_image_sha256) {
      issues.push(`recapture formula/cell hash collision: ${key}`);
      continue;
    }
    distinctRecaptureImages += 1;
  }

  const contextRows = new Map<string, SmokeRestContextRow>();
  let englishTeacherRereadRows = 0;
  for (const sheet of options.contextIndex.sheets) {
    const layout = smokeRestSheetLayout(sheet.worksheet);
    if (sheet.course_column !== layout.course_column || sheet.teacher_column !== layout.teacher_column) {
      issues.push(`guessed course/teacher letters on ${sheet.worksheet}`);
    }
    for (const row of sheet.rows) {
      contextRows.set(`${sheet.worksheet}|${row.row}`, row);
      if (row.course_column !== layout.course_column || row.teacher_column !== layout.teacher_column) {
        issues.push(`guessed context on ${sheet.worksheet} row ${row.row}`);
      }
      if (sheet.worksheet === "大英和视听说" && row.teacher_column !== "E") {
        issues.push(`大英和视听说 teacher column must be E on row ${row.row}`);
      }
      if (row.teacher_reread) englishTeacherRereadRows += 1;
    }
  }
  for (const sheet of inventory.sheets) {
    for (const row of sheet.recapture_rows) {
      if (!contextRows.has(`${sheet.worksheet}|${row}`)) {
        issues.push(`context index missing recapture row: ${sheet.worksheet}|${row}`);
      }
    }
  }
  if (inventory.sheets.some((sheet) => sheet.worksheet === "大英和视听说")) {
    for (const row of ENGLISH_TEACHER_REREAD_ROWS) {
      const entry = contextRows.get(`大英和视听说|${row}`);
      if (!entry) {
        issues.push(`context index missing 大英和视听说 teacher reread row ${row}`);
        continue;
      }
      if (entry.teacher_column !== "E" || entry.teacher_cell !== `E${row}` || !entry.teacher_reread) {
        issues.push(`大英和视听说 row ${row} must reread teacher column E`);
      }
      if (!entry.visible_teacher) {
        issues.push(`大英和视听说 row ${row} missing teacher E reread`);
      }
    }
  }

  for (const failure of options.compositionFailures ?? []) {
    issues.push(`composition rejected: ${failure.key}: ${failure.issues.join("; ")}`);
  }

  const identityIssue = issues.some((issue) => (
    issue.includes("hash changed")
    || issue.includes("duplicate")
    || issue.includes("not closed 1:1")
    || issue.includes("bound never_packaged")
    || issue.includes("SHA-256")
    || issue.includes("frozen smoke")
  ));
  const status: SmokeRestQaStatus = identityIssue
    ? "manifest_mismatch"
    : issues.length > 0
      ? "recapture_required"
      : "accepted";

  const content = {
    contract_version: SMOKE_REST_CAPTURE_QA_VERSION,
    status,
    issues,
    never_packaged: inventory.totals.never_packaged,
    recapture_keys: recaptureKeys.length,
    later_capture_smoke_remaining_closed: remainingClosed,
    bound_sha_matched: inventory.bound,
    smoke_frozen_keys_excluded: frozenExcluded,
    english_teacher_column: "E" as const,
    english_teacher_reread_rows: englishTeacherRereadRows,
    recapture_with_distinct_images: distinctRecaptureImages,
    click_grid: false as const,
    rewrote_smoke_pack: false as const,
    wrote_tencent_or_business_db: false as const,
    live_tencent_capture: false as const,
    read_only: true as const,
  };
  assertNoReviewBodies(content);
  return { ...content, qa_sha256: sha256(stableJson(content)) };
}

export function freezeSmokeRestManifest(options: {
  inventory: SmokeRestCaptureInventory;
  contextIndex: SmokeRestContextIndex;
  qa: SmokeRestCaptureQa;
}): SmokeRestCaptureManifest {
  validateSmokeRestCaptureInventory(options.inventory);
  validateSmokeRestContextIndex(options.contextIndex);
  validateSmokeRestCaptureQa(options.qa);
  if (options.qa.status !== "accepted") {
    throw new Error("smoke-rest manifest can be frozen only after accepted Capture QA");
  }
  const content = {
    contract_version: SMOKE_REST_CAPTURE_MANIFEST_VERSION,
    bound_production_gap_inventory_sha256: BOUND_PRODUCTION_GAP_INVENTORY_SHA256,
    bound_smoke_capture_manifest_sha256: BOUND_SMOKE_CAPTURE_MANIFEST_SHA256,
    bound_smoke_capture_manifest_version: SMOKE_MANIFEST_VERSION,
    inventory_sha256: options.inventory.inventory_sha256,
    context_index_sha256: options.contextIndex.context_index_sha256,
    qa_status: options.qa.status,
    qa_sha256: options.qa.qa_sha256,
    recapture_keys: options.inventory.recapture_keys,
    reuse_record_sha256s: options.inventory.reuse_record_sha256s,
    capture_order: SMOKE_REST_CAPTURE_ORDER,
    bound_worksheet: options.inventory.bound_worksheet,
    english_teacher_reread_rows: ENGLISH_TEACHER_REREAD_ROWS,
  };
  assertNoReviewBodies(content);
  return { ...content, manifest_sha256: sha256(stableJson(content)) };
}

export function validateSmokeRestCaptureInventory(value: unknown): asserts value is SmokeRestCaptureInventory {
  if (!isRecord(value) || value.contract_version !== SMOKE_REST_CAPTURE_INVENTORY_VERSION || typeof value.inventory_sha256 !== "string") {
    throw new Error("invalid smoke-rest capture inventory");
  }
  const { inventory_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.inventory_sha256) throw new Error("smoke-rest inventory hash mismatch");
  assertNoReviewBodies(value);
}

export function validateSmokeRestContextIndex(value: unknown): asserts value is SmokeRestContextIndex {
  if (!isRecord(value) || value.contract_version !== SMOKE_REST_CONTEXT_INDEX_VERSION || typeof value.context_index_sha256 !== "string") {
    throw new Error("invalid smoke-rest context index");
  }
  const { context_index_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.context_index_sha256) throw new Error("smoke-rest context index hash mismatch");
  assertNoReviewBodies(value);
}

export function validateSmokeRestCaptureQa(value: unknown): asserts value is SmokeRestCaptureQa {
  if (!isRecord(value) || value.contract_version !== SMOKE_REST_CAPTURE_QA_VERSION || typeof value.qa_sha256 !== "string") {
    throw new Error("invalid smoke-rest capture QA");
  }
  if (!["accepted", "recapture_required", "manifest_mismatch"].includes(value.status as string)) {
    throw new Error("invalid smoke-rest capture QA status");
  }
  const { qa_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.qa_sha256) throw new Error("smoke-rest capture QA hash mismatch");
  assertNoReviewBodies(value);
}

export function validateSmokeRestCaptureManifest(value: unknown): asserts value is SmokeRestCaptureManifest {
  if (!isRecord(value) || value.contract_version !== SMOKE_REST_CAPTURE_MANIFEST_VERSION || typeof value.manifest_sha256 !== "string") {
    throw new Error("invalid smoke-rest capture manifest");
  }
  const { manifest_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.manifest_sha256) throw new Error("smoke-rest capture manifest hash mismatch");
  assertNoReviewBodies(value);
}

export function assertSmokeRestOutputPath(path: string) {
  const resolved = resolve(path).replaceAll("\\", "/");
  if (!resolved.includes(`/${SMOKE_REST_OUTPUT_RELATIVE}`)) {
    throw new Error(`smoke-rest output must stay inside ${SMOKE_REST_OUTPUT_RELATIVE}`);
  }
  if (resolved.includes("/smoke-20260818-v1")) {
    throw new Error("smoke-rest output must not overwrite the frozen smoke pack");
  }
  if (resolved.includes("/formula-bar-full") || resolved.includes("/formula-bar-rebuild")) {
    throw new Error("smoke-rest output must not overwrite an existing formula-bar pack");
  }
  if (resolved.includes("/rest-sheets-") || resolved.includes("/other-smoke-")) {
    throw new Error("smoke-rest output must not overwrite rest-sheets or other-smoke packs");
  }
}

export function smokeRestCaptureUsage() {
  return [
    "Usage:",
    "  pnpm run smoke-rest-capture bind-inventory <production-gap-inventory.json> <inventory.json> [--worksheet <表>] [--allow-unbound-sha]",
    "  pnpm run smoke-rest-capture context-index <inventory.json> <context-index.json> [teacher-reads.json]",
    "  pnpm run smoke-rest-capture plan-row <inventory.json> <worksheet> <row>",
    "  pnpm run smoke-rest-capture qa <inventory.json> <context-index.json> <qa.json> [captures.json] [composition-failures.json]",
    "  pnpm run smoke-rest-capture freeze-manifest <inventory.json> <context-index.json> <qa.json> <manifest.json>",
  ].join("\n");
}

export async function runSmokeRestCaptureCli(argv: string[]) {
  const { allowUnboundSha, worksheet, args } = parseCliFlags(argv);
  const [command, ...rest] = args;
  if (command === "bind-inventory") {
    const [gapPath, outputPath] = rest;
    if (!gapPath || !outputPath) throw new Error(smokeRestCaptureUsage());
    const inventory = bindSmokeRestCaptureInventory(
      JSON.parse(await readFile(resolve(gapPath), "utf8")),
      { allowUnboundSha, worksheet },
    );
    await writeSmokeRestJson(resolve(outputPath), inventory);
    return {
      output: resolve(outputPath),
      bound: inventory.bound,
      recapture_keys: inventory.recapture_keys.length,
      inventory_sha256: inventory.inventory_sha256,
    };
  }
  if (command === "context-index") {
    const [inventoryPath, outputPath, teacherReadsPath] = rest;
    if (!inventoryPath || !outputPath) throw new Error(smokeRestCaptureUsage());
    const teacherReads = teacherReadsPath
      ? JSON.parse(await readFile(resolve(teacherReadsPath), "utf8")) as SmokeRestTeacherRead[]
      : [];
    const index = buildSmokeRestContextIndex(
      readInventory(await readFile(resolve(inventoryPath), "utf8")),
      teacherReads,
    );
    await writeSmokeRestJson(resolve(outputPath), index);
    return {
      output: resolve(outputPath),
      sheets: index.sheets.length,
      context_index_sha256: index.context_index_sha256,
    };
  }
  if (command === "plan-row") {
    const [inventoryPath, worksheet, rowText] = rest;
    if (!inventoryPath || !worksheet || !rowText) throw new Error(smokeRestCaptureUsage());
    return planSmokeRestRowCapture(
      readInventory(await readFile(resolve(inventoryPath), "utf8")),
      worksheet,
      Number(rowText),
    );
  }
  if (command === "qa") {
    const [inventoryPath, contextIndexPath, outputPath, capturesPath, compositionFailuresPath] = rest;
    if (!inventoryPath || !contextIndexPath || !outputPath) throw new Error(smokeRestCaptureUsage());
    const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
    const contextIndex = JSON.parse(await readFile(resolve(contextIndexPath), "utf8"));
    validateSmokeRestContextIndex(contextIndex);
    const captures = capturesPath
      ? JSON.parse(await readFile(resolve(capturesPath), "utf8")) as SmokeRestSyntheticCapture[]
      : [];
    const compositionFailures = compositionFailuresPath
      ? JSON.parse(await readFile(resolve(compositionFailuresPath), "utf8")) as Array<{ key: string; issues: string[] }>
      : [];
    const qa = buildSmokeRestCaptureQa({
      inventory,
      contextIndex,
      captures,
      compositionFailures,
      reusedRecordSha256s: new Map(Object.entries(inventory.reuse_record_sha256s)),
    });
    await writeSmokeRestJson(resolve(outputPath), qa);
    return { output: resolve(outputPath), status: qa.status, issues: qa.issues.length };
  }
  if (command === "freeze-manifest") {
    const [inventoryPath, contextIndexPath, qaPath, outputPath] = rest;
    if (!inventoryPath || !contextIndexPath || !qaPath || !outputPath) throw new Error(smokeRestCaptureUsage());
    const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
    const contextIndex = JSON.parse(await readFile(resolve(contextIndexPath), "utf8"));
    validateSmokeRestContextIndex(contextIndex);
    const qa = JSON.parse(await readFile(resolve(qaPath), "utf8"));
    validateSmokeRestCaptureQa(qa);
    const manifest = freezeSmokeRestManifest({ inventory, contextIndex, qa });
    await writeSmokeRestJson(resolve(outputPath), manifest);
    return { output: resolve(outputPath), sha256: manifest.manifest_sha256 };
  }
  throw new Error(smokeRestCaptureUsage());
}

function readInventory(text: string): SmokeRestCaptureInventory {
  const inventory = JSON.parse(text);
  validateSmokeRestCaptureInventory(inventory);
  return inventory;
}

async function writeSmokeRestJson(path: string, value: unknown) {
  assertSmokeRestOutputPath(path);
  assertNoReviewBodies(value);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function readProductionGapInventory(value: unknown): ProductionGapInventory {
  if (
    !isRecord(value)
    || value.contract_version !== PRODUCTION_GAP_INVENTORY_VERSION
    || typeof value.inventory_sha256 !== "string"
    || !Array.isArray(value.cells)
    || !Array.isArray(value.sheets)
    || !isRecord(value.later_capture)
    || !isRecord(value.later_capture.smoke)
    || !Array.isArray(value.later_capture.smoke.keys)
  ) {
    throw new Error("invalid production-gap inventory");
  }
  const { inventory_sha256, ...content } = value;
  if (sha256(stableJson(content)) !== inventory_sha256) {
    throw new Error("production-gap inventory hash mismatch");
  }
  return value as ProductionGapInventory;
}

function assertBoundNeverPackagedCounts(
  sheets: SmokeRestInventorySheet[],
  smokeLaterTotal: number,
  boundWorksheet: SmokeRestWorksheet | null,
) {
  const targets = boundWorksheet ? [boundWorksheet] : [...SMOKE_REST_CAPTURE_ORDER];
  if (!boundWorksheet && smokeLaterTotal !== SMOKE_REST_BOUND_NEVER_PACKAGED_TOTAL) {
    throw new Error(`bound never_packaged total must be ${SMOKE_REST_BOUND_NEVER_PACKAGED_TOTAL}, got ${smokeLaterTotal}`);
  }
  for (const worksheet of targets) {
    const expected = SMOKE_REST_BOUND_NEVER_PACKAGED_COUNTS[worksheet];
    const sheet = sheets.find((item) => item.worksheet === worksheet);
    const actual = sheet?.never_packaged ?? 0;
    if (actual !== expected) {
      throw new Error(`bound never_packaged ${worksheet} must be ${expected}, got ${actual}`);
    }
  }
}

function parseCliFlags(argv: readonly string[]) {
  const args: string[] = [];
  let allowUnboundSha = false;
  let worksheet: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--allow-unbound-sha") {
      allowUnboundSha = true;
      continue;
    }
    if (item === "--worksheet") {
      worksheet = argv[index + 1];
      index += 1;
      continue;
    }
    args.push(item);
  }
  return { allowUnboundSha, worksheet, args };
}

function assertKeySetsClose(left: readonly string[], right: readonly string[]) {
  if (!sameKeySet(left, right)) {
    throw new Error("later_capture.smoke remaining is not closed 1:1");
  }
}

function sameKeySet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  if (rightSet.size !== right.length) return false;
  return left.every((key) => rightSet.has(key));
}

function isSmokeRestSheet(worksheet: string): worksheet is SmokeRestWorksheet {
  return SMOKE_REST_SHEET_SET.has(worksheet);
}

function rejectObsoleteLetters(worksheet: string, teacherColumn: string) {
  if (worksheet === "体育课" && teacherColumn === "C") {
    throw new Error("rejected obsolete 体育课 teacher column C");
  }
  if (worksheet === "大英和视听说" && teacherColumn === "G") {
    throw new Error("rejected obsolete 大英和视听说 teacher column G");
  }
}

function assertNoReviewBodies(value: unknown) {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  if (
    encoded.includes("formula_bar_value")
    || encoded.includes("visible_cell_text")
    || encoded.includes("\"comment\"")
  ) {
    throw new Error("smoke-rest inventory/QA/manifest must not include formula text, visible-cell text, or comments");
  }
}

function contiguousWithPrevious(previous: string, current: string) {
  const left = parseAddress(previous);
  const right = parseAddress(current);
  return left.row === right.row && columnNumber(right.column) === columnNumber(left.column) + 1;
}

function parseMatrixKey(key: string) {
  const match = /^(.+)\|([1-9]\d*)\|([A-Z]+)$/.exec(key);
  if (!match) throw new Error(`invalid matrix key: ${key}`);
  return { worksheet: match[1], row: Number(match[2]), column: match[3] };
}

function parseAddress(address: string) {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address.trim());
  if (!match) throw new Error(`invalid cell address: ${address}`);
  return { address: `${match[1].toUpperCase()}${match[2]}`, column: match[1].toUpperCase(), row: Number(match[2]) };
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

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
