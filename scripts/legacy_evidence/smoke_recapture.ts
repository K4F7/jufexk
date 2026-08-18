import { createHash } from "node:crypto";
import {
  captureCompositionPair,
  type CompositionDomObservation,
  type CompositionFrame,
} from "./composition_qa";
import { buildFrozenFormulaBarMatrixPlan, buildFormulaBarMatrixPlan, type FormulaBarMatrixPlan } from "./formula_bar_locator";

export const SMOKE_REUSE_RECAPTURE_VERSION = "smoke-reuse-recapture-v1" as const;
export const SMOKE_CONTEXT_INDEX_VERSION = "smoke-context-index-v1" as const;
export const SMOKE_ROW_PLAN_VERSION = "smoke-row-plan-v1" as const;
export const SMOKE_CELL_CAPTURE_VERSION = "smoke-cell-capture-v1" as const;
export const SMOKE_CAPTURE_QA_VERSION = "smoke-capture-qa-v1" as const;
export const SMOKE_MANIFEST_VERSION = "smoke-capture-manifest-v1" as const;

export const SMOKE_CAPTURE_ORDER = ["体育课", "大英和视听说", "思政课"] as const;

export const SMOKE_SHEET_LAYOUTS = [
  {
    worksheet: "思政课",
    course_column: "A",
    teacher_column: "F",
    teacher_unconfirmed: false,
    hidden_columns: ["B", "C", "D", "E"],
    review_first: "G",
    review_last: "N",
    first_row: 8,
    last_row: 14,
    context_group_label: "A-F",
    walk_up_for_course_anchor: true,
  },
  {
    worksheet: "体育课",
    course_column: "A",
    teacher_column: "C",
    teacher_unconfirmed: false,
    hidden_columns: ["B"],
    review_first: "D",
    review_last: "K",
    first_row: 6,
    last_row: 14,
    context_group_label: "A-C",
    walk_up_for_course_anchor: true,
  },
  {
    worksheet: "大英和视听说",
    course_column: "A",
    teacher_column: "G",
    teacher_unconfirmed: true,
    hidden_columns: ["B", "C", "D", "E", "F"],
    review_first: "H",
    review_last: "O",
    first_row: 8,
    last_row: 14,
    context_group_label: "A-G",
    walk_up_for_course_anchor: true,
  },
] as const;

export const SMOKE_PROBE_TARGETS = [
  {
    worksheet: "MOOC",
    row: 46,
    columns: ["G", "H", "I", "J", "K", "L", "M", "N"],
    purpose: "halt_batch_row",
    old_failure: "整行 halt_batch",
  },
  {
    worksheet: "主要课程",
    addresses: ["F23", "F25"],
    purpose: "navigation_misclick",
    old_failure: "点格错位",
  },
  {
    worksheet: "主要课程",
    purpose: "long_conflict",
    old_failure: "公式栏全文未进画",
  },
  {
    worksheet: "思政课",
    address: "G15",
    purpose: "composition_beyond_smoke",
    old_failure: "构图能否出 8-14",
  },
  {
    worksheet: "大英和视听说",
    address: "H18",
    purpose: "truncation_vs_neighbor",
    old_failure: "截断 vs 点到邻格",
  },
  {
    worksheet: "外教",
    address: "K4",
    purpose: "small_sheet_tail",
    old_failure: "小表收尾",
  },
] as const;

export type SmokeSheetLayout = (typeof SMOKE_SHEET_LAYOUTS)[number];
export type SmokeReviewAction = "reuse" | "reuse_as_overflow" | "recapture" | "missing" | "inspect";
export type SmokeQaStatus = "accepted" | "recapture_required" | "manifest_mismatch";

export type SmokeSourceReviewEvidence = {
  key: string;
  worksheet: string;
  row: number;
  column: string;
  target_address: string;
  terminal_status: "review_origin" | "horizontal_overflow_blank" | "ordinary_blank" | "evidence_conflict";
  correspondence: string;
  conflict_reason: string | null;
  halt_batch: boolean;
  formula_bar_nonempty: boolean | null;
  formula_bar_text_sha256: string | null;
  record_sha256: string;
  evidence: {
    cell_image: { sha256: string } | null;
    conflict_image: { sha256: string } | null;
  };
};

export type SmokeInventoryReview = {
  key: string;
  address: string;
  present: boolean;
  terminal_status: SmokeSourceReviewEvidence["terminal_status"] | null;
  correspondence: string | null;
  conflict_reason: string | null;
  halt_batch: boolean | null;
  formula_bar_nonempty: boolean | null;
  formula_bar_text_sha256: string | null;
  record_sha256: string | null;
  cell_image_sha256: string | null;
  conflict_image_sha256: string | null;
  cell_image_same_as_conflict: boolean;
  action: SmokeReviewAction;
  reason: string;
};

export type SmokeInventoryContextCell = {
  role: "course_anchor" | "teacher";
  column: string;
  address: string;
  action: "capture_context";
  reason: string;
};

export type SmokeInventoryRow = {
  row: number;
  context: SmokeInventoryContextCell[];
  reviews: SmokeInventoryReview[];
};

export type SmokeInventorySheet = {
  worksheet: string;
  smoke_rows: [number, number];
  review_columns: string[];
  context_layout: { course: string; teacher: string; hidden: string[] };
  walk_up_for_course_anchor: boolean;
  terminal_status_counts: Record<string, number>;
  rows: SmokeInventoryRow[];
};

export type SmokeReuseRecaptureInventory = {
  contract_version: typeof SMOKE_REUSE_RECAPTURE_VERSION;
  source_evidence_root: string;
  generated_at: string;
  notes: string[];
  sheets: SmokeInventorySheet[];
  totals: {
    review_cells: number;
    reuse: number;
    reuse_as_overflow: number;
    recapture: number;
    missing_evidence: number;
    inspect: number;
    context_missing: number;
  };
  inventory_sha256: string;
};

