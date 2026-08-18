import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  LIVE_LAYOUT_OUTPUT_RELATIVE,
  PROTECTED_LIVE_LAYOUT_OUTPUT_MARKERS,
  validateLiveLayout,
  type LiveLayout,
  type LiveLayoutSheet,
  type LiveLayoutWorksheet,
} from "./live_layout";

export const LIVE_LAYOUT_CONTEXT_INDEX_VERSION = "live-layout-context-index-v1" as const;
export const LIVE_LAYOUT_CONTEXT_OUTPUT_RELATIVE = "scripts/legacy_evidence/output/live-layout-context-20260819-v1" as const;
export const MISSING_CONTEXT = "missing_context" as const;

export type MissingContext = typeof MISSING_CONTEXT;

export type LiveLayoutContextRead = {
  worksheet: string;
  row: number;
  role: "course" | "teacher";
  address: string;
  nonempty: boolean;
};

export type LiveLayoutContextRow = {
  row: number;
  course_cell: string | MissingContext;
  teacher_cell: string | MissingContext;
  course_anchor_row: number | MissingContext;
};

export type LiveLayoutContextSheet = {
  worksheet: LiveLayoutWorksheet;
  course_column: string;
  teacher_column: string;
  smoke_rows: [number, number];
  rows: LiveLayoutContextRow[];
};

export type LiveLayoutContextIndex = {
  contract_version: typeof LIVE_LAYOUT_CONTEXT_INDEX_VERSION;
  layout_sha256: string;
  sheets: LiveLayoutContextSheet[];
  wrote_tencent_or_business_db: false;
  context_index_sha256: string;
};

const READ_KEYS = new Set(["worksheet", "row", "role", "address", "nonempty"]);

export function compileLiveLayoutContextIndex(input: {
  layout: LiveLayout;
  reads?: readonly LiveLayoutContextRead[];
}): LiveLayoutContextIndex {
  assertNoReviewBodies(input);
  assertOnlyKeys(input, ["layout", "reads"], "live layout context index input");
  validateLiveLayout(input.layout);
  const reads = normalizeReads(input.reads ?? [], input.layout);
  const sheets = input.layout.sheets.map((sheet) => compileSheet(sheet, reads));
  const content = {
    contract_version: LIVE_LAYOUT_CONTEXT_INDEX_VERSION,
    layout_sha256: input.layout.layout_sha256,
    sheets,
    wrote_tencent_or_business_db: false as const,
  };
  assertNoReviewBodies(content);
  return { ...content, context_index_sha256: sha256(stableJson(content)) };
}

export function validateLiveLayoutContextIndex(value: unknown): asserts value is LiveLayoutContextIndex {
  assertNoReviewBodies(value);
  if (
    !isRecord(value)
    || value.contract_version !== LIVE_LAYOUT_CONTEXT_INDEX_VERSION
    || typeof value.layout_sha256 !== "string"
    || typeof value.context_index_sha256 !== "string"
  ) {
    throw new Error("invalid live-layout context index");
  }
  if (value.wrote_tencent_or_business_db !== false) {
    throw new Error("context index must not write Tencent sheets or the business database");
  }
  if (!Array.isArray(value.sheets)) throw new Error("invalid live-layout context index");
  const { context_index_sha256: _hash, ...content } = value;
  if (sha256(stableJson(content)) !== value.context_index_sha256) {
    throw new Error("live-layout context index hash mismatch");
  }
}

export function assertLiveLayoutContextOutputPath(path: string) {
  const resolved = resolve(path).replaceAll("\\", "/");
  if (PROTECTED_LIVE_LAYOUT_OUTPUT_MARKERS.some((marker) => resolved.includes(marker))) {
    throw new Error("context index output must not overwrite protected #180, #229, or formula-bar packs");
  }
  if (resolved.includes(LIVE_LAYOUT_OUTPUT_RELATIVE) || !resolved.includes(LIVE_LAYOUT_CONTEXT_OUTPUT_RELATIVE)) {
    throw new Error(`context index output must stay inside ${LIVE_LAYOUT_CONTEXT_OUTPUT_RELATIVE}`);
  }
}

