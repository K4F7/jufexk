import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCapturePackage, type CaptureQuery } from "./capture-package";

interface SourceOption { id: string; label: string }
interface SourceDictionary {
  schemaVersion: "catalog-capture-package/v1";
  semesters: SourceOption[];
  educationLevels: SourceOption[];
  grades: SourceOption[];
  homeUnits: SourceOption[];
  majors: SourceOption[];
  capturedAt: string;
  sha256: string;
}
interface Coverage {
  schemaVersion: "catalog-capture-package/v1";
  batchId: string;
  sourceChanged: boolean;
  sourceChangeRounds: number;
  unresolvedSourceChanges: number;
  queryCount: number;
  statuses: Record<string, number>;
  exceptions: unknown[];
}
interface Checkpoint { batchId: string; phase: string; queries: unknown[] }

const captureArgument = process.argv[2];
if (!captureArgument) throw new Error("usage: pnpm run audit:catalog-full <capture-directory>");

const captureRoot = resolve(captureArgument);
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const reportPath = resolve(scriptRoot, "../../docs/catalog-full-capture-summary.md");
const manifest = await validateCapturePackage(captureRoot);
if (manifest.status !== "complete" || (manifest.counts.statuses.exception ?? 0) !== 0) {
  throw new Error(`full capture is not complete: status=${manifest.status}, exceptions=${manifest.counts.statuses.exception ?? 0}`);
}

const parseJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(join(captureRoot, path), "utf8")) as T;
const dictionary = await parseJson<SourceDictionary>("source-dictionary.json");
const coverage = await parseJson<Coverage>("coverage.json");
const checkpoint = await parseJson<Checkpoint>("checkpoint.json");
const queryLines = (await readFile(join(captureRoot, "queries.jsonl"), "utf8")).trim().split("\n").filter(Boolean);
const queries = queryLines.map((line) => JSON.parse(line) as CaptureQuery);
const logLines = (await readFile(join(captureRoot, "run-log.jsonl"), "utf8")).trim().split("\n").filter(Boolean);
const logEvents = new Map<string, number>();
for (const line of logLines) {
  const event = String((JSON.parse(line) as { event?: string }).event ?? "unknown");
  logEvents.set(event, (logEvents.get(event) ?? 0) + 1);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`full capture audit failed: ${message}`);
}
const dimensionKey = (query: Pick<CaptureQuery, "dimensions">) => `${query.dimensions.semester}\u0000${query.dimensions.educationLevel}\u0000${query.dimensions.grade}`;
const expectedDimensions = new Set<string>();
for (const semester of dictionary.semesters) {
  for (const level of dictionary.educationLevels) {
    for (const grade of dictionary.grades) {
      expectedDimensions.add(`${semester.id}\u0000${level.id}\u0000${grade.id}`);
    }
  }
}
const mainQueries = queries.filter((query) => query.kind === "main");
const actualDimensions = new Set(mainQueries.map(dimensionKey));
const { sha256: declaredDictionarySha256, capturedAt: _capturedAt, ...dictionaryContent } = dictionary;
const computedDictionarySha256 = createHash("sha256")
  .update(stable({ ...dictionaryContent, capturedAt: undefined }))
  .digest("hex");
assert(declaredDictionarySha256 === computedDictionarySha256, "source dictionary content hash is invalid");
assert(dictionary.sha256 === manifest.sourceDictionarySha256, "source dictionary hash does not match manifest");
assert(mainQueries.length === expectedDimensions.size, `main matrix size ${mainQueries.length} != ${expectedDimensions.size}`);
assert(actualDimensions.size === expectedDimensions.size && [...expectedDimensions].every((key) => actualDimensions.has(key)), "main matrix does not exactly cover the frozen dictionary Cartesian product");
assert(mainQueries.every((query) => Object.values(query.filters).every((value) => value === "")), "main matrix contains a narrowed filter");
assert(queries.every((query) => query.status === "complete"), "one or more queries are not complete");

const computedStatuses: Record<string, number> = {};
for (const query of queries) computedStatuses[query.status] = (computedStatuses[query.status] ?? 0) + 1;
assert(coverage.schemaVersion === manifest.schemaVersion, "coverage schema version mismatch");
assert(coverage.batchId === manifest.batchId && checkpoint.batchId === manifest.batchId, "batch ID mismatch across runtime artifacts");
assert(coverage.queryCount === queries.length && checkpoint.queries.length === queries.length, "query count mismatch across runtime artifacts");
assert(stable(coverage.statuses) === stable(computedStatuses) && stable(computedStatuses) === stable(manifest.counts.statuses), "status counts mismatch across runtime artifacts");
assert(!coverage.sourceChanged && coverage.unresolvedSourceChanges === 0, "source dictionary changed or remains unresolved");
assert(coverage.exceptions.length === 0, "coverage contains exceptions");
assert(checkpoint.phase === "complete", `checkpoint phase is ${checkpoint.phase}`);
assert((logEvents.get("page_complete") ?? 0) === manifest.counts.pages, "page completion events do not exactly match final snapshots; completed pages may have been replayed");
assert((logEvents.get("query_complete") ?? 0) === queries.length, "query completion events do not exactly match final queries; completed queries may have been replayed");
assert((logEvents.get("directory_unavailable") ?? 0) >= 1, "run log lacks a real checkpoint-recovery event");
assert((logEvents.get("batch_complete") ?? 0) >= 1 && (logEvents.get("export_complete") ?? 0) >= 1, "run log lacks terminal/export evidence");

