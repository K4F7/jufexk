import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  captureFormulaBarCell,
  type FormulaBarCellSource,
  type FormulaBarEvidence,
  validateFormulaBarEvidence,
} from "./formula_bar";

export const FORMULA_BAR_SMOKE_TARGETS_VERSION = "formula-bar-smoke-targets-v1" as const;
export const FORMULA_BAR_SMOKE_GATE_VERSION = "formula-bar-smoke-gate-v1" as const;

const WORKSHEET_ORDER = [
  "主要课程",
  "体育课",
  "外教",
  "大英和视听说",
  "思政课",
  "数学课",
  "美育",
  "MOOC",
] as const;

export type HistoricalEvaluationForSmoke = {
  evaluation_id: string;
  worksheet: string;
  source_row: number;
  source_column: string;
  comment: string;
};

export type FormulaBarSmokeTarget = {
  key: string;
  group_id: string;
  worksheet: string;
  row: number;
  column: string;
  address: string;
  expected_visible_text: string;
  expected_visible_text_sha256: string;
  existing_evaluation_ids: string[];
};

export type FormulaBarSmokeTargetSet = {
  contract_version: typeof FORMULA_BAR_SMOKE_TARGETS_VERSION;
  source_rows: number;
  group_count: number;
  target_count: number;
  worksheets: Array<{ worksheet: string; groups: number; targets: number; first_address: string; last_address: string }>;
  targets: FormulaBarSmokeTarget[];
  target_set_sha256: string;
};

export type FormulaBarManualExpectation = {
  key: string;
  terminal_status: FormulaBarEvidence["terminal_status"];
};

export type FormulaBarManualResolution = {
  key: string;
  evidence_record_sha256: string;
  cell_image_sha256: string;
  terminal_status: Exclude<FormulaBarEvidence["terminal_status"], "evidence_conflict">;
  reason: "visual_formula_correspondence_confirmed";
};

