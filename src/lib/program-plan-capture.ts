/**
 * 培养方案采集包：manifest.json + queries.jsonl + snapshots/。
 * 独立 schema，不混进目录基线批准包。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  PROGRAM_PLAN_CAPTURE_SCHEMA,
  assertProgramPlanCaptureSafe,
  deriveProgramPlanRecords,
  validateProgramPlanQueries,
  type ProgramPlanCaptureManifest,
  type ProgramPlanCourse,
  type ProgramPlanQuery,
} from "./program-plan";

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hash(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSafePathPart(value: string, name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`invalid ${name}`);
}

function isSafeArtifactPath(value: string) {
  return !value.includes("\\") && value.split("/").every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part));
}

function safeJoin(root: string, artifactPath: string) {
  const destination = resolve(root, ...artifactPath.split("/"));
  const prefix = `${resolve(root)}${sep}`;
  if (!destination.startsWith(prefix)) throw new Error("artifact path escapes package root");
  return destination;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const httpUrl = /https?:\/\/[^\s"'<>]+/gi;

function assertSafeHtml(html: string, source: string) {
  assertProgramPlanCaptureSafe(html, source);
  for (const match of html.matchAll(httpUrl)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      throw new Error(`unsafe URL in ${source}`);
    }
    if (url.protocol !== "https:" || url.hostname !== "jwxt.jxufe.edu.cn") {
      throw new Error(`unsafe cross-origin URL in ${source}`);
    }
  }
}

export type ProgramPlanCaptureInput = {
  batchId: string;
  status: ProgramPlanCaptureManifest["status"];
  queries: ProgramPlanQuery[];
  snapshots: Array<{ queryId: string; page: number; html: string }>;
};

function validateInput(input: ProgramPlanCaptureInput) {
  assertSafePathPart(input.batchId, "batchId");
  validateProgramPlanQueries(input.queries);
  const queryIds = new Set(input.queries.map((query) => query.queryId));
  const pageKeys = new Set<string>();
  for (const snapshot of input.snapshots) {
    if (!queryIds.has(snapshot.queryId)) throw new Error(`snapshot references unknown query ${snapshot.queryId}`);
    if (!Number.isSafeInteger(snapshot.page) || snapshot.page < 1 || snapshot.page > 9999) {
      throw new Error("invalid snapshot page");
    }
    const key = `${snapshot.queryId}:${snapshot.page}`;
    if (pageKeys.has(key)) throw new Error(`duplicate snapshot ${key}`);
    pageKeys.add(key);
    assertSafeHtml(snapshot.html, key);
  }
  for (const query of input.queries) {
    if (!Number.isSafeInteger(query.pageCount) || query.pageCount < 0) {
      throw new Error(`invalid page count for ${query.queryId}`);
    }
    const pages = input.snapshots
      .filter((snapshot) => snapshot.queryId === query.queryId)
      .map((snapshot) => snapshot.page)
      .sort((left, right) => left - right);
    if (query.status === "complete" && pages.length !== query.pageCount) {
      throw new Error(`page count mismatch for ${query.queryId}`);
    }
    if (pages.some((page, index) => page !== index + 1)) {
      throw new Error(`snapshot pages must be continuous for ${query.queryId}`);
    }
  }
}

function manifestHash(manifest: Omit<ProgramPlanCaptureManifest, "manifestContentSha256">) {
  return hash(stableJson(manifest));
}

export async function writeProgramPlanCapturePackage(
  root: string,
  input: ProgramPlanCaptureInput,
): Promise<ProgramPlanCaptureManifest> {
  validateInput(input);
  const queryBytes = Buffer.from(
    input.queries.map((query) => JSON.stringify(query)).join("\n") + (input.queries.length ? "\n" : ""),
  );
  const artifacts = [
    { path: "queries.jsonl", bytes: queryBytes, records: input.queries.length },
    ...input.snapshots
      .map((snapshot) => ({
        path: `snapshots/${snapshot.queryId}/page-${String(snapshot.page).padStart(4, "0")}.html`,
        bytes: Buffer.from(snapshot.html),
        records: 1,
      }))
      .sort((left, right) => compareText(left.path, right.path)),
  ];
  const manifestContent: Omit<ProgramPlanCaptureManifest, "manifestContentSha256"> = {
    schemaVersion: PROGRAM_PLAN_CAPTURE_SCHEMA,
    batchId: input.batchId,
    status: input.status,
    counts: {
      queries: input.queries.length,
      pages: input.snapshots.length,
      records: input.queries.reduce(
        (total, query) => total + (query.capturedRecordCount ?? (query.status === "complete" ? query.declaredRecordCount : 0)),
        0,
      ),
    },
    files: artifacts.map((artifact) => ({
      path: artifact.path,
      bytes: artifact.bytes.byteLength,
      records: artifact.records,
      sha256: hash(artifact.bytes),
    })),
  };
  const manifest: ProgramPlanCaptureManifest = {
    ...manifestContent,
    manifestContentSha256: manifestHash(manifestContent),
  };
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

async function listPackageFiles(root: string, directory = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await listPackageFiles(root, path)));
    else if (entry.isFile()) result.push(path.slice(resolve(root).length + 1).split(sep).join("/"));
  }
  return result.sort(compareText);
}

export async function validateProgramPlanCapturePackage(root: string): Promise<ProgramPlanCaptureManifest> {
  const manifestValue: unknown = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (!manifestValue || typeof manifestValue !== "object") throw new Error("capture manifest schema validation failed");
  const manifest = manifestValue as ProgramPlanCaptureManifest;
  if (manifest.schemaVersion !== PROGRAM_PLAN_CAPTURE_SCHEMA) throw new Error("unsupported capture schema");
  const { manifestContentSha256, ...manifestContent } = manifest;
  if (manifestHash(manifestContent) !== manifestContentSha256) {
    throw new Error("capture package integrity failure: manifest content");
  }
  const declaredPaths = manifest.files.map((file) => file.path);
  if (new Set(declaredPaths).size !== declaredPaths.length) throw new Error("duplicate file");
  const actualPaths = await listPackageFiles(root);
  const expectedPaths = ["manifest.json", ...declaredPaths].sort(compareText);
  if (stableJson(actualPaths) !== stableJson(expectedPaths)) {
    throw new Error("capture package contains undeclared or missing files");
  }
  const contents = new Map<string, Buffer>();
  for (const file of manifest.files) {
    if (!isSafeArtifactPath(file.path)) throw new Error(`unsafe artifact path ${file.path}`);
    const content = await readFile(safeJoin(root, file.path));
    if (content.byteLength !== file.bytes || hash(content) !== file.sha256) {
      throw new Error(`capture package integrity failure: ${file.path}`);
    }
    contents.set(file.path, content);
  }
  const queryLines = (contents.get("queries.jsonl") ?? Buffer.alloc(0)).toString("utf8").trim().split("\n").filter(Boolean);
  const queries = queryLines.map((line) => JSON.parse(line) as ProgramPlanQuery);
  const snapshotFiles = manifest.files.filter((file) => /^snapshots\/[A-Za-z0-9][A-Za-z0-9._-]*\/page-\d{4}\.html$/.test(file.path));
  const snapshots = snapshotFiles.map((file) => {
    const match = /^snapshots\/([A-Za-z0-9][A-Za-z0-9._-]*)\/page-(\d{4})\.html$/.exec(file.path)!;
    return {
      queryId: match[1],
      page: Number(match[2]),
      html: (contents.get(file.path) ?? Buffer.alloc(0)).toString("utf8"),
    };
  });
  validateInput({ batchId: manifest.batchId, status: manifest.status, queries, snapshots });
  return manifest;
}

export async function deriveProgramPlanFromCapturePackage(root: string): Promise<{
  records: ProgramPlanCourse[];
  exceptions: ReturnType<typeof deriveProgramPlanRecords>["exceptions"];
}> {
  const manifest = await validateProgramPlanCapturePackage(root);
  const queryLines = (await readFile(join(root, "queries.jsonl"), "utf8")).trim().split("\n").filter(Boolean);
  const queries = queryLines.map((line) => JSON.parse(line) as ProgramPlanQuery);
  const snapshots = manifest.files
    .filter((file) => file.path.startsWith("snapshots/"))
    .map((file) => {
      const match = /^snapshots\/([A-Za-z0-9][A-Za-z0-9._-]*)\/page-\d{4}\.html$/.exec(file.path)!;
      return { queryId: match[1], path: file.path };
    });
  const htmlPages = await Promise.all(
    snapshots.map(async (snapshot) => ({
      queryId: snapshot.queryId,
      html: await readFile(safeJoin(root, snapshot.path), "utf8"),
    })),
  );
  return deriveProgramPlanRecords(queries, htmlPages);
}
