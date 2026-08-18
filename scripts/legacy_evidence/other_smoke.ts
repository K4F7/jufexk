import { createHash } from "node:crypto";
import { buildFormulaBarMatrixPlan, buildFrozenFormulaBarMatrixPlan, type FormulaBarMatrixPlan } from "./formula_bar_locator";
import {
  SMOKE_ROW_PLAN_VERSION,
  classifySmokeReview,
  evidenceToSmokeSource,
  type SmokeInventoryReview,
  type SmokeRowPlan,
  type SmokeSourceReviewEvidence,
} from "./smoke_recapture";

export const OTHER_SMOKE_INVENTORY_VERSION = "other-smoke-inventory-v1" as const;
export const OTHER_SMOKE_CAPTURE_QA_VERSION = "other-smoke-capture-qa-v1" as const;
export const OTHER_SMOKE_MANIFEST_VERSION = "other-smoke-capture-manifest-v1" as const;
export const OTHER_SMOKE_CAPTURE_ORDER = ["外教", "数学课", "MOOC", "主要课程", "美育"] as const;

export const OTHER_SMOKE_SHEETS = [
  { worksheet: "外教", first_row: 3, last_row: 6, review_first: "G", review_last: "N" },
  { worksheet: "数学课", first_row: 8, last_row: 14, review_first: "D", review_last: "J" },
  { worksheet: "MOOC", first_row: 8, last_row: 14, review_first: "G", review_last: "N" },
  { worksheet: "主要课程", first_row: 19, last_row: 26, review_first: "F", review_last: "M" },
  { worksheet: "美育", first_row: 8, last_row: 14, review_first: "E", review_last: "M" },
] as const;

export const OTHER_SMOKE_REVIEW_CELLS = 264 as const;
export const OTHER_SMOKE_OUTPUT_RELATIVE = "scripts/legacy_evidence/output/other-smoke-20260819-v1" as const;

export type OtherSmokeWorksheet = (typeof OTHER_SMOKE_CAPTURE_ORDER)[number];

export type OtherSmokeInventorySheet = {
  worksheet: OtherSmokeWorksheet;
  smoke_rows: [number, number];
  review_columns: string[];
  course_column: "missing_context";
  teacher_column: "missing_context";
  terminal_status_counts: Record<string, number>;
  rows: Array<{ row: number; reviews: SmokeInventoryReview[] }>;
};

export type OtherSmokeInventory = {
  contract_version: typeof OTHER_SMOKE_INVENTORY_VERSION;
  source_evidence_root: string;
  generated_at: string;
  notes: string[];
  capture_order: typeof OTHER_SMOKE_CAPTURE_ORDER;
  sheets: OtherSmokeInventorySheet[];
  recapture_keys: string[];
  totals: {
    review_cells: number;
    reuse: number;
    reuse_as_overflow: number;
    recapture: number;
    missing_evidence: number;
    inspect: number;
  };
  course_column: "missing_context";
  teacher_column: "missing_context";
  inventory_sha256: string;
};

export type OtherSmokeCaptureQa = {
  contract_version: typeof OTHER_SMOKE_CAPTURE_QA_VERSION;
  status: "accepted" | "recapture_required" | "manifest_mismatch";
  issues: string[];
  review_cells: number;
  recapture_keys: number;
  recapture_with_distinct_images: number;
  formula_truncated_isolated: string[];
  click_grid: false;
  guessed_context_letters: false;
  rewrote_source_json: false;
  wrote_tencent_or_business_db: false;
  live_tencent_capture: false;
  read_only: true;
  qa_sha256: string;
};

export type OtherSmokeManifest = {
  contract_version: typeof OTHER_SMOKE_MANIFEST_VERSION;
  matrix_plan_sha256: string;
  inventory_sha256: string;
  qa_status: OtherSmokeCaptureQa["status"];
  qa_sha256: string;
  recapture_keys: string[];
  reuse_record_sha256s: Record<string, string>;
  formula_truncated_isolated: string[];
  capture_order: typeof OTHER_SMOKE_CAPTURE_ORDER;
  manifest_sha256: string;
};

export function otherSmokeSheet(worksheet: string) {
  const sheet = OTHER_SMOKE_SHEETS.find((item) => item.worksheet === worksheet);
  if (!sheet) throw new Error(`not an other-smoke worksheet: ${worksheet}`);
  return sheet;
}

