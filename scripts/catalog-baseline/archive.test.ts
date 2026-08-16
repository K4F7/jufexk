import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildArchiveManifest } from "./archive";
import { writeCapturePackage } from "./capture-package";
import { deriveCatalogBaseline } from "./derive";

function sha(value: Uint8Array | string) { return createHash("sha256").update(value).digest("hex") }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function fixture(root: string) {
  const capture = join(root, "capture"), derived = join(root, "derived"), approved = join(root, "approved");
  const dictionaryContent = { schemaVersion: "catalog-capture-package/v1" as const, semesters: [{ id: "S1", label: "学期" }], educationLevels: [{ id: "L1", label: "层次" }], grades: [{ id: "G1", label: "年级" }], homeUnits: [{ id: "U1", label: "单位" }], majors: [] };
  const dictionarySha = sha(stable({ ...dictionaryContent, capturedAt: undefined }));
  const captureManifest = await writeCapturePackage(capture, {
    batchId: "archive-test", status: "complete", sourceDictionarySha256: dictionarySha,
    sourceDictionary: { ...dictionaryContent, sha256: dictionarySha },
    queries: [{ schemaVersion: "catalog-capture-package/v1", queryId: "q1", kind: "main", dimensions: { semester: "S1", educationLevel: "L1", grade: "G1" }, filters: { department: "", major: "", campus: "", category: "", courseName: "", teacherName: "", homeUnit: "" }, status: "complete", declaredRecordCount: 0, capturedRecordCount: 0, pageCount: 0, requestParameters: {} }],
    snapshots: [],
  });
  const derivedManifest = await deriveCatalogBaseline(capture, derived);
  await mkdir(approved);
  const artifact = Buffer.alloc(0);
  const content = {
    schemaVersion: "catalog-baseline-approved-manifest/v1", status: "package_ready",
    sourceCaptureManifestContentSha256: captureManifest.manifestContentSha256, derivationContentSha256: derivedManifest.contentSha256,
    qualityManifestContentSha256: "c".repeat(64), decisionsSha256: "d".repeat(64), boundaryFixtureContentSha256: "e".repeat(64),
    counts: { courses: 0, teachers: 0, relations: 0, totalRecords: 0 }, artifact: { path: "catalog-baseline.jsonl", records: 0, bytes: 0, sha256: sha(artifact) },
  };
  await writeFile(join(approved, "catalog-baseline.jsonl"), artifact);
  await writeFile(join(approved, "manifest.json"), `${JSON.stringify({ ...content, contentSha256: sha(stable(content)) }, null, 2)}\n`);
  return { capture, derived, approved };
}

describe("catalog baseline archive manifest", () => {
  it("verifies and binds capture, derived, and approved packages deterministically", async () => {
    const root = join(tmpdir(), `jufexk-archive-${crypto.randomUUID()}`);
    try {
      const input = await fixture(root);
      const first = await buildArchiveManifest(input.capture, input.derived, input.approved, join(root, "first.json"));
      const second = await buildArchiveManifest(input.capture, input.derived, input.approved, join(root, "second.json"));
      expect(second).toEqual(first);
      expect(await readFile(join(root, "second.json"))).toEqual(await readFile(join(root, "first.json")));
      expect(first).toMatchObject({ status: "retention_pending", retention: { stableDaysRequired: 90, triggerCompletedAt: null, archiveEligibleAt: null } });
      expect(first.packages).toMatchObject({ capture: { records: 0 }, derived: { status: "derived" }, approved: { records: 0 } });
    } finally { await rm(root, { recursive: true, force: true }) }
  });

  it("rejects tampering and cross-package binding mismatches", async () => {
    const root = join(tmpdir(), `jufexk-archive-tamper-${crypto.randomUUID()}`);
    try {
      const input = await fixture(root);
      await writeFile(join(input.approved, "catalog-baseline.jsonl"), "tampered\n");
      await expect(buildArchiveManifest(input.capture, input.derived, input.approved, join(root, "tampered.json"))).rejects.toThrow(/approved artifact integrity/i);
    } finally { await rm(root, { recursive: true, force: true }) }
  });
});