export type SmokeContextRow = {
  row: number;
  course_cell: string;
  teacher_cell: string;
  review_keys: string[];
  course_anchor_row: number | null;
  visible_course: string | null;
  visible_teacher: string | null;
  course_span: { first_row: number; last_row: number } | { pending_walk_up: true };
};

export type SmokeContextIndex = {
  contract_version: typeof SMOKE_CONTEXT_INDEX_VERSION;
  sheets: Array<{
    worksheet: string;
    teacher_column: string;
    teacher_unconfirmed: boolean;
    rows: SmokeContextRow[];
  }>;
  pending_walk_up_rows: number;
  context_index_sha256: string;
};

export type SmokeRowPlanStep =
  | { type: "assert_view_only" }
  | { type: "select_worksheet"; worksheet: string }
  | { type: "locate"; address: string; role: "course" | "teacher" | "review"; walk_up_if_empty?: boolean }
  | { type: "move_right"; address: string }
  | { type: "capture_pair"; address: string; role: "course" | "teacher" | "review"; recapture: boolean; bind_reuse_sha256: string | null }
  | { type: "confirm_blank"; address: string }
  | { type: "confirm_overflow_blank"; address: string }
  | { type: "capture_context_group"; name: string };

export type SmokeRowPlan = {
  contract_version: typeof SMOKE_ROW_PLAN_VERSION;
  worksheet: string;
  row: number;
  mode: "protocol_rehearsal" | "recapture_only";
  click_grid: false;
  steps: SmokeRowPlanStep[];
  plan_sha256: string;
};

export type SmokeImageRef = { path: string; sha256: string };

export type SmokeCellCapture = {
  contract_version: typeof SMOKE_CELL_CAPTURE_VERSION;
  worksheet: string;
  address: string;
  role: "course" | "teacher" | "review" | "context_group";
  recapture: boolean;
  rewrite_source_json: false;
  bind_reuse_sha256: string | null;
  active_addresses: readonly [string, string];
  formula_bar_reads: readonly [{ sequence: 1; value: string; sha256: string }, { sequence: 2; value: string; sha256: string }];
  formula_bar_value: string;
  formula_bar_text_sha256: string;
  formula_truncated_dom_authoritative: boolean;
  formula_image: SmokeImageRef | null;
  cell_image: SmokeImageRef | null;
  read_only: true;
  captured_at: string;
  record_sha256: string;
};

export interface SmokeRowCaptureSource {
  assertViewOnly(): Promise<void>;
  selectWorksheet(worksheet: string): Promise<void>;
  locateByAddressBox(address: string): Promise<void>;
  moveRight(): Promise<void>;
  readActiveAddress(): Promise<string>;
  readFormulaBar(): Promise<string>;
  grabFormulaImage(address: string): Promise<CompositionFrame>;
  grabCellImage(address: string): Promise<CompositionFrame>;
  writeFrozenImage(input: { filename: string; bytes: Uint8Array }): Promise<SmokeImageRef>;
  captureContextGroup(name: string): Promise<SmokeImageRef>;
  captureConflictImage(name: string): Promise<SmokeImageRef>;
  readCompositionObservation(address: string): Promise<Partial<CompositionDomObservation>>;
  expandFormulaBar?(): Promise<void>;
  isFormulaBarTruncated?(): Promise<boolean>;
  now(): string;
}

export type SmokeRowCaptureResult = {
  status: "completed" | "blocked";
  stop_reason: string | null;
  target_address: string | null;
  active_address: string | null;
  actions: string[];
  captures: SmokeCellCapture[];
  blanks_confirmed: string[];
  course_anchor_address: string | null;
  context_group: SmokeImageRef | null;
  conflict_image: SmokeImageRef | null;
  recapture_required_addresses: string[];
};

export type SmokeCourseRead = {
  worksheet: string;
  row: number;
  address: string;
  formula_bar_value: string;
};

export type SmokeTeacherRead = {
  worksheet: string;
  row: number;
  address: string;
  formula_bar_value: string;
};

export type SmokeProbeNote = {
  purpose: string;
  target_address: string;
  active_address: string;
  formula_reads_agree: boolean;
  formula_and_address_visible: boolean;
  old_failure: string;
  new_result: string;
};

export type SmokeCaptureQa = {
  contract_version: typeof SMOKE_CAPTURE_QA_VERSION;
  status: SmokeQaStatus;
  issues: string[];
  review_cells: number;
  reuse_unchanged: number;
  recapture_with_distinct_images: number;
  sports_row6_passed: boolean;
  probe_notes: number;
  full_sheet_recapture: false;
  review_workflow_implemented: false;
  wrote_tencent_or_business_db: false;
  read_only: true;
  qa_sha256: string;
};

export type SmokeCaptureManifest = {
  contract_version: typeof SMOKE_MANIFEST_VERSION;
  matrix_plan_sha256: string;
  inventory_sha256: string;
  context_index_sha256: string;
  qa_status: SmokeQaStatus;
  qa_sha256: string;
  recapture_keys: string[];
  reuse_record_sha256s: Record<string, string>;
  manifest_sha256: string;
};

export function smokeSheetLayout(worksheet: string): SmokeSheetLayout {
  const layout = SMOKE_SHEET_LAYOUTS.find((item) => item.worksheet === worksheet);
  if (!layout) throw new Error(`not a smoke worksheet: ${worksheet}`);
  return layout;
}

export function smokeFieldSequence() {
  return SMOKE_CAPTURE_ORDER.flatMap((worksheet) => {
    const layout = smokeSheetLayout(worksheet);
    return Array.from({ length: layout.last_row - layout.first_row + 1 }, (_, index) => ({
      worksheet,
      row: layout.first_row + index,
    }));
  });
}