export function buildOtherSmokeReviewMatrixPlan(): FormulaBarMatrixPlan {
  const frozen = buildFrozenFormulaBarMatrixPlan();
  const sheets = OTHER_SMOKE_SHEETS.map((layout) => {
    const frozenSheet = frozen.sheets.find((sheet) => sheet.worksheet === layout.worksheet);
    if (!frozenSheet) throw new Error(`frozen matrix is missing smoke sheet: ${layout.worksheet}`);
    const rows = frozenSheet.rows.filter((row) => row.row >= layout.first_row && row.row <= layout.last_row);
    if (rows.length !== layout.last_row - layout.first_row + 1) {
      throw new Error(`other-smoke rows are not a contiguous frozen subset: ${layout.worksheet}`);
    }
    for (const row of rows) {
      if (row.columns[0] !== layout.review_first || row.columns.at(-1) !== layout.review_last) {
        throw new Error(`other-smoke review columns drift from frozen matrix: ${layout.worksheet}|${row.row}`);
      }
    }
    return { worksheet: layout.worksheet, rows };
  });
  return buildFormulaBarMatrixPlan(sheets);
}

export function otherSmokeReviewKeys(plan = buildOtherSmokeReviewMatrixPlan()): string[] {
  return plan.sheets.flatMap((sheet) => (
    sheet.rows.flatMap((row) => row.columns.map((column) => `${sheet.worksheet}|${row.row}|${column}`))
  ));
}

export function buildOtherSmokeInventory(options: {
  evidenceByKey: ReadonlyMap<string, SmokeSourceReviewEvidence>;
  sourceEvidenceRoot: string;
  generatedAt: string;
}): OtherSmokeInventory {
  const plan = buildOtherSmokeReviewMatrixPlan();
  const sheets = OTHER_SMOKE_SHEETS.map((layout) => {
    const planned = plan.sheets.find((sheet) => sheet.worksheet === layout.worksheet)!;
    const rows = planned.rows.map((entry) => ({
      row: entry.row,
      reviews: entry.columns.map((column) => {
        const key = `${layout.worksheet}|${entry.row}|${column}`;
        const evidence = options.evidenceByKey.get(key) ?? null;
        if (evidence && (evidence.key !== key || evidence.worksheet !== layout.worksheet || evidence.row !== entry.row || evidence.column !== column)) {
          throw new Error(`other-smoke evidence identity mismatch: ${key}`);
        }
        const classified = classifySmokeReview(evidence);
        const cellImage = evidence?.evidence.cell_image?.sha256 ?? null;
        const conflictImage = evidence?.evidence.conflict_image?.sha256 ?? null;
        return {
          key,
          address: `${column}${entry.row}`,
          present: evidence !== null,
          terminal_status: evidence?.terminal_status ?? null,
          correspondence: evidence?.correspondence ?? null,
          conflict_reason: evidence?.conflict_reason ?? null,
          halt_batch: evidence?.halt_batch ?? null,
          formula_bar_nonempty: evidence?.formula_bar_nonempty ?? null,
          formula_bar_text_sha256: evidence?.formula_bar_text_sha256 ?? null,
          record_sha256: evidence?.record_sha256 ?? null,
          cell_image_sha256: cellImage,
          conflict_image_sha256: conflictImage,
          cell_image_same_as_conflict: cellImage !== null && conflictImage !== null && cellImage === conflictImage,
          action: classified.action,
          reason: classified.reason,
        } satisfies SmokeInventoryReview;
      }),
    }));
    const terminalStatusCounts: Record<string, number> = {};
    for (const row of rows) {
      for (const review of row.reviews) {
        if (review.terminal_status) {
          terminalStatusCounts[review.terminal_status] = (terminalStatusCounts[review.terminal_status] ?? 0) + 1;
        }
      }
    }
    return {
      worksheet: layout.worksheet,
      smoke_rows: [layout.first_row, layout.last_row] as [number, number],
      review_columns: [...planned.rows[0].columns],
      course_column: "missing_context" as const,
      teacher_column: "missing_context" as const,
      terminal_status_counts: terminalStatusCounts,
      rows,
    };
  });
  const reviews = sheets.flatMap((sheet) => sheet.rows.flatMap((row) => row.reviews));
  const recaptureKeys = reviews.filter((item) => item.action === "recapture").map((item) => item.key);
  const inventory = {
    contract_version: OTHER_SMOKE_INVENTORY_VERSION,
    source_evidence_root: options.sourceEvidenceRoot,
    generated_at: options.generatedAt,
    notes: [
      "No formula-bar values or visible-cell text are included.",
      "Course and teacher letters stay missing_context until a live formula-bar confirmation.",
      "MOOC G46 is outside this smoke range; do not guess that locator from 8-14.",
    ],
    capture_order: OTHER_SMOKE_CAPTURE_ORDER,
    sheets,
    recapture_keys: recaptureKeys,
    totals: {
      review_cells: reviews.length,
      reuse: reviews.filter((item) => item.action === "reuse").length,
      reuse_as_overflow: reviews.filter((item) => item.action === "reuse_as_overflow").length,
      recapture: recaptureKeys.length,
      missing_evidence: reviews.filter((item) => item.action === "missing").length,
      inspect: reviews.filter((item) => item.action === "inspect").length,
    },
    course_column: "missing_context" as const,
    teacher_column: "missing_context" as const,
  };
  assertNoReviewBodiesOrGuessedLetters(inventory);
  if (inventory.totals.review_cells !== OTHER_SMOKE_REVIEW_CELLS) {
    throw new Error(`other-smoke must cover ${OTHER_SMOKE_REVIEW_CELLS} cells, got ${inventory.totals.review_cells}`);
  }
  return { ...inventory, inventory_sha256: sha256(stableJson(inventory)) };
}