export function buildStrongSuspectTargetSet(
  evaluations: HistoricalEvaluationForSmoke[],
  expected = { groups: 52, targets: 110 },
): FormulaBarSmokeTargetSet {
  const identities = new Set<string>();
  const grouped = new Map<string, HistoricalEvaluationForSmoke[]>();
  for (const evaluation of evaluations) {
    validateEvaluation(evaluation);
    const identity = `${evaluation.worksheet}|${evaluation.source_row}|${evaluation.source_column.toUpperCase()}`;
    if (identities.has(identity)) throw new Error(`duplicate historical evaluation source key: ${identity}`);
    identities.add(identity);
    const duplicateKey = stableJson([
      evaluation.worksheet,
      evaluation.source_row,
      evaluation.comment,
    ]);
    const group = grouped.get(duplicateKey) ?? [];
    group.push(evaluation);
    grouped.set(duplicateKey, group);
  }

  const targets = [...grouped.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) => {
      const ordered = [...group].sort(compareEvaluation);
      const representative = ordered[0];
      const groupId = sha256(stableJson([
        representative.worksheet,
        representative.source_row,
        representative.comment,
      ]));
      const evaluationIds = ordered.map((item) => item.evaluation_id).sort();
      return ordered.map((item) => {
        const column = item.source_column.toUpperCase();
        return {
          key: `${item.worksheet}|${item.source_row}|${column}`,
          group_id: groupId,
          worksheet: item.worksheet,
          row: item.source_row,
          column,
          address: `${column}${item.source_row}`,
          expected_visible_text: item.comment,
          expected_visible_text_sha256: sha256(item.comment),
          existing_evaluation_ids: evaluationIds,
        };
      });
    })
    .sort(compareTarget);

  const groupCount = new Set(targets.map((target) => target.group_id)).size;
  if (groupCount !== expected.groups || targets.length !== expected.targets) {
    throw new Error(
      `strong-suspect scope mismatch: expected ${expected.groups} groups/${expected.targets} targets, got ${groupCount}/${targets.length}`,
    );
  }
  const worksheets = WORKSHEET_ORDER.map((worksheet) => {
    const selected = targets.filter((target) => target.worksheet === worksheet);
    return selected.length === 0 ? null : {
      worksheet,
      groups: new Set(selected.map((target) => target.group_id)).size,
      targets: selected.length,
      first_address: selected[0].address,
      last_address: selected[selected.length - 1].address,
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  const content = {
    contract_version: FORMULA_BAR_SMOKE_TARGETS_VERSION,
    source_rows: evaluations.length,
    group_count: groupCount,
    target_count: targets.length,
    worksheets,
    targets,
  };
  return { ...content, target_set_sha256: sha256(stableJson(content)) };
}

export function validateSmokeTargetSet(value: unknown): asserts value is FormulaBarSmokeTargetSet {
  if (!isRecord(value) || value.contract_version !== FORMULA_BAR_SMOKE_TARGETS_VERSION
    || !Array.isArray(value.targets) || !Array.isArray(value.worksheets)
    || !Number.isInteger(value.source_rows) || !Number.isInteger(value.group_count)
    || !Number.isInteger(value.target_count) || typeof value.target_set_sha256 !== "string") {
    throw new Error("invalid formula-bar smoke target contract");
  }
  const { target_set_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.target_set_sha256) {
    throw new Error("formula-bar smoke target hash mismatch");
  }
  const keys = new Set<string>();
  for (const target of value.targets) {
    if (!isRecord(target) || typeof target.key !== "string" || typeof target.group_id !== "string"
      || typeof target.worksheet !== "string" || !Number.isInteger(target.row)
      || typeof target.column !== "string" || typeof target.address !== "string"
      || target.address !== `${target.column}${target.row}`
      || target.key !== `${target.worksheet}|${target.row}|${target.column}`
      || typeof target.expected_visible_text !== "string"
      || target.expected_visible_text_sha256 !== sha256(target.expected_visible_text)
      || !Array.isArray(target.existing_evaluation_ids) || target.existing_evaluation_ids.length < 2) {
      throw new Error("invalid formula-bar smoke target");
    }
    if (keys.has(target.key)) throw new Error(`duplicate formula-bar smoke target: ${target.key}`);
    keys.add(target.key);
  }
  if (value.target_count !== value.targets.length
    || value.group_count !== new Set(value.targets.map((target: any) => target.group_id)).size) {
    throw new Error("formula-bar smoke target counts do not close");
  }
}

export async function captureFormulaBarSmoke(
  targetSet: FormulaBarSmokeTargetSet,
  createSource: (target: FormulaBarSmokeTarget) => FormulaBarCellSource,
  persist: (target: FormulaBarSmokeTarget, evidence: FormulaBarEvidence) => Promise<void>,
) {
  validateSmokeTargetSet(targetSet);
  const captured: FormulaBarEvidence[] = [];
  for (const target of targetSet.targets) {
    const evidence = await captureFormulaBarCell(
      { worksheet: target.worksheet, address: target.address },
      createSource(target),
      { force_cell_image: true },
    );
    await persist(target, evidence);
    captured.push(evidence);
    if (evidence.halt_batch) break;
  }
  return captured;
}

export function buildFormulaBarSmokeGate(
  targetSet: FormulaBarSmokeTargetSet,
  evidence: FormulaBarEvidence[],
  manualExpectations: FormulaBarManualExpectation[] = [],
  manualResolutions: FormulaBarManualResolution[] = [],
) {
  validateSmokeTargetSet(targetSet);
  const targetByKey = new Map(targetSet.targets.map((target) => [target.key, target]));
  const evidenceByKey = new Map<string, FormulaBarEvidence>();
  for (const item of evidence) {
    validateFormulaBarEvidence(item);
    if (!targetByKey.has(item.key)) throw new Error(`unexpected smoke evidence key: ${item.key}`);
    if (evidenceByKey.has(item.key)) throw new Error(`duplicate smoke evidence key: ${item.key}`);
    evidenceByKey.set(item.key, item);
  }

  const missingKeys = targetSet.targets.filter((target) => !evidenceByKey.has(target.key)).map((target) => target.key);
  const orderedEvidence = targetSet.targets.flatMap((target) => {
    const item = evidenceByKey.get(target.key);
    return item ? [item] : [];
  });
  const addressBound = orderedEvidence.filter((item) => item.active_addresses.length === 2
    && item.active_addresses.every((address) => address === item.target_address)).length;
  const stableDoubleReads = orderedEvidence.filter((item) => item.formula_bar_reads.length === 2
    && item.formula_bar_reads[0].value === item.formula_bar_reads[1].value).length;
  const imageBacked = orderedEvidence.filter((item) => item.evidence.cell_image !== null
    || item.evidence.conflict_image !== null).length;
  const resolutionByKey = new Map<string, FormulaBarManualResolution>();
  for (const resolution of manualResolutions) {
    const item = evidenceByKey.get(resolution.key);
    if (!item || item.terminal_status !== "evidence_conflict"
      || item.record_sha256 !== resolution.evidence_record_sha256
      || item.evidence.cell_image?.sha256 !== resolution.cell_image_sha256
      || resolution.reason !== "visual_formula_correspondence_confirmed") {
      throw new Error(`invalid or stale manual smoke resolution: ${resolution.key}`);
    }
    if (resolutionByKey.has(resolution.key)) throw new Error(`duplicate manual smoke resolution: ${resolution.key}`);
    resolutionByKey.set(resolution.key, resolution);
  }
  const rawConflicts = orderedEvidence.filter((item) => item.terminal_status === "evidence_conflict");
  const conflicts = rawConflicts.filter((item) => !resolutionByKey.has(item.key));
  const effectiveStatus = (item: FormulaBarEvidence) => resolutionByKey.get(item.key)?.terminal_status ?? item.terminal_status;
  const statusCounts = Object.fromEntries([
    "review_origin",
    "horizontal_overflow_blank",
    "ordinary_blank",
    "evidence_conflict",
  ].map((status) => [status, orderedEvidence.filter((item) => effectiveStatus(item) === status).length]));
  const manualMismatches = manualExpectations.flatMap((expectation) => {
    const item = evidenceByKey.get(expectation.key);
    return item?.terminal_status === expectation.terminal_status ? [] : [{
      key: expectation.key,
      expected: expectation.terminal_status,
      actual: item?.terminal_status ?? "missing",
    }];
  });
  const pass = missingKeys.length === 0
    && orderedEvidence.length === targetSet.target_count
    && addressBound === targetSet.target_count
    && stableDoubleReads === targetSet.target_count
    && imageBacked === targetSet.target_count
    && conflicts.length === 0
    && manualMismatches.length === 0;
  const content = {
    contract_version: FORMULA_BAR_SMOKE_GATE_VERSION,
    target_set_sha256: targetSet.target_set_sha256,
    scope: targetSet.worksheets,
    counts: {
      planned: targetSet.target_count,
      captured: orderedEvidence.length,
      address_bound: addressBound,
      stable_double_reads: stableDoubleReads,
      image_backed: imageBacked,
      raw_conflicts: rawConflicts.length,
      resolved_conflicts: resolutionByKey.size,
      conflicts: conflicts.length,
      missing: missingKeys.length,
      manual_expectations: manualExpectations.length,
      manual_mismatches: manualMismatches.length,
      terminal_statuses: statusCounts,
    },
    missing_keys: missingKeys,
    conflict_keys: conflicts.map((item) => item.key),
    manual_resolutions: manualResolutions,
    manual_mismatches: manualMismatches,
    evidence_content_sha256: sha256(stableJson(orderedEvidence.map((item) => item.record_sha256))),
    conclusion: pass ? "pass" as const : "blocked" as const,
    full_scan_allowed: pass,
    read_only: orderedEvidence.every((item) => item.read_only === true),
  };
  return { ...content, gate_sha256: sha256(stableJson(content)) };
}

export async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function validateEvaluation(value: HistoricalEvaluationForSmoke) {
  if (!value || typeof value.evaluation_id !== "string" || !value.evaluation_id
    || typeof value.worksheet !== "string" || !value.worksheet
    || !Number.isInteger(value.source_row) || value.source_row < 1
    || typeof value.source_column !== "string" || !/^[A-Z]+$/i.test(value.source_column)
    || typeof value.comment !== "string") {
    throw new Error("invalid historical evaluation for formula-bar smoke");
  }
}

function compareEvaluation(left: HistoricalEvaluationForSmoke, right: HistoricalEvaluationForSmoke) {
  return compareWorksheet(left.worksheet, right.worksheet)
    || left.source_row - right.source_row
    || columnNumber(left.source_column) - columnNumber(right.source_column);
}

function compareTarget(left: FormulaBarSmokeTarget, right: FormulaBarSmokeTarget) {
  return compareWorksheet(left.worksheet, right.worksheet)
    || left.row - right.row
    || columnNumber(left.column) - columnNumber(right.column);
}

function compareWorksheet(left: string, right: string) {
  const leftIndex = WORKSHEET_ORDER.indexOf(left as any);
  const rightIndex = WORKSHEET_ORDER.indexOf(right as any);
  return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
    - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
    || left.localeCompare(right);
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
