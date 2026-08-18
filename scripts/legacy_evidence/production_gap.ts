import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  buildFrozenFormulaBarMatrixPlan,
  validateFormulaBarMatrixPlan,
  type FormulaBarMatrixPlan,
} from "./formula_bar_locator";

export const PRODUCTION_GAP_INVENTORY_VERSION = "production-gap-inventory-v1" as const;
export const PRODUCTION_GAP_SMOKE_SHEETS = ["大英和视听说", "思政课", "体育课"] as const;

const TERMINAL_STATUSES = [
  "review_origin",
  "horizontal_overflow_blank",
  "ordinary_blank",
  "evidence_conflict",
] as const;

export type FormulaBarGapTerminalStatus = (typeof TERMINAL_STATUSES)[number];
export type ProductionGapPartition =
  | "in_production"
  | "packaged_not_imported"
  | "never_packaged"
  | "not_a_review";

export type FormulaBarGapEvidence = {
  key: string;
  terminal_status: FormulaBarGapTerminalStatus;
  formula_bar_nonempty: boolean | null;
  halt_batch: boolean;
  record_sha256: string | null;
};

export type NamedSourceRecords = {
  name: string;
  records: unknown[];
};

export type ProductionGapCell = {
  key: string;
  worksheet: string;
  row: number;
  column: string;
  terminal_status: FormulaBarGapTerminalStatus;
  formula_bar_nonempty: boolean | null;
  halt_batch: boolean;
  partition: ProductionGapPartition;
  production_batches: string[];
  record_sha256: string | null;
  course_anchor: "missing_context";
};

export type ProductionGapSheetCounts = {
  worksheet: string;
  planned_cells: number;
  nonempty_cells: number;
  in_production: number;
  packaged_not_imported: number;
  never_packaged: number;
  not_a_review: number;
  halt_batch: number;
  never_packaged_rows: number[];
  course_anchor: "missing_context";
};

export type ProductionGapDuplicateKey = {
  key: string;
  batches: string[];
};

export type ProductionGapLaterCaptureBucket = {
  worksheets: string[];
  cell_count: number;
  keys: string[];
};

export type ProductionGapInventory = {
  contract_version: typeof PRODUCTION_GAP_INVENTORY_VERSION;
  plan_sha256: string;
  planned_rows: number;
  planned_cells: number;
  production_records: number;
  production_unique_keys: number;
  production_missing_from_formula: number;
  production_missing_from_formula_keys: string[];
  cells: ProductionGapCell[];
  sheets: ProductionGapSheetCounts[];
  never_packaged_rows: Array<{ worksheet: string; rows: number[] }>;
  duplicate_production_keys: ProductionGapDuplicateKey[];
  later_capture: {
    smoke: ProductionGapLaterCaptureBucket;
    non_smoke: ProductionGapLaterCaptureBucket;
  };
  course_anchor: "missing_context";
  inventory_sha256: string;
};

export type ProductionGapCliOptions = {
  formulaBarDir: string;
  production: Array<{ name: string; path: string }>;
  unimported: Array<{ name: string; path: string }>;
  outDir: string;
  plan?: FormulaBarMatrixPlan;
};

const EVIDENCE_KEEP = new Set([
  "key",
  "terminal_status",
  "formula_bar_nonempty",
  "halt_batch",
  "record_sha256",
]);

const JSONL_KEEP = new Set(["worksheet", "source_row", "source_column", "evaluation"]);

export function isReviewLike(evidence: Pick<FormulaBarGapEvidence, "terminal_status" | "formula_bar_nonempty">) {
  return evidence.terminal_status === "review_origin"
    || evidence.terminal_status === "evidence_conflict"
    || evidence.formula_bar_nonempty === true;
}

export function classifyProductionGapCell(options: {
  evidence: Pick<FormulaBarGapEvidence, "terminal_status" | "formula_bar_nonempty">;
  inProduction: boolean;
  inUnimported: boolean;
}): ProductionGapPartition {
  if (options.inProduction) return "in_production";
  if (options.inUnimported && isReviewLike(options.evidence)) return "packaged_not_imported";
  if (isReviewLike(options.evidence)) return "never_packaged";
  return "not_a_review";
}

