import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { COURSE_SCHEMA_VERSION } from "./derive";
import {
  QUALITY_CONFLICT_SCHEMA_VERSION,
  QUALITY_COVERAGE_EXCEPTION_SCHEMA_VERSION,
  QUALITY_COVERAGE_SCHEMA_VERSION,
  QUALITY_GOLDEN_SCHEMA_VERSION,
  QUALITY_MANIFEST_SCHEMA_VERSION,
  validateBoundaryFixtureIndex,
  validateQualityDecisions,
  type GoldenBoundaryRecord,
  type GoldenSampleRecord,
  type QualityConflict,
  type QualityCoverage,
  type QualityCoverageException,
  type QualityCourse,
  type QualityManifest,
} from "./quality";

export const REVIEW_MANIFEST_SCHEMA_VERSION = "catalog-baseline-review-manifest/v1" as const;

const qualityArtifactNames = ["courses.jsonl", "teachers.jsonl", "relations.jsonl", "conflicts.jsonl", "exclusions.jsonl", "coverage-exceptions.jsonl", "golden-sample.jsonl", "coverage.json"] as const;
const reviewArtifactNames = ["catalog-review.md", "summary.csv", "unit_decisions.csv", "course_conflicts.csv", "teacher_conflicts.csv", "coverage_exceptions.csv", "golden_sample.csv"] as const;

interface ReviewArtifact { path: (typeof reviewArtifactNames)[number]; records: number; bytes: number; sha256: string }
export interface ReviewManifest {
  schemaVersion: typeof REVIEW_MANIFEST_SCHEMA_VERSION;
  qualityManifestContentSha256: string;
  status: "review_ready";
  files: ReviewArtifact[];
  contentSha256: string;
}

type ReviewGolden = GoldenSampleRecord | GoldenBoundaryRecord;
type Cell = string | number | boolean | null | undefined;

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