export function validateSmokeReuseRecaptureInventory(value: unknown): asserts value is SmokeReuseRecaptureInventory {
  if (!isRecord(value) || value.contract_version !== SMOKE_REUSE_RECAPTURE_VERSION || typeof value.inventory_sha256 !== "string") {
    throw new Error("invalid smoke reuse/recapture inventory");
  }
  const { inventory_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.inventory_sha256) throw new Error("smoke inventory hash mismatch");
}

export function validateSmokeContextIndex(value: unknown): asserts value is SmokeContextIndex {
  if (!isRecord(value) || value.contract_version !== SMOKE_CONTEXT_INDEX_VERSION || typeof value.context_index_sha256 !== "string") {
    throw new Error("invalid smoke context index");
  }
  const { context_index_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.context_index_sha256) throw new Error("smoke context index hash mismatch");
}

export function validateSmokeCaptureQa(value: unknown): asserts value is SmokeCaptureQa {
  if (!isRecord(value) || value.contract_version !== SMOKE_CAPTURE_QA_VERSION || typeof value.qa_sha256 !== "string") {
    throw new Error("invalid smoke capture QA");
  }
  if (!["accepted", "recapture_required", "manifest_mismatch"].includes(value.status as string)) {
    throw new Error("invalid smoke capture QA status");
  }
  const { qa_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.qa_sha256) throw new Error("smoke capture QA hash mismatch");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildSmokeReviewMatrixPlan(): FormulaBarMatrixPlan {
  const frozen = buildFrozenFormulaBarMatrixPlan();
  const sheets = SMOKE_SHEET_LAYOUTS.map((layout) => {
    const frozenSheet = frozen.sheets.find((sheet) => sheet.worksheet === layout.worksheet);
    if (!frozenSheet) throw new Error(`frozen matrix is missing smoke sheet: ${layout.worksheet}`);
    const rows = frozenSheet.rows.filter((row) => row.row >= layout.first_row && row.row <= layout.last_row);
    if (rows.length !== layout.last_row - layout.first_row + 1) {
      throw new Error(`smoke rows are not a contiguous frozen subset: ${layout.worksheet}`);
    }
    for (const row of rows) {
      if (row.columns[0] !== layout.review_first || row.columns.at(-1) !== layout.review_last) {
        throw new Error(`smoke review columns drift from frozen matrix: ${layout.worksheet}|${row.row}`);
      }
    }
    return { worksheet: layout.worksheet, rows };
  });
  return buildFormulaBarMatrixPlan(sheets);
}

export function smokeReviewKeys(plan = buildSmokeReviewMatrixPlan()): string[] {
  return plan.sheets.flatMap((sheet) => (
    sheet.rows.flatMap((row) => row.columns.map((column) => `${sheet.worksheet}|${row.row}|${column}`))
  ));
}

export function classifySmokeReview(evidence: SmokeSourceReviewEvidence | null): Pick<SmokeInventoryReview, "action" | "reason"> {
  if (!evidence) return { action: "missing", reason: "no formula-bar evidence record" };
  if (evidence.halt_batch || evidence.terminal_status === "evidence_conflict") {
    return { action: "recapture", reason: evidence.conflict_reason ?? "evidence_conflict" };
  }
  if (evidence.terminal_status === "horizontal_overflow_blank") {
    return { action: "reuse_as_overflow", reason: "formula empty, visible text present" };
  }
  if (evidence.terminal_status === "ordinary_blank") {
    return { action: "reuse", reason: "ordinary blank, no cell image needed" };
  }
  if (evidence.terminal_status === "review_origin") {
    return { action: "reuse", reason: "formula-bar origin, hashes stable" };
  }
  return { action: "inspect", reason: "unclassified terminal status" };
}

export function buildSmokeReuseRecaptureInventory(options: {
  evidenceByKey: ReadonlyMap<string, SmokeSourceReviewEvidence>;
  sourceEvidenceRoot: string;
  generatedAt: string;
}): SmokeReuseRecaptureInventory {
  const plan = buildSmokeReviewMatrixPlan();
  const sheets = SMOKE_SHEET_LAYOUTS.map((layout) => {
    const planned = plan.sheets.find((sheet) => sheet.worksheet === layout.worksheet)!;
    const rows = planned.rows.map((entry) => buildInventoryRow(layout, entry.row, entry.columns, options.evidenceByKey));
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
      context_layout: {
        course: layout.course_column,
        teacher: layout.teacher_column,
        hidden: [...layout.hidden_columns],
      },
      walk_up_for_course_anchor: layout.walk_up_for_course_anchor,
      terminal_status_counts: terminalStatusCounts,
      rows,
    };
  });
  const reviews = sheets.flatMap((sheet) => sheet.rows.flatMap((row) => row.reviews));
  const contextCells = sheets.flatMap((sheet) => sheet.rows.flatMap((row) => row.context));
  const inventory = {
    contract_version: SMOKE_REUSE_RECAPTURE_VERSION,
    source_evidence_root: options.sourceEvidenceRoot,
    generated_at: options.generatedAt,
    notes: [
      "No formula-bar values or visible-cell text are included.",
      "Course/teacher context cells are not in the frozen review matrix; they are always missing until a context-index capture.",
      "Smoke rows start at the frozen review first_row; if a course merge begins above that row, walk up before freezing the context index.",
    ],
    sheets,
    totals: {
      review_cells: reviews.length,
      reuse: reviews.filter((item) => item.action === "reuse").length,
      reuse_as_overflow: reviews.filter((item) => item.action === "reuse_as_overflow").length,
      recapture: reviews.filter((item) => item.action === "recapture").length,
      missing_evidence: reviews.filter((item) => item.action === "missing").length,
      inspect: reviews.filter((item) => item.action === "inspect").length,
      context_missing: contextCells.length,
    },
  };
  assertInventoryHasNoReviewBodies(inventory);
  return { ...inventory, inventory_sha256: sha256(stableJson(inventory)) };
}