export function pickFormulaBarGapFields(value: unknown): FormulaBarGapEvidence | null {
  if (!isRecord(value) || typeof value.key !== "string") return null;
  if (!parseMatrixKey(value.key, false)) return null;
  if (!isTerminalStatus(value.terminal_status)) {
    throw new Error(`invalid formula-bar gap terminal_status for ${value.key}`);
  }
  if (value.formula_bar_nonempty !== true && value.formula_bar_nonempty !== false && value.formula_bar_nonempty !== null) {
    throw new Error(`invalid formula-bar gap formula_bar_nonempty for ${value.key}`);
  }
  if (typeof value.halt_batch !== "boolean") {
    throw new Error(`invalid formula-bar gap halt_batch for ${value.key}`);
  }
  if (value.record_sha256 != null && (typeof value.record_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.record_sha256))) {
    throw new Error(`invalid formula-bar gap record_sha256 for ${value.key}`);
  }
  return {
    key: value.key,
    terminal_status: value.terminal_status,
    formula_bar_nonempty: value.formula_bar_nonempty,
    halt_batch: value.halt_batch,
    record_sha256: value.record_sha256 ?? null,
  };
}

export function sourceKeyFromRecord(record: unknown, origin = "jsonl"): string {
  const root = isRecord(record) ? record : null;
  const nested = root && isRecord(root.evaluation) ? root.evaluation : null;
  const worksheet = pickString(root, "worksheet") ?? pickString(nested, "worksheet");
  const sourceRow = pickInteger(root, "source_row") ?? pickInteger(nested, "source_row");
  const sourceColumn = pickString(root, "source_column") ?? pickString(nested, "source_column");
  if (!worksheet || sourceRow == null || !sourceColumn || !/^[A-Z]+$/i.test(sourceColumn)) {
    throw new Error(`invalid source identity in ${origin}`);
  }
  return `${worksheet}|${sourceRow}|${sourceColumn.toUpperCase()}`;
}

export function parseProductionGapArgs(argv: string[]): ProductionGapCliOptions {
  const formulaBarDir = requiredOption(argv, "--formula-bar-dir");
  const outDir = requiredOption(argv, "--out");
  const production = namedPathOptions(argv, "--production");
  const unimported = namedPathOptions(argv, "--unimported");
  for (const item of unimported) {
    if (item.name === "other-excluded") {
      throw new Error("do not pass other-excluded as --unimported");
    }
  }
  return { formulaBarDir, production, unimported, outDir };
}

