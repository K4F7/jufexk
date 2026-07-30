import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  COURSE_SCHEMA_VERSION,
  RELATION_SCHEMA_VERSION,
  TEACHER_SCHEMA_VERSION,
  type RelationRecord,
  type TeacherRecord,
} from "./derive";
import {
  QUALITY_CONFLICT_SCHEMA_VERSION,
  QUALITY_COVERAGE_EXCEPTION_SCHEMA_VERSION,
  QUALITY_COVERAGE_SCHEMA_VERSION,
  QUALITY_EXCLUSION_SCHEMA_VERSION,
  QUALITY_GOLDEN_SCHEMA_VERSION,
  QUALITY_MANIFEST_SCHEMA_VERSION,
  validateBoundaryFixtureIndex,
  type GoldenBoundaryRecord,
  type GoldenSampleRecord,
  type QualityConflict,
  type QualityCoverage,
  type QualityCoverageException,
  type QualityCourse,
  type QualityExclusion,
  type QualityManifest,
} from "./quality";

export const APPROVED_RECORD_SCHEMA_VERSION = "catalog-baseline-approved-record/v1" as const;
export const APPROVED_MANIFEST_SCHEMA_VERSION = "catalog-baseline-approved-manifest/v1" as const;

const qualityArtifactNames = ["courses.jsonl", "teachers.jsonl", "relations.jsonl", "conflicts.jsonl", "exclusions.jsonl", "coverage-exceptions.jsonl", "golden-sample.jsonl", "coverage.json"] as const;
const approvedArtifactName = "catalog-baseline.jsonl" as const;

type QualityGoldenRecord = GoldenSampleRecord | GoldenBoundaryRecord;
interface ApprovedRecord {
  schemaVersion: typeof APPROVED_RECORD_SCHEMA_VERSION;
  recordType: "course" | "teacher" | "relation";
  value: QualityCourse | TeacherRecord | RelationRecord;
}

export interface ApprovedCatalogManifest {
  schemaVersion: typeof APPROVED_MANIFEST_SCHEMA_VERSION;
  status: "package_ready";
  sourceCaptureManifestContentSha256: string;
  derivationContentSha256: string;
  qualityManifestContentSha256: string;
  decisionsSha256: string;
  boundaryFixtureContentSha256: string;
  counts: { courses: number; teachers: number; relations: number; totalRecords: number };
  artifact: { path: typeof approvedArtifactName; records: number; bytes: number; sha256: string };
  contentSha256: string;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseJsonLines<T>(bytes: Uint8Array): T[] {
  return new TextDecoder().decode(bytes).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

function assertSha256(value: unknown, field: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`invalid ${field}`);
}

async function requireDirectory(path: string, label: string) {
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`${label} must be a directory`);
}

async function requireAbsent(path: string) {
  const info = await stat(path).catch(() => null);
  if (info) throw new Error(`approved output already exists: ${path}`);
}

async function readQualityArtifact<T>(root: string, manifest: QualityManifest, path: (typeof qualityArtifactNames)[number]): Promise<{ bytes: Buffer; value: T }> {
  const declaration = manifest.files.find((file) => file.path === path);
  if (!declaration) throw new Error(`quality manifest does not declare ${path}`);
  const bytes = await readFile(join(root, path));
  if (bytes.byteLength !== declaration.bytes || sha256(bytes) !== declaration.sha256) throw new Error(`quality artifact integrity check failed for ${path}`);
  const value = path.endsWith(".jsonl") ? parseJsonLines(bytes) : JSON.parse(bytes.toString("utf8"));
  const records = Array.isArray(value) ? value.length : 1;
  if (records !== declaration.records) throw new Error(`quality artifact record count check failed for ${path}`);
  return { bytes, value: value as T };
}

