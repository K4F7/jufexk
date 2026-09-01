import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVED_MANIFEST_SCHEMA_VERSION, APPROVED_RECORD_SCHEMA_VERSION, compileApprovedCatalogBaseline } from "./approve";

const qualityFiles = ["courses.jsonl", "teachers.jsonl", "relations.jsonl", "conflicts.jsonl", "exclusions.jsonl", "coverage-exceptions.jsonl", "golden-sample.jsonl", "coverage.json"] as const;
const boundaryFixtures = {
  gbk: "gbk.html",
  pagination: "pagination.html",
  rowspan: "rowspan.html",
  "multi-teacher": "multi-teacher.html",
  "teacher-digit-suffix": "teacher-digit-suffix.html",
  "course-rename": "course-rename.html",
  mooc: "mooc.html",
  "three-campuses": "three-campuses.html",
  "empty-field": "empty-field.html",
  "abnormal-format": "abnormal-format.html",
} as const;

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonLines(records: unknown[]) {
  return Buffer.from(records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
}

async function writeQualityPackage(root: string, options: {
  passed?: boolean;
  decisionsSha256?: string;
  notObservedBoundary?: keyof typeof boundaryFixtures;
  includeBoundaryException?: boolean;
} = {}) {
  await mkdir(root, { recursive: true });
  const passed = options.passed ?? true;
  const course = {
    schemaVersion: "catalog-baseline-course/v1",
    courseCode: "COURSE-1",
    currentName: "课程一",
    normalizedCurrentName: "课程一",
    nameVariants: [{ rawName: "课程一", normalizedName: "课程一", firstSemester: "2026-1", lastSemester: "2026-1", occurrences: 1 }],
    category: "general",
    sourceCategoryTexts: ["必修课"],
  };
  const teacher = { schemaVersion: "catalog-baseline-teacher/v1", sourceTeacherLabel: "教师一", normalizedTeacherLabel: "教师一" };
  const provenance = [{ queryId: "query-1", page: 1, row: 1, semester: "2026-1", educationLevel: "undergraduate", grade: "2025" }];
  const relation = { schemaVersion: "catalog-baseline-relation/v2", courseCode: "COURSE-1", sourceTeacherLabel: "教师一", provenance };
  const boundaries = Object.fromEntries(Object.entries(boundaryFixtures).map(([name, fixture]) => [name, name === options.notObservedBoundary
    ? { status: "not_observed", fixtures: [], detail: `${name} was not observed in Pilot or full capture` }
    : { status: "proven", fixtures: [fixture], detail: `${name} frozen fixture` }]));
  const boundaryGolden = Object.entries(boundaryFixtures)
    .filter(([boundary]) => boundary !== options.notObservedBoundary)
    .map(([boundary, fixture]) => ({ schemaVersion: "catalog-baseline-quality-golden/v2", kind: "boundary_fixture", sampleId: `golden:boundary:${boundary}:${fixture}`, boundary, fixture, verified: true }));
  const golden = [
    { schemaVersion: "catalog-baseline-quality-golden/v2", kind: "relation", sampleId: "golden:relation:1", courseCode: "COURSE-1", sourceTeacherLabel: "教师一", verified: true, provenance },
    ...boundaryGolden,
  ];
  const coverageExceptions = options.notObservedBoundary && options.includeBoundaryException ? [{
    schemaVersion: "catalog-baseline-quality-coverage-exception/v1",
    coverageExceptionId: `coverage-exception:boundary:${options.notObservedBoundary}`,
    subjectKey: `boundary:${options.notObservedBoundary}`,
    detail: `${options.notObservedBoundary} was not observed in Pilot or full capture`,
    decision: {
      schemaVersion: "catalog-baseline-quality-decision/v1",
      subjectKey: `boundary:${options.notObservedBoundary}`,
      decision: "coverage_exception",
      reason: "Pilot and full capture did not observe this boundary; owner accepted synthetic contract coverage.",
      reviewer: "K4F7",
    },
  }] : [];
  const blockerIds = passed ? [] : ["conflict:pending"];
  const coverage = {
    schemaVersion: "catalog-baseline-quality-coverage/v2",
    status: passed ? "quality_passed" : "review_required",
    counts: { inventory: 1, courses: 1, teachers: 1, relations: 1, conflicts: 0, pendingConflicts: passed ? 0 : 1, exclusions: 0, coverageExceptions: coverageExceptions.length, goldenSample: golden.length, goldenRelations: 1, goldenBoundaries: boundaryGolden.length, goldenUnverified: 0 },
    categoryCounts: { general: 1, sports: 0 },
    locationEvidence: { mailu: 1, fenglin: 0, jiaoquiao: 0, mooc: 0, unknown: 0 },
    unitEvidence: { codedRows: 1, blankRows: 0, coursesRecoveredFromOtherRows: 0, coursesMissingAllEvidence: 0 },
    teacherEvidence: { emptyTeacherRows: 0, coursesWithoutTeacher: 0, placeholderRows: 0, suspectedTeacherLabels: 0 },
    boundaries,
    blockerIds,
  };
  const values: Record<(typeof qualityFiles)[number], unknown[] | object> = {
    "courses.jsonl": [course],
    "teachers.jsonl": [teacher],
    "relations.jsonl": [relation],
    "conflicts.jsonl": [],
    "exclusions.jsonl": [],
    "coverage-exceptions.jsonl": coverageExceptions,
    "golden-sample.jsonl": golden,
    "coverage.json": coverage,
  };
  const files: Array<{ path: (typeof qualityFiles)[number]; records: number; bytes: number; sha256: string }> = [];
  for (const path of qualityFiles) {
    const value = values[path];
    const bytes = path.endsWith(".jsonl") ? jsonLines(value as unknown[]) : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    await writeFile(join(root, path), bytes);
    files.push({ path, records: Array.isArray(value) ? value.length : 1, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const content = {
    schemaVersion: "catalog-baseline-quality-manifest/v2",
    captureManifestContentSha256: "a".repeat(64),
    derivationContentSha256: "b".repeat(64),
    decisionsSha256: options.decisionsSha256 ?? "c".repeat(64),
    boundaryFixtureContentSha256: "d".repeat(64),
    status: coverage.status,
    files,
  };
  const manifest = { ...content, contentSha256: sha256(stableJson(content)) };
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function exists(path: string) {
  return !!await stat(path).catch(() => null);
}

async function resignQualityArtifact(root: string, path: (typeof qualityFiles)[number], bytes: Buffer) {
  await writeFile(join(root, path), bytes);
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const file = manifest.files.find((item: { path: string }) => item.path === path);
  file.bytes = bytes.byteLength;
  file.records = path.endsWith(".jsonl") ? bytes.toString("utf8").trim().split("\n").filter(Boolean).length : 1;
  file.sha256 = sha256(bytes);
  const { contentSha256: _oldHash, ...content } = manifest;
  manifest.contentSha256 = sha256(stableJson(content));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

describe("approved catalog baseline compiler", () => {
  it("atomically compiles a quality-passed package into the sole approved JSONL artifact", async () => {
    const root = join(tmpdir(), `jufexk-approved-${crypto.randomUUID()}`);
    const qualityRoot = join(root, "quality");
    const firstRoot = join(root, "approved-1");
    const secondRoot = join(root, "approved-2");
    try {
      const qualityManifest = await writeQualityPackage(qualityRoot);
      const first = await compileApprovedCatalogBaseline(qualityRoot, firstRoot);
      const second = await compileApprovedCatalogBaseline(qualityRoot, secondRoot);
      expect(first).toEqual(second);
      expect(first).toMatchObject({
        schemaVersion: APPROVED_MANIFEST_SCHEMA_VERSION,
        status: "package_ready",
        qualityManifestContentSha256: qualityManifest.contentSha256,
        counts: { courses: 1, teachers: 1, relations: 1, totalRecords: 3 },
      });
      expect((await readdir(firstRoot)).sort()).toEqual(["catalog-baseline.jsonl", "manifest.json"]);
      expect(await readFile(join(firstRoot, "catalog-baseline.jsonl"))).toEqual(await readFile(join(secondRoot, "catalog-baseline.jsonl")));
      const records = (await readFile(join(firstRoot, "catalog-baseline.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(records.map((item) => [item.schemaVersion, item.recordType])).toEqual([
        [APPROVED_RECORD_SCHEMA_VERSION, "course"],
        [APPROVED_RECORD_SCHEMA_VERSION, "teacher"],
        [APPROVED_RECORD_SCHEMA_VERSION, "relation"],
      ]);
      expect(records[2].value.schemaVersion).toBe("catalog-baseline-relation/v2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("compiles v3 PE specialization mappings into the approved relation records", async () => {
    const root = join(tmpdir(), `jufexk-approved-pe-${crypto.randomUUID()}`);
    const qualityRoot = join(root, "quality");
    const outputRoot = join(root, "approved");
    try {
      await writeQualityPackage(qualityRoot);
      const peRelation = {
        schemaVersion: "catalog-baseline-relation/v3",
        courseCode: "COURSE-1",
        sourceTeacherLabel: "教师一",
        provenance: [{ queryId: "query-1", page: 1, row: 1, semester: "2026-1", educationLevel: "undergraduate", grade: "2025" }],
        peSpecialization: {
          sourceKind: "direct_skill",
          normalizedSpecialization: "篮球",
          displaySemantics: "keep_source_name",
          evidence: {
            kind: "catalog_course_name",
            sourceCourseCode: "COURSE-1",
            sourceCourseName: "篮球2",
            sourceTeacherLabel: "教师一",
            rawSpecializationName: "篮球2",
          },
        },
      };
      await resignQualityArtifact(qualityRoot, "relations.jsonl", jsonLines([peRelation]));
      const compiled = await compileApprovedCatalogBaseline(qualityRoot, outputRoot);
      const records = (await readFile(join(outputRoot, "catalog-baseline.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(compiled.counts.relations).toBe(1);
      expect(records[2].value).toMatchObject({
        schemaVersion: "catalog-baseline-relation/v3",
        peSpecialization: {
          sourceKind: "direct_skill",
          normalizedSpecialization: "篮球",
          displaySemantics: "keep_source_name",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects review-required, tampered, and non-directory inputs without publishing output", async () => {
    const root = join(tmpdir(), `jufexk-approved-reject-${crypto.randomUUID()}`);
    try {
      const reviewRoot = join(root, "review-required");
      await writeQualityPackage(reviewRoot, { passed: false });
      const reviewOutput = join(root, "review-output");
      await expect(compileApprovedCatalogBaseline(reviewRoot, reviewOutput)).rejects.toThrow(/quality_passed/i);
      expect(await exists(reviewOutput)).toBe(false);

      const tamperedRoot = join(root, "tampered-quality");
      await writeQualityPackage(tamperedRoot);
      await writeFile(join(tamperedRoot, "courses.jsonl"), "tampered\n");
      await expect(compileApprovedCatalogBaseline(tamperedRoot, join(root, "tampered-output"))).rejects.toThrow(/integrity/i);

      const workbook = join(root, "catalog-review.xlsx");
      await writeFile(workbook, "not authoritative");
      await expect(compileApprovedCatalogBaseline(workbook, join(root, "workbook-output"))).rejects.toThrow(/must be a directory/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("binds decisions while ignoring a separate workbook's display content", async () => {
    const root = join(tmpdir(), `jufexk-approved-binding-${crypto.randomUUID()}`);
    try {
      const qualityA = join(root, "quality-a");
      const qualityB = join(root, "quality-b");
      const workbook = join(root, "catalog-review.xlsx");
      await writeQualityPackage(qualityA, { decisionsSha256: "1".repeat(64) });
      await writeQualityPackage(qualityB, { decisionsSha256: "2".repeat(64) });
      await writeFile(workbook, "display version one");
      const approvedA1 = await compileApprovedCatalogBaseline(qualityA, join(root, "approved-a1"));
      await writeFile(workbook, "display version two");
      const approvedA2 = await compileApprovedCatalogBaseline(qualityA, join(root, "approved-a2"));
      const approvedB = await compileApprovedCatalogBaseline(qualityB, join(root, "approved-b"));
      expect(approvedA2).toEqual(approvedA1);
      expect(approvedB.decisionsSha256).not.toBe(approvedA1.decisionsSha256);
      expect(approvedB.contentSha256).not.toBe(approvedA1.contentSha256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a re-signed golden relation whose provenance differs from the approved relation", async () => {
    const root = join(tmpdir(), `jufexk-approved-golden-${crypto.randomUUID()}`);
    const qualityRoot = join(root, "quality");
    try {
      await writeQualityPackage(qualityRoot);
      const goldenPath = join(qualityRoot, "golden-sample.jsonl");
      const golden = (await readFile(goldenPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      golden[0].provenance[0].semester = "forged-semester";
      await resignQualityArtifact(qualityRoot, "golden-sample.jsonl", jsonLines(golden));
      await expect(compileApprovedCatalogBaseline(qualityRoot, join(root, "approved"))).rejects.toThrow(/provenance/i);
      expect(await exists(join(root, "approved"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a re-signed course candidate that drops raw source category evidence", async () => {
    const root = join(tmpdir(), `jufexk-approved-category-evidence-${crypto.randomUUID()}`);
    const qualityRoot = join(root, "quality");
    try {
      await writeQualityPackage(qualityRoot);
      const coursePath = join(qualityRoot, "courses.jsonl");
      const courses = (await readFile(coursePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      delete courses[0].sourceCategoryTexts;
      await resignQualityArtifact(qualityRoot, "courses.jsonl", jsonLines(courses));
      await expect(compileApprovedCatalogBaseline(qualityRoot, join(root, "approved"))).rejects.toThrow(/source category evidence/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires an audited coverage exception for every not-observed boundary", async () => {
    const root = join(tmpdir(), `jufexk-approved-boundary-${crypto.randomUUID()}`);
    try {
      const acceptedRoot = join(root, "accepted");
      await writeQualityPackage(acceptedRoot, { notObservedBoundary: "rowspan", includeBoundaryException: true });
      await expect(compileApprovedCatalogBaseline(acceptedRoot, join(root, "accepted-output"))).resolves.toMatchObject({ status: "package_ready" });

      const missingRoot = join(root, "missing");
      await writeQualityPackage(missingRoot, { notObservedBoundary: "rowspan" });
      await expect(compileApprovedCatalogBaseline(missingRoot, join(root, "missing-output"))).rejects.toThrow(/not-observed boundaries/i);
      expect(await exists(join(root, "missing-output"))).toBe(false);

      const mismatchedRoot = join(root, "mismatched");
      await writeQualityPackage(mismatchedRoot, { notObservedBoundary: "rowspan", includeBoundaryException: true });
      const exceptionsPath = join(mismatchedRoot, "coverage-exceptions.jsonl");
      const exceptions = (await readFile(exceptionsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      exceptions[0].decision.subjectKey = "boundary:pagination";
      await resignQualityArtifact(mismatchedRoot, "coverage-exceptions.jsonl", jsonLines(exceptions));
      await expect(compileApprovedCatalogBaseline(mismatchedRoot, join(root, "mismatched-output"))).rejects.toThrow(/subject binding/i);
      expect(await exists(join(root, "mismatched-output"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
