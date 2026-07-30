import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { CAPTURE_PACKAGE_SCHEMA_VERSION, type SourceOption, type WideFilters } from "./query-plan";

export { CAPTURE_PACKAGE_SCHEMA_VERSION } from "./query-plan";

export type QueryStatus = "pending" | "complete" | "failed" | "exception";

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface CaptureQuery {
  schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION;
  queryId: string;
  kind: "main" | "supplemental" | "counterexample";
  dimensions: { semester: string; educationLevel: string; grade: string };
  filters: WideFilters;
  status: QueryStatus;
  declaredRecordCount: number;
  capturedRecordCount?: number;
  pageCount: number;
  requestParameters: Record<string, string>;
}

export interface CaptureSourceDictionary {
  schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION;
  semesters: SourceOption[];
  educationLevels: SourceOption[];
  grades: SourceOption[];
  homeUnits: SourceOption[];
  majors?: SourceOption[];
  capturedAt?: string;
  sha256: string;
}

export interface CapturePackageInput {
  batchId: string;
  status: "capturing" | "complete" | "complete_with_exceptions" | "source_changed";
  sourceDictionarySha256: string;
  queries: CaptureQuery[];
  snapshots: Array<{ queryId: string; page: number; bytes: Uint8Array }>;
  sourceDictionary?: CaptureSourceDictionary;
}

interface ManifestFile {
  path: string;
  bytes: number;
  records: number;
  sha256: string;
}

export interface CaptureManifest {
  schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION;
  batchId: string;
  status: CapturePackageInput["status"];
  sourceDictionarySha256: string;
  counts: { queries: number; pages: number; records: number; bytes: number; statuses: Partial<Record<QueryStatus, number>> };
  files: ManifestFile[];
  manifestContentSha256: string;
}

type LegacyCompatibleCaptureManifest = Omit<CaptureManifest, "counts"> & {
  counts: Omit<CaptureManifest["counts"], "records"> & { records?: number };
};

function hash(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSafePathPart(value: string, name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`invalid ${name}`);
}