export function buildSmokeContextIndex(
  inventory: SmokeReuseRecaptureInventory,
  courseReads: readonly SmokeCourseRead[] = [],
  teacherReads: readonly SmokeTeacherRead[] = [],
): SmokeContextIndex {
  const courseBySheetRow = indexReads(courseReads);
  const teacherBySheetRow = indexReads(teacherReads);
  const sheets = inventory.sheets.map((sheet) => {
    const layout = smokeSheetLayout(sheet.worksheet);
    const resolved = sheet.rows.map((row) => {
      const courseRead = courseReadForRow(sheet.worksheet, row.row, layout, courseBySheetRow);
      const teacherRead = teacherBySheetRow.get(`${sheet.worksheet}|${row.row}`);
      return {
        row: row.row,
        course_cell: courseRead?.address ?? `${layout.course_column}${row.row}`,
        teacher_cell: `${layout.teacher_column}${row.row}`,
        review_keys: row.reviews.map((review) => review.key),
        course_anchor_row: courseRead?.row ?? null,
        visible_course: courseRead && courseRead.formula_bar_value.length > 0 ? courseRead.formula_bar_value : null,
        visible_teacher: teacherRead && teacherRead.formula_bar_value.length > 0 ? teacherRead.formula_bar_value : null,
        course_span: { pending_walk_up: true } as const,
      };
    });
    return {
      worksheet: sheet.worksheet,
      teacher_column: layout.teacher_column,
      teacher_unconfirmed: layout.teacher_unconfirmed,
      rows: assignCourseSpans(resolved),
    };
  });
  const content = {
    contract_version: SMOKE_CONTEXT_INDEX_VERSION,
    sheets,
    pending_walk_up_rows: sheets.reduce((total, sheet) => (
      total + sheet.rows.filter((row) => "pending_walk_up" in row.course_span).length
    ), 0),
  };
  return { ...content, context_index_sha256: sha256(stableJson(content)) };
}

export function planSmokeRowCapture(
  inventory: SmokeReuseRecaptureInventory,
  worksheet: string,
  row: number,
): SmokeRowPlan {
  const layout = smokeSheetLayout(worksheet);
  const sheet = inventory.sheets.find((item) => item.worksheet === worksheet);
  const entry = sheet?.rows.find((item) => item.row === row);
  if (!entry) throw new Error(`smoke inventory has no ${worksheet} row ${row}`);
  const rehearsal = worksheet === "体育课" && row === 6;
  const steps: SmokeRowPlanStep[] = [
    { type: "assert_view_only" },
    { type: "select_worksheet", worksheet },
    {
      type: "locate",
      address: `${layout.course_column}${row}`,
      role: "course",
      walk_up_if_empty: layout.walk_up_for_course_anchor,
    },
    { type: "capture_pair", address: `${layout.course_column}${row}`, role: "course", recapture: false, bind_reuse_sha256: null },
    { type: "locate", address: `${layout.teacher_column}${row}`, role: "teacher" },
    { type: "capture_pair", address: `${layout.teacher_column}${row}`, role: "teacher", recapture: false, bind_reuse_sha256: null },
  ];
  if (rehearsal) {
    entry.reviews.forEach((review, index) => {
      if (index === 0) steps.push({ type: "locate", address: review.address, role: "review" });
      else steps.push({ type: "move_right", address: review.address });
      if (review.action === "reuse" && review.terminal_status === "review_origin") {
        steps.push({
          type: "capture_pair",
          address: review.address,
          role: "review",
          recapture: false,
          bind_reuse_sha256: review.record_sha256,
        });
      } else if (review.action === "recapture") {
        steps.push({
          type: "capture_pair",
          address: review.address,
          role: "review",
          recapture: true,
          bind_reuse_sha256: review.record_sha256,
        });
      } else if (review.action === "reuse_as_overflow") {
        steps.push({ type: "confirm_overflow_blank", address: review.address });
      } else {
        steps.push({ type: "confirm_blank", address: review.address });
      }
    });
  } else {
    const recaptures = entry.reviews.filter((review) => review.action === "recapture");
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
  }
  if (rehearsal || row === layout.first_row) {
    steps.push({
      type: "capture_context_group",
      name: contextGroupName(row, row, layout.context_group_label),
    });
  }
  const content = {
    contract_version: SMOKE_ROW_PLAN_VERSION,
    worksheet,
    row,
    mode: rehearsal ? "protocol_rehearsal" as const : "recapture_only" as const,
    click_grid: false as const,
    steps,
  };
  return { ...content, plan_sha256: sha256(stableJson(content)) };
}

