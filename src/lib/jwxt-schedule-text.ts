/**
 * 本科教务页里的上课时间 / 课表表解析。
 * 只处理学生浏览器里已经看得见的文本，不接触 Cookie。
 */
import { defaultWeeks, PERIOD_COUNT } from "./schedule-plan";

export const JWXT_CHANNEL2_URL = "https://jwxt.jxufe.edu.cn/jxcjcaslogin";
export const EHALL_URL = "http://ehall.jxufe.edu.cn/";
export const JWXT_IMPORT_HASH_PREFIX = "jwxt-import=";
export const JWXT_IMPORT_VERSION = 1;

export type JwxtImportRow = {
  courseName: string;
  courseCode: string;
  teacherName: string;
  weekText: string;
  timeText: string;
};

export type JwxtImportPayload = {
  v: typeof JWXT_IMPORT_VERSION;
  rows: JwxtImportRow[];
};

export type ParsedJwxtSlot = {
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
};

const WEEKDAY_TOKEN: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

function looksLikeSecret(text: string) {
  return /CASTGC|JSESSIONID|password|passwd|cookie/i.test(text);
}

export function splitCourseCell(text: string): { courseCode: string; courseName: string } {
  const raw = text.replace(/\s+/g, " ").trim();
  const match = /^(\d{8,12})\s+(.+)$/.exec(raw);
  if (match) return { courseCode: match[1], courseName: match[2].trim() };
  return { courseCode: "", courseName: raw };
}

export function parseJwxtWeeks(text: string): number[] {
  const raw = text.replace(/\s+/g, "").trim();
  if (!raw) return defaultWeeks();
  if (raw.includes("单周")) {
    return defaultWeeks().filter((week) => week % 2 === 1);
  }
  if (raw.includes("双周")) {
    return defaultWeeks().filter((week) => week % 2 === 0);
  }
  const weekOnly = !/节|星期/.test(raw);
  if (weekOnly && (raw === "1-16" || raw === "1-16周")) return defaultWeeks();
  const weeks = new Set<number>();
  const range = weekOnly
    ? /(\d{1,2})[-~～至到](\d{1,2})/g
    : /(\d{1,2})[-~～至到](\d{1,2})周/g;
  let match: RegExpExecArray | null;
  while ((match = range.exec(raw))) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    for (let week = from; week <= to && week <= 30; week += 1) weeks.add(week);
  }
  const singleRe = weekOnly ? /(?:^|[,，、;；])(\d{1,2})(?=$|[,，、;；])/g : /(\d{1,2})周/g;
  while ((match = singleRe.exec(raw))) {
    const week = Number(match[1]);
    if (week >= 1 && week <= 30) weeks.add(week);
  }
  return weeks.size > 0 ? [...weeks].sort((left, right) => left - right) : defaultWeeks();
}

function periodPair(raw: string): { startPeriod: number; endPeriod: number } | null {
  const range = /第?\s*(\d{1,2})\s*[-–—~至到,，]\s*(\d{1,2})\s*节/.exec(raw);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start >= 1 && end <= PERIOD_COUNT && start <= end) {
      return { startPeriod: start, endPeriod: end };
    }
  }
  const single = /第\s*(\d{1,2})\s*节/.exec(raw);
  if (single) {
    const period = Number(single[1]);
    if (period >= 1 && period <= PERIOD_COUNT) {
      return { startPeriod: period, endPeriod: period };
    }
  }
  return null;
}

function weekdayOf(raw: string): number | null {
  const match = /星期([一二三四五六日天])|周([一二三四五六日天])/.exec(raw);
  if (!match) return null;
  return WEEKDAY_TOKEN[match[1] || match[2]] ?? null;
}

export function parseJwxtTimeText(timeText: string, weekText = ""): ParsedJwxtSlot[] {
  const fallbackWeeks = parseJwxtWeeks(weekText);
  const chunks = timeText
    .split(/[;；\n|/]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const slots: ParsedJwxtSlot[] = [];
  for (const chunk of chunks) {
    const weekday = weekdayOf(chunk);
    const periods = periodPair(chunk);
    if (weekday == null || !periods) continue;
    const weeks =
      /节\[/.test(chunk) || /\d+周/.test(chunk) ? parseJwxtWeeks(chunk) : fallbackWeeks;
    slots.push({ weekday, ...periods, weeks });
  }
  return mergeAdjacentSlots(slots);
}

export function mergeAdjacentSlots(slots: ParsedJwxtSlot[]): ParsedJwxtSlot[] {
  const sorted = [...slots].sort((left, right) => {
    if (left.weekday !== right.weekday) return left.weekday - right.weekday;
    return left.startPeriod - right.startPeriod;
  });
  const merged: ParsedJwxtSlot[] = [];
  for (const slot of sorted) {
    const previous = merged[merged.length - 1];
    const sameWeeks =
      previous &&
      previous.weekday === slot.weekday &&
      previous.weeks.join(",") === slot.weeks.join(",") &&
      previous.endPeriod + 1 === slot.startPeriod;
    if (sameWeeks && previous) {
      previous.endPeriod = slot.endPeriod;
    } else {
      merged.push({ ...slot, weeks: [...slot.weeks] });
    }
  }
  return merged;
}

function htmlCellText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tableRowCells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(
    (match) => htmlCellText(match[1]),
  );
}

function headerIndex(cells: string[], names: string[]) {
  return cells.findIndex((cell) => names.some((name) => cell.includes(name)));
}

function extractFromListTable(tableHtml: string): JwxtImportRow[] {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (match) => tableRowCells(match[1]),
  );
  if (rows.length < 2) return [];
  const heads = rows[0];
  const courseIndex = headerIndex(heads, ["课程"]);
  const timeIndex = headerIndex(heads, ["上课时间"]);
  if (courseIndex < 0 || timeIndex < 0) return [];
  const teacherIndex = headerIndex(heads, ["任课教师", "教师"]);
  const weekIndex = headerIndex(heads, ["周次"]);
  const extracted: JwxtImportRow[] = [];
  for (const cells of rows.slice(1)) {
    const courseCell = cells[courseIndex] || "";
    const timeText = cells[timeIndex] || "";
    if (!courseCell || !timeText) continue;
    if (looksLikeSecret(courseCell) || looksLikeSecret(timeText)) continue;
    const split = splitCourseCell(courseCell);
    extracted.push({
      courseName: split.courseName,
      courseCode: split.courseCode,
      teacherName: teacherIndex >= 0 ? cells[teacherIndex] || "" : "",
      weekText: weekIndex >= 0 ? cells[weekIndex] || "" : "",
      timeText,
    });
  }
  return extracted;
}

