/**
 * 培养方案「理论课程」表：按年级×专业采课号，不含老师/开课班。
 * 采集包 schema 独立于目录基线，不写入 courses.enrollment_category。
 */
import { looksLikeForbidden, parseCredits } from "./jwxt-offering";
import { splitCourseCell } from "./jwxt-schedule-text";

export const PROGRAM_PLAN_CAPTURE_SCHEMA = "program-plan-capture/v1";
export const PROGRAM_PLAN_RECORD_SCHEMA = "program-plan-course/v1";

export type ProgramPlanCourse = {
  schemaVersion: typeof PROGRAM_PLAN_RECORD_SCHEMA;
  grade: string;
  departmentCode: string;
  departmentName: string;
  majorCode: string;
  majorName: string;
  studyKind: "主修";
  courseCode: string;
  courseName: string;
  credits: number | null;
  categoryPath: string;
  courseStanding: string;
  assessment: string;
  suggestedTerm: string;
  totalHours: number | null;
  lectureHours: number | null;
  labHours: number | null;
  practiceHours: number | null;
  otherHours: number | null;
  weeklyHours: number | null;
  catalogCourseId: number | null;
};

export type ProgramPlanException = {
  reason: string;
  courseText: string;
  suggestedTerm: string;
};

export type ProgramPlanQuery = {
  schemaVersion: typeof PROGRAM_PLAN_CAPTURE_SCHEMA;
  queryId: string;
  grade: string;
  departmentCode: string;
  departmentName: string;
  majorCode: string;
  majorName: string;
  studyKind: "主修";
  status: "pending" | "complete" | "failed" | "exception";
  declaredRecordCount: number;
  capturedRecordCount?: number;
  pageCount: number;
};

export type ProgramPlanCaptureManifest = {
  schemaVersion: typeof PROGRAM_PLAN_CAPTURE_SCHEMA;
  batchId: string;
  status: "capturing" | "complete" | "complete_with_exceptions";
  counts: { queries: number; pages: number; records: number };
  files: Array<{ path: string; bytes: number; records: number; sha256: string }>;
  manifestContentSha256: string;
};

export type ProgramPlanParse =
  | {
      ok: true;
      rows: Omit<
        ProgramPlanCourse,
        | "schemaVersion"
        | "grade"
        | "departmentCode"
        | "departmentName"
        | "majorCode"
        | "majorName"
        | "studyKind"
        | "catalogCourseId"
      >[];
      exceptions: ProgramPlanException[];
    }
  | { ok: false; kind: "login-expired" | "malformed"; message: string };

type HtmlCell = { text: string; rowspan: number; colspan: number };

const HEADER_ALIASES: Record<string, string[]> = {
  term: ["学年学期"],
  course: ["课程"],
  credits: ["学分"],
  category: ["课程类别"],
  standing: ["课程地位"],
  assessment: ["考核方式"],
  totalHours: ["总学时"],
  lectureHours: ["讲授学时"],
  labHours: ["实验学时"],
  practiceHours: ["实践学时"],
  otherHours: ["其它学时", "其他学时"],
  weeklyHours: ["周学时"],
};