export async function runSmokeRowCapture(
  plan: SmokeRowPlan,
  source: SmokeRowCaptureSource,
): Promise<SmokeRowCaptureResult> {
  const actions: string[] = [];
  const captures: SmokeCellCapture[] = [];
  const blanksConfirmed: string[] = [];
  const recaptureRequired: string[] = [];
  let courseAnchorAddress: string | null = null;
  let contextGroup: SmokeImageRef | null = null;
  let activeAddress = "";

  const doubleRead = async (expected: string) => {
    const firstAddress = normalizeAddress(await source.readActiveAddress());
    actions.push(`address:${firstAddress}`);
    if (firstAddress !== expected) return mismatch(expected, firstAddress);
    const firstValue = await source.readFormulaBar();
    const secondAddress = normalizeAddress(await source.readActiveAddress());
    actions.push(`address:${secondAddress}`);
    if (secondAddress !== expected) return mismatch(expected, secondAddress);
    const secondValue = await source.readFormulaBar();
    if (firstValue !== secondValue) {
      return fail("formula_bar_reads_mismatch", expected, secondAddress);
    }
    return {
      blocked: false as const,
      active_addresses: [firstAddress, secondAddress] as const,
      formula_bar_reads: [firstValue, secondValue] as const,
      value: firstValue,
    };
  };

  const mismatch = async (target: string, active: string) => {
    const conflict = await source.captureConflictImage(`冲突-${target}-${active}.jpg`);
    actions.push(`conflict:${target}:${active}`);
    return {
      blocked: true as const,
      reason: "active_address_mismatch",
      target,
      active,
      conflict,
    };
  };

  const fail = async (reason: string, target: string, active: string) => {
    const conflict = await source.captureConflictImage(`冲突-${target}-${active}.jpg`);
    actions.push(`conflict:${reason}:${target}`);
    return { blocked: true as const, reason, target, active, conflict };
  };

  for (const step of plan.steps) {
    if (step.type === "assert_view_only") {
      await source.assertViewOnly();
      actions.push("assert_view_only");
      continue;
    }
    if (step.type === "select_worksheet") {
      await source.selectWorksheet(step.worksheet);
      actions.push(`sheet:${step.worksheet}`);
      continue;
    }
    if (step.type === "locate") {
      let address = step.address;
      await source.locateByAddressBox(address);
      actions.push(`locate:${address}`);
      let reads = await doubleRead(address);
      if (reads.blocked) return blockedResult(actions, captures, blanksConfirmed, recaptureRequired, courseAnchorAddress, reads);
      if (step.walk_up_if_empty && reads.value.length === 0) {
        const parsed = parseAddress(address);
        for (let row = parsed.row - 1; row >= 1; row -= 1) {
          address = `${parsed.column}${row}`;
          await source.locateByAddressBox(address);
          actions.push(`locate:${address}`);
          reads = await doubleRead(address);
          if (reads.blocked) return blockedResult(actions, captures, blanksConfirmed, recaptureRequired, courseAnchorAddress, reads);
          if (reads.value.length > 0) break;
        }
      }
      activeAddress = address;
      if (step.role === "course") courseAnchorAddress = address;
      continue;
    }
    if (step.type === "move_right") {
      await source.moveRight();
      actions.push(`move:${step.address}`);
      const reads = await doubleRead(step.address);
      if (reads.blocked) return blockedResult(actions, captures, blanksConfirmed, recaptureRequired, courseAnchorAddress, reads);
      activeAddress = step.address;
      continue;
    }
    if (step.type === "capture_pair") {
      const address = step.role === "course" && courseAnchorAddress ? courseAnchorAddress : step.address;
      if (activeAddress !== address) {
        await source.locateByAddressBox(address);
        actions.push(`locate:${address}`);
      }
      const reads = await doubleRead(address);
      if (reads.blocked) return blockedResult(actions, captures, blanksConfirmed, recaptureRequired, courseAnchorAddress, reads);
      if (reads.value.length > 40) {
        await source.expandFormulaBar?.();
        actions.push(`expand:${address}`);
      }
      const truncated = await source.isFormulaBarTruncated?.() ?? false;
      const extra = await source.readCompositionObservation(address);
      const pair = await captureCompositionPair({
        observation: {
          target_address: address,
          active_address: reads.active_addresses[1],
          view_only_visible: extra.view_only_visible === true,
          address_box_present: extra.address_box_present === true,
          formula_bar_reads: reads.formula_bar_reads,
          formula_bar_record_sha256: step.bind_reuse_sha256,
          formula_clip: extra.formula_clip,
          chrome_rects: extra.chrome_rects,
        },
        grabFormula: () => source.grabFormulaImage(address),
        grabCell: () => source.grabCellImage(address),
      });
      actions.push(`formula:${address}`, `cell:${address}`);
      if (pair.status === "recapture_required") {
        recaptureRequired.push(address);
        actions.push(`recapture_required:${address}`);
        continue;
      }
      const formulaImage = await source.writeFrozenImage({ filename: `${address}-formula.jpg`, bytes: pair.formula.bytes });
      const cellImage = await source.writeFrozenImage({ filename: `${address}-cell.jpg`, bytes: pair.cell.bytes });
      if (formulaImage.sha256 !== pair.formula.sha256 || cellImage.sha256 !== pair.cell.sha256) {
        throw new Error(`smoke screenshot hash mismatch: ${address}`);
      }
      captures.push(buildCaptureRecord({
        worksheet: plan.worksheet,
        address,
        role: step.role,
        recapture: step.recapture,
        bindReuseSha256: step.bind_reuse_sha256,
        reads,
        formulaImage,
        cellImage,
        truncated,
        capturedAt: source.now(),
      }));
      continue;
    }
    if (step.type === "confirm_blank" || step.type === "confirm_overflow_blank") {
      const reads = await doubleRead(step.address);
      if (reads.blocked) return blockedResult(actions, captures, blanksConfirmed, recaptureRequired, courseAnchorAddress, reads);
      if (reads.value.length > 0) {
        return blockedResult(actions, captures, blanksConfirmed, recaptureRequired, courseAnchorAddress, {
          reason: "expected_blank_had_formula",
          target: step.address,
          active: step.address,
          conflict: null,
        });
      }
      blanksConfirmed.push(step.address);
      actions.push(`blank:${step.address}`);
      continue;
    }
    if (step.type === "capture_context_group") {
      const firstRow = courseAnchorAddress ? parseAddress(courseAnchorAddress).row : plan.row;
      const name = contextGroupName(firstRow, plan.row, smokeSheetLayout(plan.worksheet).context_group_label);
      contextGroup = await source.captureContextGroup(name);
      actions.push(`context:${name}`);
    }
  }

  return {
    status: "completed",
    stop_reason: null,
    target_address: null,
    active_address: activeAddress || null,
    actions,
    captures,
    blanks_confirmed: blanksConfirmed,
    course_anchor_address: courseAnchorAddress,
    context_group: contextGroup,
    conflict_image: null,
    recapture_required_addresses: recaptureRequired,
  };
}