export async function writeLiveLayoutContextIndex(path: string, index: LiveLayoutContextIndex) {
  assertLiveLayoutContextOutputPath(path);
  validateLiveLayoutContextIndex(index);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(index, null, 2)}\n`);
}

export function liveLayoutContextIndexUsage() {
  return [
    "Usage:",
    "  pnpm run live-layout-context-index compile <layout.json> <context-index.json> [reads.json]",
    "  pnpm run live-layout-context-index compile <layout.json> <context-index.json> <course-reads.json> <teacher-reads.json>",
  ].join("\n");
}

export async function runLiveLayoutContextIndexCli(argv: string[]) {
  const [command, layoutPath, outputPath, firstReadsPath, secondReadsPath] = argv;
  if (command !== "compile" || !layoutPath || !outputPath) {
    throw new Error(liveLayoutContextIndexUsage());
  }
  const layout = JSON.parse(await readFile(resolve(layoutPath), "utf8"));
  validateLiveLayout(layout);
  const reads = secondReadsPath
    ? [...await loadReads(firstReadsPath, "course"), ...await loadReads(secondReadsPath, "teacher")]
    : await loadReads(firstReadsPath, null);
  const index = compileLiveLayoutContextIndex({ layout, reads });
  await writeLiveLayoutContextIndex(resolve(outputPath), index);
  return {
    output: resolve(outputPath),
    sheets: index.sheets.length,
    context_index_sha256: index.context_index_sha256,
    wrote_tencent_or_business_db: false as const,
  };
}

function compileSheet(
  sheet: LiveLayoutSheet,
  reads: readonly LiveLayoutContextRead[],
): LiveLayoutContextSheet {
  const [firstRow, lastRow] = sheet.smoke_rows;
  const rows: LiveLayoutContextRow[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const course = resolveCourse(sheet, row, reads);
    rows.push({
      row,
      course_cell: course.cell,
      teacher_cell: `${sheet.teacher_column}${row}`,
      course_anchor_row: course.anchor,
    });
  }
  if (rows.length !== lastRow - firstRow + 1) {
    throw new Error(`context index must cover each smoke row exactly once: ${sheet.worksheet}`);
  }
  if (new Set(rows.map((item) => item.row)).size !== rows.length) {
    throw new Error(`duplicate context index row: ${sheet.worksheet}`);
  }
  return {
    worksheet: sheet.worksheet,
    course_column: sheet.course_column,
    teacher_column: sheet.teacher_column,
    smoke_rows: [...sheet.smoke_rows],
    rows,
  };
}

function resolveCourse(sheet: LiveLayoutSheet, row: number, reads: readonly LiveLayoutContextRead[]) {
  const layoutCell = `${sheet.course_column}${row}`;
  const own = findRead(reads, sheet.worksheet, row, "course");
  if (!own) return { cell: layoutCell, anchor: MISSING_CONTEXT } as const;
  if (own.nonempty) {
    return { cell: own.address, anchor: parseAddress(own.address).row } as const;
  }
  for (let current = row - 1; current >= 1; current -= 1) {
    const previous = findRead(reads, sheet.worksheet, current, "course");
    if (previous?.nonempty) {
      return { cell: previous.address, anchor: parseAddress(previous.address).row } as const;
    }
  }
  return { cell: MISSING_CONTEXT, anchor: MISSING_CONTEXT } as const;
}

function findRead(
  reads: readonly LiveLayoutContextRead[],
  worksheet: string,
  row: number,
  role: LiveLayoutContextRead["role"],
) {
  return reads.find((item) => item.worksheet === worksheet && item.row === row && item.role === role);
}

function normalizeReads(reads: readonly LiveLayoutContextRead[], layout: LiveLayout): LiveLayoutContextRead[] {
  assertNoReviewBodies(reads);
  const sheets = new Map<string, LiveLayoutSheet>(layout.sheets.map((sheet) => [sheet.worksheet, sheet]));
  const seen = new Set<string>();
  return reads.map((read) => {
    assertOnlyKeys(read, READ_KEYS, `context read ${read.worksheet}|${read.row}`);
    if (!isLiveLayoutContextRead(read)) throw new Error("invalid context read");
    const sheet = sheets.get(read.worksheet);
    if (!sheet) throw new Error(`context read is not on a live-layout worksheet: ${read.worksheet}`);
    const address = parseAddress(read.address);
    rejectObsoleteTeacherLetter(sheet, read, address.column);
    if (read.role === "teacher") {
      if (address.column !== sheet.teacher_column) {
        throw new Error(`unconfirmed teacher column ${address.column} on ${sheet.worksheet}`);
      }
      if (address.row !== read.row) {
        throw new Error(`teacher read must stay on the same row: ${sheet.worksheet}|${read.row}`);
      }
    } else {
      if (address.column !== sheet.course_column) {
        throw new Error(`unconfirmed course column ${address.column} on ${sheet.worksheet}`);
      }
      if (address.row > read.row) {
        throw new Error(`course address cannot be below the source row: ${sheet.worksheet}|${read.row}`);
      }
    }
    const key = `${read.worksheet}|${read.role}|${read.row}`;
    if (seen.has(key)) throw new Error(`duplicate context read: ${key}`);
    seen.add(key);
    return {
      worksheet: read.worksheet,
      row: read.row,
      role: read.role,
      address: address.address,
      nonempty: read.nonempty,
    };
  });
}

function rejectObsoleteTeacherLetter(
  sheet: LiveLayoutSheet,
  read: LiveLayoutContextRead,
  column: string,
) {
  if (read.role !== "teacher") return;
  if (sheet.worksheet === "体育课" && column === "C") {
    throw new Error("rejected obsolete 体育课 teacher column C");
  }
  if (sheet.worksheet === "大英和视听说" && column === "G") {
    throw new Error("rejected obsolete 大英和视听说 teacher column G");
  }
  if (sheet.worksheet === "外教" && column === "F") {
    throw new Error("外教 column F is a remark role, not a teacher column");
  }
}

async function loadReads(path: string | undefined, inferredRole: LiveLayoutContextRead["role"] | null) {
  if (!path) return [];
  const raw = JSON.parse(await readFile(resolve(path), "utf8"));
  const items = Array.isArray(raw) ? raw : Array.isArray(raw.reads) ? raw.reads : null;
  if (!items) throw new Error(`context reads must be an array or {reads:[]}: ${path}`);
  return items.map((item: unknown) => normalizeExternalRead(item, inferredRole));
}

function normalizeExternalRead(value: unknown, inferredRole: LiveLayoutContextRead["role"] | null): LiveLayoutContextRead {
  if (!isRecord(value)) throw new Error("invalid context read");
  const role = value.role === "course" || value.role === "teacher" ? value.role : inferredRole;
  const nonempty = typeof value.nonempty === "boolean"
    ? value.nonempty
    : typeof value.formula_bar_value === "string"
      ? value.formula_bar_value.length > 0
      : null;
  if (
    typeof value.worksheet !== "string"
    || !Number.isInteger(value.row)
    || typeof value.address !== "string"
    || nonempty === null
    || (role !== "course" && role !== "teacher")
  ) {
    throw new Error("invalid context read");
  }
  return {
    worksheet: value.worksheet,
    row: value.row,
    role,
    address: value.address,
    nonempty,
  };
}

function isLiveLayoutContextRead(value: unknown): value is LiveLayoutContextRead {
  return isRecord(value)
    && typeof value.worksheet === "string"
    && Number.isInteger(value.row)
    && value.row >= 1
    && (value.role === "course" || value.role === "teacher")
    && typeof value.address === "string"
    && typeof value.nonempty === "boolean";
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
    || encoded.includes("visible_course")
    || encoded.includes("visible_teacher")
    || encoded.includes('"comment"')
    || encoded.includes('"body"')
  ) {
    throw new Error("context index must not include formula text, visible-cell text, comments, or review body");
  }
}

function parseAddress(address: string) {
  const match = /^([A-Z]+)([1-9]\d*)$/i.exec(address.trim());
  if (!match) throw new Error(`invalid cell address: ${address}`);
  return { address: `${match[1].toUpperCase()}${match[2]}`, column: match[1].toUpperCase(), row: Number(match[2]) };
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
