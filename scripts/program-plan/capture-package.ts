import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  CAPTURE_PACKAGE_SCHEMA_VERSION,
  COVERAGE_SCHEMA_VERSION,
  assertSafeContent,
  assertSafeParameters,
  assertSafePathPart,
  compareText,
  sha256,
  stableJson,
} from "./shared";
import {
  sourceDictionaryContentSha256,
  type CoverageDeclaration,
  type FrozenSourceDictionary,
  type ProgramPlanDimensions,
  type ProgramPlanFilters,
} from "./query-plan";

export { CAPTURE_PACKAGE_SCHEMA_VERSION } from "./shared";
export { sourceDictionaryContentSha256 } from "./query-plan";

export type QueryStatus = "pending" | "complete" | "failed" | "exception";

export interface CaptureQuery {
  schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION;
  queryId: string;
  kind: "main";
  dimensions: ProgramPlanDimensions;
  filters: ProgramPlanFilters;
  status: QueryStatus;
  declaredRecordCount: number;
  capturedRecordCount?: number;
  pageCount: number;
  requestParameters: Record<string, string>;
}

export interface CapturePackageInput {
  batchId: string;
  status: "capturing" | "complete" | "complete_with_exceptions";
  sourceDictionarySha256: string;
  queries: CaptureQuery[];
  snapshots: Array<{ queryId: string; page: number; bytes: Uint8Array }>;
  sourceDictionary: FrozenSourceDictionary;
  coverage: CoverageDeclaration;
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

function assertValidSourceDictionary(dictionary: FrozenSourceDictionary) {
  if (dictionary.schemaVersion !== CAPTURE_PACKAGE_SCHEMA_VERSION || !/^[a-f0-9]{64}$/.test(dictionary.sha256)) {
    throw new Error("source dictionary schema validation failed");
  }
  if (sourceDictionaryContentSha256(dictionary) !== dictionary.sha256) throw new Error("source dictionary content hash mismatch");
}

function assertValidCoverage(coverage: CoverageDeclaration, input: CapturePackageInput) {
  if (coverage.schemaVersion !== COVERAGE_SCHEMA_VERSION || coverage.batchId !== input.batchId) {
    throw new Error("coverage schema validation failed");
  }
  const queryIds = new Set(input.queries.map((query) => query.queryId));
  const seen = new Set<string>();
  for (const entry of coverage.entries) {
    const key = `${entry.grade}:${entry.departmentCode}:${entry.majorCode}`;
    if (seen.has(key)) throw new Error(`duplicate coverage entry ${key}`);
    seen.add(key);
    if (entry.queryId) {
      if (!queryIds.has(entry.queryId)) throw new Error(`coverage references unknown query ${entry.queryId}`);
    } else if (entry.status !== "exception") {
      throw new Error("coverage entry without query must be an exception");
    }
  }
  for (const query of input.queries) {
    if (!coverage.entries.some((entry) => entry.queryId === query.queryId)) {
      throw new Error(`coverage missing query ${query.queryId}`);
    }
  }
  for (const grade of coverage.grades) {
    if (!coverage.entries.some((entry) => entry.grade === grade)) throw new Error(`coverage missing grade ${grade}`);
  }
}

function validateInput(input: CapturePackageInput) {
  assertSafePathPart(input.batchId, "batchId");
  if (!/^[a-f0-9]{64}$/.test(input.sourceDictionarySha256)) throw new Error("invalid source dictionary SHA-256");
  assertValidSourceDictionary(input.sourceDictionary);
  if (input.sourceDictionary.sha256 !== input.sourceDictionarySha256) throw new Error("source dictionary content hash mismatch");
  assertValidCoverage(input.coverage, input);
  const queryIds = new Set<string>();
  for (const query of input.queries) {
    if (query.schemaVersion !== CAPTURE_PACKAGE_SCHEMA_VERSION) throw new Error("unsupported query schema version");
    assertSafePathPart(query.queryId, "queryId");
    if (queryIds.has(query.queryId)) throw new Error(`duplicate query ${query.queryId}`);
    queryIds.add(query.queryId);
    if (query.kind !== "main") throw new Error(`unsupported query kind ${query.kind}`);
    if (query.dimensions.studyKind !== "主修" || query.dimensions.majorDirection !== "") {
      throw new Error(`query ${query.queryId} must be 主修 with empty major direction`);
    }
    if (!Number.isSafeInteger(query.pageCount) || query.pageCount < 0) throw new Error(`invalid page count for ${query.queryId}`);
    if (!Number.isSafeInteger(query.declaredRecordCount) || query.declaredRecordCount < 0) throw new Error(`invalid record count for ${query.queryId}`);
    if (query.capturedRecordCount !== undefined && (!Number.isSafeInteger(query.capturedRecordCount) || query.capturedRecordCount < 0 || query.capturedRecordCount > query.declaredRecordCount)) {
      throw new Error(`invalid captured record count for ${query.queryId}`);
    }
    if (query.status === "complete" && query.capturedRecordCount !== undefined && query.capturedRecordCount !== query.declaredRecordCount) {
      throw new Error(`record count mismatch for ${query.queryId}`);
    }
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
    const pages = input.snapshots.filter((snapshot) => snapshot.queryId === query.queryId).map((snapshot) => snapshot.page).sort((left, right) => left - right);
    if (query.status === "complete" && pages.length !== query.pageCount) throw new Error(`page count mismatch for ${query.queryId}`);
    if (query.status !== "complete" && pages.length > query.pageCount) throw new Error(`page count mismatch for ${query.queryId}`);
    if (pages.some((page, index) => page !== index + 1)) throw new Error(`snapshot pages must be continuous for ${query.queryId}`);
  }
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

function manifestHash(manifest: Omit<CaptureManifest, "manifestContentSha256">) {
  return sha256(stableJson(manifest));
}

export async function writeCapturePackage(root: string, input: CapturePackageInput): Promise<CaptureManifest> {
  validateInput(input);
  const queryBytes = Buffer.from(input.queries.map((query) => JSON.stringify(query)).join("\n") + (input.queries.length ? "\n" : ""));
  const artifacts = [
    { path: "queries.jsonl", bytes: queryBytes, records: input.queries.length },
    { path: "source-dictionary.json", bytes: Buffer.from(`${JSON.stringify(input.sourceDictionary, null, 2)}\n`), records: 1 },
    { path: "coverage.json", bytes: Buffer.from(`${JSON.stringify(input.coverage, null, 2)}\n`), records: input.coverage.entries.length },
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
    files: artifacts.map((artifact) => ({ path: artifact.path, bytes: artifact.bytes.byteLength, records: artifact.records, sha256: sha256(artifact.bytes) })),
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

function isManifest(value: unknown): value is CaptureManifest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CaptureManifest>;
  return item.schemaVersion === CAPTURE_PACKAGE_SCHEMA_VERSION
    && typeof item.batchId === "string"
    && ["capturing", "complete", "complete_with_exceptions"].includes(String(item.status))
    && typeof item.sourceDictionarySha256 === "string" && /^[a-f0-9]{64}$/.test(item.sourceDictionarySha256)
    && typeof item.manifestContentSha256 === "string" && /^[a-f0-9]{64}$/.test(item.manifestContentSha256)
    && !!item.counts && Number.isSafeInteger(item.counts.queries) && Number.isSafeInteger(item.counts.pages) && Number.isSafeInteger(item.counts.records) && Number.isSafeInteger(item.counts.bytes)
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
    if (content.byteLength !== file.bytes || sha256(content) !== file.sha256) throw new Error(`capture package integrity failure: ${file.path}`);
    assertSafeContent(content, file.path);
    bytes += content.byteLength;
    contents.set(file.path, content);
  }
  if (bytes !== manifest.counts.bytes) throw new Error("capture package integrity failure: byte count");
  const dictionary = JSON.parse((contents.get("source-dictionary.json") ?? Buffer.alloc(0)).toString("utf8")) as FrozenSourceDictionary;
  assertValidSourceDictionary(dictionary);
  if (dictionary.sha256 !== manifest.sourceDictionarySha256) throw new Error("capture package integrity failure: source dictionary content");
  const coverage = JSON.parse((contents.get("coverage.json") ?? Buffer.alloc(0)).toString("utf8")) as CoverageDeclaration;
  const queryLines = (contents.get("queries.jsonl") ?? Buffer.alloc(0)).toString("utf8").trim().split("\n").filter(Boolean);
  if (queryLines.length !== manifest.counts.queries) throw new Error("capture package schema validation failed: query records");
  const queries = queryLines.map((line) => JSON.parse(line) as CaptureQuery);
  const snapshotFiles = manifest.files.filter((file) => /^snapshots\/[A-Za-z0-9][A-Za-z0-9._-]*\/page-\d{4}\.html$/.test(file.path));
  if (snapshotFiles.length !== manifest.counts.pages) throw new Error("capture package schema validation failed: page count");
  const snapshots = snapshotFiles.map((file) => {
    const match = /^snapshots\/([A-Za-z0-9][A-Za-z0-9._-]*)\/page-(\d{4})\.html$/.exec(file.path)!;
    return { queryId: match[1], page: Number(match[2]), bytes: contents.get(file.path)! };
  });
  validateInput({
    batchId: manifest.batchId,
    status: manifest.status,
    sourceDictionarySha256: manifest.sourceDictionarySha256,
    queries,
    snapshots,
    sourceDictionary: dictionary,
    coverage,
  });
  const statuses: Partial<Record<QueryStatus, number>> = {};
  for (const query of queries) statuses[query.status] = (statuses[query.status] ?? 0) + 1;
  if (stableJson(statuses) !== stableJson(manifest.counts.statuses)) throw new Error("capture package integrity failure: status counts");
  const records = queries.reduce((total, query) => total + (query.capturedRecordCount ?? (query.status === "complete" ? query.declaredRecordCount : 0)), 0);
  if (records !== manifest.counts.records) throw new Error("capture package integrity failure: record count");
  const incomplete = (statuses.pending ?? 0) + (statuses.failed ?? 0);
  const coverageExceptions = coverage.entries.filter((entry) => entry.status === "exception").length;
  if (manifest.status === "complete" && (incomplete !== 0 || (statuses.exception ?? 0) !== 0 || coverageExceptions !== 0)) {
    throw new Error("capture package semantic failure: complete manifest contains non-complete queries");
  }
  if (manifest.status === "complete_with_exceptions" && incomplete !== 0) {
    throw new Error("capture package semantic failure: exception manifest has unfinished queries");
  }
  if (manifest.status === "complete_with_exceptions" && (statuses.exception ?? 0) === 0 && coverageExceptions === 0) {
    throw new Error("capture package semantic failure: exception manifest has invalid query states");
  }
  return manifest;
}