function csvCell(value: Cell) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvBytes(rows: Cell[][]) {
  return Buffer.from(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`);
}

function markdownCell(value: Cell) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
}

function markdownTable(rows: Cell[][], indexes: number[]) {
  const selected = rows.map((row) => indexes.map((index) => markdownCell(row[index])));
  const header = selected[0];
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...selected.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function decisionCells(conflict: QualityConflict): Cell[] {
  return [conflict.decision?.decision, conflict.decision?.correctedValue, conflict.decision?.reason, conflict.decision?.reviewer];
}

function allowedFor(conflict: QualityConflict): [string, string] {
  if (conflict.code === "LOCATION_EVIDENCE_UNKNOWN") return ["include|exclude|coverage_exception", "mailu|fenglin|jiaoquiao|mooc (include 时必填)"];
  if (conflict.code === "PE_SPECIALIZATION_MAPPING_REQUIRED") return ["include|coverage_exception", "具体专项名 (include 时必填)"];
  if (["SOURCE_DERIVATION_EXCEPTION", "UNIT_EVIDENCE_MISSING"].includes(conflict.code)) return ["exclude|coverage_exception", ""];
  return ["include|exclude", ""];
}

export function buildCatalogReviewFiles(input: {
  qualityManifestContentSha256: string;
  courses: QualityCourse[];
  conflicts: QualityConflict[];
  coverageExceptions: QualityCoverageException[];
  golden: ReviewGolden[];
  coverage: QualityCoverage;
}): Map<(typeof reviewArtifactNames)[number], Buffer> {
  const courseNames = new Map(input.courses.map((course) => [course.courseCode, course.currentName]));
  const pendingByCode = new Map<string, number>();
  for (const conflict of input.conflicts.filter((item) => item.status === "pending")) pendingByCode.set(conflict.code, (pendingByCode.get(conflict.code) ?? 0) + 1);
  const summary: Cell[][] = [
    ["metric", "value", "note"],
    ["quality_status", input.coverage.status, "任一未决异常或未核验金标准都会阻断批准包"],
    ["pending_conflicts", input.coverage.counts.pendingConflicts, "只填写各审核表末尾的 decision/correctedValue/reason/reviewer"],
    ["golden_unverified", input.coverage.counts.goldenUnverified, "关系身份核对正确后 decision 填 include"],
    ["coverage_exceptions", input.coverage.counts.coverageExceptions, "已接受例外会预填，不能改写只读来源列"],
    ...[...pendingByCode.entries()].sort(([left], [right]) => compareText(left, right)).map(([code, count]) => [`pending_${code}`, count, ""]),
  ];

  const unitHeader: Cell[] = ["subjectKey", "code", "unitCode", "unitLabel", "detail", "allowedDecisions", "allowedCorrectedValues", "decision", "correctedValue", "reason", "reviewer"];
  const courseHeader: Cell[] = ["subjectKey", "code", "courseCode", "currentName", "detail", "evidenceJson", "allowedDecisions", "allowedCorrectedValues", "decision", "correctedValue", "reason", "reviewer"];
  const teacherHeader: Cell[] = ["subjectKey", "code", "sourceTeacherLabel", "detail", "evidenceJson", "allowedDecisions", "allowedCorrectedValues", "decision", "correctedValue", "reason", "reviewer"];
  const coverageHeader: Cell[] = ["subjectKey", "code", "courseCode", "currentName", "detail", "sourceContextJson", "allowedDecisions", "allowedCorrectedValues", "decision", "correctedValue", "reason", "reviewer"];
  const goldenHeader: Cell[] = ["subjectKey", "courseCode", "currentName", "sourceTeacherLabel", "provenanceCount", "semesters", "educationLevels", "grades", "provenanceJson", "allowedDecisions", "decision", "reason", "reviewer"];
  const unitRows: Cell[][] = [unitHeader];
  const courseRows: Cell[][] = [courseHeader];
  const teacherRows: Cell[][] = [teacherHeader];
  const coverageRows: Cell[][] = [coverageHeader];
  const goldenRows: Cell[][] = [goldenHeader];

  for (const conflict of [...input.conflicts].sort((left, right) => compareText(left.conflictId, right.conflictId))) {
    const [allowedDecisions, allowedCorrectedValues] = allowedFor(conflict);
    const decision = decisionCells(conflict);
    if (conflict.code.startsWith("UNIT_") && conflict.code !== "UNIT_EVIDENCE_MISSING") {
      unitRows.push([conflict.conflictId, conflict.code, conflict.evidence[0], conflict.evidence[1], conflict.detail, allowedDecisions, allowedCorrectedValues, ...decision]);
    } else if (conflict.code.startsWith("TEACHER_")) {
      teacherRows.push([conflict.conflictId, conflict.code, conflict.evidence[0], conflict.detail, JSON.stringify(conflict.evidence), allowedDecisions, allowedCorrectedValues, ...decision]);
    } else if (["SOURCE_DERIVATION_EXCEPTION", "LOCATION_EVIDENCE_UNKNOWN", "UNIT_EVIDENCE_MISSING"].includes(conflict.code)) {
      coverageRows.push([conflict.conflictId, conflict.code, conflict.courseCode, courseNames.get(conflict.courseCode ?? ""), conflict.detail, conflict.evidence[0] ?? JSON.stringify(conflict.evidence), allowedDecisions, allowedCorrectedValues, ...decision]);
    } else {
      courseRows.push([conflict.conflictId, conflict.code, conflict.courseCode, courseNames.get(conflict.courseCode ?? ""), conflict.detail, JSON.stringify(conflict.evidence), allowedDecisions, allowedCorrectedValues, ...decision]);
    }
  }

  const conflictKeys = new Set(input.conflicts.map((item) => item.conflictId));
  for (const exception of [...input.coverageExceptions].sort((left, right) => compareText(left.subjectKey, right.subjectKey))) {
    if (conflictKeys.has(exception.subjectKey)) continue;
    coverageRows.push([exception.subjectKey, "BOUNDARY_NOT_OBSERVED", "", "", exception.detail, "", "coverage_exception", "", exception.decision.decision, exception.decision.correctedValue, exception.decision.reason, exception.decision.reviewer]);
  }

  for (const sample of input.golden.filter((item): item is GoldenSampleRecord => item.kind === "relation" && !item.verified).sort((left, right) => compareText(left.sampleId, right.sampleId))) {
    goldenRows.push([
      sample.sampleId,
      sample.courseCode,
      courseNames.get(sample.courseCode),
      sample.sourceTeacherLabel,
      sample.provenance.length,
      [...new Set(sample.provenance.map((item) => item.semester))].sort(compareText).join("|"),
      [...new Set(sample.provenance.map((item) => item.educationLevel))].sort(compareText).join("|"),
      [...new Set(sample.provenance.map((item) => item.grade))].sort(compareText).join("|"),
      JSON.stringify(sample.provenance),
      "include",
      "",
      "",
      "",
    ]);
  }

  const pendingCoverageRows = [coverageRows[0], ...coverageRows.slice(1).filter((row) => !row[8])];
  const resolvedCoverageCount = coverageRows.length - pendingCoverageRows.length;
  const markdown = Buffer.from(`${[
    "# Catalog baseline review",
    "",
    `Quality manifest: \`${input.qualityManifestContentSha256}\``,
    "",
    "只填写各表的 decision、correctedValue、reason、reviewer；来源列由质量包哈希绑定。可稳定判定的记录已经由机器规则终结，本文件只保留真正待决事项。",
    "",
    "## summary",
    "",
    markdownTable(summary, [0, 1, 2]),
    "",
    `机器已终结 coverage exception：${resolvedCoverageCount}；这些项目不要求逐条人工确认。`,
    "",
    "## unit_decisions",
    "",
    markdownTable(unitRows, [0, 2, 3, 5, 7, 9, 10]),
    "",
    "## course_conflicts",
    "",
    markdownTable(courseRows, [0, 2, 3, 5, 6, 8, 9, 10, 11]),
    "",
    "## teacher_conflicts",
    "",
    markdownTable(teacherRows, [0, 2, 4, 5, 7, 9, 10]),
    "",
    "## coverage_exceptions",
    "",
    markdownTable(pendingCoverageRows, [0, 1, 2, 3, 4, 6, 8, 10, 11]),
    "",
    "## golden_sample",
    "",
    markdownTable(goldenRows, [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12]),
    "",
  ].join("\n")}\n`);

  return new Map([
    ["catalog-review.md", markdown],
    ["summary.csv", csvBytes(summary)],
    ["unit_decisions.csv", csvBytes(unitRows)],
    ["course_conflicts.csv", csvBytes(courseRows)],
    ["teacher_conflicts.csv", csvBytes(teacherRows)],
    ["coverage_exceptions.csv", csvBytes(coverageRows)],
    ["golden_sample.csv", csvBytes(goldenRows)],
  ]);
}

async function prepareOutput(root: string) {
  await mkdir(root, { recursive: true });
  const allowed = new Set<string>([...reviewArtifactNames, "manifest.json"]);
  const existing = await readdir(root, { withFileTypes: true });
  const unexpected = existing.filter((entry) => !entry.isFile() || !allowed.has(entry.name));
  if (unexpected.length) throw new Error(`review output directory contains unrelated entries: ${unexpected.map((entry) => entry.name).sort(compareText).join(", ")}`);
  await Promise.all(existing.map((entry) => unlink(join(root, entry.name))));
}

export async function exportCatalogReview(qualityDirectory: string, outputDirectory: string): Promise<ReviewManifest> {
  const qualityRoot = resolve(qualityDirectory);
  const outputRoot = resolve(outputDirectory);
  if (qualityRoot === outputRoot) throw new Error("quality and review output directories must differ");
  const entries = await readdir(qualityRoot, { withFileTypes: true });
  const expectedEntries = [...qualityArtifactNames, "manifest.json"].sort(compareText);
  if (entries.some((entry) => !entry.isFile()) || JSON.stringify(entries.map((entry) => entry.name).sort(compareText)) !== JSON.stringify(expectedEntries)) throw new Error("quality directory must contain exactly the declared quality package files");
  const manifest = JSON.parse(await readFile(join(qualityRoot, "manifest.json"), "utf8")) as QualityManifest;
  if (manifest.schemaVersion !== QUALITY_MANIFEST_SCHEMA_VERSION || !Array.isArray(manifest.files)) throw new Error("input is not a supported quality package");
  const { contentSha256, ...manifestContent } = manifest;
  if (sha256(stableJson(manifestContent)) !== contentSha256) throw new Error("quality manifest content hash check failed");
  const declaredPaths = manifest.files.map((item) => item.path).sort(compareText);
  if (JSON.stringify(declaredPaths) !== JSON.stringify([...qualityArtifactNames].sort(compareText))) throw new Error("quality manifest must declare each expected artifact exactly once");
  const values = new Map<string, unknown>();
  for (const path of qualityArtifactNames) {
    const declaration = manifest.files.find((item) => item.path === path);
    if (!declaration) throw new Error(`quality manifest does not declare ${path}`);
    const bytes = await readFile(join(qualityRoot, path));
    if (bytes.byteLength !== declaration.bytes || sha256(bytes) !== declaration.sha256) throw new Error(`quality artifact integrity check failed for ${path}`);
    const value = path.endsWith(".jsonl") ? parseJsonLines(bytes) : JSON.parse(bytes.toString("utf8"));
    if ((Array.isArray(value) ? value.length : 1) !== declaration.records) throw new Error(`quality artifact record count check failed for ${path}`);
    values.set(path, value);
  }
  const courses = values.get("courses.jsonl") as QualityCourse[];
  const teachers = values.get("teachers.jsonl") as unknown[];
  const relations = values.get("relations.jsonl") as unknown[];
  const conflicts = values.get("conflicts.jsonl") as QualityConflict[];
  const exclusions = values.get("exclusions.jsonl") as unknown[];
  const coverageExceptions = values.get("coverage-exceptions.jsonl") as QualityCoverageException[];
  const golden = values.get("golden-sample.jsonl") as ReviewGolden[];
  const coverage = values.get("coverage.json") as QualityCoverage;
  if (courses.some((item) => item.schemaVersion !== COURSE_SCHEMA_VERSION)
    || conflicts.some((item) => item.schemaVersion !== QUALITY_CONFLICT_SCHEMA_VERSION)
    || coverageExceptions.some((item) => item.schemaVersion !== QUALITY_COVERAGE_EXCEPTION_SCHEMA_VERSION)
    || golden.some((item) => item.schemaVersion !== QUALITY_GOLDEN_SCHEMA_VERSION)
    || coverage.schemaVersion !== QUALITY_COVERAGE_SCHEMA_VERSION) throw new Error("quality review artifacts contain unsupported schemas");
  validateBoundaryFixtureIndex({ schemaVersion: "catalog-pilot-fixtures/v1", boundaries: coverage.boundaries });
  const conflictIds = conflicts.map((item) => item.conflictId);
  const goldenIds = golden.map((item) => item.sampleId);
  if (new Set(conflictIds).size !== conflictIds.length || new Set(goldenIds).size !== goldenIds.length) throw new Error("quality review artifact identities must be unique");
  const decisionByKey = new Map<string, NonNullable<QualityConflict["decision"]>>();
  for (const conflict of conflicts) {
    if ((conflict.status === "resolved") !== !!conflict.decision || (conflict.decision && conflict.decision.subjectKey !== conflict.conflictId)) throw new Error(`quality conflict decision binding is invalid for ${conflict.conflictId}`);
    if (conflict.decision) decisionByKey.set(conflict.conflictId, conflict.decision);
  }
  for (const exception of coverageExceptions) {
    if (exception.subjectKey !== exception.decision.subjectKey || exception.decision.decision !== "coverage_exception") throw new Error(`quality coverage-exception binding is invalid for ${exception.subjectKey}`);
    const existing = decisionByKey.get(exception.subjectKey);
    if (existing && stableJson(existing) !== stableJson(exception.decision)) throw new Error(`quality decisions disagree for ${exception.subjectKey}`);
    decisionByKey.set(exception.subjectKey, exception.decision);
  }
  validateQualityDecisions([...decisionByKey.values()]);
  const pendingConflictIds = conflicts.filter((item) => item.status === "pending").map((item) => item.conflictId);
  const unverifiedGoldenIds = golden.filter((item) => !item.verified).map((item) => item.sampleId);
  const coverageExceptionKeys = new Set(coverageExceptions.map((item) => item.subjectKey));
  const boundaryBlockerIds = Object.entries(coverage.boundaries)
    .filter(([name, evidence]) => (evidence.status !== "proven" || !evidence.fixtures.length) && !coverageExceptionKeys.has(`boundary:${name}`))
    .map(([name]) => `boundary:${name}`);
  const expectedBlockerIds = [...pendingConflictIds, ...unverifiedGoldenIds, ...boundaryBlockerIds].sort(compareText);
  const relationGolden = golden.filter((item) => item.kind === "relation");
  const boundaryGolden = golden.filter((item) => item.kind === "boundary_fixture");
  const expectedBoundaryGolden = Object.entries(coverage.boundaries)
    .filter(([, evidence]) => evidence.status === "proven")
    .map(([boundary, evidence]) => `${boundary}\u0000${evidence.fixtures[0]}`)
    .sort(compareText);
  const actualBoundaryGolden = boundaryGolden.map((item) => `${item.boundary}\u0000${item.fixture}`).sort(compareText);
  if (manifest.status !== coverage.status
    || coverage.counts.courses !== courses.length
    || coverage.counts.teachers !== teachers.length
    || coverage.counts.relations !== relations.length
    || coverage.counts.conflicts !== conflicts.length
    || coverage.counts.pendingConflicts !== pendingConflictIds.length
    || coverage.counts.exclusions !== exclusions.length
    || coverage.counts.coverageExceptions !== coverageExceptions.length
    || coverage.counts.goldenSample !== golden.length
    || coverage.counts.goldenRelations !== relationGolden.length
    || coverage.counts.goldenBoundaries !== boundaryGolden.length
    || coverage.counts.goldenUnverified !== unverifiedGoldenIds.length
    || JSON.stringify(actualBoundaryGolden) !== JSON.stringify(expectedBoundaryGolden)
    || JSON.stringify(coverage.blockerIds) !== JSON.stringify(expectedBlockerIds)) throw new Error("quality coverage counts or blockers do not match review artifacts");
  const reviewFiles = buildCatalogReviewFiles({ qualityManifestContentSha256: manifest.contentSha256, courses, conflicts, coverageExceptions, golden, coverage });
  await prepareOutput(outputRoot);
  const files: ReviewArtifact[] = [];
  for (const path of reviewArtifactNames) {
    const bytes = reviewFiles.get(path)!;
    await writeFile(join(outputRoot, path), bytes);
    files.push({ path, records: path.endsWith(".csv") ? bytes.toString("utf8").split("\r\n").filter(Boolean).length - 1 : 1, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const content = { schemaVersion: REVIEW_MANIFEST_SCHEMA_VERSION, qualityManifestContentSha256: manifest.contentSha256, status: "review_ready" as const, files };
  const reviewManifest: ReviewManifest = { ...content, contentSha256: sha256(stableJson(content)) };
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(reviewManifest, null, 2)}\n`);
  return reviewManifest;
}