export function buildProductionGapInventory(options: {
  plan?: FormulaBarMatrixPlan;
  evidence: FormulaBarGapEvidence[];
  production: NamedSourceRecords[];
  unimported: NamedSourceRecords[];
}): ProductionGapInventory {
  const plan = options.plan ?? buildFrozenFormulaBarMatrixPlan();
  validateFormulaBarMatrixPlan(plan);
  for (const item of options.unimported) {
    if (item.name === "other-excluded") {
      throw new Error("do not pass other-excluded as --unimported");
    }
  }

  const plannedKeys: string[] = [];
  const plannedSet = new Set<string>();
  for (const sheet of plan.sheets) {
    for (const row of sheet.rows) {
      for (const column of row.columns) {
        const key = `${sheet.worksheet}|${row.row}|${column}`;
        plannedKeys.push(key);
        plannedSet.add(key);
      }
    }
  }

  const evidenceByKey = new Map<string, FormulaBarGapEvidence>();
  for (const item of options.evidence) {
    if (evidenceByKey.has(item.key)) throw new Error(`duplicate formula-bar gap evidence: ${item.key}`);
    evidenceByKey.set(item.key, item);
  }

  const productionKeys = collectNamedKeys(options.production, plannedSet);
  const unimportedKeys = collectNamedKeys(options.unimported, plannedSet);
  const productionMissing = [...productionKeys.outsidePlan].sort(compareMatrixKey);

  const cells: ProductionGapCell[] = plannedKeys.map((key) => {
    const parsed = parseMatrixKey(key);
    const evidence = evidenceByKey.get(key);
    if (!evidence) throw new Error(`missing formula-bar evidence: ${key}`);
    const productionBatches = productionKeys.batchesByKey.get(key) ?? [];
    return {
      key,
      worksheet: parsed.worksheet,
      row: parsed.row,
      column: parsed.column,
      terminal_status: evidence.terminal_status,
      formula_bar_nonempty: evidence.formula_bar_nonempty,
      halt_batch: evidence.halt_batch,
      partition: classifyProductionGapCell({
        evidence,
        inProduction: productionBatches.length > 0,
        inUnimported: (unimportedKeys.batchesByKey.get(key)?.length ?? 0) > 0,
      }),
      production_batches: productionBatches,
      record_sha256: evidence.record_sha256,
      course_anchor: "missing_context",
    };
  });

  const sheets = plan.sheets.map((sheet) => {
    const sheetCells = cells.filter((cell) => cell.worksheet === sheet.worksheet);
    const neverPackagedRows = [...new Set(
      sheetCells.filter((cell) => cell.partition === "never_packaged").map((cell) => cell.row),
    )].sort((left, right) => left - right);
    return {
      worksheet: sheet.worksheet,
      planned_cells: sheet.planned_cells,
      nonempty_cells: sheetCells.filter((cell) => cell.formula_bar_nonempty === true).length,
      in_production: countPartition(sheetCells, "in_production"),
      packaged_not_imported: countPartition(sheetCells, "packaged_not_imported"),
      never_packaged: countPartition(sheetCells, "never_packaged"),
      not_a_review: countPartition(sheetCells, "not_a_review"),
      halt_batch: sheetCells.filter((cell) => cell.halt_batch).length,
      never_packaged_rows: neverPackagedRows,
      course_anchor: "missing_context" as const,
    };
  });

  const smokeSheetSet = new Set<string>(PRODUCTION_GAP_SMOKE_SHEETS);
  const smokeKeys = cells
    .filter((cell) => cell.partition === "never_packaged" && smokeSheetSet.has(cell.worksheet))
    .map((cell) => cell.key);
  const nonSmokeKeys = cells
    .filter((cell) => cell.partition === "never_packaged" && !smokeSheetSet.has(cell.worksheet))
    .map((cell) => cell.key);
  const planWorksheets = plan.sheets.map((sheet) => sheet.worksheet);

  const content = {
    contract_version: PRODUCTION_GAP_INVENTORY_VERSION,
    plan_sha256: plan.plan_sha256,
    planned_rows: plan.planned_rows,
    planned_cells: plan.planned_cells,
    production_records: productionKeys.recordCount,
    production_unique_keys: productionKeys.batchesByKey.size,
    production_missing_from_formula: productionMissing.length,
    production_missing_from_formula_keys: productionMissing,
    cells,
    sheets,
    never_packaged_rows: sheets.map((sheet) => ({
      worksheet: sheet.worksheet,
      rows: sheet.never_packaged_rows,
    })),
    duplicate_production_keys: [...productionKeys.batchesByKey.entries()]
      .filter(([, batches]) => batches.length > 1)
      .map(([key, batches]) => ({ key, batches }))
      .sort((left, right) => compareMatrixKey(left.key, right.key)),
    later_capture: {
      smoke: {
        worksheets: PRODUCTION_GAP_SMOKE_SHEETS.filter((worksheet) => planWorksheets.includes(worksheet)),
        cell_count: smokeKeys.length,
        keys: smokeKeys,
      },
      non_smoke: {
        worksheets: planWorksheets.filter((worksheet) => !smokeSheetSet.has(worksheet)),
        cell_count: nonSmokeKeys.length,
        keys: nonSmokeKeys,
      },
    },
    course_anchor: "missing_context" as const,
  };
  assertInventoryHasNoBodies(content);
  return { ...content, inventory_sha256: sha256(stableJson(content)) };
}

