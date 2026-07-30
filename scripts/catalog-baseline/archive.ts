import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { APPROVED_MANIFEST_SCHEMA_VERSION, type ApprovedCatalogManifest } from "./approve";
import { validateCapturePackage } from "./capture-package";
import { DERIVATION_SCHEMA_VERSION, type ArtifactManifest, type DerivationManifest } from "./derive";

export const ARCHIVE_MANIFEST_SCHEMA_VERSION = "catalog-baseline-archive-manifest/v1" as const;

interface PackageSummary {
  schemaVersion: string;
  status: string;
  manifestContentSha256: string;
  records: number;
  bytes: number;
  files: Array<{ path: string; records: number; bytes: number; sha256: string }>;
}

export interface ArchiveManifest {
  schemaVersion: typeof ARCHIVE_MANIFEST_SCHEMA_VERSION;
  status: "retention_pending";
  retention: {
    trigger: "catalog_import_and_legacy_mapping_complete";
    stableDaysRequired: 90;
    triggerCompletedAt: null;
    archiveEligibleAt: null;
    encryptedOfflineArchiveCompleted: false;
  };
  packages: { capture: PackageSummary; derived: PackageSummary; approved: PackageSummary };
  contentSha256: string;
}

const derivedNames = ["courses.jsonl", "exceptions.jsonl", "inventory.jsonl", "relations.jsonl", "teachers.jsonl"] as const;

function compareText(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0 }
function sha256(value: Uint8Array | string) { return createHash("sha256").update(value).digest("hex") }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function exactFiles(root: string, expected: string[]) {
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile()) || JSON.stringify(entries.map((entry) => entry.name).sort(compareText)) !== JSON.stringify([...expected].sort(compareText))) throw new Error(`package directory has undeclared or missing files: ${root}`);
}

async function verifyFiles(root: string, files: ArtifactManifest[]) {
  for (const file of files) {
    const bytes = await readFile(join(root, file.path));
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`package artifact integrity check failed for ${file.path}`);
    const records = bytes.toString("utf8").trim().split("\n").filter(Boolean).length;
    if (records !== file.records) throw new Error(`package artifact record count check failed for ${file.path}`);
  }
}

async function readDerived(root: string, captureHash: string) {
  await exactFiles(root, [...derivedNames, "manifest.json"]);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as DerivationManifest;
  if (manifest.schemaVersion !== DERIVATION_SCHEMA_VERSION || !["derived", "derived_with_exceptions"].includes(manifest.status) || !Array.isArray(manifest.files)) throw new Error("invalid derivation manifest");
  const { contentSha256, ...content } = manifest;
  if (sha256(stableJson(content)) !== contentSha256) throw new Error("derivation manifest content hash mismatch");
  if (manifest.captureManifestContentSha256 !== captureHash) throw new Error("derivation does not bind the selected capture package");
  if (JSON.stringify(manifest.files.map((file) => file.path).sort(compareText)) !== JSON.stringify([...derivedNames].sort(compareText))) throw new Error("derivation manifest file set mismatch");
  await verifyFiles(root, manifest.files);
  return manifest;
}

async function readApproved(root: string, captureHash: string, derivationHash: string) {
  await exactFiles(root, ["catalog-baseline.jsonl", "manifest.json"]);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as ApprovedCatalogManifest;
  if (manifest.schemaVersion !== APPROVED_MANIFEST_SCHEMA_VERSION || manifest.status !== "package_ready") throw new Error("invalid approved manifest");
  const { contentSha256, ...content } = manifest;
  if (sha256(stableJson(content)) !== contentSha256) throw new Error("approved manifest content hash mismatch");
  if (manifest.sourceCaptureManifestContentSha256 !== captureHash || manifest.derivationContentSha256 !== derivationHash) throw new Error("approved package does not bind the selected capture and derivation packages");
  if (manifest.counts.totalRecords !== manifest.counts.courses + manifest.counts.teachers + manifest.counts.relations || manifest.artifact.records !== manifest.counts.totalRecords) throw new Error("approved package record counts mismatch");
  const bytes = await readFile(join(root, manifest.artifact.path));
  if (bytes.byteLength !== manifest.artifact.bytes || sha256(bytes) !== manifest.artifact.sha256 || bytes.toString("utf8").trim().split("\n").filter(Boolean).length !== manifest.artifact.records) throw new Error("approved artifact integrity check failed");
  return manifest;
}

export async function buildArchiveManifest(captureDirectory: string, derivationDirectory: string, approvedDirectory: string, outputPath: string): Promise<ArchiveManifest> {
  const captureRoot = resolve(captureDirectory), derivedRoot = resolve(derivationDirectory), approvedRoot = resolve(approvedDirectory), destination = resolve(outputPath);
  if ((await stat(destination).catch(() => null))) throw new Error(`archive manifest output already exists: ${destination}`);
  const capture = await validateCapturePackage(captureRoot);
  if (!capture.manifestContentSha256 || !["complete", "complete_with_exceptions"].includes(capture.status)) throw new Error("capture package is not terminal");
  const derived = await readDerived(derivedRoot, capture.manifestContentSha256);
  const approved = await readApproved(approvedRoot, capture.manifestContentSha256, derived.contentSha256);
  const packages = {
    capture: {
      schemaVersion: capture.schemaVersion, status: capture.status, manifestContentSha256: capture.manifestContentSha256,
      records: capture.counts.records, bytes: capture.counts.bytes, files: capture.files,
    },
    derived: {
      schemaVersion: derived.schemaVersion, status: derived.status, manifestContentSha256: derived.contentSha256,
      records: derived.files.reduce((total, file) => total + file.records, 0), bytes: derived.files.reduce((total, file) => total + file.bytes, 0), files: derived.files,
    },
    approved: {
      schemaVersion: approved.schemaVersion, status: approved.status, manifestContentSha256: approved.contentSha256,
      records: approved.artifact.records, bytes: approved.artifact.bytes, files: [approved.artifact],
    },
  };
  const content = {
    schemaVersion: ARCHIVE_MANIFEST_SCHEMA_VERSION,
    status: "retention_pending" as const,
    retention: {
      trigger: "catalog_import_and_legacy_mapping_complete" as const,
      stableDaysRequired: 90 as const,
      triggerCompletedAt: null,
      archiveEligibleAt: null,
      encryptedOfflineArchiveCompleted: false as const,
    },
    packages,
  };
  const manifest: ArchiveManifest = { ...content, contentSha256: sha256(stableJson(content)) };
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