const decodeEntities = (value: string) => value
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;/gi, "'")
  .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
const textOf = (html: string) => decodeEntities(html.replace(/<br\s*\/?\s*>/gi, "、").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tableRows = (html: string) => {
  const table = /<table\b[^>]*\bid\s*=\s*["']keywords["'][^>]*>[\s\S]*?<\/table>/i.exec(html)?.[0] ?? "";
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table)?.[1] ?? "";
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => JSON.stringify(
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => textOf(cell[1])),
  ));
};
const rowsForQuery = async (query: CaptureQuery) => {
  const rows: string[] = [];
  for (let page = 1; page <= query.pageCount; page += 1) {
    const path = join(captureRoot, "snapshots", query.queryId, `page-${String(page).padStart(4, "0")}.html`);
    rows.push(...tableRows(new TextDecoder("gbk").decode(await readFile(path))));
  }
  return rows;
};
const counterexamples = queries.filter((query) => query.kind === "counterexample");
assert(counterexamples.length >= 2, "fewer than two counterexample queries were captured");
let nonemptyCounterexamples = 0;
for (const query of counterexamples) {
  const base = mainQueries.find((candidate) => dimensionKey(candidate) === dimensionKey(query));
  assert(base, `counterexample ${query.queryId} has no wide-query base`);
  const baseRows = new Set(await rowsForQuery(base));
  const rows = await rowsForQuery(query);
  if (rows.length) nonemptyCounterexamples += 1;
  assert(rows.every((row) => baseRows.has(row)), `counterexample ${query.queryId} contains a row absent from ${base.queryId}`);
}
assert(nonemptyCounterexamples >= 1, "no non-empty counterexample was observed");

let replacementCharacters = 0;
const snapshotFiles = manifest.files.filter((file) => file.path.startsWith("snapshots/"));
for (const file of snapshotFiles) {
  const html = new TextDecoder("gbk").decode(await readFile(join(captureRoot, ...file.path.split("/"))));
  replacementCharacters += (html.match(/\uFFFD/g) ?? []).length;
}
assert(replacementCharacters === 0, `${replacementCharacters} GBK replacement characters were observed`);

const eventText = [...logEvents.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([event, count]) => `\`${event}=${count}\``).join(", ");
const report = `# Catalog Full Capture Summary\n\n## Decision\n\n**Accepted.** The full raw catalog capture is complete, recoverable, auditable, credential-safe, and can be consumed offline. The raw package remains gitignored and is not committed.\n\n## Package\n\n| Field | Value |\n| --- | ---: |\n| Batch | \`${manifest.batchId}\` |\n| Status | \`${manifest.status}\` |\n| Queries | ${manifest.counts.queries} |\n| Main matrix queries | ${mainQueries.length} |\n| Counterexample queries | ${counterexamples.length} |\n| Pages | ${manifest.counts.pages} |\n| Records | ${manifest.counts.records} |\n| Bytes | ${manifest.counts.bytes} |\n| Source dictionary SHA-256 | \`${manifest.sourceDictionarySha256}\` |\n| Manifest content SHA-256 | \`${manifest.manifestContentSha256}\` |\n| GBK replacement characters | ${replacementCharacters} |\n\n## Frozen Matrix\n\n- Source dimensions: ${dictionary.semesters.length} semesters × ${dictionary.educationLevels.length} education levels × ${dictionary.grades.length} grades = ${expectedDimensions.size} required main queries.\n- Exact Cartesian-product coverage: passed; no missing, duplicate, or extra main dimension tuple.\n- Wide-query filters: all blank for every main query.\n- Counterexample containment: passed for ${counterexamples.length} queries; ${nonemptyCounterexamples} were non-empty.\n- Source dictionary batch-tail check: unchanged; ${coverage.sourceChangeRounds} change rounds and ${coverage.unresolvedSourceChanges} unresolved changes.\n\n## Integrity And Runtime Audit\n\n- Query statuses: ${Object.entries(computedStatuses).map(([status, count]) => `\`${status}=${count}\``).join(", ")}.\n- Runtime events: ${eventText}.\n- Checkpoint recovery: ${(logEvents.get("directory_unavailable") ?? 0)} directory-unavailable interruptions were followed by terminal completion; page and query completion event counts exactly match the final package, proving completed units were not replayed as an unnecessary full rerun.\n- Coverage, checkpoint, queries, and manifest agree on batch ID, query count, terminal statuses, and zero exceptions.\n- The validator recomputed the manifest content hash, every declared file byte count and SHA-256, accumulated record count, page count and continuity, query status semantics, and credential/cross-origin safety scan.\n- No Cookie, Authorization header, password, access token, refresh token, or session token is present in the validated package.\n- All declared source snapshots decode as GBK without replacement characters.\n\n## Storage Boundary\n\n- Raw package: \`scripts/catalog-baseline/captures/full\` (gitignored, local only).\n- This summary contains only aggregate counts and cryptographic hashes; it does not copy course, teacher, class, time, place, or account values.\n`;
await writeFile(reportPath, report);

console.log(JSON.stringify({
  valid: true,
  reportPath,
  batchId: manifest.batchId,
  queries: queries.length,
  mainQueries: mainQueries.length,
  counterexamples: counterexamples.length,
  pages: manifest.counts.pages,
  records: manifest.counts.records,
  bytes: manifest.counts.bytes,
  manifestContentSha256: manifest.manifestContentSha256,
}, null, 2));