async function readVerifiedQualityPackage(root: string) {
  await requireDirectory(root, "quality input");
  const entries = await readdir(root, { withFileTypes: true });
  const expectedEntries = [...qualityArtifactNames, "manifest.json"].sort(compareText);
  const actualEntries = entries.map((entry) => entry.name).sort(compareText);
  if (entries.some((entry) => !entry.isFile()) || JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) throw new Error("quality directory must contain exactly the declared quality package files");

  const manifestBytes = await readFile(join(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as QualityManifest;
  if (manifest.schemaVersion !== QUALITY_MANIFEST_SCHEMA_VERSION || !Array.isArray(manifest.files)) throw new Error("input is not a supported quality package");
  const { contentSha256, ...manifestContent } = manifest;
  assertSha256(contentSha256, "quality manifest contentSha256");
  if (sha256(stableJson(manifestContent)) !== contentSha256) throw new Error("quality manifest content hash check failed");
  for (const [value, field] of [
    [manifest.captureManifestContentSha256, "capture manifest content hash"],
    [manifest.derivationContentSha256, "derivation content hash"],
    [manifest.decisionsSha256, "decisions hash"],
    [manifest.boundaryFixtureContentSha256, "boundary fixture content hash"],
  ] as const) assertSha256(value, field);
  const declaredPaths = manifest.files.map((file) => file.path).sort(compareText);
  if (JSON.stringify(declaredPaths) !== JSON.stringify([...qualityArtifactNames].sort(compareText))) throw new Error("quality manifest must declare each expected artifact exactly once");

  const [courseFile, teacherFile, relationFile, conflictFile, exclusionFile, coverageExceptionFile, goldenFile, coverageFile] = await Promise.all([
    readQualityArtifact<QualityCourse[]>(root, manifest, "courses.jsonl"),
    readQualityArtifact<TeacherRecord[]>(root, manifest, "teachers.jsonl"),
    readQualityArtifact<RelationRecord[]>(root, manifest, "relations.jsonl"),
    readQualityArtifact<QualityConflict[]>(root, manifest, "conflicts.jsonl"),
    readQualityArtifact<QualityExclusion[]>(root, manifest, "exclusions.jsonl"),
    readQualityArtifact<QualityCoverageException[]>(root, manifest, "coverage-exceptions.jsonl"),
    readQualityArtifact<QualityGoldenRecord[]>(root, manifest, "golden-sample.jsonl"),
    readQualityArtifact<QualityCoverage>(root, manifest, "coverage.json"),
  ]);
  const courses = courseFile.value;
  const teachers = teacherFile.value;
  const relations = relationFile.value;
  const conflicts = conflictFile.value;
  const exclusions = exclusionFile.value;
  const coverageExceptions = coverageExceptionFile.value;
  const golden = goldenFile.value;
  const coverage = coverageFile.value;

  if (manifest.status !== "quality_passed" || coverage.schemaVersion !== QUALITY_COVERAGE_SCHEMA_VERSION || coverage.status !== "quality_passed") throw new Error("quality package is not quality_passed");
  if (coverage.blockerIds.length || coverage.counts.pendingConflicts || coverage.counts.goldenUnverified) throw new Error("quality package still has blockers");
  validateBoundaryFixtureIndex({ schemaVersion: "catalog-pilot-fixtures/v1", boundaries: coverage.boundaries });
  if (conflicts.some((item) => item.schemaVersion !== QUALITY_CONFLICT_SCHEMA_VERSION || item.status !== "resolved")) throw new Error("quality package has unresolved conflicts");
  if (exclusions.some((item) => item.schemaVersion !== QUALITY_EXCLUSION_SCHEMA_VERSION)) throw new Error("invalid quality exclusion schema");
  if (coverageExceptions.some((item) => item.schemaVersion !== QUALITY_COVERAGE_EXCEPTION_SCHEMA_VERSION || item.decision.subjectKey !== item.subjectKey)) throw new Error("invalid quality coverage-exception schema or subject binding");
  if (golden.some((item) => item.schemaVersion !== QUALITY_GOLDEN_SCHEMA_VERSION || item.verified !== true)) throw new Error("quality package has unverified or invalid golden evidence");
  if (courses.some((item) => item.schemaVersion !== COURSE_SCHEMA_VERSION || !["general", "sports"].includes(item.category))) throw new Error("approved course candidates require a valid review template kind");
  if (courses.some((item) => !Array.isArray(item.sourceCategoryTexts) || item.sourceCategoryTexts.some((text) => typeof text !== "string"))) throw new Error("approved course candidates require explicit source category evidence");
  if (teachers.some((item) => item.schemaVersion !== TEACHER_SCHEMA_VERSION)) throw new Error("invalid teacher candidate schema");
  if (relations.some((item) => item.schemaVersion !== RELATION_SCHEMA_VERSION || !item.provenance.length)) throw new Error("invalid relation candidate schema or provenance");
  if (coverage.counts.courses !== courses.length || coverage.counts.teachers !== teachers.length || coverage.counts.relations !== relations.length || coverage.counts.conflicts !== conflicts.length || coverage.counts.exclusions !== exclusions.length || coverage.counts.coverageExceptions !== coverageExceptions.length || coverage.counts.goldenSample !== golden.length) throw new Error("quality coverage counts do not match artifacts");

  const courseCodes = new Set(courses.map((item) => item.courseCode));
  const teacherLabels = new Set(teachers.map((item) => item.sourceTeacherLabel));
  const relationByKey = new Map(relations.map((item) => [`${item.courseCode}\u0000${item.sourceTeacherLabel}`, item]));
  const relationKeys = new Set(relationByKey.keys());
  if (courseCodes.size !== courses.length || teacherLabels.size !== teachers.length || relationKeys.size !== relations.length) throw new Error("quality candidate identities must be unique");
  if (relations.some((item) => !courseCodes.has(item.courseCode) || !teacherLabels.has(item.sourceTeacherLabel))) throw new Error("relation candidate references a missing course or teacher");
  const sampleIds = new Set(golden.map((item) => item.sampleId));
  if (sampleIds.size !== golden.length) throw new Error("golden sample identities must be unique");
  const relationGolden = golden.filter((item): item is GoldenSampleRecord => item.kind === "relation");
  const boundaryGolden = golden.filter((item): item is GoldenBoundaryRecord => item.kind === "boundary_fixture");
  if (relationGolden.length !== Math.min(100, relations.length) || relationGolden.some((item) => {
    const relation = relationByKey.get(`${item.courseCode}\u0000${item.sourceTeacherLabel}`);
    return !relation || stableJson(item.provenance) !== stableJson(relation.provenance);
  })) throw new Error("golden relation coverage or provenance does not match approved relations");
  const expectedBoundaryGolden = Object.entries(coverage.boundaries)
    .filter(([, evidence]) => evidence.status === "proven")
    .map(([boundary, evidence]) => `${boundary}\u0000${evidence.fixtures[0]}`)
    .sort(compareText);
  const actualBoundaryGolden = boundaryGolden.map((item) => `${item.boundary}\u0000${item.fixture}`).sort(compareText);
  if (JSON.stringify(actualBoundaryGolden) !== JSON.stringify(expectedBoundaryGolden)) throw new Error("golden boundary coverage does not match frozen fixtures");
  const coverageExceptionKeys = new Set(coverageExceptions
    .filter((item) => item.decision.decision === "coverage_exception")
    .map((item) => item.subjectKey));
  const unresolvedNotObserved = Object.entries(coverage.boundaries)
    .filter(([, evidence]) => evidence.status === "not_observed")
    .map(([boundary]) => `boundary:${boundary}`)
    .filter((subjectKey) => !coverageExceptionKeys.has(subjectKey));
  if (unresolvedNotObserved.length) throw new Error("not-observed boundaries require audited coverage exceptions");
  return { manifest, courses, teachers, relations };
}

export async function compileApprovedCatalogBaseline(qualityDirectory: string, outputDirectory: string): Promise<ApprovedCatalogManifest> {
  const qualityRoot = resolve(qualityDirectory);
  const outputRoot = resolve(outputDirectory);
  if (qualityRoot === outputRoot) throw new Error("quality input and approved output directories must differ");
  await requireAbsent(outputRoot);
  const { manifest: qualityManifest, courses, teachers, relations } = await readVerifiedQualityPackage(qualityRoot);

  const records: ApprovedRecord[] = [
    ...[...courses].sort((left, right) => compareText(left.courseCode, right.courseCode)).map((value) => ({ schemaVersion: APPROVED_RECORD_SCHEMA_VERSION, recordType: "course" as const, value })),
    ...[...teachers].sort((left, right) => compareText(left.sourceTeacherLabel, right.sourceTeacherLabel)).map((value) => ({ schemaVersion: APPROVED_RECORD_SCHEMA_VERSION, recordType: "teacher" as const, value })),
    ...[...relations].sort((left, right) => compareText(`${left.courseCode}\u0000${left.sourceTeacherLabel}`, `${right.courseCode}\u0000${right.sourceTeacherLabel}`)).map((value) => ({ schemaVersion: APPROVED_RECORD_SCHEMA_VERSION, recordType: "relation" as const, value })),
  ];
  const artifactBytes = Buffer.from(records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
  const content = {
    schemaVersion: APPROVED_MANIFEST_SCHEMA_VERSION,
    status: "package_ready" as const,
    sourceCaptureManifestContentSha256: qualityManifest.captureManifestContentSha256,
    derivationContentSha256: qualityManifest.derivationContentSha256,
    qualityManifestContentSha256: qualityManifest.contentSha256,
    decisionsSha256: qualityManifest.decisionsSha256,
    boundaryFixtureContentSha256: qualityManifest.boundaryFixtureContentSha256,
    counts: { courses: courses.length, teachers: teachers.length, relations: relations.length, totalRecords: records.length },
    artifact: { path: approvedArtifactName, records: records.length, bytes: artifactBytes.byteLength, sha256: sha256(artifactBytes) },
  };
  const approvedManifest: ApprovedCatalogManifest = { ...content, contentSha256: sha256(stableJson(content)) };

  await mkdir(dirname(outputRoot), { recursive: true });
  const temporaryRoot = await mkdtemp(join(dirname(outputRoot), `.${basename(outputRoot)}-tmp-`));
  try {
    await Promise.all([
      writeFile(join(temporaryRoot, approvedArtifactName), artifactBytes),
      writeFile(join(temporaryRoot, "manifest.json"), `${JSON.stringify(approvedManifest, null, 2)}\n`),
    ]);
    await rename(temporaryRoot, outputRoot);
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  return approvedManifest;
}