export function renderProductionGapMarkdown(inventory: ProductionGapInventory) {
  const lines = [
    "# Production gap inventory",
    "",
    `- contract: ${inventory.contract_version}`,
    `- plan_sha256: \`${inventory.plan_sha256}\``,
    `- inventory_sha256: \`${inventory.inventory_sha256}\``,
    `- planned_cells: ${inventory.planned_cells}`,
    `- production_records: ${inventory.production_records}`,
    `- production_unique_keys: ${inventory.production_unique_keys}`,
    `- production_missing_from_formula: ${inventory.production_missing_from_formula}`,
    `- later_capture smoke: ${inventory.later_capture.smoke.cell_count}`,
    `- later_capture non-smoke: ${inventory.later_capture.non_smoke.cell_count}`,
    `- course_anchor: ${inventory.course_anchor}`,
    "",
    "| worksheet | planned | nonempty | in_production | packaged_not_imported | never_packaged | halt_batch |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const sheet of inventory.sheets) {
    lines.push(`| ${sheet.worksheet} | ${sheet.planned_cells} | ${sheet.nonempty_cells} | ${sheet.in_production} | ${sheet.packaged_not_imported} | ${sheet.never_packaged} | ${sheet.halt_batch} |`);
  }
  lines.push(`| total | ${inventory.planned_cells} | ${sum(inventory.sheets, "nonempty_cells")} | ${sum(inventory.sheets, "in_production")} | ${sum(inventory.sheets, "packaged_not_imported")} | ${sum(inventory.sheets, "never_packaged")} | ${sum(inventory.sheets, "halt_batch")} |`);
  lines.push("", "## Duplicate production keys", "");
  if (inventory.duplicate_production_keys.length === 0) {
    lines.push("None.");
  } else {
    for (const item of inventory.duplicate_production_keys) {
      lines.push(`- \`${item.key}\`: ${item.batches.join(", ")}`);
    }
  }
  lines.push("", "## never_packaged rows", "");
  for (const sheet of inventory.never_packaged_rows) {
    lines.push(`### ${sheet.worksheet}`, "");
    lines.push(sheet.rows.length ? sheet.rows.join(", ") : "(none)");
    lines.push("");
  }
  lines.push("## later_capture", "");
  lines.push(`- smoke (${inventory.later_capture.smoke.worksheets.join(", ") || "none"}): ${inventory.later_capture.smoke.cell_count}`);
  lines.push(`- non-smoke (${inventory.later_capture.non_smoke.worksheets.join(", ") || "none"}): ${inventory.later_capture.non_smoke.cell_count}`);
  const markdown = `${lines.join("\n")}\n`;
  assertInventoryHasNoBodies(markdown);
  return markdown;
}

export async function writeProductionGapInventory(outDir: string, inventory: ProductionGapInventory) {
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, "production-gap-inventory.json");
  const markdownPath = join(outDir, "production-gap-inventory.md");
  await writeJsonAtomic(jsonPath, inventory);
  await writeFile(markdownPath, renderProductionGapMarkdown(inventory), "utf8");
  return { jsonPath, markdownPath };
}

export async function loadFormulaBarGapEvidence(dir: string): Promise<FormulaBarGapEvidence[]> {
  const files = await jsonFiles(dir);
  const items: FormulaBarGapEvidence[] = [];
  for (const path of files) {
    const raw = JSON.parse(await readFile(path, "utf8"), evidenceReviver);
    const picked = pickFormulaBarGapFields(raw);
    if (picked) items.push(picked);
  }
  return items;
}

export async function loadNamedJsonl(path: string): Promise<unknown[]> {
  const text = await readFile(path, "utf8");
  const records: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    records.push(JSON.parse(line, jsonlReviver));
  }
  return records;
}

export async function runProductionGap(options: ProductionGapCliOptions) {
  const plan = options.plan ?? buildFrozenFormulaBarMatrixPlan();
  const evidence = await loadFormulaBarGapEvidence(options.formulaBarDir);
  const production = await Promise.all(options.production.map(async (item) => ({
    name: item.name,
    records: await loadNamedJsonl(item.path),
  })));
  const unimported = await Promise.all(options.unimported.map(async (item) => ({
    name: item.name,
    records: await loadNamedJsonl(item.path),
  })));
  const inventory = buildProductionGapInventory({ plan, evidence, production, unimported });
  const written = await writeProductionGapInventory(options.outDir, inventory);
  return { inventory, ...written };
}

export function productionGapUsage() {
  return [
    "Usage:",
    "  pnpm run legacy-production-gap -- --formula-bar-dir <dir> --production <name>=<jsonl> [--production ...] [--unimported <name>=<jsonl> ...] --out <dir>",
  ].join("\n");
}

