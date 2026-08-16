import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import iconv from "iconv-lite";
import { validateCapturePackage, type CaptureQuery } from "./capture-package";

interface Cell { attributes: string; html: string; text: string }
interface Row { sourcePath: string; rowIndex: number; raw: string; cells: Cell[] }
interface BoundaryEvidence { status: "proven" | "not_observed"; fixtures: string[]; detail: string }

const captureArgument = process.argv[2];
if (!captureArgument) throw new Error("usage: pnpm run audit:catalog-pilot <capture-directory>");

const captureRoot = resolve(captureArgument);
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptRoot, "../..");
const fixtureRoot = join(scriptRoot, "fixtures", "pilot");
const reportPath = join(repositoryRoot, "docs", "catalog-pilot-report.md");
const manifest = await validateCapturePackage(captureRoot);

const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const decodeEntities = (value: string) => value
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, "\"")
  .replace(/&#39;/gi, "'")
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
const textOf = (html: string) => decodeEntities(html.replace(/<br\s*\/?\s*>/gi, "、").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function parseRows(html: string, sourcePath: string): Row[] {
  const table = /<table\b[^>]*\bid\s*=\s*["']keywords["'][^>]*>[\s\S]*?<\/table>/i.exec(html)?.[0] ?? "";
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table)?.[1] ?? "";
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch, rowIndex) => ({
    sourcePath,
    rowIndex,
    raw: rowMatch[0],
    cells: [...rowMatch[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map((cellMatch) => ({
      attributes: cellMatch[1],
      html: cellMatch[2],
      text: textOf(cellMatch[2]),
    })),
  }));
}

const snapshotFiles = manifest.files.filter((file) => file.path.startsWith("snapshots/")).sort((left, right) => left.path.localeCompare(right.path));
const rowsByPath = new Map<string, Row[]>();
const htmlByPath = new Map<string, string>();
let replacementCharacters = 0;
for (const file of snapshotFiles) {
  const bytes = await readFile(join(captureRoot, ...file.path.split("/")));
  const html = new TextDecoder("gbk", { fatal: false }).decode(bytes);
  replacementCharacters += [...html].filter((character) => character === "\uFFFD").length;
  htmlByPath.set(file.path, html);
  rowsByPath.set(file.path, parseRows(html, file.path));
}
const allRows = [...rowsByPath.values()].flat();

const queryText = await readFile(join(captureRoot, "queries.jsonl"), "utf8");
const queries = queryText.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as CaptureQuery);
const rowsForQuery = (queryId: string) => [...rowsByPath.entries()].filter(([path]) => path.startsWith(`snapshots/${queryId}/`)).flatMap(([, rows]) => rows);
const rowKey = (row: Row) => JSON.stringify(row.cells.map((cell) => cell.text));

const counterexampleChecks = queries.filter((query) => query.kind === "counterexample").map((query) => {
  const base = queries.find((candidate) => candidate.kind === "main"
    && candidate.dimensions.semester === query.dimensions.semester
    && candidate.dimensions.educationLevel === query.dimensions.educationLevel
    && candidate.dimensions.grade === query.dimensions.grade);
  const baseKeys = new Set(base ? rowsForQuery(base.queryId).map(rowKey) : []);
  const counterexampleKeys = rowsForQuery(query.queryId).map(rowKey);
  return { queryId: query.queryId, baseQueryId: base?.queryId, records: counterexampleKeys.length, missingFromBase: counterexampleKeys.filter((key) => !baseKeys.has(key)).length };
});

const levelPairs: Array<{ left: string; right: string; rowsEqual: boolean }> = [];
for (const left of queries.filter((query) => query.kind === "main")) {
  const right = queries.find((query) => query.kind === "main"
    && query.queryId > left.queryId
    && query.dimensions.semester === left.dimensions.semester
    && query.dimensions.grade === left.dimensions.grade
    && query.dimensions.educationLevel !== left.dimensions.educationLevel);
  if (right) levelPairs.push({ left: left.queryId, right: right.queryId, rowsEqual: JSON.stringify(rowsForQuery(left.queryId).map(rowKey)) === JSON.stringify(rowsForQuery(right.queryId).map(rowKey)) });
}

const courseIdentity = (row: Row) => /^\[([^\]]+)]\s*(.*)$/.exec(row.cells[0]?.text ?? "");
const isChineseSpaceSeparatedTeacherList = (value: string) => {
  if (/\s{2,}/u.test(value)) return false;
  const parts = value.replace(/\s+/gu, " ").trim().split(" ");
  return parts.length > 1 && parts.every((part) => /^[\p{Script=Han}·]{2,}\d?$/u.test(part));
};
const courseNames = new Map<string, Map<string, Row>>();
for (const row of allRows) {
  const identity = courseIdentity(row);
  if (!identity) continue;
  const names = courseNames.get(identity[1]) ?? new Map<string, Row>();
  names.set(identity[2], row);
  courseNames.set(identity[1], names);
}
const renamedCourse = [...courseNames.values()].find((names) => names.size > 1);
const renamedRows = renamedCourse ? [...renamedCourse.values()].slice(0, 2) : [];
const rowspanRow = allRows.find((row) => /\browspan\s*=/i.test(row.raw));
const multiTeacherRow = allRows.find((row) => {
  const teacher = row.cells[14];
  if (!teacher?.text) return false;
  return /<br\b/i.test(teacher.html)
    || /[、,，;；/]\s*[^\s]/.test(teacher.text)
    || isChineseSpaceSeparatedTeacherList(teacher.text);
});
const digitSuffixRow = allRows.find((row) => /[\p{Script=Han}A-Za-z·]{2,}\d+\b/u.test(row.cells[14]?.text ?? ""));
const moocRow = allRows.find((row) => /MOOC|慕课|在线开放/i.test(row.cells.map((cell) => cell.text).join(" ")));
const emptyRow = allRows.find((row) => row.cells.some((cell) => cell.text === ""));
const abnormalRow = allRows.find((row) => row.cells.length !== 22 || !courseIdentity(row));
const campusRows = [...new Map(allRows.filter((row) => row.cells[1]?.text).map((row) => [row.cells[1].text, row])).values()].slice(0, 3);
const firstPagedQuery = queries.find((query) => query.pageCount > 1);
const paginationRows = firstPagedQuery ? [rowsForQuery(firstPagedQuery.queryId)[0], rowsForQuery(firstPagedQuery.queryId).at(-1)].filter(Boolean) as Row[] : [];
const gbkRow = allRows.find((row) => /[^\x00-\x7F]/.test(row.raw));

