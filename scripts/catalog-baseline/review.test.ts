import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportCatalogReview } from "./review";

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function jsonLines(records: unknown[]) {
  return Buffer.from(records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
}

async function writeQualityPackage(root: string) {
  await mkdir(root, { recursive: true });
  const provenance = [{ queryId: "query-1", page: 1, row: 1, semester: "2026-1", educationLevel: "undergraduate", grade: "2025" }];
  const decision = { schemaVersion: "catalog-baseline-quality-decision/v1", subjectKey: "boundary:rowspan", decision: "coverage_exception", reason: "owner accepted synthetic coverage", reviewer: "K4F7" };
  const conflicts = [
    { schemaVersion: "catalog-baseline-quality-conflict/v2", conflictId: "conflict:course-name", code: "COURSE_SAME_SEMESTER_NAME_CONFLICT", status: "pending", courseCode: "COURSE-1", detail: "course-name conflict", evidence: ["课程一", "课程壹"] },
    { schemaVersion: "catalog-baseline-quality-conflict/v2", conflictId: "conflict:location", code: "LOCATION_EVIDENCE_UNKNOWN", status: "pending", courseCode: "COURSE-1", detail: "location unknown", evidence: [JSON.stringify({ recordId: "query-1:0001:0001", semester: "2026-1", sourceHomeUnit: "本校单位甲" })] },
    { schemaVersion: "catalog-baseline-quality-conflict/v2", conflictId: "conflict:teacher", code: "TEACHER_PLACEHOLDER_SUSPECTED", status: "pending", detail: "teacher suspected", evidence: ["  =HYPERLINK(\"https://invalid.example\")"] },
    { schemaVersion: "catalog-baseline-quality-conflict/v2", conflictId: "conflict:unit", code: "UNIT_DECISION_REQUIRED", status: "pending", detail: "unit scope", evidence: ["UNIT-1", "本校单位甲"] },
  ];
  const boundaryFixtures = {
    gbk: "gbk.html", pagination: "pagination.html", rowspan: "rowspan.html", "multi-teacher": "multi-teacher.html", "teacher-digit-suffix": "teacher-digit-suffix.html",
    "course-rename": "course-rename.html", mooc: "mooc.html", "three-campuses": "three-campuses.html", "empty-field": "empty-field.html", "abnormal-format": "abnormal-format.html",
  } as const;
  const boundaries = Object.fromEntries(Object.entries(boundaryFixtures).map(([name, fixture]) => [name, name === "rowspan"
    ? { status: "not_observed", fixtures: [], detail: "not observed" }
    : { status: "proven", fixtures: [fixture], detail: "proven fixture" }]));
  const golden = [
    { schemaVersion: "catalog-baseline-quality-golden/v2", kind: "relation", sampleId: "golden:relation:1", courseCode: "COURSE-1", sourceTeacherLabel: "教师一", verified: false, provenance },
    ...Object.entries(boundaryFixtures).filter(([name]) => name !== "rowspan").map(([boundary, fixture]) => ({ schemaVersion: "catalog-baseline-quality-golden/v2", kind: "boundary_fixture", sampleId: `golden:boundary:${boundary}:${fixture}`, boundary, fixture, verified: true })),
  ];
  const coverage = {
    schemaVersion: "catalog-baseline-quality-coverage/v2",
    status: "review_required",
    counts: { inventory: 1, courses: 1, teachers: 1, relations: 1, conflicts: 4, pendingConflicts: 4, exclusions: 0, coverageExceptions: 1, goldenSample: golden.length, goldenRelations: 1, goldenBoundaries: golden.length - 1, goldenUnverified: 1 },
    categoryCounts: { general: 1, sports: 0 },
    locationEvidence: { mailu: 0, fenglin: 0, jiaoquiao: 0, mooc: 0, unknown: 1 },
    unitEvidence: { codedRows: 1, blankRows: 0, coursesRecoveredFromOtherRows: 0, coursesMissingAllEvidence: 0 },
    teacherEvidence: { emptyTeacherRows: 0, coursesWithoutTeacher: 0, placeholderRows: 0, suspectedTeacherLabels: 1 },
    boundaries,
    blockerIds: [...conflicts.map((item) => item.conflictId), "golden:relation:1"].sort(),
  };
  const values: Record<string, unknown[] | object> = {
    "courses.jsonl": [{ schemaVersion: "catalog-baseline-course/v1", courseCode: "COURSE-1", currentName: "课程一", normalizedCurrentName: "课程一", nameVariants: [], category: "general", sourceCategoryTexts: ["必修", "选修"] }],
    "teachers.jsonl": [{ schemaVersion: "catalog-baseline-teacher/v1", sourceTeacherLabel: "教师一", normalizedTeacherLabel: "教师一" }],
    "relations.jsonl": [{ schemaVersion: "catalog-baseline-relation/v2", courseCode: "COURSE-1", sourceTeacherLabel: "教师一", provenance }],
    "conflicts.jsonl": conflicts,
    "exclusions.jsonl": [],
    "coverage-exceptions.jsonl": [{ schemaVersion: "catalog-baseline-quality-coverage-exception/v1", coverageExceptionId: "coverage-exception:rowspan", subjectKey: "boundary:rowspan", detail: "not observed", decision }],
    "golden-sample.jsonl": golden,
    "coverage.json": coverage,
  };
  const files: Array<{ path: string; records: number; bytes: number; sha256: string }> = [];
  for (const path of ["courses.jsonl", "teachers.jsonl", "relations.jsonl", "conflicts.jsonl", "exclusions.jsonl", "coverage-exceptions.jsonl", "golden-sample.jsonl", "coverage.json"]) {
    const value = values[path];
    const bytes = path.endsWith(".jsonl") ? jsonLines(value as unknown[]) : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    await writeFile(join(root, path), bytes);
    files.push({ path, records: Array.isArray(value) ? value.length : 1, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const content = { schemaVersion: "catalog-baseline-quality-manifest/v2", captureManifestContentSha256: "a".repeat(64), derivationContentSha256: "b".repeat(64), decisionsSha256: "c".repeat(64), boundaryFixtureContentSha256: "d".repeat(64), status: "review_required", files };
  await writeFile(join(root, "manifest.json"), `${JSON.stringify({ ...content, contentSha256: sha256(stableJson(content)) }, null, 2)}\n`);
}

async function resignQualityJson(root: string, path: string, value: object) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(join(root, path), bytes);
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const declaration = manifest.files.find((item: { path: string }) => item.path === path);
  declaration.bytes = bytes.byteLength;
  declaration.records = 1;
  declaration.sha256 = sha256(bytes);
  const { contentSha256: _oldHash, ...content } = manifest;
  manifest.contentSha256 = sha256(stableJson(content));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

describe("catalog review export", () => {
  it("exports deterministic fixed review sheets with editable decision columns", async () => {
    const root = join(tmpdir(), `jufexk-review-${crypto.randomUUID()}`);
    try {
      const quality = join(root, "quality");
      const first = join(root, "review-1");
      const second = join(root, "review-2");
      await writeQualityPackage(quality);
      expect(await exportCatalogReview(quality, first)).toEqual(await exportCatalogReview(quality, second));
      for (const path of ["catalog-review.md", "summary.csv", "unit_decisions.csv", "course_conflicts.csv", "teacher_conflicts.csv", "coverage_exceptions.csv", "golden_sample.csv", "manifest.json"]) {
        expect(await readFile(join(first, path))).toEqual(await readFile(join(second, path)));
      }
      expect(await readFile(join(first, "course_conflicts.csv"), "utf8")).toContain('"conflict:course-name"');
      expect(await readFile(join(first, "coverage_exceptions.csv"), "utf8")).toContain('"boundary:rowspan"');
      expect(await readFile(join(first, "golden_sample.csv"), "utf8")).toContain('"golden:relation:1"');
      expect(await readFile(join(first, "teacher_conflicts.csv"), "utf8")).toContain('"\'  =HYPERLINK(""https://invalid.example"")"');
      const markdown = await readFile(join(first, "catalog-review.md"), "utf8");
      expect(markdown).toContain("## unit_decisions");
      expect(markdown).toContain("## course_conflicts");
      expect(markdown).toContain("## teacher_conflicts");
      expect(markdown).toContain("## coverage_exceptions");
      expect(markdown).toContain("## golden_sample");
      expect(markdown).toContain("conflict:course-name");
      expect(markdown).toContain("golden:relation:1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a tampered quality artifact", async () => {
    const root = join(tmpdir(), `jufexk-review-tamper-${crypto.randomUUID()}`);
    try {
      const quality = join(root, "quality");
      await writeQualityPackage(quality);
      await writeFile(join(quality, "conflicts.jsonl"), "tampered\n");
      await expect(exportCatalogReview(quality, join(root, "review"))).rejects.toThrow(/integrity/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a re-signed package whose coverage counts disagree with its artifacts", async () => {
    const root = join(tmpdir(), `jufexk-review-counts-${crypto.randomUUID()}`);
    try {
      const quality = join(root, "quality");
      await writeQualityPackage(quality);
      const coverage = JSON.parse(await readFile(join(quality, "coverage.json"), "utf8"));
      coverage.counts.courses = 2;
      await resignQualityJson(quality, "coverage.json", coverage);
      await expect(exportCatalogReview(quality, join(root, "review"))).rejects.toThrow(/counts or blockers/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