function collectNamedKeys(packages: NamedSourceRecords[], plannedSet: ReadonlySet<string>) {
  const batchesByKey = new Map<string, string[]>();
  const outsidePlan = new Set<string>();
  let recordCount = 0;
  for (const item of packages) {
    if (!item.name.trim()) throw new Error("source package name is required");
    const seen = new Set<string>();
    for (const [index, record] of item.records.entries()) {
      const key = sourceKeyFromRecord(record, `${item.name}:${index + 1}`);
      recordCount += 1;
      if (!plannedSet.has(key)) outsidePlan.add(key);
      if (seen.has(key)) continue;
      seen.add(key);
      const batches = batchesByKey.get(key) ?? [];
      batches.push(item.name);
      batchesByKey.set(key, batches);
    }
  }
  return { batchesByKey, outsidePlan, recordCount };
}

function countPartition(cells: ProductionGapCell[], partition: ProductionGapPartition) {
  return cells.filter((cell) => cell.partition === partition).length;
}

function sum(sheets: ProductionGapSheetCounts[], field: keyof Pick<ProductionGapSheetCounts, "nonempty_cells" | "in_production" | "packaged_not_imported" | "never_packaged" | "halt_batch">) {
  return sheets.reduce((total, sheet) => total + sheet[field], 0);
}

function namedPathOptions(argv: string[], flag: string) {
  const items: Array<{ name: string; path: string }> = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) continue;
    const raw = argv[index + 1];
    if (!raw) throw new Error(`missing ${flag} value`);
    const split = raw.indexOf("=");
    if (split <= 0 || split === raw.length - 1) throw new Error(`${flag} must be name=jsonl`);
    items.push({ name: raw.slice(0, split), path: raw.slice(split + 1) });
  }
  return items;
}

function requiredOption(argv: string[], flag: string) {
  const index = argv.indexOf(flag);
  if (index < 0 || !argv[index + 1]) throw new Error(`missing ${flag}`);
  return argv[index + 1];
}

function parseMatrixKey(key: string): { worksheet: string; row: number; column: string };
function parseMatrixKey(key: string, required: false): { worksheet: string; row: number; column: string } | null;
function parseMatrixKey(key: string, required = true) {
  const match = /^(.+)\|([1-9]\d*)\|([A-Z]+)$/.exec(key);
  if (!match) {
    if (!required) return null;
    throw new Error(`invalid matrix key: ${key}`);
  }
  return { worksheet: match[1], row: Number(match[2]), column: match[3] };
}

function compareMatrixKey(left: string, right: string) {
  const parsedLeft = parseMatrixKey(left);
  const parsedRight = parseMatrixKey(right);
  return parsedLeft.worksheet.localeCompare(parsedRight.worksheet)
    || parsedLeft.row - parsedRight.row
    || parsedLeft.column.localeCompare(parsedRight.column);
}

function pickString(record: Record<string, unknown> | null, field: string) {
  if (!record || typeof record[field] !== "string" || !record[field].trim()) return null;
  return record[field];
}

function pickInteger(record: Record<string, unknown> | null, field: string) {
  if (!record) return null;
  const value = record[field];
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return Number(value);
  return null;
}

function isTerminalStatus(value: unknown): value is FormulaBarGapTerminalStatus {
  return typeof value === "string" && (TERMINAL_STATUSES as readonly string[]).includes(value);
}

function evidenceReviver(key: string, value: unknown) {
  if (key === "" || EVIDENCE_KEEP.has(key)) return value;
  return undefined;
}

function jsonlReviver(key: string, value: unknown) {
  if (key === "" || JSONL_KEEP.has(key)) return value;
  return undefined;
}

function assertInventoryHasNoBodies(value: unknown) {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  if (
    encoded.includes("formula_bar_value")
    || encoded.includes("visible_cell_text")
    || encoded.includes("\"comment\"")
  ) {
    throw new Error("production gap inventory must not include formula text, visible-cell text, or comments");
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function jsonFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) throw new Error(`formula-bar directory is missing: ${directory}`);
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
  }
  return files.sort();
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
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
