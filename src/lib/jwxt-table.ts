/**
 * 解析 KINGOSOFT 选课表 HTML（S2020302 已选、S2020103 候选）。
 * 动态表头、rowspan、分页与登录失效全部失败关闭；不读 Cookie。
 */
import {
  looksLikeForbidden,
  normalizeOffering,
  parseCount,
  parseCredits,
  type JwxtCategoryOption,
  type JwxtFilterOption,
  type JwxtOffering,
} from "./jwxt-offering";

export type JwxtPagination = {
  page: number;
  pages: number;
  total: number;
  tableId: string;
};

export type JwxtTableFilters = {
  terms: JwxtFilterOption[];
  educationLevels: JwxtFilterOption[];
  grades: JwxtFilterOption[];
  majors: JwxtFilterOption[];
  categories: JwxtCategoryOption[];
};

export type JwxtTableParse =
  | {
      ok: true;
      offerings: JwxtOffering[];
      pagination: JwxtPagination | null;
      filters: JwxtTableFilters;
    }
  | { ok: false; kind: "login-expired"; message: string }
  | { ok: false; kind: "malformed"; message: string };

type HtmlCell = { text: string; rowspan: number; colspan: number };

const LOGIN_EXPIRED_RE =
  /登录超时|会话过期|重新登录|请先登录|login\.jsp|cas\/login|CASTGC/i;

const HEADER_ALIASES: Record<string, string[]> = {
  course: ["课程", "课程号", "课程名称"],
  credits: ["学分"],
  category: ["课程类别", "类别"],
  section: ["上课班级", "上课班号", "班号", "班次"],
  teacher: ["任课教师", "教师"],
  campus: ["开课校区", "校区"],
  weeks: ["周次"],
  time: ["上课时间", "授课时段"],
  place: ["上课地点", "场地"],
  limit: ["限选人数", "人数上限", "限选", "容量"],
  selected: ["已选人数", "已选/免听", "已选"],
  available: ["可选人数", "剩余人数", "可选", "余量"],
  status: ["选课状态", "状态"],
};

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function textOf(html: string) {
  return decodeEntities(
    html.replace(/<br\s*\/?\s*>/gi, "；").replace(/<[^>]+>/g, " "),
  )
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
  const courseColumn = headerIndex(grids[headerStart], HEADER_ALIASES.course);
  let headerEnd = headerStart;
  while (
    headerEnd + 1 < grids.length &&
    HEADER_ALIASES.course.includes((grids[headerEnd + 1][courseColumn] || "").trim())
  ) {
    headerEnd += 1;
  }
  return { headers: grids[headerEnd], rows: grids.slice(headerEnd + 1) };
}

function headerIndex(headers: string[], keys: string[]) {
  const exact = headers.findIndex((header) => keys.includes(header.trim()));
  return exact >= 0
    ? exact
    : headers.findIndex((header) => keys.some((key) => header.includes(key)));
}

function cell(row: string[], index: number) {
  return index >= 0 ? row[index] || "" : "";
}

function emptyFilters(): JwxtTableFilters {
  return { terms: [], educationLevels: [], grades: [], majors: [], categories: [] };
}

function optionList(html: string, names: string[]): JwxtFilterOption[] {
  const select = names
    .map((name) => {
      const named = new RegExp(
        `<select\\b[^>]*(?:name|id)\\s*=\\s*["'][^"']*${name}[^"']*["'][^>]*>([\\s\\S]*?)</select>`,
        "i",
      ).exec(html);
      return named?.[1];
    })
    .find(Boolean);
  if (!select) return [];
  const options: JwxtFilterOption[] = [];
  for (const match of select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
    const value = /value\s*=\s*["']([^"']*)["']/i.exec(match[1])?.[1] ?? textOf(match[2]);
    const label = textOf(match[2]);
    if (!value && !label) continue;
    if (looksLikeForbidden(value) || looksLikeForbidden(label)) continue;
    options.push({ id: value || label, label: label || value });
  }
  return options;
}

function categoryOptions(html: string): JwxtCategoryOption[] {
  const raw = optionList(html, ["kclb", "kclx", "category"]);
  return raw.map((item) => ({
    ...item,
    kind: /公共选修|公选|通识选修/.test(item.label) ? "public" : "planned",
  }));
}

