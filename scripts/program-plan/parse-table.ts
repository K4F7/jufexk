export interface HtmlCell {
  text: string;
  rowspan: number;
  colspan: number;
}

export interface ParsedCourseCell {
  courseCode: string;
  courseName: string;
}

const headerAliases = {
  term: ["学年学期", "建议修读学年学期", "建议修读学期", "建议修读", "学期"],
  course: ["课程", "课程名称", "课程名"],
  credits: ["学分"],
  category: ["课程类别"],
  status: ["课程地位"],
  exam: ["考核方式"],
  hoursTotal: ["总学时", "学时"],
  hoursLecture: ["讲授"],
  hoursExperiment: ["实验"],
  hoursPractice: ["实践"],
  hoursOther: ["其它", "其他"],
  hoursWeekly: ["周学时"],
} as const;

export type ColumnKey = keyof typeof headerAliases;

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

export function textOf(html: string) {
  return decodeEntities(html.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function attributeNumber(attributes: string, name: string) {
  const value = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attributes)?.[1];
  const number = value ? Number(value) : 1;
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

export function cellsOf(rowHtml: string): HtmlCell[] {
  return [...rowHtml.matchAll(/<t[hd]\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi)].map((match) => ({
    text: textOf(match[2]),
    rowspan: attributeNumber(match[1], "rowspan"),
    colspan: attributeNumber(match[1], "colspan"),
  }));
}

export function findResultTable(html: string) {
  const keywords = /<table\b[^>]*\bid\s*=\s*["']keywords["'][^>]*>[\s\S]*?<\/table>/i.exec(html)?.[0];
  if (keywords) return keywords;
  for (const match of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    if (/学年学期|建议修读|课程类别/.test(match[0])) return match[0];
  }
}

export function tableGrid(html: string): { headers: string[]; rows: string[][] } | undefined {
  const table = findResultTable(html);
  if (!table) return undefined;
  const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(table)?.[1];
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table)?.[1] ?? "";
  const headerSource = head ?? /<tr\b[^>]*>([\s\S]*?)<\/tr>/i.exec(table)?.[1];
  if (!headerSource) return undefined;
  const headers = cellsOf(headerSource).flatMap((cell) => Array.from({ length: cell.colspan }, () => cell.text));
  const pending: Array<{ remaining: number; value: string } | undefined> = [];
  const rows: string[][] = [];
  const bodyRows = head
    ? [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    : [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1);
  for (const rowMatch of bodyRows) {
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
    for (const cell of cellsOf(rowMatch[1])) {
      inherit();
      for (let offset = 0; offset < cell.colspan; offset += 1) {
        row[column] = cell.text;
        if (cell.rowspan > 1) pending[column] = { remaining: cell.rowspan - 1, value: cell.text };
        column += 1;
      }
    }
    inherit();
    if (row.some((value) => value)) rows.push(row);
  }
  return { headers, rows };
}

export function normalizeHeader(value: string) {
  return value.replace(/\s+/g, "");
}

export function columnIndex(headers: string[], key: ColumnKey) {
  const aliases = headerAliases[key];
  return headers.findIndex((header) => (aliases as readonly string[]).includes(normalizeHeader(header)));
}

export function mapColumns(headers: string[]) {
  const term = columnIndex(headers, "term");
  const course = columnIndex(headers, "course");
  if (term < 0 || course < 0) return undefined;
  return {
    term,
    course,
    credits: columnIndex(headers, "credits"),
    category: columnIndex(headers, "category"),
    status: columnIndex(headers, "status"),
    exam: columnIndex(headers, "exam"),
    hoursTotal: columnIndex(headers, "hoursTotal"),
    hoursLecture: columnIndex(headers, "hoursLecture"),
    hoursExperiment: columnIndex(headers, "hoursExperiment"),
    hoursPractice: columnIndex(headers, "hoursPractice"),
    hoursOther: columnIndex(headers, "hoursOther"),
    hoursWeekly: columnIndex(headers, "hoursWeekly"),
  };
}

export function cellValue(row: string[], index: number) {
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

export function parseCourseCell(text: string): ParsedCourseCell | undefined {
  const match = /^\[(\d+)\]\s*(.+)$/.exec(text.trim());
  if (!match) return undefined;
  return { courseCode: match[1], courseName: match[2].trim() };
}

export function discoverTableId(html: string) {
  return /name\s*=\s*["']tableId["'][^>]*value\s*=\s*["'](\d+)["']/i.exec(html)?.[1]
    ?? /[?&]tableId=(\d+)/i.exec(html)?.[1]
    ?? /showTotalRecord\(\s*['"](\d+)['"]/.exec(html)?.[1];
}

export function discoverFormAction(html: string) {
  return /<form\b[^>]*\bid\s*=\s*["']ActionForm["'][^>]*\baction\s*=\s*["']([^"']+)["']/i.exec(html)?.[1]
    ?? /<form\b[^>]*\baction\s*=\s*["']([^"']+)["'][^>]*\bid\s*=\s*["']ActionForm["']/i.exec(html)?.[1];
}

function selectByLabel(html: string, label: RegExp) {
  const labeled = new RegExp(`(?:${label.source})[^<]{0,120}<select\\b([^>]*)>`, "i").exec(html)
    ?? new RegExp(`<td[^>]*>\\s*(?:${label.source})\\s*</td>\\s*<td[^>]*>\\s*<select\\b([^>]*)>`, "i").exec(html);
  if (!labeled) return undefined;
  const attributes = labeled[1];
  const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] ?? "";
  const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1] ?? "";
  if (!id && !name) return undefined;
  return { id, name };
}

export function parseSelectOptions(html: string, idOrName: string) {
  const block = new RegExp(`<select\\b[^>]*(?:\\bid\\s*=\\s*["']${idOrName}["']|\\bname\\s*=\\s*["']${idOrName}["'])[^>]*>([\\s\\S]*?)</select>`, "i").exec(html)?.[1];
  if (!block) return [];
  return [...block.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((match) => ({
    id: /\bvalue\s*=\s*["']?([^"'>\s]*)/i.exec(match[1])?.[1] ?? "",
    label: textOf(match[2]),
  })).filter((option) => option.id && option.label && !/请选择|全部/.test(option.label));
}

export function discoverFilterFields(html: string) {
  const grade = selectByLabel(html, /年级/);
  const direction = selectByLabel(html, /专业方向/);
  const department = selectByLabel(html, /院\s*\(?系\)?\)?\s*\/?\s*部|院系|院\(系\)\/部/);
  const major = selectByLabel(html, /专业(?!方向)/);
  const studyKind = selectByLabel(html, /主修\s*\/\s*辅修|主修|辅修/);
  if (!grade || !department || !major) return undefined;
  return { grade, department, major, direction, studyKind };
}

export function findStudyKindValue(html: string, field: { id: string; name: string }) {
  const options = parseSelectOptions(html, field.id || field.name);
  return options.find((option) => option.label === "主修" || option.id === "主修")?.id;
}