export function planOtherSmokeRowCapture(inventory: OtherSmokeInventory, worksheet: string, row: number): SmokeRowPlan {
  validateOtherSmokeInventory(inventory);
  otherSmokeSheet(worksheet);
  const sheet = inventory.sheets.find((item) => item.worksheet === worksheet);
  const entry = sheet?.rows.find((item) => item.row === row);
  if (!entry) throw new Error(`other-smoke inventory has no ${worksheet} row ${row}`);
  const recaptures = entry.reviews.filter((review) => review.action === "recapture");
  const steps: SmokeRowPlan["steps"] = [
    { type: "assert_view_only" },
    { type: "select_worksheet", worksheet },
  ];
  recaptures.forEach((review, index) => {
    if (index === 0 || !contiguousWithPrevious(recaptures[index - 1].address, review.address)) {
      steps.push({ type: "locate", address: review.address, role: "review" });
    } else {
      steps.push({ type: "move_right", address: review.address });
    }
    steps.push({
      type: "capture_pair",
      address: review.address,
      role: "review",
      recapture: true,
      bind_reuse_sha256: review.record_sha256,
    });
  });
  const content = {
    contract_version: SMOKE_ROW_PLAN_VERSION,
    worksheet,
    row,
    mode: "recapture_only" as const,
    click_grid: false as const,
    steps,
  };
  assertNoReviewBodiesOrGuessedLetters(content);
  return { ...content, plan_sha256: sha256(stableJson(content)) };
}

export function buildOtherSmokeCaptureQa(options: {
  inventory: OtherSmokeInventory;
  captures?: ReadonlyArray<{
    worksheet: string;
    address: string;
    recapture: boolean;
    role: string;
    rewrite_source_json: false;
    formula_image?: { sha256: string } | null;
    cell_image?: { sha256: string } | null;
    formula_truncated_dom_authoritative?: boolean;
  }>;
  compositionFailures?: readonly { key?: string; address?: string; issues: string[] }[];
}): OtherSmokeCaptureQa {
  validateOtherSmokeInventory(options.inventory);
  const issues: string[] = [];
  if (options.inventory.totals.review_cells !== OTHER_SMOKE_REVIEW_CELLS) {
    issues.push(`expected ${OTHER_SMOKE_REVIEW_CELLS} review cells, got ${options.inventory.totals.review_cells}`);
  }
  const reviews = options.inventory.sheets.flatMap((sheet) => sheet.rows.flatMap((row) => row.reviews));
  for (const review of reviews) {
    if (review.action === "missing" || !review.terminal_status) issues.push(`missing terminal status: ${review.key}`);
  }
  const recaptureKeys = options.inventory.recapture_keys;
  if (new Set(recaptureKeys).size !== recaptureKeys.length) issues.push("duplicate recapture keys");
  const captures = options.captures ?? [];
  const recaptureByKey = new Map(
    captures
      .filter((item) => item.recapture && item.role === "review")
      .map((item) => [`${item.worksheet}|${parseAddress(item.address).row}|${parseAddress(item.address).column}`, item]),
  );
  let distinct = 0;
  for (const key of recaptureKeys) {
    const capture = recaptureByKey.get(key);
    if (!capture?.formula_image || !capture.cell_image) {
      issues.push(`recapture missing formula/cell images: ${key}`);
      continue;
    }
    if (capture.rewrite_source_json !== false) issues.push(`${key} rewrote source JSON`);
    if (capture.formula_image.sha256 === capture.cell_image.sha256) {
      issues.push(`recapture formula/cell hash collision: ${key}`);
      continue;
    }
    distinct += 1;
  }
  for (const failure of options.compositionFailures ?? []) {
    issues.push(`composition rejected: ${failure.key ?? failure.address ?? "cell"}: ${failure.issues.join("; ")}`);
  }
  const truncated = [...new Set(
    captures
      .filter((item) => item.formula_truncated_dom_authoritative)
      .map((item) => `${item.worksheet}|${parseAddress(item.address).row}|${parseAddress(item.address).column}`),
  )];
  const identityIssue = issues.some((issue) => issue.includes("duplicate") || issue.includes("expected") || issue.includes("hash"));
  const content = {
    contract_version: OTHER_SMOKE_CAPTURE_QA_VERSION,
    status: (identityIssue ? "manifest_mismatch" : issues.length > 0 ? "recapture_required" : "accepted") as OtherSmokeCaptureQa["status"],
    issues,
    review_cells: options.inventory.totals.review_cells,
    recapture_keys: recaptureKeys.length,
    recapture_with_distinct_images: distinct,
    formula_truncated_isolated: truncated,
    click_grid: false as const,
    guessed_context_letters: false as const,
    rewrote_source_json: false as const,
    wrote_tencent_or_business_db: false as const,
    live_tencent_capture: false as const,
    read_only: true as const,
  };
  assertNoReviewBodiesOrGuessedLetters(content);
  return { ...content, qa_sha256: sha256(stableJson(content)) };
}

