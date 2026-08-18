import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const LIVE_LAYOUT_VERSION = "legacy-live-layout-v1" as const;
export const LIVE_LAYOUT_OUTPUT_RELATIVE = "scripts/legacy_evidence/output/live-layout-20260819-v1" as const;

export const LIVE_LAYOUT_WORKSHEETS = [
  "主要课程",
  "数学课",
  "美育",
  "大英和视听说",
  "思政课",
  "外教",
  "MOOC",
  "体育课",
] as const;

export const PROTECTED_LIVE_LAYOUT_OUTPUT_MARKERS = [
  "/smoke-20260818-v1",
  "/smoke-rest-20260818-v1",
  "/other-smoke-20260819-v1",
  "/formula-bar-full-",
  "/formula-bar-rebuild-",
] as const;

export type LiveLayoutWorksheet = (typeof LIVE_LAYOUT_WORKSHEETS)[number];
export type ExtraColumnRole = "english_name" | "course_intro";
export type G46Status = "blocked_locator" | "accepted";

export type LiveLayoutSheetInput = {
  worksheet: string;
  course_column: string;
  teacher_column: string;
  extra_columns?: Readonly<Record<string, ExtraColumnRole>>;
  smoke_rows: readonly [number, number];
  g46_status?: G46Status;
};

export type LiveLayoutSheet = {
  worksheet: LiveLayoutWorksheet;
  course_column: string;
  teacher_column: string;
  extra_columns?: Record<string, ExtraColumnRole>;
  smoke_rows: [number, number];
  g46_status?: G46Status;
};

export type LiveLayout = {
  contract_version: typeof LIVE_LAYOUT_VERSION;
  sheets: LiveLayoutSheet[];
  wrote_tencent_or_business_db: false;
  layout_sha256: string;
};

type ConfirmedSheet = {
  course_column: string;
  teacher_column: string;
  extra_columns?: Record<string, ExtraColumnRole>;
  smoke_rows: [number, number];
  g46_status?: G46Status;
};

const CONFIRMED_SHEETS: Record<LiveLayoutWorksheet, ConfirmedSheet> = {
  主要课程: { course_column: "A", teacher_column: "E", smoke_rows: [19, 26] },
  数学课: { course_column: "B", teacher_column: "C", smoke_rows: [8, 14] },
  美育: { course_column: "A", teacher_column: "D", smoke_rows: [8, 14] },
  大英和视听说: { course_column: "B", teacher_column: "E", smoke_rows: [8, 14] },
  思政课: { course_column: "A", teacher_column: "F", smoke_rows: [8, 14] },
  外教: { course_column: "A", teacher_column: "E", extra_columns: { F: "english_name" }, smoke_rows: [3, 6] },
  MOOC: { course_column: "B", teacher_column: "F", smoke_rows: [8, 14], g46_status: "blocked_locator" },
  体育课: { course_column: "A", teacher_column: "B", smoke_rows: [6, 14] },
};

const SHEET_INPUT_KEYS = new Set([
  "worksheet",
  "course_column",
  "teacher_column",
  "extra_columns",
  "smoke_rows",
  "g46_status",
]);

export function compileLiveLayout(input: { sheets: readonly LiveLayoutSheetInput[] }): LiveLayout {
  assertNoReviewBodies(input);
  assertOnlyKeys(input, ["sheets"], "live layout input");
  if (!Array.isArray(input.sheets) || input.sheets.length !== LIVE_LAYOUT_WORKSHEETS.length) {
    throw new Error("live layout must cover the eight confirmed worksheets");
  }
  const byName = new Map<string, LiveLayoutSheetInput>();
  for (const sheet of input.sheets) {
    assertOnlyKeys(sheet, SHEET_INPUT_KEYS, `live layout sheet ${sheet.worksheet}`);
    if (byName.has(sheet.worksheet)) throw new Error(`duplicate worksheet: ${sheet.worksheet}`);
    rejectObsoleteLetters(sheet);
    byName.set(sheet.worksheet, sheet);
  }
  const sheets = LIVE_LAYOUT_WORKSHEETS.map((worksheet) => {
    const sheet = byName.get(worksheet);
    if (!sheet) throw new Error(`missing worksheet: ${worksheet}`);
    return normalizeConfirmedSheet(sheet);
  });
  const content = {
    contract_version: LIVE_LAYOUT_VERSION,
    sheets,
    wrote_tencent_or_business_db: false as const,
  };
  assertNoReviewBodies(content);
  return { ...content, layout_sha256: sha256(stableJson(content)) };
}

export function compileConfirmedLiveLayout(): LiveLayout {
  return compileLiveLayout({
    sheets: LIVE_LAYOUT_WORKSHEETS.map((worksheet) => {
      const confirmed = CONFIRMED_SHEETS[worksheet];
      return {
        worksheet,
        course_column: confirmed.course_column,
        teacher_column: confirmed.teacher_column,
        extra_columns: confirmed.extra_columns,
        smoke_rows: confirmed.smoke_rows,
        g46_status: confirmed.g46_status,
      };
    }),
  });
}

