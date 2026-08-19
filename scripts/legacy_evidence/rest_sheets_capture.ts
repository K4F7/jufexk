import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  PRODUCTION_GAP_INVENTORY_VERSION,
  type ProductionGapCell,
  type ProductionGapInventory,
  type ProductionGapPartition,
} from "./production_gap";

export const REST_SHEETS_CAPTURE_INVENTORY_VERSION = "rest-sheets-capture-inventory-v1" as const;
export const REST_SHEETS_CONTEXT_INDEX_VERSION = "rest-sheets-context-index-v1" as const;
export const REST_SHEETS_ROW_PLAN_VERSION = "rest-sheets-row-plan-v1" as const;
export const REST_SHEETS_CAPTURE_QA_VERSION = "rest-sheets-capture-qa-v1" as const;
export const REST_SHEETS_CAPTURE_MANIFEST_VERSION = "rest-sheets-capture-manifest-v1" as const;

export const BOUND_PRODUCTION_GAP_INVENTORY_SHA256 = "86cfa237d58c8ad8f4554e96a1a8c4bfc968c66494c502d8c7f4faaccbc4162c" as const;

export const REST_SHEETS_CAPTURE_ORDER = ["外教", "数学课", "MOOC", "主要课程", "美育"] as const;
export const REST_SHEETS_OUTPUT_RELATIVE = "scripts/legacy_evidence/output/rest-sheets-20260818-v1" as const;

export const REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS = {
  外教: 10,
  数学课: 1,
  MOOC: 24,
  主要课程: 77,
  美育: 0,
} as const;

export const REST_SHEETS_BOUND_NEVER_PACKAGED_TOTAL = (
  REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS.外教
  + REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS.数学课
  + REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS.MOOC
  + REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS.主要课程
  + REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS.美育
);

export const REST_SHEETS_LOCATOR_TARGETS = [
  { worksheet: "MOOC", address: "G46", purpose: "halt_batch_row" },
  { worksheet: "主要课程", address: "F23", purpose: "navigation_misclick" },
  { worksheet: "主要课程", address: "F25", purpose: "navigation_misclick" },
] as const;

export type RestSheetsWorksheet = (typeof REST_SHEETS_CAPTURE_ORDER)[number];
export type RestSheetsReviewAction = "recapture" | "reuse" | "do_not_recapture" | "skip";
export type RestSheetsQaStatus = "accepted" | "recapture_required" | "manifest_mismatch";
export type RestSheetsMissingContext = "missing_context";
export type RestSheetsRowPlanMode = "recapture_only" | "locator_only";

export type RestSheetsInventoryCell = {
  key: string;
  worksheet: string;
  row: number;
  column: string;
  partition: ProductionGapPartition;
  action: RestSheetsReviewAction;
  record_sha256: string | null;
  course_anchor: RestSheetsMissingContext;
};

export type RestSheetsInventorySheet = {
  worksheet: RestSheetsWorksheet;
  never_packaged: number;
  in_production: number;
  packaged_not_imported: number;
  not_a_review: number;
  never_packaged_rows: number[];
  course_anchor: RestSheetsMissingContext;
  cells: RestSheetsInventoryCell[];
};

export type RestSheetsCaptureInventory = {
  contract_version: typeof REST_SHEETS_CAPTURE_INVENTORY_VERSION;
  bound_production_gap_inventory_sha256: typeof BOUND_PRODUCTION_GAP_INVENTORY_SHA256;
  source_inventory_sha256: string;
  bound: boolean;
  capture_order: typeof REST_SHEETS_CAPTURE_ORDER;
  notes: string[];
  sheets: RestSheetsInventorySheet[];
  recapture_keys: string[];
  later_capture_non_smoke_keys: string[];
  reuse_record_sha256s: Record<string, string>;
  do_not_recapture_keys: string[];
  totals: {
    cells: number;
    never_packaged: number;
    recapture: number;
    reuse: number;
    do_not_recapture: number;
    skip: number;
  };
  course_anchor: RestSheetsMissingContext;
  click_grid: false;
  inventory_sha256: string;
};

export type RestSheetsContextRow = {
  row: number;
  review_keys: string[];
  course_column: RestSheetsMissingContext;
  teacher_column: RestSheetsMissingContext;
  course_cell: RestSheetsMissingContext;
  teacher_cell: RestSheetsMissingContext;
  course_anchor: RestSheetsMissingContext;
};