export function freezeOtherSmokeManifest(options: {
  matrix: FormulaBarMatrixPlan;
  inventory: OtherSmokeInventory;
  qa: OtherSmokeCaptureQa;
}): OtherSmokeManifest {
  validateOtherSmokeInventory(options.inventory);
  validateOtherSmokeCaptureQa(options.qa);
  if (options.qa.status !== "accepted") throw new Error("other-smoke manifest can be frozen only after accepted Capture QA");
  const reuseRecordSha256s = Object.fromEntries(
    options.inventory.sheets.flatMap((sheet) => sheet.rows.flatMap((row) => row.reviews
      .filter((review) => (review.action === "reuse" || review.action === "reuse_as_overflow") && review.record_sha256)
      .map((review) => [review.key, review.record_sha256!]))),
  );
  const content = {
    contract_version: OTHER_SMOKE_MANIFEST_VERSION,
    matrix_plan_sha256: options.matrix.plan_sha256,
    inventory_sha256: options.inventory.inventory_sha256,
    qa_status: options.qa.status,
    qa_sha256: options.qa.qa_sha256,
    recapture_keys: options.inventory.recapture_keys,
    reuse_record_sha256s: reuseRecordSha256s,
    formula_truncated_isolated: options.qa.formula_truncated_isolated,
    capture_order: OTHER_SMOKE_CAPTURE_ORDER,
  };
  assertNoReviewBodiesOrGuessedLetters(content);
  return { ...content, manifest_sha256: sha256(stableJson(content)) };
}

export function validateOtherSmokeInventory(value: unknown): asserts value is OtherSmokeInventory {
  if (!isRecord(value) || value.contract_version !== OTHER_SMOKE_INVENTORY_VERSION || typeof value.inventory_sha256 !== "string") {
    throw new Error("invalid other-smoke inventory");
  }
  const { inventory_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.inventory_sha256) throw new Error("other-smoke inventory hash mismatch");
  assertNoReviewBodiesOrGuessedLetters(value);
}

export function validateOtherSmokeCaptureQa(value: unknown): asserts value is OtherSmokeCaptureQa {
  if (!isRecord(value) || value.contract_version !== OTHER_SMOKE_CAPTURE_QA_VERSION || typeof value.qa_sha256 !== "string") {
    throw new Error("invalid other-smoke capture QA");
  }
  const { qa_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.qa_sha256) throw new Error("other-smoke capture QA hash mismatch");
  assertNoReviewBodiesOrGuessedLetters(value);
}

export { evidenceToSmokeSource };

function assertNoReviewBodiesOrGuessedLetters(value: unknown) {
  const encoded = JSON.stringify(value);
  if (encoded.includes("formula_bar_value") || encoded.includes("visible_cell_text") || encoded.includes("\"comment\"")) {
    throw new Error("other-smoke inventory/QA/manifest must not include formula text, visible-cell text, or comments");
  }
  if (/"course_column":"[A-Z]+"|"teacher_column":"[A-Z]+"/.test(encoded)) {
    throw new Error("do not guess course/teacher letters");
  }
}

function contiguousWithPrevious(previous: string, current: string) {
  const left = parseAddress(previous);
  const right = parseAddress(current);
  return left.row === right.row && columnNumber(right.column) === columnNumber(left.column) + 1;
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