export function evaluateSportsRow6(result: SmokeRowCaptureResult, inventory: SmokeReuseRecaptureInventory) {
  const issues: string[] = [];
  const row = inventory.sheets.find((sheet) => sheet.worksheet === "体育课")?.rows.find((item) => item.row === 6);
  if (!row) throw new Error("inventory is missing 体育课 row 6");
  if (result.status !== "completed") issues.push(result.stop_reason ?? "sports row 6 blocked");
  if (result.actions.some((action) => action.startsWith("click:"))) issues.push("located a cell by clicking the grid");
  const reviewCaptures = result.captures.filter((item) => item.role === "review");
  const expectedPractice = row.reviews.filter((item) => item.terminal_status === "review_origin").map((item) => item.address);
  if (reviewCaptures.map((item) => item.address).join(",") !== expectedPractice.join(",")) {
    issues.push("sports row 6 did not capture D-G composition pairs");
  }
  for (const capture of reviewCaptures) {
    if (!capture.formula_image || !capture.cell_image || capture.formula_image.sha256 === capture.cell_image.sha256) {
      issues.push(`${capture.address} formula/cell hashes are missing or identical`);
    }
    const expected = row.reviews.find((item) => item.address === capture.address);
    if (expected?.formula_bar_text_sha256 && capture.formula_bar_text_sha256 !== expected.formula_bar_text_sha256) {
      issues.push(`${capture.address} formula-bar hash drifted from reused record`);
    }
    if (capture.rewrite_source_json !== false) issues.push(`${capture.address} rewrote source JSON`);
  }
  const expectedBlanks = row.reviews.filter((item) => item.terminal_status === "ordinary_blank").map((item) => item.address);
  if (result.blanks_confirmed.join(",") !== expectedBlanks.join(",")) {
    issues.push("sports row 6 did not confirm H-K as empty");
  }
  if (!result.captures.some((item) => item.role === "course") || !result.captures.some((item) => item.role === "teacher")) {
    issues.push("sports row 6 is missing course or teacher formula/cell captures");
  }
  if (result.recapture_required_addresses.length > 0) {
    issues.push(`composition recapture required: ${result.recapture_required_addresses.join(",")}`);
  }
  if (!result.context_group) issues.push("sports row 6 is missing the A-C context group image");
  return { passed: issues.length === 0, issues };
}

export function buildSmokeCaptureQa(options: {
  inventory: SmokeReuseRecaptureInventory;
  contextIndex: SmokeContextIndex;
  captures: readonly SmokeCellCapture[];
  sportsRow6: SmokeRowCaptureResult | null;
  probeNotes?: readonly SmokeProbeNote[];
  reusedRecordSha256s?: ReadonlyMap<string, string>;
  compositionFailures?: readonly { key?: string; address?: string; issues: string[] }[];
}): SmokeCaptureQa {
  const issues: string[] = [];
  const reviews = options.inventory.sheets.flatMap((sheet) => sheet.rows.flatMap((row) => row.reviews));
  if (reviews.length !== 184) issues.push(`expected 184 review cells, got ${reviews.length}`);
  const keys = reviews.map((item) => item.key);
  if (new Set(keys).size !== keys.length) issues.push("duplicate review keys");
  for (const review of reviews) {
    if (review.action === "missing" || !review.terminal_status) issues.push(`missing terminal status: ${review.key}`);
    if (review.action === "reuse" || review.action === "reuse_as_overflow") {
      const previous = options.reusedRecordSha256s?.get(review.key);
      if (previous && previous !== review.record_sha256) issues.push(`reuse hash changed: ${review.key}`);
    }
  }
  const recaptureKeys = reviews.filter((item) => item.action === "recapture").map((item) => item.key);
  const recaptureCaptures = options.captures.filter((item) => item.recapture && item.role === "review");
  const recaptureByAddress = new Map(recaptureCaptures.map((item) => [`${item.worksheet}|${parseAddress(item.address).row}|${parseAddress(item.address).column}`, item]));
  let distinctRecaptureImages = 0;
  for (const key of recaptureKeys) {
    const capture = recaptureByAddress.get(key);
    if (!capture?.formula_image || !capture.cell_image) {
      issues.push(`recapture missing formula/cell images: ${key}`);
      continue;
    }
    if (capture.formula_image.sha256 === capture.cell_image.sha256) {
      issues.push(`recapture formula/cell hash collision: ${key}`);
      continue;
    }
    distinctRecaptureImages += 1;
  }
  const sportsRow6 = options.sportsRow6 ? evaluateSportsRow6(options.sportsRow6, options.inventory) : { passed: false, issues: ["sports row 6 has not been captured"] };
  issues.push(...sportsRow6.issues);
  for (const failure of options.compositionFailures ?? []) {
    const label = failure.key ?? failure.address ?? "cell";
    issues.push(`composition rejected: ${label}: ${failure.issues.join("; ")}`);
  }
  if (options.contextIndex.pending_walk_up_rows > 0) {
    issues.push(`context index still has ${options.contextIndex.pending_walk_up_rows} unresolved course spans`);
  }
  for (const note of options.probeNotes ?? []) {
    if (!note.target_address || !note.active_address || !note.old_failure || !note.new_result) {
      issues.push(`probe note is incomplete: ${note.purpose}`);
    }
  }
  const status: SmokeQaStatus = issues.some((issue) => issue.includes("hash changed") || issue.includes("duplicate"))
    ? "manifest_mismatch"
    : issues.length > 0
      ? "recapture_required"
      : "accepted";
  const content = {
    contract_version: SMOKE_CAPTURE_QA_VERSION,
    status,
    issues,
    review_cells: reviews.length,
    reuse_unchanged: reviews.filter((item) => item.action === "reuse" || item.action === "reuse_as_overflow").length,
    recapture_with_distinct_images: distinctRecaptureImages,
    sports_row6_passed: sportsRow6.passed,
    probe_notes: options.probeNotes?.length ?? 0,
    full_sheet_recapture: false as const,
    review_workflow_implemented: false as const,
    wrote_tencent_or_business_db: false as const,
    read_only: true as const,
  };
  return { ...content, qa_sha256: sha256(stableJson(content)) };
}