export type RestSheetsContextIndex = {
  contract_version: typeof REST_SHEETS_CONTEXT_INDEX_VERSION;
  bound_production_gap_inventory_sha256: typeof BOUND_PRODUCTION_GAP_INVENTORY_SHA256;
  source_inventory_sha256: string;
  sheets: Array<{
    worksheet: RestSheetsWorksheet;
    course_column: RestSheetsMissingContext;
    teacher_column: RestSheetsMissingContext;
    rows: RestSheetsContextRow[];
  }>;
  course_anchor: RestSheetsMissingContext;
  context_index_sha256: string;
};

export type RestSheetsRowPlanStep =
  | { type: "assert_view_only" }
  | { type: "select_worksheet"; worksheet: string }
  | { type: "locate"; address: string; role: "review" | "locator" }
  | { type: "move_right"; address: string }
  | { type: "capture_pair"; address: string; role: "review"; recapture: true; bind_reuse_sha256: string | null }
  | { type: "stop"; reason: string; target_address: string; active_address: string };

export type RestSheetsRowPlan = {
  contract_version: typeof REST_SHEETS_ROW_PLAN_VERSION;
  worksheet: string;
  row: number | null;
  mode: RestSheetsRowPlanMode;
  click_grid: false;
  steps: RestSheetsRowPlanStep[];
  plan_sha256: string;
};

export type RestSheetsLocatorNote = {
  worksheet: string;
  target_address: string;
  active_address: string;
};

export type RestSheetsSyntheticCapture = {
  key: string;
  worksheet: string;
  address: string;
  recapture: boolean;
  formula_image_sha256: string;
  cell_image_sha256: string;
};

export type RestSheetsCaptureQa = {
  contract_version: typeof REST_SHEETS_CAPTURE_QA_VERSION;
  status: RestSheetsQaStatus;
  issues: string[];
  never_packaged: number;
  recapture_keys: number;
  later_capture_non_smoke_closed: boolean;
  bound_sha_matched: boolean;
  mooc_g46_aligned: boolean | null;
  aesthetic_empty_screenshots: number;
  recapture_with_distinct_images: number;
  click_grid: false;
  full_sheet_recapture: false;
  review_workflow_implemented: false;
  wrote_tencent_or_business_db: false;
  live_tencent_capture: false;
  read_only: true;
  qa_sha256: string;
};

export type RestSheetsCaptureManifest = {
  contract_version: typeof REST_SHEETS_CAPTURE_MANIFEST_VERSION;
  bound_production_gap_inventory_sha256: typeof BOUND_PRODUCTION_GAP_INVENTORY_SHA256;
  inventory_sha256: string;
  context_index_sha256: string;
  qa_status: RestSheetsQaStatus;
  qa_sha256: string;
  recapture_keys: string[];
  reuse_record_sha256s: Record<string, string>;
  capture_order: typeof REST_SHEETS_CAPTURE_ORDER;
  manifest_sha256: string;
};

const REST_SHEET_SET = new Set<string>(REST_SHEETS_CAPTURE_ORDER);

export function classifyRestSheetsAction(partition: ProductionGapPartition): RestSheetsReviewAction {
  if (partition === "never_packaged") return "recapture";
  if (partition === "in_production") return "reuse";
  if (partition === "packaged_not_imported") return "do_not_recapture";
  return "skip";
}