export function parsePagination(html: string): JwxtPagination | null {
  const totalMatch = /showTotalRecord\(\s*['"]([^'"]+)['"]\s*,\s*['"]?(\d+)['"]?\s*\)/i.exec(html);
  const pageMatch = /reloadPage\([^,]+,\s*(\d+)\s*,\s*(\d+)/i.exec(html);
  if (!totalMatch && !pageMatch) return null;
  const total = totalMatch ? Number(totalMatch[2]) : Number(pageMatch?.[2] || 0);
  const page = pageMatch ? Number(pageMatch[1]) : 1;
  const pages = pageMatch ? Number(pageMatch[2]) : page;
  if (![total, page, pages].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return null;
  }
  return { page, pages, total, tableId: totalMatch?.[1] || "" };
}

function offeringsFromGrid(headers: string[], rows: string[][]): JwxtOffering[] {
  const courseIndex = headerIndex(headers, HEADER_ALIASES.course);
  if (courseIndex < 0) return [];
  const timeIndex = headerIndex(headers, HEADER_ALIASES.time);
  const indexes = {
    credits: headerIndex(headers, HEADER_ALIASES.credits),
    category: headerIndex(headers, HEADER_ALIASES.category),
    section: headerIndex(headers, HEADER_ALIASES.section),
    teacher: headerIndex(headers, HEADER_ALIASES.teacher),
    campus: headerIndex(headers, HEADER_ALIASES.campus),
    weeks: headerIndex(headers, HEADER_ALIASES.weeks),
    place: headerIndex(headers, HEADER_ALIASES.place),
    limit: headerIndex(headers, HEADER_ALIASES.limit),
    selected: headerIndex(headers, HEADER_ALIASES.selected),
    available: headerIndex(headers, HEADER_ALIASES.available),
    status: headerIndex(headers, HEADER_ALIASES.status),
  };
  const offerings: JwxtOffering[] = [];
  for (const row of rows) {
    const courseCell = cell(row, courseIndex);
    if (!courseCell) continue;
    if (looksLikeForbidden(row.join(" "))) {
      return [];
    }
    const offering = normalizeOffering({
        courseName: courseCell,
        credits: parseCredits(cell(row, indexes.credits)),
        categoryPath: cell(row, indexes.category),
        section: cell(row, indexes.section),
        teacherName: cell(row, indexes.teacher),
        campus: cell(row, indexes.campus),
        weekText: cell(row, indexes.weeks),
        timeText: timeIndex >= 0 ? cell(row, timeIndex) : "",
        place: indexes.place === timeIndex ? "" : cell(row, indexes.place),
        capacityLimit: parseCount(cell(row, indexes.limit)),
        capacitySelected: parseCount(cell(row, indexes.selected)),
        capacityAvailable: parseCount(cell(row, indexes.available)),
        enrollStatus: cell(row, indexes.status),
      });
    const existing = offerings.find(
      (item) => item.courseCode === offering.courseCode && item.section === offering.section && item.courseName === offering.courseName,
    );
    if (existing) {
      existing.meetings = [...existing.meetings, ...offering.meetings];
      if (offering.timeText) {
        existing.timeText = existing.timeText ? `${existing.timeText}；${offering.timeText}` : offering.timeText;
      }
      if (offering.weekText && existing.weekText !== offering.weekText) {
        existing.weekText = existing.weekText ? `${existing.weekText}，${offering.weekText}` : offering.weekText;
      }
    } else {
      offerings.push(offering);
    }
  }
  return offerings;
}

export function parseJwxtTableHtml(html: string): JwxtTableParse {
  if (!html || !html.trim()) {
    return { ok: false, kind: "malformed", message: "空响应" };
  }
  if (LOGIN_EXPIRED_RE.test(html) && !/<table\b/i.test(html)) {
    return { ok: false, kind: "login-expired", message: "教务登录已失效" };
  }
  if (LOGIN_EXPIRED_RE.test(html) && /cas\/login|登录超时|会话过期|请先登录/i.test(html)) {
    const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];
    const hasCourseHeader = tables.some((table) => /课程/.test(table) && /上课时间|上课班号/.test(table));
    if (!hasCourseHeader) {
      return { ok: false, kind: "login-expired", message: "教务登录已失效" };
    }
  }
  const filters: JwxtTableFilters = {
    terms: optionList(html, ["xnxq", "xq", "term"]),
    educationLevels: optionList(html, ["pycc", "xslb", "level"]),
    grades: optionList(html, ["nj", "grade"]),
    majors: optionList(html, ["zy", "major"]),
    categories: categoryOptions(html),
  };
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];
  if (tables.length === 0) {
    return { ok: false, kind: "malformed", message: "没有表格" };
  }
  const offerings: JwxtOffering[] = [];
  for (const table of tables) {
    const grid = expandGrid(table);
    if (!grid || grid.headers.length === 0) continue;
    const parsed = offeringsFromGrid(grid.headers, grid.rows);
    if (looksLikeForbidden(grid.headers.join(" ")) || parsed.length === 0 && /CASTGC|JSESSIONID/i.test(table)) {
      return { ok: false, kind: "malformed", message: "响应含凭据或畸形单元格" };
    }
    offerings.push(...parsed);
  }
  if (offerings.length === 0 && looksLikeForbidden(html)) {
    return { ok: false, kind: "malformed", message: "响应含凭据或畸形单元格" };
  }
  return {
    ok: true,
    offerings,
    pagination: parsePagination(html),
    filters,
  };
}