export function freezeSmokeManifest(options: {
  matrix: FormulaBarMatrixPlan;
  inventory: SmokeReuseRecaptureInventory;
  contextIndex: SmokeContextIndex;
  qa: SmokeCaptureQa;
}): SmokeCaptureManifest {
  if (options.qa.status !== "accepted") throw new Error("smoke manifest can be frozen only after accepted Capture QA");
  const reuseRecordSha256s = Object.fromEntries(
    options.inventory.sheets.flatMap((sheet) => sheet.rows.flatMap((row) => row.reviews
      .filter((review) => (review.action === "reuse" || review.action === "reuse_as_overflow") && review.record_sha256)
      .map((review) => [review.key, review.record_sha256!]))),
  );
  const recaptureKeys = options.inventory.sheets.flatMap((sheet) => sheet.rows.flatMap((row) => (
    row.reviews.filter((review) => review.action === "recapture").map((review) => review.key)
  )));
  const content = {
    contract_version: SMOKE_MANIFEST_VERSION,
    matrix_plan_sha256: options.matrix.plan_sha256,
    inventory_sha256: options.inventory.inventory_sha256,
    context_index_sha256: options.contextIndex.context_index_sha256,
    qa_status: options.qa.status,
    qa_sha256: options.qa.qa_sha256,
    recapture_keys: recaptureKeys,
    reuse_record_sha256s: reuseRecordSha256s,
  };
  return { ...content, manifest_sha256: sha256(stableJson(content)) };
}