export function bindRestSheetsCaptureInventory(
  productionGap: unknown,
  options: { allowUnboundSha?: boolean } = {},
): RestSheetsCaptureInventory {
  const gap = readProductionGapInventory(productionGap);
  const bound = gap.inventory_sha256 === BOUND_PRODUCTION_GAP_INVENTORY_SHA256;
  if (!bound && !options.allowUnboundSha) {
    throw new Error(
      `bind requires production-gap inventory SHA-256 ${BOUND_PRODUCTION_GAP_INVENTORY_SHA256}; pass --allow-unbound-sha for tests`,
    );
  }

  const laterKeys = [...gap.later_capture.non_smoke.keys];
  const laterSet = new Set(laterKeys);
  if (laterSet.size !== laterKeys.length) {
    throw new Error("later_capture.non_smoke has duplicate keys");
  }
  for (const key of laterKeys) {
    const parsed = parseMatrixKey(key);
    if (!REST_SHEET_SET.has(parsed.worksheet)) {
      throw new Error(`later_capture.non_smoke includes a non-rest sheet key: ${key}`);
    }
  }

  const cellsBySheet = new Map<RestSheetsWorksheet, ProductionGapCell[]>();
  for (const worksheet of REST_SHEETS_CAPTURE_ORDER) cellsBySheet.set(worksheet, []);
  for (const cell of gap.cells) {
    if (!isRestSheet(cell.worksheet)) continue;
    cellsBySheet.get(cell.worksheet)!.push(cell);
  }

  const sheets: RestSheetsInventorySheet[] = [];
  const recaptureKeys: string[] = [];
  const reuseRecordSha256s: Record<string, string> = {};
  const doNotRecaptureKeys: string[] = [];

  for (const worksheet of REST_SHEETS_CAPTURE_ORDER) {
    const sourceCells = cellsBySheet.get(worksheet) ?? [];
    if (sourceCells.length === 0 && !bound) continue;
    const cells = sourceCells.map((cell) => {
      const action = classifyRestSheetsAction(cell.partition);
      const mapped: RestSheetsInventoryCell = {
        key: cell.key,
        worksheet: cell.worksheet,
        row: cell.row,
        column: cell.column,
        partition: cell.partition,
        action,
        record_sha256: cell.record_sha256,
        course_anchor: "missing_context",
      };
      if (action === "recapture") recaptureKeys.push(mapped.key);
      if (action === "reuse" && mapped.record_sha256) reuseRecordSha256s[mapped.key] = mapped.record_sha256;
      if (action === "do_not_recapture") doNotRecaptureKeys.push(mapped.key);
      return mapped;
    });
    const neverPackagedRows = [...new Set(
      cells.filter((cell) => cell.action === "recapture").map((cell) => cell.row),
    )].sort((left, right) => left - right);
    sheets.push({
      worksheet,
      never_packaged: countAction(cells, "recapture"),
      in_production: countAction(cells, "reuse"),
      packaged_not_imported: countAction(cells, "do_not_recapture"),
      not_a_review: countAction(cells, "skip"),
      never_packaged_rows: neverPackagedRows,
      course_anchor: "missing_context",
      cells,
    });
  }

  assertKeySetsClose(recaptureKeys, laterKeys);
  if (bound) assertBoundNeverPackagedCounts(sheets, recaptureKeys.length);

  const inventory = {
    contract_version: REST_SHEETS_CAPTURE_INVENTORY_VERSION,
    bound_production_gap_inventory_sha256: BOUND_PRODUCTION_GAP_INVENTORY_SHA256,
    source_inventory_sha256: gap.inventory_sha256,
    bound,
    capture_order: REST_SHEETS_CAPTURE_ORDER,
    notes: [
      "No formula text, visible-cell text, or comments are included.",
      "Course and teacher letters stay missing_context; do not guess them.",
      "never_packaged is recapture; in_production is reuse; packaged_not_imported is do_not_recapture; not_a_review is skip.",
      "Keys close 1:1 with later_capture.non_smoke.",
    ],
    sheets,
    recapture_keys: recaptureKeys,
    later_capture_non_smoke_keys: laterKeys,
    reuse_record_sha256s: reuseRecordSha256s,
    do_not_recapture_keys: doNotRecaptureKeys,
    totals: {
      cells: sheets.reduce((total, sheet) => total + sheet.cells.length, 0),
      never_packaged: recaptureKeys.length,
      recapture: recaptureKeys.length,
      reuse: Object.keys(reuseRecordSha256s).length + sheets.reduce((total, sheet) => (
        total + sheet.cells.filter((cell) => cell.action === "reuse" && !cell.record_sha256).length
      ), 0),
      do_not_recapture: doNotRecaptureKeys.length,
      skip: sheets.reduce((total, sheet) => total + sheet.not_a_review, 0),
    },
    course_anchor: "missing_context" as const,
    click_grid: false as const,
  };
  assertNoReviewBodies(inventory);
  assertNoGuessedContextLetters(inventory);
  return { ...inventory, inventory_sha256: sha256(stableJson(inventory)) };
}

