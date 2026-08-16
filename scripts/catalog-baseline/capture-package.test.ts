import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CAPTURE_PACKAGE_SCHEMA_VERSION,
  sourceDictionaryContentSha256,
  validateCapturePackage,
  writeCapturePackage,
  type CapturePackageInput,
} from "./capture-package";

const roots: string[] = [];

async function tempRoot(name: string) {
  const root = join(tmpdir(), `jufexk-catalog-${name}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixture(overrides: Partial<CapturePackageInput> = {}): CapturePackageInput {
  const dictionaryContent = { schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION, semesters: [], educationLevels: [], grades: [], homeUnits: [], majors: [], capturedAt: "2026-01-01T00:00:00.000Z" };
  const sourceDictionary = { ...dictionaryContent, sha256: sourceDictionaryContentSha256(dictionaryContent) };
  return {
    batchId: "pilot-2026-01",
    status: "complete",
    sourceDictionarySha256: sourceDictionary.sha256,
    sourceDictionary,
    queries: [
      {
        schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION,
        queryId: "main-0001",
        kind: "main",
        dimensions: { semester: "2026-1", educationLevel: "undergraduate", grade: "2025" },
        filters: { department: "", major: "", campus: "", category: "", courseName: "", teacherName: "", homeUnit: "" },
        status: "complete",
        declaredRecordCount: 1,
        pageCount: 1,
        requestParameters: { xnxq: "2026-1", pycc: "undergraduate", nj: "2025" },
      },
    ],
    snapshots: [{ queryId: "main-0001", page: 1, bytes: Buffer.from("<html><body>GBK bytes: \xd6\xd0\xce\xc4</body></html>", "latin1") }],
    ...overrides,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

describe("capture package v1", () => {
  it("round-trips a valid package with exact counts, bytes, and SHA-256", async () => {
    const root = await tempRoot("round-trip");
    const written = await writeCapturePackage(root, fixture());
    const validated = await validateCapturePackage(root);

    expect(validated).toEqual(written);
    expect(validated.schemaVersion).toBe("catalog-capture-package/v1");
    expect(validated.counts).toEqual(expect.objectContaining({ queries: 1, pages: 1, records: 1, statuses: { complete: 1 } }));
    expect(validated.files.map((file) => file.path)).toEqual([
      "queries.jsonl",
      "source-dictionary.json",
      "snapshots/main-0001/page-0001.html",
    ]);
    expect(validated.files[2].bytes).toBe(41);
    expect(await readFile(join(root, "snapshots/main-0001/page-0001.html"))).toEqual(fixture().snapshots[0].bytes);
  });

  it("validates an early v1 manifest without records and derives the count", async () => {
    const root = await tempRoot("early-v1");
    await writeCapturePackage(root, fixture());
    const path = join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    delete manifest.counts.records;
    const { manifestContentSha256: _oldHash, ...content } = manifest;
    manifest.manifestContentSha256 = createHash("sha256").update(stableJson(content)).digest("hex");
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(validateCapturePackage(root)).resolves.toMatchObject({ counts: { records: 1 } });
  });

  it.each([
    ["queries", async (root: string) => writeFile(join(root, "queries.jsonl"), "{}\n")],
    ["snapshot", async (root: string) => writeFile(join(root, "snapshots/main-0001/page-0001.html"), "tampered")],
  ])("rejects changed %s bytes", async (_name, tamper) => {
    const root = await tempRoot("tamper");
    await writeCapturePackage(root, fixture());
    await tamper(root);
    await expect(validateCapturePackage(root)).rejects.toThrow(/integrity/i);
  });

  it("rejects a forged dictionary even when its file and manifest hashes are rewritten", async () => {
    const root = await tempRoot("forged-dictionary");
    await writeCapturePackage(root, fixture());
    const dictionaryPath = join(root, "source-dictionary.json");
    const forged = JSON.parse(await readFile(dictionaryPath, "utf8"));
    forged.homeUnits = [{ id: "FORGED", label: "forged" }];
    const dictionaryBytes = Buffer.from(`${JSON.stringify(forged, null, 2)}\n`);
    await writeFile(dictionaryPath, dictionaryBytes);
    const manifestPath = join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const declaration = manifest.files.find((file: { path: string }) => file.path === "source-dictionary.json");
    manifest.counts.bytes += dictionaryBytes.byteLength - declaration.bytes;
    declaration.bytes = dictionaryBytes.byteLength;
    declaration.sha256 = createHash("sha256").update(dictionaryBytes).digest("hex");
    const { manifestContentSha256: _oldHash, ...content } = manifest;
    manifest.manifestContentSha256 = createHash("sha256").update(stableJson(content)).digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(validateCapturePackage(root)).rejects.toThrow(/source dictionary content/i);
  });

  it.each([
    ["password", "password=hunter2"],
    ["cookie", "Cookie: JSESSIONID=secret"],
    ["token", "access_token=secret"],
    ["authorization", "Authorization: Bearer secret"],
    ["external URL", "https://evil.example/collect"],
  ])("refuses %s in exported package content", async (_name, unsafe) => {
    const root = await tempRoot("unsafe");
    const input = fixture({ snapshots: [{ queryId: "main-0001", page: 1, bytes: Buffer.from(`<html>${unsafe}</html>`) }] });
    await expect(writeCapturePackage(root, input)).rejects.toThrow(/unsafe/i);
  });

  it.each(["password", "cookie", "access_token", "authorization"])("refuses sensitive query parameter key %s", async (key) => {
    const root = await tempRoot("unsafe-query");
    const input = fixture();
    input.queries[0].requestParameters[key] = "secret";
    await expect(writeCapturePackage(root, input)).rejects.toThrow(/unsafe/i);
  });

  it("rejects a semantically changed manifest", async () => {
    const root = await tempRoot("manifest-tamper");
    await writeCapturePackage(root, fixture());
    const path = join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.status = "capturing";
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    await expect(validateCapturePackage(root)).rejects.toThrow(/integrity/i);
  });

  it("rejects non-contiguous snapshot pages", async () => {
    const root = await tempRoot("page-gap");
    const input = fixture();
    input.queries[0].pageCount = 2;
    input.snapshots = [
      { ...input.snapshots[0], page: 1 },
      { ...input.snapshots[0], page: 3 },
    ];
    await expect(writeCapturePackage(root, input)).rejects.toThrow(/continuous/i);
  });

  it("rejects files not declared by the manifest", async () => {
    const root = await tempRoot("extra-file");
    await writeCapturePackage(root, fixture());
    await writeFile(join(root, "unexpected.txt"), "not declared");
    await expect(validateCapturePackage(root)).rejects.toThrow(/undeclared/i);
  });

  it("rejects a complete manifest that contains a pending query", async () => {
    const root = await tempRoot("false-complete");
    const input = fixture();
    input.queries[0].status = "pending";
    await writeCapturePackage(root, input);
    await expect(validateCapturePackage(root)).rejects.toThrow(/semantic/i);
  });

  it("accepts an exception only when the manifest declares exceptions", async () => {
    const root = await tempRoot("declared-exception");
    const input = fixture({ status: "complete_with_exceptions", snapshots: [] });
    input.queries[0].status = "exception";
    input.queries[0].pageCount = 0;
    await writeCapturePackage(root, input);
    await expect(validateCapturePackage(root)).resolves.toMatchObject({ status: "complete_with_exceptions" });
  });

  it("preserves and validates continuous partial pages for an exception query", async () => {
    const root = await tempRoot("partial-exception");
    const input = fixture({ status: "complete_with_exceptions" });
    input.queries[0].status = "exception";
    input.queries[0].pageCount = 2;
    input.queries[0].declaredRecordCount = 2;
    input.queries[0].capturedRecordCount = 1;
    await writeCapturePackage(root, input);
    await expect(validateCapturePackage(root)).resolves.toMatchObject({ counts: { pages: 1, statuses: { exception: 1 } } });
  });
});