const LOGIN_EXPIRED_RE =
  /登录超时|会话过期|重新登录|请先登录|login\.jsp|cas\/login|CASTGC/i;

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function textOf(html: string) {
  return decodeEntities(html.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function attributeNumber(attributes: string, name: string) {
  const value = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attributes)?.[1];
  const number = value ? Number(value) : 1;
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

function cellsOf(rowHtml: string): HtmlCell[] {
  return [...rowHtml.matchAll(/<t[hd]\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map((match) => ({
    text: textOf(match[2]),
    rowspan: attributeNumber(match[1], "rowspan"),
    colspan: attributeNumber(match[1], "colspan"),
  }));
}

function headerIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(header.trim()));
}

function expandGrid(tableHtml: string): { headers: string[]; rows: string[][] } | null {
  const rowHtmls = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (match) => match[1],
  );
  if (rowHtmls.length < 1) return null;
  const pending: Array<{ remaining: number; value: string } | undefined> = [];
  const grids: string[][] = [];
  for (const rowHtml of rowHtmls) {
    const row: string[] = [];
    let column = 0;
    const inherit = () => {
      while (pending[column]?.remaining) {
        const item = pending[column]!;
        row[column] = item.value;
        item.remaining -= 1;
        if (item.remaining === 0) pending[column] = undefined;
        column += 1;
      }
    };
    for (const cell of cellsOf(rowHtml)) {
      inherit();
      for (let offset = 0; offset < cell.colspan; offset += 1) {
        row[column] = cell.text;
        if (cell.rowspan > 1) pending[column] = { remaining: cell.rowspan - 1, value: cell.text };
        column += 1;
      }
    }
    inherit();
    if (row.some((cell) => cell)) grids.push(row);
  }
  if (grids.length < 2) return { headers: grids[0] ?? [], rows: [] };
  const headerStart = grids.findIndex((row) => headerIndex(row, HEADER_ALIASES.course) >= 0);
  if (headerStart < 0) return { headers: grids[0], rows: grids.slice(1) };
  return { headers: grids[headerStart], rows: grids.slice(headerStart + 1) };
}

function cell(row: string[], index: number) {
  return index >= 0 ? (row[index] || "").trim() : "";
}

function parseHours(raw: string): number | null {
  return parseCredits(raw);
}

export function programPlanRowKey(row: Pick<ProgramPlanCourse, "grade" | "majorCode" | "courseCode" | "suggestedTerm">) {
  return [row.grade, row.majorCode, row.courseCode, row.suggestedTerm].join("\0");
}

/** 把本站学期 id（`2025-2026-2`）对到培养方案「学年学期」原文片段。 */
export function catalogTermToSuggestedTerm(termId: string): string {
  const match = /^(\d{4}-\d{4})-([12])$/.exec(termId.trim());
  if (!match) return termId.trim();
  return `${match[1]}学年${match[2] === "1" ? "第一学期" : "第二学期"}`;
}

export function parseProgramPlanHtml(html: string): ProgramPlanParse {
  if (LOGIN_EXPIRED_RE.test(html) || looksLikeForbidden(html)) {
    return { ok: false, kind: "login-expired", message: "登录已失效，培养方案页未解析。" };
  }
  const tableMatch = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!tableMatch) return { ok: false, kind: "malformed", message: "培养方案页缺少课程表。" };
  const grid = expandGrid(tableMatch[1]);
  if (!grid) return { ok: false, kind: "malformed", message: "培养方案表无法展开。" };
  const courseIndex = headerIndex(grid.headers, HEADER_ALIASES.course);
  if (courseIndex < 0) return { ok: false, kind: "malformed", message: "培养方案表缺少课程列。" };
  const indexes = {
    term: headerIndex(grid.headers, HEADER_ALIASES.term),
    credits: headerIndex(grid.headers, HEADER_ALIASES.credits),
    category: headerIndex(grid.headers, HEADER_ALIASES.category),
    standing: headerIndex(grid.headers, HEADER_ALIASES.standing),
    assessment: headerIndex(grid.headers, HEADER_ALIASES.assessment),
    totalHours: headerIndex(grid.headers, HEADER_ALIASES.totalHours),
    lectureHours: headerIndex(grid.headers, HEADER_ALIASES.lectureHours),
    labHours: headerIndex(grid.headers, HEADER_ALIASES.labHours),
    practiceHours: headerIndex(grid.headers, HEADER_ALIASES.practiceHours),
    otherHours: headerIndex(grid.headers, HEADER_ALIASES.otherHours),
    weeklyHours: headerIndex(grid.headers, HEADER_ALIASES.weeklyHours),
  };
  const rows: Array<
    Omit<
      ProgramPlanCourse,
      | "schemaVersion"
      | "grade"
      | "departmentCode"
      | "departmentName"
      | "majorCode"
      | "majorName"
      | "studyKind"
      | "catalogCourseId"
    >
  > = [];
  const exceptions: ProgramPlanException[] = [];
  for (const row of grid.rows) {
    const courseText = cell(row, courseIndex);
    if (!courseText) continue;
    const split = splitCourseCell(courseText);
    const suggestedTerm = cell(row, indexes.term);
    if (!split.courseCode) {
      exceptions.push({ reason: "缺少课号", courseText, suggestedTerm });
      continue;
    }
    rows.push({
      courseCode: split.courseCode,
      courseName: split.courseName,
      credits: parseCredits(cell(row, indexes.credits)),
      categoryPath: cell(row, indexes.category),
      courseStanding: cell(row, indexes.standing),
      assessment: cell(row, indexes.assessment),
      suggestedTerm,
      totalHours: parseHours(cell(row, indexes.totalHours)),
      lectureHours: parseHours(cell(row, indexes.lectureHours)),
      labHours: parseHours(cell(row, indexes.labHours)),
      practiceHours: parseHours(cell(row, indexes.practiceHours)),
      otherHours: parseHours(cell(row, indexes.otherHours)),
      weeklyHours: parseHours(cell(row, indexes.weeklyHours)),
    });
  }
  return { ok: true, rows, exceptions };
}