const secretPatterns = [
  /\bpassword["']?\s*[:=]/i,
  /\bcookie["']?\s*:/i,
  /\b(?:access[_-]?token|refresh[_-]?token|session[_-]?token)["']?\s*[:=]/i,
  /\bauthorization["']?\s*:/i,
];

const sensitiveKey = /^(?:password|passwd|cookie|authorization|.*token.*|session)$/i;

function assertSafeContent(bytes: Uint8Array, source: string) {
  const text = Buffer.from(bytes).toString("latin1");
  if (secretPatterns.some((pattern) => pattern.test(text))) throw new Error(`unsafe credential content in ${source}`);
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      throw new Error(`unsafe URL in ${source}`);
    }
    if (url.protocol !== "https:" || url.hostname !== "jwxt.jxufe.edu.cn") throw new Error(`unsafe cross-origin URL in ${source}`);
  }
}

function assertSafeParameters(parameters: Record<string, string>, source: string) {
  for (const [key, value] of Object.entries(parameters)) {
    if (sensitiveKey.test(key)) throw new Error(`unsafe credential parameter ${key} in ${source}`);
    assertSafeContent(Buffer.from(value), `${source}.${key}`);
  }
}

function validateInput(input: CapturePackageInput) {
  assertSafePathPart(input.batchId, "batchId");
  if (!/^[a-f0-9]{64}$/.test(input.sourceDictionarySha256)) throw new Error("invalid source dictionary SHA-256");
  const queryIds = new Set<string>();
  for (const query of input.queries) {
    if (query.schemaVersion !== CAPTURE_PACKAGE_SCHEMA_VERSION) throw new Error("unsupported query schema version");
    assertSafePathPart(query.queryId, "queryId");
    if (queryIds.has(query.queryId)) throw new Error(`duplicate query ${query.queryId}`);
    queryIds.add(query.queryId);
    if (!Number.isSafeInteger(query.pageCount) || query.pageCount < 0) throw new Error(`invalid page count for ${query.queryId}`);
    if (!Number.isSafeInteger(query.declaredRecordCount) || query.declaredRecordCount < 0) throw new Error(`invalid record count for ${query.queryId}`);
    if (query.capturedRecordCount !== undefined && (!Number.isSafeInteger(query.capturedRecordCount) || query.capturedRecordCount < 0 || query.capturedRecordCount > query.declaredRecordCount)) throw new Error(`invalid captured record count for ${query.queryId}`);
    if (query.status === "complete" && query.capturedRecordCount !== undefined && query.capturedRecordCount !== query.declaredRecordCount) throw new Error(`record count mismatch for ${query.queryId}`);
    if (!query.requestParameters || typeof query.requestParameters !== "object") throw new Error(`invalid request parameters for ${query.queryId}`);
    assertSafeParameters(query.requestParameters, query.queryId);
    assertSafeContent(Buffer.from(JSON.stringify(query.filters)), query.queryId);
  }
  const pageKeys = new Set<string>();
  for (const snapshot of input.snapshots) {
    if (!queryIds.has(snapshot.queryId)) throw new Error(`snapshot references unknown query ${snapshot.queryId}`);
    if (!Number.isSafeInteger(snapshot.page) || snapshot.page < 1 || snapshot.page > 9999) throw new Error("invalid snapshot page");
    const key = `${snapshot.queryId}:${snapshot.page}`;
    if (pageKeys.has(key)) throw new Error(`duplicate snapshot ${key}`);
    pageKeys.add(key);
    assertSafeContent(snapshot.bytes, key);
  }
  for (const query of input.queries) {
    const pages = input.snapshots.filter((snapshot) => snapshot.queryId === query.queryId).map((snapshot) => snapshot.page).sort((a, b) => a - b);
    if (query.status === "complete" && pages.length !== query.pageCount) throw new Error(`page count mismatch for ${query.queryId}`);
    if (query.status !== "complete" && pages.length > query.pageCount) throw new Error(`page count mismatch for ${query.queryId}`);
    if (pages.some((page, index) => page !== index + 1)) throw new Error(`snapshot pages must be continuous for ${query.queryId}`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sourceDictionaryContentSha256(dictionary: Omit<CaptureSourceDictionary, "sha256"> | CaptureSourceDictionary) {
  const content = {
    schemaVersion: dictionary.schemaVersion,
    semesters: dictionary.semesters,
    educationLevels: dictionary.educationLevels,
    grades: dictionary.grades,
    homeUnits: dictionary.homeUnits,
    majors: dictionary.majors ?? [],
    capturedAt: undefined,
  };
  return hash(stableJson(content));
}

function assertValidSourceDictionary(dictionary: CaptureSourceDictionary) {
  if (dictionary.schemaVersion !== CAPTURE_PACKAGE_SCHEMA_VERSION || !/^[a-f0-9]{64}$/.test(dictionary.sha256)) throw new Error("source dictionary schema validation failed");
  for (const [name, options] of Object.entries({ semesters: dictionary.semesters, educationLevels: dictionary.educationLevels, grades: dictionary.grades, homeUnits: dictionary.homeUnits, majors: dictionary.majors ?? [] })) {
    if (!Array.isArray(options)) throw new Error(`source dictionary ${name} must be an array`);
    const ids = new Set<string>();
    for (const option of options) {
      if (!option || typeof option.id !== "string" || typeof option.label !== "string" || !option.id.trim() || !option.label.trim()) throw new Error(`source dictionary ${name} requires non-empty id and label`);
      if (ids.has(option.id)) throw new Error(`source dictionary ${name} contains duplicate id ${option.id}`);
      ids.add(option.id);
    }
  }
}

function manifestHash(manifest: Omit<LegacyCompatibleCaptureManifest, "manifestContentSha256">) {
  return hash(stableJson(manifest));
}

function safeJoin(root: string, artifactPath: string) {
  const destination = resolve(root, ...artifactPath.split("/"));
  const prefix = `${resolve(root)}${sep}`;
  if (!destination.startsWith(prefix)) throw new Error("artifact path escapes package root");
  return destination;
}

function isSafeArtifactPath(value: string) {
  return !value.includes("\\") && value.split("/").every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part));
}

export async function writeCapturePackage(root: string, input: CapturePackageInput): Promise<CaptureManifest> {
  validateInput(input);
  if (!input.sourceDictionary) throw new Error("source dictionary is required");
  assertValidSourceDictionary(input.sourceDictionary);
  const computedDictionarySha256 = sourceDictionaryContentSha256(input.sourceDictionary);
  if (computedDictionarySha256 !== input.sourceDictionary.sha256 || computedDictionarySha256 !== input.sourceDictionarySha256) throw new Error("source dictionary content hash mismatch");
  const queryBytes = Buffer.from(input.queries.map((query) => JSON.stringify(query)).join("\n") + (input.queries.length ? "\n" : ""));
  const artifacts = [
    { path: "queries.jsonl", bytes: queryBytes, records: input.queries.length },
    ...(input.sourceDictionary ? [{ path: "source-dictionary.json", bytes: Buffer.from(`${JSON.stringify(input.sourceDictionary, null, 2)}\n`), records: 1 }] : []),
    ...input.snapshots
      .map((snapshot) => ({
        path: `snapshots/${snapshot.queryId}/page-${String(snapshot.page).padStart(4, "0")}.html`,
        bytes: Buffer.from(snapshot.bytes),
        records: 1,
      }))
      .sort((left, right) => compareText(left.path, right.path)),
  ];
  const statuses: Partial<Record<QueryStatus, number>> = {};
  for (const query of input.queries) statuses[query.status] = (statuses[query.status] ?? 0) + 1;
  const manifestContent: Omit<CaptureManifest, "manifestContentSha256"> = {
    schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION,
    batchId: input.batchId,
    status: input.status,
    sourceDictionarySha256: input.sourceDictionarySha256,
    counts: {
      queries: input.queries.length,
      pages: input.snapshots.length,
      records: input.queries.reduce((total, query) => total + (query.capturedRecordCount ?? (query.status === "complete" ? query.declaredRecordCount : 0)), 0),
      bytes: artifacts.reduce((total, artifact) => total + artifact.bytes.byteLength, 0),
      statuses,
    },
    files: artifacts.map((artifact) => ({ path: artifact.path, bytes: artifact.bytes.byteLength, records: artifact.records, sha256: hash(artifact.bytes) })),
  };
  const manifest: CaptureManifest = { ...manifestContent, manifestContentSha256: manifestHash(manifestContent) };
  await mkdir(root, { recursive: true });
  if ((await readdir(root)).length) throw new Error("capture package output directory must be empty");
  for (const artifact of artifacts) {
    const path = safeJoin(root, artifact.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, artifact.bytes);
  }
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function isManifest(value: unknown): value is LegacyCompatibleCaptureManifest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CaptureManifest>;
  return item.schemaVersion === CAPTURE_PACKAGE_SCHEMA_VERSION
    && typeof item.batchId === "string"
    && ["capturing", "complete", "complete_with_exceptions", "source_changed"].includes(String(item.status))
    && typeof item.sourceDictionarySha256 === "string" && /^[a-f0-9]{64}$/.test(item.sourceDictionarySha256)
    && typeof item.manifestContentSha256 === "string" && /^[a-f0-9]{64}$/.test(item.manifestContentSha256)
    && !!item.counts && Number.isSafeInteger(item.counts.queries) && Number.isSafeInteger(item.counts.pages) && (item.counts.records === undefined || Number.isSafeInteger(item.counts.records)) && Number.isSafeInteger(item.counts.bytes)
    && Array.isArray(item.files)
    && item.files.every((file) => typeof file.path === "string" && isSafeArtifactPath(file.path) && Number.isSafeInteger(file.bytes) && Number.isSafeInteger(file.records) && /^[a-f0-9]{64}$/.test(file.sha256));
}

async function listPackageFiles(root: string, directory = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listPackageFiles(root, path));
    else if (entry.isFile()) result.push(path.slice(resolve(root).length + 1).split(sep).join("/"));
  }
  return result.sort(compareText);
}

export async function validateCapturePackage(root: string): Promise<CaptureManifest> {
  const manifestValue: unknown = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (!isManifest(manifestValue)) throw new Error("capture manifest schema validation failed");
  const manifest = manifestValue;
  const { manifestContentSha256, ...manifestContent } = manifest;
  if (manifestHash(manifestContent) !== manifestContentSha256) throw new Error("capture package integrity failure: manifest content");
  const declaredPaths = manifest.files.map((file) => file.path);
  if (new Set(declaredPaths).size !== declaredPaths.length) throw new Error("capture package schema validation failed: duplicate file");
  const actualPaths = await listPackageFiles(root);
  const expectedPaths = ["manifest.json", ...declaredPaths].sort(compareText);
  if (stableJson(actualPaths) !== stableJson(expectedPaths)) throw new Error("capture package contains undeclared or missing files");
  let bytes = 0;
  const contents = new Map<string, Buffer>();
  for (const file of manifest.files) {
    const content = await readFile(safeJoin(root, file.path));
    if (content.byteLength !== file.bytes || hash(content) !== file.sha256) throw new Error(`capture package integrity failure: ${file.path}`);
    assertSafeContent(content, file.path);
    bytes += content.byteLength;
    contents.set(file.path, content);
  }
  if (bytes !== manifest.counts.bytes) throw new Error("capture package integrity failure: byte count");
  const dictionaryFile = manifest.files.find((file) => file.path === "source-dictionary.json");
  if (!dictionaryFile || dictionaryFile.records !== 1) throw new Error("capture package schema validation failed: source dictionary");
  const sourceDictionary = JSON.parse((contents.get("source-dictionary.json") ?? Buffer.alloc(0)).toString("utf8")) as CaptureSourceDictionary;
  assertValidSourceDictionary(sourceDictionary);
  const computedDictionarySha256 = sourceDictionaryContentSha256(sourceDictionary);
  if (sourceDictionary.sha256 !== computedDictionarySha256 || manifest.sourceDictionarySha256 !== computedDictionarySha256) throw new Error("capture package integrity failure: source dictionary content");
  const queriesFile = manifest.files.find((file) => file.path === "queries.jsonl");
  if (!queriesFile || queriesFile.records !== manifest.counts.queries) throw new Error("capture package schema validation failed: queries count");
  const snapshotFiles = manifest.files.filter((file) => /^snapshots\/[A-Za-z0-9][A-Za-z0-9._-]*\/page-\d{4}\.html$/.test(file.path));
  if (snapshotFiles.length !== manifest.counts.pages) throw new Error("capture package schema validation failed: page count");
  const queryLines = (contents.get("queries.jsonl") ?? Buffer.alloc(0)).toString("utf8").trim().split("\n").filter(Boolean);
  if (queryLines.length !== manifest.counts.queries) throw new Error("capture package schema validation failed: query records");
  const queries = queryLines.map((line) => JSON.parse(line) as CaptureQuery);
  const snapshots = snapshotFiles.map((file) => {
    const match = /^snapshots\/([A-Za-z0-9][A-Za-z0-9._-]*)\/page-(\d{4})\.html$/.exec(file.path)!;
    return { queryId: match[1], page: Number(match[2]), bytes: contents.get(file.path)! };
  });
  validateInput({ batchId: manifest.batchId, status: manifest.status, sourceDictionarySha256: manifest.sourceDictionarySha256, queries, snapshots, sourceDictionary });
  const statuses: Partial<Record<QueryStatus, number>> = {};
  for (const query of queries) statuses[query.status] = (statuses[query.status] ?? 0) + 1;
  if (stableJson(statuses) !== stableJson(manifest.counts.statuses)) throw new Error("capture package integrity failure: status counts");
  const records = queries.reduce((total, query) => total + (query.capturedRecordCount ?? (query.status === "complete" ? query.declaredRecordCount : 0)), 0);
  if (manifest.counts.records !== undefined && records !== manifest.counts.records) throw new Error("capture package integrity failure: record count");
  const incomplete = (statuses.pending ?? 0) + (statuses.failed ?? 0);
  if (manifest.status === "complete" && (incomplete !== 0 || (statuses.exception ?? 0) !== 0)) {
    throw new Error("capture package semantic failure: complete manifest contains non-complete queries");
  }
  if (manifest.status === "complete_with_exceptions" && (incomplete !== 0 || (statuses.exception ?? 0) === 0)) {
    throw new Error("capture package semantic failure: exception manifest has invalid query states");
  }
  if (manifest.status === "source_changed" && incomplete !== 0) {
    throw new Error("capture package semantic failure: source-changed manifest contains unfinished queries");
  }
  return { ...manifest, counts: { ...manifest.counts, records } };
}