export function validateLiveLayout(value: unknown): asserts value is LiveLayout {
  assertNoReviewBodies(value);
  if (!isRecord(value) || value.contract_version !== LIVE_LAYOUT_VERSION || typeof value.layout_sha256 !== "string") {
    throw new Error("invalid live layout");
  }
  if (value.wrote_tencent_or_business_db !== false) {
    throw new Error("live layout must not write Tencent sheets or the business database");
  }
  if (!Array.isArray(value.sheets)) throw new Error("invalid live layout");
  const compiled = compileLiveLayout({ sheets: value.sheets });
  if (compiled.layout_sha256 !== value.layout_sha256 || stableJson(value) !== stableJson(compiled)) {
    throw new Error("live layout hash mismatch");
  }
}

export function assertLiveLayoutOutputPath(path: string) {
  const resolved = resolve(path).replaceAll("\\", "/");
  if (PROTECTED_LIVE_LAYOUT_OUTPUT_MARKERS.some((marker) => resolved.includes(marker))) {
    throw new Error("live layout output must not overwrite protected #180, #229, smoke-rest, or formula-bar packs");
  }
  if (!resolved.includes(LIVE_LAYOUT_OUTPUT_RELATIVE)) {
    throw new Error(`live layout output must stay inside ${LIVE_LAYOUT_OUTPUT_RELATIVE}`);
  }
}

export async function writeLiveLayout(path: string, layout: LiveLayout) {
  assertLiveLayoutOutputPath(path);
  validateLiveLayout(layout);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(layout, null, 2)}\n`);
}

function rejectObsoleteLetters(sheet: LiveLayoutSheetInput) {
  if (sheet.worksheet === "体育课" && sheet.teacher_column === "C") {
    throw new Error("rejected obsolete 体育课 teacher column C");
  }
  if (sheet.worksheet === "大英和视听说" && sheet.teacher_column === "G") {
    throw new Error("rejected obsolete 大英和视听说 teacher column G");
  }
  if (sheet.worksheet === "外教" && sheet.teacher_column === "F") {
    throw new Error("外教 column F is a remark role, not a teacher column");
  }
  if (sheet.worksheet === "外教" && sheet.extra_columns?.F && sheet.extra_columns.F !== "english_name") {
    throw new Error("外教 column F must be english_name");
  }
}

function normalizeConfirmedSheet(sheet: LiveLayoutSheetInput): LiveLayoutSheet {
  if (!isLiveLayoutWorksheet(sheet.worksheet)) {
    throw new Error(`unknown worksheet: ${sheet.worksheet}`);
  }
  const expected = CONFIRMED_SHEETS[sheet.worksheet];
  if (sheet.course_column !== expected.course_column || sheet.teacher_column !== expected.teacher_column) {
    throw new Error(`unconfirmed column letters: ${sheet.worksheet}`);
  }
  if (!sameSmokeRows(sheet.smoke_rows, expected.smoke_rows)) {
    throw new Error(`unconfirmed smoke rows: ${sheet.worksheet}`);
  }
  if (sheet.g46_status !== expected.g46_status) {
    throw new Error(`unconfirmed MOOC G46 status: ${sheet.worksheet}`);
  }
  if (stableJson(sheet.extra_columns ?? null) !== stableJson(expected.extra_columns ?? null)) {
    throw new Error(`unconfirmed extra columns: ${sheet.worksheet}`);
  }
  const normalized: LiveLayoutSheet = {
    worksheet: sheet.worksheet,
    course_column: expected.course_column,
    teacher_column: expected.teacher_column,
    smoke_rows: [...expected.smoke_rows],
  };
  if (expected.extra_columns) normalized.extra_columns = { ...expected.extra_columns };
  if (expected.g46_status) normalized.g46_status = expected.g46_status;
  return normalized;
}

function sameSmokeRows(actual: readonly [number, number], expected: readonly [number, number]) {
  return actual[0] === expected[0] && actual[1] === expected[1];
}

function isLiveLayoutWorksheet(value: string): value is LiveLayoutWorksheet {
  return (LIVE_LAYOUT_WORKSHEETS as readonly string[]).includes(value);
}

function assertOnlyKeys(value: unknown, allowed: Iterable<string>, label: string) {
  if (!isRecord(value)) throw new Error(`invalid ${label}`);
  const allowedKeys = allowed instanceof Set ? allowed : new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) throw new Error(`${label} has unexpected fields: ${unexpected.join(", ")}`);
}

function assertNoReviewBodies(value: unknown) {
  const encoded = JSON.stringify(value);
  if (
    encoded.includes("formula_bar_value")
    || encoded.includes("visible_cell_text")
    || encoded.includes('"comment"')
    || encoded.includes('"body"')
  ) {
    throw new Error("live layout must not include formula text, visible-cell text, comments, or review body");
  }
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