export function buildRestSheetsContextIndex(inventory: RestSheetsCaptureInventory): RestSheetsContextIndex {
  validateRestSheetsCaptureInventory(inventory);
  const sheets = inventory.sheets.map((sheet) => {
    const rowsByNumber = new Map<number, string[]>();
    for (const cell of sheet.cells) {
      const include = cell.action === "recapture"
        || (sheet.worksheet === "美育" && cell.action === "reuse");
      if (!include) continue;
      const keys = rowsByNumber.get(cell.row) ?? [];
      keys.push(cell.key);
      rowsByNumber.set(cell.row, keys);
    }
    const rows = [...rowsByNumber.entries()]
      .sort(([left], [right]) => left - right)
      .map(([row, reviewKeys]) => ({
        row,
        review_keys: reviewKeys,
        course_column: "missing_context" as const,
        teacher_column: "missing_context" as const,
        course_cell: "missing_context" as const,
        teacher_cell: "missing_context" as const,
        course_anchor: "missing_context" as const,
      }));
    return {
      worksheet: sheet.worksheet,
      course_column: "missing_context" as const,
      teacher_column: "missing_context" as const,
      rows,
    };
  });
  const content = {
    contract_version: REST_SHEETS_CONTEXT_INDEX_VERSION,
    bound_production_gap_inventory_sha256: BOUND_PRODUCTION_GAP_INVENTORY_SHA256,
    source_inventory_sha256: inventory.source_inventory_sha256,
    sheets,
    course_anchor: "missing_context" as const,
  };
  assertNoReviewBodies(content);
  assertNoGuessedContextLetters(content);
  return { ...content, context_index_sha256: sha256(stableJson(content)) };
}

export function planRestSheetsLocator(worksheet: string, address: string): RestSheetsRowPlan {
  const target = REST_SHEETS_LOCATOR_TARGETS.find((item) => (
    item.worksheet === worksheet && item.address === address
  ));
  if (!target) {
    throw new Error(`not a rest-sheets locator target: ${worksheet} ${address}`);
  }
  const parsed = parseAddress(address);
  const content = {
    contract_version: REST_SHEETS_ROW_PLAN_VERSION,
    worksheet,
    row: parsed.row,
    mode: "locator_only" as const,
    click_grid: false as const,
    steps: [
      { type: "assert_view_only" as const },
      { type: "select_worksheet" as const, worksheet },
      { type: "locate" as const, address: target.address, role: "locator" as const },
    ],
  };
  return { ...content, plan_sha256: sha256(stableJson(content)) };
}

export function planRestSheetsRowCapture(
  inventory: RestSheetsCaptureInventory,
  worksheet: string,
  row: number,
  locator?: RestSheetsLocatorNote | null,
): RestSheetsRowPlan {
  validateRestSheetsCaptureInventory(inventory);
  if (!isRestSheet(worksheet)) throw new Error(`not a rest-sheets worksheet: ${worksheet}`);
  const sheet = inventory.sheets.find((item) => item.worksheet === worksheet);
  if (!sheet) throw new Error(`rest-sheets inventory has no ${worksheet}`);
  if (!Number.isInteger(row) || row < 1) throw new Error(`invalid rest-sheets row: ${row}`);

  if (worksheet === "MOOC" && row === 46) {
    if (!locator || locator.worksheet !== "MOOC" || locator.target_address !== "G46") {
      throw new Error("MOOC G46 locator is required before planning G-N");
    }
    if (locator.active_address !== "G46") {
      const stopped = {
        contract_version: REST_SHEETS_ROW_PLAN_VERSION,
        worksheet,
        row,
        mode: "locator_only" as const,
        click_grid: false as const,
        steps: [
          { type: "assert_view_only" as const },
          { type: "select_worksheet" as const, worksheet },
          { type: "locate" as const, address: "G46", role: "locator" as const },
          {
            type: "stop" as const,
            reason: "active_address_mismatch",
            target_address: "G46",
            active_address: locator.active_address,
          },
        ],
      };
      return { ...stopped, plan_sha256: sha256(stableJson(stopped)) };
    }
  }

  const recaptures = sheet.cells.filter((cell) => cell.row === row && cell.action === "recapture");
  const steps: RestSheetsRowPlanStep[] = [
    { type: "assert_view_only" },
    { type: "select_worksheet", worksheet },
  ];
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

  if (worksheet === "美育") {
    const screenshotSteps = steps.filter((step) => step.type === "capture_pair");
    if (screenshotSteps.length > 0 && recaptures.length === 0) {
      throw new Error("美育 must not plan empty screenshots");
    }
  }

  const content = {
    contract_version: REST_SHEETS_ROW_PLAN_VERSION,
    worksheet,
    row,
    mode: "recapture_only" as const,
    click_grid: false as const,
    steps,
  };
  return { ...content, plan_sha256: sha256(stableJson(content)) };
}