export function renderSmokeInventoryMarkdown(inventory: SmokeReuseRecaptureInventory): string {
  const lines = [
    "# Smoke reuse / recapture inventory",
    "",
    `Generated from ${inventory.source_evidence_root}. No formula-bar values included.`,
    "",
    "## Totals",
    "",
    `- review_cells: ${inventory.totals.review_cells}`,
    `- reuse: ${inventory.totals.reuse}`,
    `- reuse_as_overflow: ${inventory.totals.reuse_as_overflow}`,
    `- recapture: ${inventory.totals.recapture}`,
    `- missing_evidence: ${inventory.totals.missing_evidence}`,
    `- inspect: ${inventory.totals.inspect}`,
    `- context_missing: ${inventory.totals.context_missing}`,
    "",
  ];
  for (const sheet of inventory.sheets) {
    const layout = smokeSheetLayout(sheet.worksheet);
    lines.push(`## ${sheet.worksheet}`, "");
    lines.push(`- smoke rows: ${sheet.smoke_rows[0]}-${sheet.smoke_rows[1]}`);
    lines.push(`- review columns: ${sheet.review_columns.join(",")}`);
    lines.push(`- context: course ${layout.course_column}, teacher ${layout.teacher_column}${layout.teacher_unconfirmed ? " (unconfirmed)" : ""}`);
    lines.push(`- hidden: ${layout.hidden_columns.join(",")}`);
    lines.push(`- terminal_status: ${JSON.stringify(sheet.terminal_status_counts)}`);
    lines.push("");
    lines.push("| row | review reuse | recapture | overflow | missing | notes |");
    lines.push("|---|---:|---:|---:|---:|---|");
    for (const row of sheet.rows) {
      const reuse = row.reviews.filter((item) => item.action === "reuse").length;
      const recapture = row.reviews.filter((item) => item.action === "recapture");
      const overflow = row.reviews.filter((item) => item.action === "reuse_as_overflow").length;
      const missing = row.reviews.filter((item) => item.action === "missing").length;
      lines.push(`| ${row.row} | ${reuse} | ${recapture.length} | ${overflow} | ${missing} | ${recapture.map((item) => item.address).join(" ")} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}`;
}

export function evidenceToSmokeSource(evidence: {
  key: string;
  worksheet: string;
  row: number;
  column: string;
  target_address: string;
  terminal_status: SmokeSourceReviewEvidence["terminal_status"];
  correspondence: string;
  conflict_reason: string | null;
  halt_batch: boolean;
  formula_bar_nonempty: boolean | null;
  formula_bar_text_sha256: string | null;
  record_sha256: string;
  evidence: { cell_image: { sha256: string } | null; conflict_image: { sha256: string } | null };
}): SmokeSourceReviewEvidence {
  return {
    key: evidence.key,
    worksheet: evidence.worksheet,
    row: evidence.row,
    column: evidence.column,
    target_address: evidence.target_address,
    terminal_status: evidence.terminal_status,
    correspondence: evidence.correspondence,
    conflict_reason: evidence.conflict_reason,
    halt_batch: evidence.halt_batch,
    formula_bar_nonempty: evidence.formula_bar_nonempty,
    formula_bar_text_sha256: evidence.formula_bar_text_sha256,
    record_sha256: evidence.record_sha256,
    evidence: {
      cell_image: evidence.evidence.cell_image ? { sha256: evidence.evidence.cell_image.sha256 } : null,
      conflict_image: evidence.evidence.conflict_image ? { sha256: evidence.evidence.conflict_image.sha256 } : null,
    },
  };
}

function buildInventoryRow(
  layout: SmokeSheetLayout,
  row: number,
  columns: string[],
  evidenceByKey: ReadonlyMap<string, SmokeSourceReviewEvidence>,
): SmokeInventoryRow {
  return {
    row,
    context: [
      {
        role: "course_anchor",
        column: layout.course_column,
        address: `${layout.course_column}${row}`,
        action: "capture_context",
        reason: "course/teacher cells are outside the frozen review matrix",
      },
      {
        role: "teacher",
        column: layout.teacher_column,
        address: `${layout.teacher_column}${row}`,
        action: "capture_context",
        reason: layout.teacher_unconfirmed
          ? "teacher column inferred as last context column; confirm via formula bar"
          : "teacher cell is outside the frozen review matrix",
      },
    ],
    reviews: columns.map((column) => {
      const key = `${layout.worksheet}|${row}|${column}`;
      const evidence = evidenceByKey.get(key) ?? null;
      if (evidence && (evidence.key !== key || evidence.worksheet !== layout.worksheet || evidence.row !== row || evidence.column !== column)) {
        throw new Error(`smoke evidence identity mismatch: ${key}`);
      }
      const classified = classifySmokeReview(evidence);
      const cellImage = evidence?.evidence.cell_image?.sha256 ?? null;
      const conflictImage = evidence?.evidence.conflict_image?.sha256 ?? null;
      return {
        key,
        address: `${column}${row}`,
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
      };
    }),
  };
}

function assertInventoryHasNoReviewBodies(
  inventory: Omit<SmokeReuseRecaptureInventory, "inventory_sha256">,
) {
  const encoded = JSON.stringify(inventory);
  if (encoded.includes("formula_bar_value") || encoded.includes("visible_cell_text")) {
    throw new Error("smoke inventory must not include formula-bar values or visible-cell text");
  }
}

function indexReads(reads: readonly { worksheet: string; row: number; address: string; formula_bar_value: string }[]) {
  return new Map(reads.map((item) => [`${item.worksheet}|${item.row}`, item]));
}

function courseReadForRow(
  worksheet: string,
  row: number,
  layout: SmokeSheetLayout,
  courseBySheetRow: ReadonlyMap<string, SmokeCourseRead>,
) {
  const own = courseBySheetRow.get(`${worksheet}|${row}`);
  if (!own) {
    return row === layout.first_row ? nearestNonemptyCourse(worksheet, row, courseBySheetRow) : null;
  }
  if (own.formula_bar_value.length > 0) return own;
  return nearestNonemptyCourse(worksheet, row - 1, courseBySheetRow);
}

function nearestNonemptyCourse(
  worksheet: string,
  startRow: number,
  courseBySheetRow: ReadonlyMap<string, SmokeCourseRead>,
) {
  for (let current = startRow; current >= 1; current -= 1) {
    const read = courseBySheetRow.get(`${worksheet}|${current}`);
    if (read && read.formula_bar_value.length > 0) return read;
  }
  return null;
}

function assignCourseSpans(rows: SmokeContextRow[]): SmokeContextRow[] {
  return rows.map((row) => {
    if (row.course_anchor_row === null) return row;
    const group = rows.filter((item) => item.course_anchor_row === row.course_anchor_row).map((item) => item.row);
    return {
      ...row,
      course_span: { first_row: row.course_anchor_row, last_row: Math.max(...group) },
    };
  });
}

function contextGroupName(firstRow: number, lastRow: number, label: string) {
  return `rows${String(firstRow).padStart(3, "0")}-${String(lastRow).padStart(3, "0")}_context-${label}.jpg`;
}

function contiguousWithPrevious(previous: string, current: string) {
  const left = parseAddress(previous);
  const right = parseAddress(current);
  return left.row === right.row && columnNumber(right.column) === columnNumber(left.column) + 1;
}

function blockedResult(
  actions: string[],
  captures: SmokeCellCapture[],
  blanksConfirmed: string[],
  recaptureRequired: string[],
  courseAnchorAddress: string | null,
  block: { reason: string; target: string; active: string; conflict: SmokeImageRef | null },
): SmokeRowCaptureResult {
  return {
    status: "blocked",
    stop_reason: block.reason,
    target_address: block.target,
    active_address: block.active,
    actions,
    captures,
    blanks_confirmed: blanksConfirmed,
    course_anchor_address: courseAnchorAddress,
    context_group: null,
    conflict_image: block.conflict,
    recapture_required_addresses: recaptureRequired,
  };
}

function buildCaptureRecord(input: {
  worksheet: string;
  address: string;
  role: "course" | "teacher" | "review";
  recapture: boolean;
  bindReuseSha256: string | null;
  reads: { active_addresses: readonly [string, string]; value: string };
  formulaImage: SmokeImageRef;
  cellImage: SmokeImageRef;
  truncated: boolean;
  capturedAt: string;
}): SmokeCellCapture {
  const firstRead = { sequence: 1 as const, value: input.reads.value, sha256: sha256(input.reads.value) };
  const secondRead = { sequence: 2 as const, value: input.reads.value, sha256: sha256(input.reads.value) };
  const content = {
    contract_version: SMOKE_CELL_CAPTURE_VERSION,
    worksheet: input.worksheet,
    address: input.address,
    role: input.role,
    recapture: input.recapture,
    rewrite_source_json: false as const,
    bind_reuse_sha256: input.bindReuseSha256,
    active_addresses: input.reads.active_addresses,
    formula_bar_reads: [firstRead, secondRead] as const,
    formula_bar_value: input.reads.value,
    formula_bar_text_sha256: firstRead.sha256,
    formula_truncated_dom_authoritative: input.truncated,
    formula_image: input.formulaImage,
    cell_image: input.cellImage,
    read_only: true as const,
    captured_at: input.capturedAt,
  };
  return { ...content, record_sha256: sha256(stableJson(content)) };
}

function parseAddress(address: string) {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address.trim());
  if (!match) throw new Error(`invalid cell address: ${address}`);
  return { address: `${match[1].toUpperCase()}${match[2]}`, column: match[1].toUpperCase(), row: Number(match[2]) };
}

function normalizeAddress(address: string) {
  return parseAddress(address).address;
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