await rm(fixtureRoot, { recursive: true, force: true });
await mkdir(fixtureRoot, { recursive: true });

const headers = ["课程", "开课校区", "学分", "总学时", "课程类别", "承担单位", "上课班号", "上课班组", "上课班级名称", "限选人数", "已选/免听", "可选人数", "周次", "授课方式", "任课教师", "上课时间", "上课地点", "双语教学", "精品课程", "上课班号", "授课方式", "校区代码"];
const letters = ["甲", "乙", "丙", "丁", "戊"];
function fixtureCell(boundary: string, rowIndex: number, cellIndex: number, source: Cell) {
  if (!source.text) return "";
  if (cellIndex === 0) {
    if (boundary === "course-rename") return `[COURSE-001]${rowIndex ? "课程新名" : "课程旧名"}`;
    if (boundary === "mooc") return "[COURSE-MOOC]MOOC课程样本";
    return `[COURSE-${String(rowIndex + 1).padStart(3, "0")}]课程样本${letters[rowIndex] ?? rowIndex + 1}`;
  }
  if (cellIndex === 1) return `校区${letters[rowIndex] ?? rowIndex + 1}`;
  if (cellIndex === 14) {
    if (boundary === "multi-teacher") return "教师甲、教师乙";
    if (boundary === "teacher-digit-suffix") return "教师甲2";
    return "教师甲";
  }
  return `字段${cellIndex}-${rowIndex + 1}`;
}
function safeCellAttributes(attributes: string) {
  return [...attributes.matchAll(/\b(rowspan|colspan)\s*=\s*(["']?)(\d+)\2/gi)].map((match) => ` ${match[1].toLowerCase()}="${match[3]}"`).join("");
}
async function writeFixture(name: string, boundary: string, rows: Row[]) {
  const body = rows.map((row, rowIndex) => `<tr>${row.cells.map((cell, cellIndex) => `<td${safeCellAttributes(cell.attributes)}>${fixtureCell(boundary, rowIndex, cellIndex, cell)}</td>`).join("")}</tr>`).join("\n");
  const html = `<!doctype html>\n<html><head><meta charset="gbk"><title>选课志脱敏回归样本</title></head><body>\n<table id="keywords"><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>\n${body}\n</tbody></table>\n<script>parent.showTotalRecord('5327042','${rows.length}');reloadPage('/taglib/DataTable.jsp',1,1);</script>\n</body></html>\n`;
  const filename = `${name}.html`;
  await writeFile(join(fixtureRoot, filename), iconv.encode(html, "gbk"));
  return filename;
}

const boundaries: Record<string, BoundaryEvidence> = {};
async function boundary(name: string, rows: Row[], detail: string) {
  boundaries[name] = rows.length
    ? { status: "proven", fixtures: [await writeFixture(name, name, rows)], detail }
    : { status: "not_observed", fixtures: [], detail };
}
await boundary("gbk", gbkRow ? [gbkRow] : [], replacementCharacters === 0 ? "All raw pages decode as GBK without replacement characters." : `${replacementCharacters} replacement characters were observed.`);
await boundary("pagination", paginationRows, firstPagedQuery ? `${firstPagedQuery.queryId} spans ${firstPagedQuery.pageCount} pages.` : "No multi-page query was observed.");
await boundary("rowspan", rowspanRow ? [rowspanRow] : [], rowspanRow ? "A rowspan cell was observed." : "No rowspan attribute was present in the Pilot pages.");
await boundary("multi-teacher", multiTeacherRow ? [multiTeacherRow] : [], multiTeacherRow ? "The teacher field contains multiple source teacher tokens." : "No conclusive multi-teacher field was observed.");
await boundary("teacher-digit-suffix", digitSuffixRow ? [digitSuffixRow] : [], digitSuffixRow ? "A teacher source token with a numeric suffix was observed." : "No conclusive teacher numeric suffix was observed.");
await boundary("course-rename", renamedRows, renamedRows.length ? "The same source course code appeared with different names." : "No same-code rename was observed.");
await boundary("mooc", moocRow ? [moocRow] : [], moocRow ? "A MOOC/online-open-course token was observed." : "No MOOC token was observed.");
await boundary("three-campuses", campusRows.length >= 3 ? campusRows : [], campusRows.length >= 3 ? `${campusRows.length} distinct non-empty campus values were sampled.` : `Only ${campusRows.length} distinct campus values were observed.`);
await boundary("empty-field", emptyRow ? [emptyRow] : [], emptyRow ? "At least one table row contains an empty cell." : "No empty cell was observed.");
await boundary("abnormal-format", abnormalRow ? [abnormalRow] : [], abnormalRow ? "A row with an unexpected cell/course shape was observed." : "No malformed row shape was observed.");

const fixtureIndex = {
  schemaVersion: "catalog-pilot-fixtures/v1",
  sourceBatchId: manifest.batchId,
  sourceManifestContentSha256: manifest.manifestContentSha256,
  sourceDictionarySha256: manifest.sourceDictionarySha256,
  sourceCounts: manifest.counts,
  sourceSnapshotBytes: snapshotFiles.reduce((total, file) => total + file.bytes, 0),
  gbkReplacementCharacters: replacementCharacters,
  counterexampleChecks,
  educationLevelComparisons: levelPairs,
  boundaries,
};
await writeFile(join(fixtureRoot, "index.json"), `${JSON.stringify(fixtureIndex, null, 2)}\n`);

const eventCounts = new Map<string, number>();
const logLines = (await readFile(join(captureRoot, "run-log.jsonl"), "utf8")).trim().split("\n").filter(Boolean);
for (const line of logLines) {
  const event = String((JSON.parse(line) as { event?: string }).event ?? "unknown");
  eventCounts.set(event, (eventCounts.get(event) ?? 0) + 1);
}
const proven = Object.values(boundaries).filter((item) => item.status === "proven").length;
const notObserved = Object.values(boundaries).filter((item) => item.status === "not_observed").length;
const counterexamplesValid = counterexampleChecks.every((item) => item.missingFromBase === 0);
const pilotAccepted = manifest.status === "complete"
  && replacementCharacters === 0
  && counterexampleChecks.length >= 2
  && counterexamplesValid;
const decision = pilotAccepted
  ? "**Decision: proceed to full capture.** All mandatory Pilot acceptance checks passed."
  : "**Decision: do not proceed to full capture.** One or more mandatory Pilot acceptance checks failed; inspect the Runtime Audit below.";
const report = `# Catalog Baseline Pilot Report\n\nGenerated from the validated, gitignored raw package; no raw course or teacher values are copied into this report or its fixtures.\n\n## Result\n\n${decision} Boundaries not observed in this Pilot remain explicit gaps for later fixtures; they are not fabricated.\n\n## Package\n\n| Field | Value |\n| --- | ---: |\n| Batch | \`${manifest.batchId}\` |\n| Status | \`${manifest.status}\` |\n| Queries | ${manifest.counts.queries} |\n| Pages | ${manifest.counts.pages} |\n| Records | ${manifest.counts.records} |\n| Bytes | ${manifest.counts.bytes} |\n| Source dictionary SHA-256 | \`${manifest.sourceDictionarySha256}\` |\n| Manifest content SHA-256 | \`${manifest.manifestContentSha256}\` |\n| GBK replacement characters | ${replacementCharacters} |\n\n## Runtime Audit\n\n- Query statuses: ${Object.entries(manifest.counts.statuses).map(([status, count]) => `\`${status}=${count}\``).join(", ")}.\n- Event counts: ${[...eventCounts.entries()].sort().map(([event, count]) => `\`${event}=${count}\``).join(", ")}.\n- Counterexample subset check: ${counterexamplesValid ? "passed" : "failed"}; ${counterexampleChecks.length} counterexample queries checked.\n- Education-level comparison: ${levelPairs.filter((pair) => pair.rowsEqual).length}/${levelPairs.length} paired result sets were identical. This is recorded as source behavior, not used to prune the required full matrix.\n- Validator recomputed the manifest hash, every declared file hash/byte count, continuous page coverage, accumulated record counts, terminal statuses, and the credential/cross-origin safety scan.\n\n## Boundary Fixtures\n\n| Boundary | Status | Fixture | Evidence |\n| --- | --- | --- | --- |\n${Object.entries(boundaries).map(([name, item]) => `| ${name} | ${item.status} | ${item.fixtures.length ? item.fixtures.map((fixture) => `\`${fixture}\``).join(", ") : "-"} | ${item.detail} |`).join("\n")}\n\nSummary: ${proven} proven, ${notObserved} not observed. Fixtures are deterministic pseudonyms encoded as GBK. The source package remains only under the gitignored capture directory.\n\n## Security\n\n- No account password, Cookie, Authorization header, access token, refresh token, or session token is present in the validated package.\n- The collector does not read browser credential stores and does not submit credentials.\n- Fixture cells replace source course codes/names, teacher values, class identifiers, times, and locations with synthetic values.\n`;
await writeFile(reportPath, report);

console.log(JSON.stringify({ valid: pilotAccepted, reportPath, fixtureRoot, proven, notObserved, counterexamplesValid, reportSha256: sha256(report) }, null, 2));
if (!pilotAccepted) throw new Error("Pilot acceptance failed; full capture must not start");