function extractFromGrid(tableHtml: string): JwxtImportRow[] {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (match) => tableRowCells(match[1]),
  );
  if (rows.length < 2) return [];
  const heads = rows[0];
  const dayIndexes: Array<{ index: number; weekday: number }> = [];
  heads.forEach((cell, index) => {
    const weekday = weekdayOf(cell);
    if (weekday != null) dayIndexes.push({ index, weekday });
  });
  if (dayIndexes.length < 3) return [];
  const extracted: JwxtImportRow[] = [];
  for (const cells of rows.slice(1)) {
    const period = periodPair(cells[0] || "");
    if (!period) continue;
    for (const day of dayIndexes) {
      const raw = cells[day.index] || "";
      if (!raw) continue;
      if (looksLikeSecret(raw)) continue;
      const [first, ...rest] = raw.split(/\n| {2,}/).map((part) => part.trim()).filter(Boolean);
      if (!first) continue;
      const split = splitCourseCell(first);
      extracted.push({
        courseName: split.courseName,
        courseCode: split.courseCode,
        teacherName: rest[0] || "",
        weekText: "",
        timeText: `${["", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"][day.weekday]} 第${period.startPeriod}节`,
      });
    }
  }
  return extracted;
}

export function extractJwxtImportRows(html: string): JwxtImportRow[] {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];
  const rows: JwxtImportRow[] = [];
  for (const table of tables) {
    const listed = extractFromListTable(table);
    if (listed.length) {
      rows.push(...listed);
      continue;
    }
    rows.push(...extractFromGrid(table));
  }
  return rows;
}

export function extractJwxtImportRowsFromText(text: string): JwxtImportRow[] {
  if (/<table/i.test(text)) return extractJwxtImportRows(text);
  const rows: JwxtImportRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes("课程") && trimmed.includes("上课时间")) continue;
    const tabbed = trimmed.split(/\t+/);
    if (tabbed.length >= 2) {
      const courseCell = tabbed[0];
      const timeText = tabbed[tabbed.length - 1];
      const teacherName = tabbed.length > 2 ? tabbed[1] : "";
      const weekText = tabbed.length > 3 ? tabbed[2] : "";
      if (!courseCell || !weekdayOf(timeText) || !periodPair(timeText)) continue;
      const split = splitCourseCell(courseCell);
      rows.push({
        courseName: split.courseName,
        courseCode: split.courseCode,
        teacherName,
        weekText,
        timeText,
      });
      continue;
    }
    const timeStart = trimmed.search(/星期[一二三四五六日天]|周[一二三四五六日天]/);
    if (timeStart <= 0) continue;
    const before = trimmed.slice(0, timeStart).trim();
    const timeText = trimmed.slice(timeStart).trim();
    if (!periodPair(timeText)) continue;
    const parts = before.split(/\s+/);
    const split = splitCourseCell(parts[0] || "");
    rows.push({
      courseName: split.courseName,
      courseCode: split.courseCode,
      teacherName: parts.slice(1).join(" "),
      weekText: "",
      timeText,
    });
  }
  return rows;
}

function utf8ToBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(encoded: string) {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isImportRow(value: unknown): value is JwxtImportRow {
  if (!value || typeof value !== "object") return false;
  const row = value as JwxtImportRow;
  return (
    typeof row.courseName === "string" &&
    typeof row.courseCode === "string" &&
    typeof row.teacherName === "string" &&
    typeof row.weekText === "string" &&
    typeof row.timeText === "string" &&
    !looksLikeSecret(JSON.stringify(row))
  );
}

export function encodeJwxtImportPayload(payload: JwxtImportPayload): string {
  return encodeURIComponent(utf8ToBase64(JSON.stringify(payload)));
}

export function readJwxtImportHash(hash: string): JwxtImportPayload | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(JWXT_IMPORT_HASH_PREFIX)) return null;
  try {
    const json = base64ToUtf8(decodeURIComponent(raw.slice(JWXT_IMPORT_HASH_PREFIX.length)));
    const parsed = JSON.parse(json) as { v?: number; rows?: unknown };
    if (parsed.v !== JWXT_IMPORT_VERSION || !Array.isArray(parsed.rows)) return null;
    const rows = parsed.rows.filter(isImportRow);
    return rows.length ? { v: JWXT_IMPORT_VERSION, rows } : null;
  } catch {
    return null;
  }
}

export function jwxtImportHash(payload: JwxtImportPayload): string {
  return `#${JWXT_IMPORT_HASH_PREFIX}${encodeJwxtImportPayload(payload)}`;
}