export function attachProgramPlanDimensions(
  parsed: Extract<ProgramPlanParse, { ok: true }>,
  query: Pick<
    ProgramPlanQuery,
    "grade" | "departmentCode" | "departmentName" | "majorCode" | "majorName" | "studyKind"
  >,
): { records: ProgramPlanCourse[]; exceptions: ProgramPlanException[] } {
  return {
    records: parsed.rows.map((row) => ({
      schemaVersion: PROGRAM_PLAN_RECORD_SCHEMA,
      grade: query.grade,
      departmentCode: query.departmentCode,
      departmentName: query.departmentName,
      majorCode: query.majorCode,
      majorName: query.majorName,
      studyKind: query.studyKind,
      catalogCourseId: null,
      ...row,
    })),
    exceptions: parsed.exceptions,
  };
}

export function uniqueProgramCourses(
  rows: ProgramPlanCourse[],
  preferredTerm = "",
): ProgramPlanCourse[] {
  const seen = new Map<string, ProgramPlanCourse>();
  const preferred = preferredTerm.trim();
  for (const row of rows) {
    const existing = seen.get(row.courseCode);
    if (!existing) {
      seen.set(row.courseCode, row);
      continue;
    }
    if (preferred && row.suggestedTerm.includes(preferred) && !existing.suggestedTerm.includes(preferred)) {
      seen.set(row.courseCode, row);
    }
  }
  return [...seen.values()];
}

const sensitiveKey = /^(?:password|passwd|cookie|authorization|.*token.*|session)$/i;
const secretPatterns = [
  /\bpassword["']?\s*[:=]/i,
  /\bcookie["']?\s*:/i,
  /\b(?:access[_-]?token|refresh[_-]?token|session[_-]?token)["']?\s*[:=]/i,
];

export function assertProgramPlanCaptureSafe(text: string, source: string) {
  if (looksLikeForbidden(text) || secretPatterns.some((pattern) => pattern.test(text))) {
    throw new Error(`unsafe credential content in ${source}`);
  }
}

export function deriveProgramPlanRecords(
  queries: ProgramPlanQuery[],
  snapshots: Array<{ queryId: string; html: string }>,
): { records: ProgramPlanCourse[]; exceptions: ProgramPlanException[] } {
  const records: ProgramPlanCourse[] = [];
  const exceptions: ProgramPlanException[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const pages = snapshots.filter((snapshot) => snapshot.queryId === query.queryId);
    for (const page of pages) {
      assertProgramPlanCaptureSafe(page.html, `${query.queryId} html`);
      const parsed = parseProgramPlanHtml(page.html);
      if (!parsed.ok) {
        exceptions.push({
          reason: parsed.message,
          courseText: "",
          suggestedTerm: "",
        });
        continue;
      }
      const attached = attachProgramPlanDimensions(parsed, query);
      exceptions.push(...attached.exceptions);
      for (const record of attached.records) {
        const key = programPlanRowKey(record);
        if (seen.has(key)) continue;
        seen.add(key);
        records.push(record);
      }
    }
  }
  return { records, exceptions };
}

export function validateProgramPlanQueries(queries: ProgramPlanQuery[]) {
  const queryIds = new Set<string>();
  for (const query of queries) {
    if (query.schemaVersion !== PROGRAM_PLAN_CAPTURE_SCHEMA) {
      throw new Error(`unsupported query schema ${query.schemaVersion}`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(query.queryId)) {
      throw new Error(`invalid queryId ${query.queryId}`);
    }
    if (queryIds.has(query.queryId)) throw new Error(`duplicate query ${query.queryId}`);
    queryIds.add(query.queryId);
    if (query.studyKind !== "主修") throw new Error(`unsupported studyKind ${query.studyKind}`);
    for (const [key] of Object.entries(query)) {
      if (sensitiveKey.test(key)) throw new Error(`unsafe credential parameter ${key}`);
    }
  }
}