export function buildRestSheetsCaptureQa(options: {
  inventory: RestSheetsCaptureInventory;
  contextIndex: RestSheetsContextIndex;
  captures?: readonly RestSheetsSyntheticCapture[];
  locatorNotes?: readonly RestSheetsLocatorNote[];
  reusedRecordSha256s?: ReadonlyMap<string, string>;
  compositionFailures?: readonly { key: string; issues: string[] }[];
}): RestSheetsCaptureQa {
  validateRestSheetsCaptureInventory(options.inventory);
  validateRestSheetsContextIndex(options.contextIndex);
  const issues: string[] = [];
  const inventory = options.inventory;
  const recaptureKeys = inventory.recapture_keys;
  const laterClosed = sameKeySet(recaptureKeys, inventory.later_capture_non_smoke_keys);
  if (!laterClosed) issues.push("later_capture.non_smoke is not closed 1:1");
  if (new Set(recaptureKeys).size !== recaptureKeys.length) issues.push("duplicate recapture keys");

  for (const sheet of inventory.sheets) {
    for (const cell of sheet.cells) {
      if (cell.course_anchor !== "missing_context") issues.push(`guessed context on ${cell.key}`);
      const expected = classifyRestSheetsAction(cell.partition);
      if (cell.action !== expected) issues.push(`action mismatch: ${cell.key}`);
    }
  }

  if (inventory.bound) {
    try {
      assertBoundNeverPackagedCounts(inventory.sheets, recaptureKeys.length);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
    if (inventory.source_inventory_sha256 !== BOUND_PRODUCTION_GAP_INVENTORY_SHA256) {
      issues.push("bound inventory SHA-256 does not match BOUND_PRODUCTION_GAP_INVENTORY_SHA256");
    }
  }

  for (const [key, recordSha] of Object.entries(inventory.reuse_record_sha256s)) {
    const previous = options.reusedRecordSha256s?.get(key);
    if (previous && previous !== recordSha) issues.push(`reuse hash changed: ${key}`);
  }

  const recaptureSet = new Set(recaptureKeys);
  const captures = options.captures ?? [];
  const captureByKey = new Map<string, RestSheetsSyntheticCapture>();
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

  let aestheticEmptyScreenshots = 0;
  for (const capture of captures) {
    if (capture.worksheet !== "美育") continue;
    if (!recaptureSet.has(capture.key)) {
      aestheticEmptyScreenshots += 1;
      issues.push(`美育 empty screenshot is not allowed: ${capture.key}`);
    }
  }

  const contextRows = new Map<string, RestSheetsContextRow>();
  for (const sheet of options.contextIndex.sheets) {
    if (sheet.course_column !== "missing_context" || sheet.teacher_column !== "missing_context") {
      issues.push(`guessed course/teacher letters on ${sheet.worksheet}`);
    }
    for (const row of sheet.rows) {
      contextRows.set(`${sheet.worksheet}|${row.row}`, row);
      if (
        row.course_column !== "missing_context"
        || row.teacher_column !== "missing_context"
        || row.course_cell !== "missing_context"
        || row.teacher_cell !== "missing_context"
        || row.course_anchor !== "missing_context"
      ) {
        issues.push(`guessed context on ${sheet.worksheet} row ${row.row}`);
      }
    }
  }
  for (const sheet of inventory.sheets) {
    for (const row of sheet.never_packaged_rows) {
      if (!contextRows.has(`${sheet.worksheet}|${row}`)) {
        issues.push(`context index missing never_packaged row: ${sheet.worksheet}|${row}`);
      }
    }
  }

  for (const failure of options.compositionFailures ?? []) {
    issues.push(`composition rejected: ${failure.key}: ${failure.issues.join("; ")}`);
  }

  const moocRecapture = recaptureKeys.some((key) => key.startsWith("MOOC|"));
  const moocNote = (options.locatorNotes ?? []).find((note) => (
    note.worksheet === "MOOC" && note.target_address === "G46"
  ));
  let moocG46Aligned: boolean | null = null;
  if (moocRecapture) {
    if (!moocNote) {
      moocG46Aligned = false;
      issues.push("MOOC G46 locator has not been recorded");
    } else if (moocNote.active_address !== "G46") {
      moocG46Aligned = false;
      issues.push("MOOC G46 is misaligned; do not plan row 46 G-N");
    } else {
      moocG46Aligned = true;
    }
  }

  const identityIssue = issues.some((issue) => (
    issue.includes("hash changed")
    || issue.includes("duplicate")
    || issue.includes("not closed 1:1")
    || issue.includes("bound never_packaged")
    || issue.includes("SHA-256")
  ));
  const status: RestSheetsQaStatus = identityIssue
    ? "manifest_mismatch"
    : issues.length > 0
      ? "recapture_required"
      : "accepted";

  const content = {
    contract_version: REST_SHEETS_CAPTURE_QA_VERSION,
    status,
    issues,
    never_packaged: inventory.totals.never_packaged,
    recapture_keys: recaptureKeys.length,
    later_capture_non_smoke_closed: laterClosed,
    bound_sha_matched: inventory.bound,
    mooc_g46_aligned: moocG46Aligned,
    aesthetic_empty_screenshots: aestheticEmptyScreenshots,
    recapture_with_distinct_images: distinctRecaptureImages,
    click_grid: false as const,
    full_sheet_recapture: false as const,
    review_workflow_implemented: false as const,
    wrote_tencent_or_business_db: false as const,
    live_tencent_capture: false as const,
    read_only: true as const,
  };
  assertNoReviewBodies(content);
  return { ...content, qa_sha256: sha256(stableJson(content)) };
}

export function freezeRestSheetsManifest(options: {
  inventory: RestSheetsCaptureInventory;
  contextIndex: RestSheetsContextIndex;
  qa: RestSheetsCaptureQa;
}): RestSheetsCaptureManifest {
  validateRestSheetsCaptureInventory(options.inventory);
  validateRestSheetsContextIndex(options.contextIndex);
  validateRestSheetsCaptureQa(options.qa);
  if (options.qa.status !== "accepted") {
    throw new Error("rest-sheets manifest can be frozen only after accepted Capture QA");
  }
  const content = {
    contract_version: REST_SHEETS_CAPTURE_MANIFEST_VERSION,
    bound_production_gap_inventory_sha256: BOUND_PRODUCTION_GAP_INVENTORY_SHA256,
    inventory_sha256: options.inventory.inventory_sha256,
    context_index_sha256: options.contextIndex.context_index_sha256,
    qa_status: options.qa.status,
    qa_sha256: options.qa.qa_sha256,
    recapture_keys: options.inventory.recapture_keys,
    reuse_record_sha256s: options.inventory.reuse_record_sha256s,
    capture_order: REST_SHEETS_CAPTURE_ORDER,
  };
  assertNoReviewBodies(content);
  return { ...content, manifest_sha256: sha256(stableJson(content)) };
}

export function validateRestSheetsCaptureInventory(value: unknown): asserts value is RestSheetsCaptureInventory {
  if (!isRecord(value) || value.contract_version !== REST_SHEETS_CAPTURE_INVENTORY_VERSION || typeof value.inventory_sha256 !== "string") {
    throw new Error("invalid rest-sheets capture inventory");
  }
  const { inventory_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.inventory_sha256) throw new Error("rest-sheets inventory hash mismatch");
  assertNoReviewBodies(value);
}

export function validateRestSheetsContextIndex(value: unknown): asserts value is RestSheetsContextIndex {
  if (!isRecord(value) || value.contract_version !== REST_SHEETS_CONTEXT_INDEX_VERSION || typeof value.context_index_sha256 !== "string") {
    throw new Error("invalid rest-sheets context index");
  }
  const { context_index_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.context_index_sha256) throw new Error("rest-sheets context index hash mismatch");
  assertNoReviewBodies(value);
}

export function validateRestSheetsCaptureQa(value: unknown): asserts value is RestSheetsCaptureQa {
  if (!isRecord(value) || value.contract_version !== REST_SHEETS_CAPTURE_QA_VERSION || typeof value.qa_sha256 !== "string") {
    throw new Error("invalid rest-sheets capture QA");
  }
  if (!["accepted", "recapture_required", "manifest_mismatch"].includes(value.status as string)) {
    throw new Error("invalid rest-sheets capture QA status");
  }
  const { qa_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.qa_sha256) throw new Error("rest-sheets capture QA hash mismatch");
  assertNoReviewBodies(value);
}

export function validateRestSheetsCaptureManifest(value: unknown): asserts value is RestSheetsCaptureManifest {
  if (!isRecord(value) || value.contract_version !== REST_SHEETS_CAPTURE_MANIFEST_VERSION || typeof value.manifest_sha256 !== "string") {
    throw new Error("invalid rest-sheets capture manifest");
  }
  const { manifest_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.manifest_sha256) throw new Error("rest-sheets capture manifest hash mismatch");
  assertNoReviewBodies(value);
}

export function assertRestSheetsOutputPath(path: string) {
  const resolved = resolve(path).replaceAll("\\", "/");
  if (!resolved.includes(`/${REST_SHEETS_OUTPUT_RELATIVE}`)) {
    throw new Error(`rest-sheets output must stay inside ${REST_SHEETS_OUTPUT_RELATIVE}`);
  }
  if (resolved.includes("/formula-bar-full") || resolved.includes("/formula-bar-rebuild")) {
    throw new Error("rest-sheets output must not overwrite an existing formula-bar pack");
  }
  if (/(?:^|\/)smoke-(?:capture|recapture|reuse)|\/smoke-/.test(resolved)) {
    throw new Error("rest-sheets output must not overwrite a smoke pack");
  }
}

export function restSheetsCaptureUsage() {
  return [
    "Usage:",
    "  pnpm run rest-sheets-capture bind-inventory <production-gap-inventory.json> <inventory.json> [--allow-unbound-sha]",
    "  pnpm run rest-sheets-capture context-index <inventory.json> <context-index.json>",
    "  pnpm run rest-sheets-capture plan-row <inventory.json> <worksheet> <row> [locator.json]",
    "  pnpm run rest-sheets-capture plan-locator <worksheet> <address>",
    "  pnpm run rest-sheets-capture qa <inventory.json> <context-index.json> <qa.json> [captures.json] [locator-notes.json] [composition-failures.json]",
    "  pnpm run rest-sheets-capture freeze-manifest <inventory.json> <context-index.json> <qa.json> <manifest.json>",
  ].join("\n");
}

export async function runRestSheetsCaptureCli(argv: string[]) {
  const allowUnboundSha = argv.includes("--allow-unbound-sha");
  const args = argv.filter((item) => item !== "--allow-unbound-sha");
  const [command, ...rest] = args;
  if (command === "bind-inventory") {
    const [gapPath, outputPath] = rest;
    if (!gapPath || !outputPath) throw new Error(restSheetsCaptureUsage());
    const inventory = bindRestSheetsCaptureInventory(
      JSON.parse(await readFile(resolve(gapPath), "utf8")),
      { allowUnboundSha },
    );
    await writeRestSheetsJson(resolve(outputPath), inventory);
    return {
      output: resolve(outputPath),
      bound: inventory.bound,
      recapture_keys: inventory.recapture_keys.length,
      inventory_sha256: inventory.inventory_sha256,
    };
  }
  if (command === "context-index") {
    const [inventoryPath, outputPath] = rest;
    if (!inventoryPath || !outputPath) throw new Error(restSheetsCaptureUsage());
    const index = buildRestSheetsContextIndex(readInventory(await readFile(resolve(inventoryPath), "utf8")));
    await writeRestSheetsJson(resolve(outputPath), index);
    return {
      output: resolve(outputPath),
      sheets: index.sheets.length,
      context_index_sha256: index.context_index_sha256,
    };
  }
  if (command === "plan-row") {
    const [inventoryPath, worksheet, rowText, locatorPath] = rest;
    if (!inventoryPath || !worksheet || !rowText) throw new Error(restSheetsCaptureUsage());
    const locator = locatorPath
      ? JSON.parse(await readFile(resolve(locatorPath), "utf8")) as RestSheetsLocatorNote
      : null;
    return planRestSheetsRowCapture(
      readInventory(await readFile(resolve(inventoryPath), "utf8")),
      worksheet,
      Number(rowText),
      locator,
    );
  }
  if (command === "plan-locator") {
    const [worksheet, address] = rest;
    if (!worksheet || !address) throw new Error(restSheetsCaptureUsage());
    return planRestSheetsLocator(worksheet, address);
  }
  if (command === "qa") {
    const [inventoryPath, contextIndexPath, outputPath, capturesPath, locatorNotesPath, compositionFailuresPath] = rest;
    if (!inventoryPath || !contextIndexPath || !outputPath) throw new Error(restSheetsCaptureUsage());
    const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
    const contextIndex = JSON.parse(await readFile(resolve(contextIndexPath), "utf8"));
    validateRestSheetsContextIndex(contextIndex);
    const captures = capturesPath
      ? JSON.parse(await readFile(resolve(capturesPath), "utf8")) as RestSheetsSyntheticCapture[]
      : [];
    const locatorNotes = locatorNotesPath
      ? JSON.parse(await readFile(resolve(locatorNotesPath), "utf8")) as RestSheetsLocatorNote[]
      : [];
    const compositionFailures = compositionFailuresPath
      ? JSON.parse(await readFile(resolve(compositionFailuresPath), "utf8")) as Array<{ key: string; issues: string[] }>
      : [];
    const qa = buildRestSheetsCaptureQa({
      inventory,
      contextIndex,
      captures,
      locatorNotes,
      compositionFailures,
      reusedRecordSha256s: new Map(Object.entries(inventory.reuse_record_sha256s)),
    });
    await writeRestSheetsJson(resolve(outputPath), qa);
    return { output: resolve(outputPath), status: qa.status, issues: qa.issues.length };
  }
  if (command === "freeze-manifest") {
    const [inventoryPath, contextIndexPath, qaPath, outputPath] = rest;
    if (!inventoryPath || !contextIndexPath || !qaPath || !outputPath) throw new Error(restSheetsCaptureUsage());
    const inventory = readInventory(await readFile(resolve(inventoryPath), "utf8"));
    const contextIndex = JSON.parse(await readFile(resolve(contextIndexPath), "utf8"));
    validateRestSheetsContextIndex(contextIndex);
    const qa = JSON.parse(await readFile(resolve(qaPath), "utf8"));
    validateRestSheetsCaptureQa(qa);
    const manifest = freezeRestSheetsManifest({ inventory, contextIndex, qa });
    await writeRestSheetsJson(resolve(outputPath), manifest);
    return { output: resolve(outputPath), sha256: manifest.manifest_sha256 };
  }
  throw new Error(restSheetsCaptureUsage());
}

function readInventory(text: string): RestSheetsCaptureInventory {
  const inventory = JSON.parse(text);
  validateRestSheetsCaptureInventory(inventory);
  return inventory;
}

async function writeRestSheetsJson(path: string, value: unknown) {
  assertRestSheetsOutputPath(path);
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
    || !isRecord(value.later_capture.non_smoke)
    || !Array.isArray(value.later_capture.non_smoke.keys)
  ) {
    throw new Error("invalid production-gap inventory");
  }
  const { inventory_sha256, ...content } = value;
  if (sha256(stableJson(content)) !== inventory_sha256) {
    throw new Error("production-gap inventory hash mismatch");
  }
  return value as ProductionGapInventory;
}

function assertBoundNeverPackagedCounts(sheets: RestSheetsInventorySheet[], total: number) {
  if (total !== REST_SHEETS_BOUND_NEVER_PACKAGED_TOTAL) {
    throw new Error(`bound never_packaged total must be ${REST_SHEETS_BOUND_NEVER_PACKAGED_TOTAL}, got ${total}`);
  }
  for (const worksheet of REST_SHEETS_CAPTURE_ORDER) {
    const expected = REST_SHEETS_BOUND_NEVER_PACKAGED_COUNTS[worksheet];
    const sheet = sheets.find((item) => item.worksheet === worksheet);
    const actual = sheet?.never_packaged ?? 0;
    if (actual !== expected) {
      throw new Error(`bound never_packaged ${worksheet} must be ${expected}, got ${actual}`);
    }
  }
}

function assertKeySetsClose(left: readonly string[], right: readonly string[]) {
  if (!sameKeySet(left, right)) {
    throw new Error("later_capture.non_smoke is not closed 1:1");
  }
}

function sameKeySet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  if (rightSet.size !== right.length) return false;
  return left.every((key) => rightSet.has(key));
}

function countAction(cells: RestSheetsInventoryCell[], action: RestSheetsReviewAction) {
  return cells.filter((cell) => cell.action === action).length;
}

function isRestSheet(worksheet: string): worksheet is RestSheetsWorksheet {
  return REST_SHEET_SET.has(worksheet);
}

function assertNoReviewBodies(value: unknown) {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  if (
    encoded.includes("formula_bar_value")
    || encoded.includes("visible_cell_text")
    || encoded.includes("\"comment\"")
  ) {
    throw new Error("rest-sheets inventory/QA/manifest must not include formula text, visible-cell text, or comments");
  }
}

function assertNoGuessedContextLetters(value: unknown) {
  const encoded = JSON.stringify(value);
  if (/"course_column":"[A-Z]+"|"teacher_column":"[A-Z]+"/.test(encoded)) {
    throw new Error("do not guess course/teacher letters");
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
