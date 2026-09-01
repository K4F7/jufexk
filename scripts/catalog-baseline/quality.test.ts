import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateCatalogQuality,
  runCatalogQuality,
  validateBoundaryFixtureIndex,
  validateQualityDecisions,
  type QualityDecision,
  type QualityInput,
} from "./quality";
import { RELATION_SCHEMA_VERSION, type CourseRecord, type ExceptionRecord, type InventoryRecord, type RelationRecord, type TeacherRecord } from "./derive";

function inventory(overrides: Partial<InventoryRecord> = {}): InventoryRecord {
  return {
    schemaVersion: "catalog-baseline-inventory/v3",
    recordId: "query-1:0001:0001",
    courseCode: "COURSE-1",
    rawCourseName: "课程一",
    normalizedCourseName: "课程一",
    rawTeacherLabels: ["教师一"],
    normalizedTeacherLabels: ["教师一"],
    sourceCampus: "麦庐园校区",
    sourceCategoryText: "必修课",
    sourceHomeUnit: "本校单位甲",
    sourceHomeUnitCode: "UNIT-1",
    sourceLocation: "麦庐园教学楼",
    queryId: "query-1",
    page: 1,
    row: 1,
    semester: "2026-1",
    educationLevel: "undergraduate",
    grade: "2025",
    ...overrides,
  };
}

function course(overrides: Partial<CourseRecord> = {}): CourseRecord {
  return {
    schemaVersion: "catalog-baseline-course/v1",
    courseCode: "COURSE-1",
    currentName: "课程一",
    normalizedCurrentName: "课程一",
    nameVariants: [{ rawName: "课程一", normalizedName: "课程一", firstSemester: "2026-1", lastSemester: "2026-1", occurrences: 1 }],
    ...overrides,
  };
}

function teacher(label = "教师一"): TeacherRecord {
  return { schemaVersion: "catalog-baseline-teacher/v1", sourceTeacherLabel: label, normalizedTeacherLabel: label };
}

function relation(courseCode = "COURSE-1", label = "教师一"): RelationRecord {
  return {
    schemaVersion: RELATION_SCHEMA_VERSION,
    courseCode,
    sourceTeacherLabel: label,
    provenance: [{ queryId: "query-1", page: 1, row: 1, semester: "2026-1", educationLevel: "undergraduate", grade: "2025" }],
  };
}

function input(overrides: Partial<QualityInput> = {}): QualityInput {
  return {
    inventory: [inventory()],
    courses: [course()],
    teachers: [teacher()],
    relations: [relation()],
    sourceExceptions: [] as ExceptionRecord[],
    ...overrides,
  };
}

function decision(subjectKey: string, value: QualityDecision["decision"] = "include", correctedValue?: string): QualityDecision {
  return {
    schemaVersion: "catalog-baseline-quality-decision/v1",
    subjectKey,
    decision: value,
    correctedValue,
    reason: "人工核验",
    reviewer: "reviewer",
  };
}

function stableJson(item: unknown): string {
  return Array.isArray(item)
    ? `[${item.map(stableJson).join(",")}]`
    : item && typeof item === "object"
      ? `{${Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, value]) => `${JSON.stringify(key)}:${stableJson(value)}`).join(",")}}`
      : JSON.stringify(item);
}

async function writeDerivation(root: string, value: QualityInput) {
  await mkdir(root, { recursive: true });
  const records = new Map<string, unknown[]>([
    ["inventory.jsonl", value.inventory],
    ["courses.jsonl", value.courses],
    ["teachers.jsonl", value.teachers],
    ["relations.jsonl", value.relations],
    ["exceptions.jsonl", value.sourceExceptions],
  ]);
  const files: Array<{ path: string; records: number; bytes: number; sha256: string }> = [];
  for (const [path, items] of records) {
    const bytes = Buffer.from(items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""));
    await writeFile(join(root, path), bytes);
    files.push({ path, records: items.length, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const content = {
    schemaVersion: "catalog-baseline-derivation/v1",
    captureBatchId: "quality-test",
    captureManifestContentSha256: "b".repeat(64),
    status: "derived",
    files,
  };
  const contentSha256 = createHash("sha256").update(stableJson(content)).digest("hex");
  await writeFile(join(root, "manifest.json"), `${JSON.stringify({ ...content, contentSha256 }, null, 2)}\n`);
}

describe("catalog baseline quality gate", () => {
  it("selects sports only from explicit evidence and defaults every other course to general", () => {
    const records = [
      inventory(),
      inventory({ recordId: "query-1:0001:0002", courseCode: "COURSE-2", rawCourseName: "课程二", normalizedCourseName: "课程二", sourceCategoryText: "任选课", row: 2 }),
      inventory({ recordId: "query-1:0001:0003", courseCode: "COURSE-3", rawCourseName: "大学体育（1）", normalizedCourseName: "大学体育（1）", sourceCategoryText: "体育课/必修课", row: 3 }),
      inventory({ recordId: "query-1:0001:0004", courseCode: "COURSE-4", rawCourseName: "课程四", normalizedCourseName: "课程四", sourceCategoryText: "专业教育课", row: 4 }),
    ];
    const result = evaluateCatalogQuality(input({
      inventory: records,
      courses: [course(), course({ courseCode: "COURSE-2", currentName: "课程二", normalizedCurrentName: "课程二" }), course({ courseCode: "COURSE-3", currentName: "大学体育（1）", normalizedCurrentName: "大学体育（1）" }), course({ courseCode: "COURSE-4", currentName: "课程四", normalizedCurrentName: "课程四" })],
      teachers: [],
      relations: [],
    }), []);

    expect(result.courses.map(({ courseCode, category }) => [courseCode, category])).toEqual([
      ["COURSE-1", "general"],
      ["COURSE-2", "general"],
      ["COURSE-3", "sports"],
      ["COURSE-4", "general"],
    ]);
    expect(result.conflicts.filter((item) => item.code.startsWith("COURSE_CATEGORY"))).toEqual([]);
  });

  it("does not infer sports from a course name without explicit source category text", () => {
    const result = evaluateCatalogQuality(input({
      inventory: [inventory({ rawCourseName: "大学体育（1）", normalizedCourseName: "大学体育（1）", sourceCategoryText: "必修课" })],
      courses: [course({ currentName: "大学体育（1）", normalizedCurrentName: "大学体育（1）" })],
    }), []);
    expect(result.courses[0].category).toBe("general");
  });

  it.each(["非必修", "非必修课", "非选修", "非选修课"])("does not classify negated category text %s", (sourceCategoryText) => {
    const result = evaluateCatalogQuality(input({ inventory: [inventory({ sourceCategoryText })] }), []);
    expect(result.courses[0].category).toBe("general");
    expect(result.conflicts.filter((item) => item.code.startsWith("COURSE_CATEGORY"))).toEqual([]);
  });

  it("uses an affirmative structured segment even when another segment is negated", () => {
    const result = evaluateCatalogQuality(input({ inventory: [inventory({ sourceCategoryText: "非选修/必修课" })] }), []);
    expect(result.courses[0].category).toBe("general");
    expect(result.conflicts.filter((item) => item.code.startsWith("COURSE_CATEGORY"))).toEqual([]);
  });

  it("retains all historical source texts without turning required or elective evidence into business categories", () => {
    const result = evaluateCatalogQuality(input({ inventory: [
      inventory({ semester: "2025-2", sourceCategoryText: "选修课" }),
      inventory({ recordId: "query-1:0001:0002", semester: "2026-1", sourceCategoryText: "必修课", row: 2 }),
    ] }), []);

    expect(result.courses[0]).toMatchObject({ category: "general", sourceCategoryTexts: ["必修课", "选修课"] });
  });

  it("maps mixed required and elective evidence to general without a blocker", () => {
    const result = evaluateCatalogQuality(input({ inventory: [
      inventory({ semester: "2025-2", sourceCategoryText: "选修课" }),
      inventory({ recordId: "query-1:0001:0002", semester: "2026-1", sourceCategoryText: "必修课", row: 2 }),
      inventory({ recordId: "query-1:0001:0003", semester: "2026-1", sourceCategoryText: "选修课", row: 3 }),
    ] }), []);

    expect(result.courses[0].category).toBe("general");
  });

  it("blocks same-semester course-name conflicts and unknown location evidence", () => {
    const result = evaluateCatalogQuality(input({ inventory: [
      inventory(),
      inventory({ recordId: "query-1:0001:0002", rawCourseName: "不同课程名", normalizedCourseName: "不同课程名", sourceCampus: "未知校区", sourceLocation: "线上", row: 2 }),
    ] }), []);

    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "COURSE_SAME_SEMESTER_NAME_CONFLICT", status: "pending" }),
      expect.objectContaining({ code: "LOCATION_EVIDENCE_UNKNOWN", status: "pending" }),
    ]));
    const locationConflict = result.conflicts.find((item) => item.code === "LOCATION_EVIDENCE_UNKNOWN")!;
    expect(JSON.parse(locationConflict.evidence[0])).toMatchObject({ recordId: "query-1:0001:0002", semester: "2026-1", sourceCampus: "未知校区", sourceLocation: "线上" });
    expect(result.coverage.status).toBe("review_required");
  });

  it("records fully blank location evidence as an automatic coverage exception without dropping catalog data", () => {
    const result = evaluateCatalogQuality(input({ inventory: [inventory({ sourceCampus: "", sourceLocation: "" })] }), []);
    const conflict = result.conflicts.find((item) => item.code === "LOCATION_EVIDENCE_UNKNOWN")!;

    expect(conflict).toMatchObject({
      status: "resolved",
      decision: { decision: "coverage_exception", reviewer: "catalog-baseline-policy/v1" },
    });
    expect(result.coverageExceptions).toContainEqual(expect.objectContaining({ subjectKey: conflict.conflictId }));
    expect(result.courses).toHaveLength(1);
    expect(result.coverage.counts.pendingConflicts).toBe(1);
  });

  it("excludes known teacher placeholders and their relations", () => {
    const result = evaluateCatalogQuality(input({
      inventory: [inventory({ rawTeacherLabels: ["待定"], normalizedTeacherLabels: ["待定"] })],
      teachers: [teacher("待定")],
      relations: [relation("COURSE-1", "待定")],
    }), []);

    expect(result.teachers).toEqual([]);
    expect(result.relations).toEqual([]);
    expect(result.exclusions).toContainEqual(expect.objectContaining({ code: "TEACHER_PLACEHOLDER", sourceTeacherLabel: "待定" }));
  });

  it("requires unit and golden-sample decisions before passing", () => {
    const first = evaluateCatalogQuality(input(), []);
    const unitKey = first.conflicts.find((item) => item.code === "UNIT_DECISION_REQUIRED")!.conflictId;
    const goldenKey = first.goldenSample[0].sampleId;
    const second = evaluateCatalogQuality(input(), [decision(unitKey), decision(goldenKey)]);

    expect(first.coverage.status).toBe("review_required");
    expect(second.coverage.status).toBe("quality_passed");
    expect(second.goldenSample[0].verified).toBe(true);
  });

  it("recovers blank unit rows from another provenance row for the same course", () => {
    const result = evaluateCatalogQuality(input({ inventory: [inventory(), inventory({ recordId: "query-1:0001:0002", sourceHomeUnit: "", sourceHomeUnitCode: "", row: 2 })] }), []);
    expect(result.conflicts.filter((item) => item.code === "UNIT_EVIDENCE_MISSING")).toEqual([]);
    expect(result.coverage.unitEvidence).toMatchObject({ blankRows: 1, coursesRecoveredFromOtherRows: 1 });
  });

  it("blocks a frozen unit code that appears with multiple source labels", () => {
    const result = evaluateCatalogQuality(input({ inventory: [
      inventory(),
      inventory({ recordId: "query-1:0001:0002", sourceHomeUnit: "本校单位甲（旧称）", row: 2 }),
    ] }), []);
    const conflict = result.conflicts.find((item) => item.code === "UNIT_CODE_LABEL_CONFLICT")!;
    expect(conflict.evidence).toEqual(["UNIT-1", "本校单位甲", "本校单位甲（旧称）"]);
    expect(() => evaluateCatalogQuality(input({ inventory: [inventory(), inventory({ recordId: "query-1:0001:0002", sourceHomeUnit: "本校单位甲（旧称）", row: 2 })] }), [decision(conflict.conflictId)])).toThrow(/correctedValue/i);
  });

  it("blocks once per course when every unit evidence row is blank", () => {
    const result = evaluateCatalogQuality(input({ inventory: [inventory({ sourceHomeUnit: "", sourceHomeUnitCode: "" })] }), []);
    expect(result.conflicts).toContainEqual(expect.objectContaining({ code: "UNIT_EVIDENCE_MISSING", courseCode: "COURSE-1", status: "pending" }));
  });

  it("adds proven boundary fixtures to golden evidence and blocks not-observed boundaries", () => {
    const boundaryInput = input({ boundaryEvidence: {
      pagination: { status: "proven", fixtures: ["pagination.html"], detail: "proven" },
      rowspan: { status: "not_observed", fixtures: [], detail: "missing" },
    } });
    const result = evaluateCatalogQuality(boundaryInput, []);
    expect(result.goldenSample).toContainEqual(expect.objectContaining({ kind: "boundary_fixture", boundary: "pagination", verified: true }));
    expect(result.coverage.blockerIds).toContain("boundary:rowspan");
    const accepted = evaluateCatalogQuality(boundaryInput, [decision("boundary:rowspan", "coverage_exception")]);
    expect(accepted.coverage.blockerIds).not.toContain("boundary:rowspan");
    expect(accepted.coverageExceptions).toContainEqual(expect.objectContaining({
      subjectKey: "boundary:rowspan",
      decision: expect.objectContaining({ decision: "coverage_exception" }),
    }));
    expect(() => evaluateCatalogQuality(boundaryInput, [decision("boundary:rowspan", "include")])).toThrow(/boundary.*coverage_exception/i);
  });

  it("enforces the boundary index key and fixture-name contract", async () => {
    const index = JSON.parse(await readFile(join(import.meta.dirname, "fixtures", "pilot", "index.json"), "utf8"));
    expect(() => validateBoundaryFixtureIndex(index)).not.toThrow();
    const forged = structuredClone(index);
    forged.boundaries.pagination.fixtures = ["arbitrary.html"];
    expect(() => validateBoundaryFixtureIndex(forged)).toThrow(/pagination\.html/i);
    const missing = structuredClone(index);
    delete missing.boundaries.rowspan;
    expect(() => validateBoundaryFixtureIndex(missing)).toThrow(/keys/i);
  });

  it("does not create a category decision subject for non-sports source text", () => {
    const ambiguous = input({ inventory: [inventory({ sourceCategoryText: "专业教育课" })] });
    const first = evaluateCatalogQuality(ambiguous, []);
    expect(first.courses[0]).toMatchObject({ category: "general", sourceCategoryTexts: ["专业教育课"] });
    expect(first.conflicts.filter((item) => item.code.startsWith("COURSE_CATEGORY"))).toEqual([]);
    expect(() => evaluateCatalogQuality(ambiguous, [decision("conflict:not-present")])).toThrow(/unknown subject/i);
  });

  it("applies exclude to catalog candidates and records an exclusion", () => {
    const first = evaluateCatalogQuality(input(), []);
    const unitKey = first.conflicts.find((item) => item.code === "UNIT_DECISION_REQUIRED")!.conflictId;
    const result = evaluateCatalogQuality(input(), [decision(unitKey, "exclude")]);
    expect(result.courses).toEqual([]);
    expect(result.teachers).toEqual([]);
    expect(result.relations).toEqual([]);
    expect(result.exclusions).toContainEqual(expect.objectContaining({ code: "REVIEW_EXCLUDE", subjectKey: unitKey }));
  });

  it("recomputes category evidence after an out-of-scope unit is excluded", () => {
    const mixed = input({ inventory: [
      inventory(),
      inventory({ recordId: "query-1:0001:0002", sourceHomeUnit: "外部单位乙", sourceHomeUnitCode: "UNIT-2", sourceCategoryText: "选修课", row: 2 }),
    ] });
    const first = evaluateCatalogQuality(mixed, []);
    const unit1 = first.conflicts.find((item) => item.code === "UNIT_DECISION_REQUIRED" && item.evidence.includes("UNIT-1"))!.conflictId;
    const unit2 = first.conflicts.find((item) => item.code === "UNIT_DECISION_REQUIRED" && item.evidence.includes("UNIT-2"))!.conflictId;
    const scoped = evaluateCatalogQuality(mixed, [decision(unit1), decision(unit2, "exclude")]);
    expect(scoped.courses[0].category).toBe("general");
  });

  it("allows coverage_exception only for coverage conflicts and records it separately", () => {
    const missingLocation = input({ inventory: [inventory({ sourceCampus: "", sourceLocation: "" })] });
    const first = evaluateCatalogQuality(missingLocation, []);
    const locationKey = first.conflicts.find((item) => item.code === "LOCATION_EVIDENCE_UNKNOWN")!.conflictId;
    const resolved = evaluateCatalogQuality(missingLocation, [decision(locationKey, "coverage_exception")]);
    expect(resolved.coverageExceptions).toContainEqual(expect.objectContaining({ subjectKey: locationKey }));
    expect(resolved.courses).toHaveLength(1);
  });

  it("requires an explicit recognized location correction for include", () => {
    const missingLocation = input({ inventory: [inventory({ sourceCampus: "", sourceLocation: "" })] });
    const first = evaluateCatalogQuality(missingLocation, []);
    const locationKey = first.conflicts.find((item) => item.code === "LOCATION_EVIDENCE_UNKNOWN")!.conflictId;
    expect(() => evaluateCatalogQuality(missingLocation, [decision(locationKey, "include")])).toThrow(/correctedValue/i);
    const fixed = evaluateCatalogQuality(missingLocation, [decision(locationKey, "include", "mooc")]);
    expect(fixed.coverage.locationEvidence).toMatchObject({ mooc: 1, unknown: 0 });
  });

  it("applies a reviewed same-semester course-name correction", () => {
    const conflicting = input({ inventory: [inventory(), inventory({ recordId: "query-1:0001:0002", rawCourseName: "课程壹", normalizedCourseName: "课程壹", row: 2 })] });
    const first = evaluateCatalogQuality(conflicting, []);
    const conflictKey = first.conflicts.find((item) => item.code === "COURSE_SAME_SEMESTER_NAME_CONFLICT")!.conflictId;
    const fixed = evaluateCatalogQuality(conflicting, [decision(conflictKey, "include", "核定课程名")]);
    expect(fixed.courses[0]).toMatchObject({ currentName: "核定课程名", normalizedCurrentName: "核定课程名" });
  });

  it("does not allow a generic include decision for source derivation exceptions", () => {
    const sourceException: ExceptionRecord = { schemaVersion: "catalog-baseline-exception/v1", code: "GBK_DECODE_ERROR", queryId: "query-1", page: 1, detail: "bad bytes" };
    const withException = input({ sourceExceptions: [sourceException] });
    const first = evaluateCatalogQuality(withException, []);
    const conflictKey = first.conflicts.find((item) => item.code === "SOURCE_DERIVATION_EXCEPTION")!.conflictId;
    expect(() => evaluateCatalogQuality(withException, [decision(conflictKey, "include")])).toThrow(/SOURCE_DERIVATION_EXCEPTION/);
  });

  it("removes a source exception scope when marked coverage_exception", () => {
    const sourceException: ExceptionRecord = { schemaVersion: "catalog-baseline-exception/v1", code: "GBK_DECODE_ERROR", queryId: "query-1", page: 1, detail: "bad bytes" };
    const withException = input({ sourceExceptions: [sourceException] });
    const first = evaluateCatalogQuality(withException, []);
    const conflictKey = first.conflicts.find((item) => item.code === "SOURCE_DERIVATION_EXCEPTION")!.conflictId;
    const resolved = evaluateCatalogQuality(withException, [decision(conflictKey, "coverage_exception")]);
    expect(resolved.courses).toEqual([]);
    expect(resolved.coverageExceptions).toHaveLength(1);
  });

  it("removes the exact source row when a derivation exception is excluded", () => {
    const sourceException: ExceptionRecord = { schemaVersion: "catalog-baseline-exception/v1", code: "UNKNOWN_TEACHER_STRUCTURE", queryId: "query-1", page: 1, row: 1, detail: "unknown list" };
    const withException = input({ sourceExceptions: [sourceException] });
    const first = evaluateCatalogQuality(withException, []);
    const conflictKey = first.conflicts.find((item) => item.code === "SOURCE_DERIVATION_EXCEPTION")!.conflictId;
    const excluded = evaluateCatalogQuality(withException, [decision(conflictKey, "exclude")]);
    expect(excluded.courses).toEqual([]);
    expect(excluded.relations).toEqual([]);
  });

  it("counts empty-teacher coverage without creating a teacher identity", () => {
    const result = evaluateCatalogQuality(input({
      inventory: [inventory({ rawTeacherLabels: [], normalizedTeacherLabels: [] })],
      teachers: [],
      relations: [],
    }), []);
    expect(result.coverage.teacherEvidence).toMatchObject({ emptyTeacherRows: 1, coursesWithoutTeacher: 1 });
  });

  it("routes suspected teacher placeholders to a decision conflict", () => {
    const label = "待定教师";
    const result = evaluateCatalogQuality(input({
      inventory: [inventory({ rawTeacherLabels: [label], normalizedTeacherLabels: [label] })],
      teachers: [teacher(label)],
      relations: [relation("COURSE-1", label)],
    }), []);
    expect(result.conflicts).toContainEqual(expect.objectContaining({ code: "TEACHER_PLACEHOLDER_SUSPECTED", status: "pending" }));
  });

  it("automatically excludes exact no-teacher placeholder forms", () => {
    const label = "无任课教师";
    const result = evaluateCatalogQuality(input({
      inventory: [inventory({ rawTeacherLabels: [label], normalizedTeacherLabels: [label] })],
      teachers: [teacher(label)],
      relations: [relation("COURSE-1", label)],
    }), []);
    expect(result.conflicts.filter((item) => item.code === "TEACHER_PLACEHOLDER_SUSPECTED")).toEqual([]);
    expect(result.teachers).toEqual([]);
    expect(result.relations).toEqual([]);
    expect(result.exclusions).toContainEqual(expect.objectContaining({ code: "TEACHER_PLACEHOLDER", sourceTeacherLabel: label }));
  });

  it("allows an audited include decision to confirm a suspected teacher identity", () => {
    const label = "待定教师";
    const suspected = input({ inventory: [inventory({ rawTeacherLabels: [label], normalizedTeacherLabels: [label] })], teachers: [teacher(label)], relations: [relation("COURSE-1", label)] });
    const first = evaluateCatalogQuality(suspected, []);
    const key = first.conflicts.find((item) => item.code === "TEACHER_PLACEHOLDER_SUSPECTED")!.conflictId;
    const included = evaluateCatalogQuality(suspected, [decision(key)]);
    expect(included.teachers).toContainEqual(expect.objectContaining({ sourceTeacherLabel: label }));
  });

  it("maps direct PE skill names, queues umbrella Relations, and does not guess 黄丽萍 as 瑜伽", () => {
    const records = [
      inventory({ courseCode: "PE-BASKET2", rawCourseName: "篮球2", normalizedCourseName: "篮球2", rawTeacherLabels: ["教师甲"], normalizedTeacherLabels: ["教师甲"] }),
      inventory({ recordId: "query-1:0001:0002", courseCode: "PE-BASKET-TH", rawCourseName: "篮球专项理论与实践1", normalizedCourseName: "篮球专项理论与实践1", rawTeacherLabels: ["教师甲"], normalizedTeacherLabels: ["教师甲"], row: 2 }),
      inventory({ recordId: "query-1:0001:0003", courseCode: "PE-AERO", rawCourseName: "健身教练", normalizedCourseName: "健身教练", rawTeacherLabels: ["教师乙"], normalizedTeacherLabels: ["教师乙"], row: 3 }),
      inventory({ recordId: "query-1:0001:0004", courseCode: "PE-WUSHU", rawCourseName: "武术", normalizedCourseName: "武术", rawTeacherLabels: ["刘春来"], normalizedTeacherLabels: ["刘春来"], row: 4 }),
      inventory({ recordId: "query-1:0001:0005", courseCode: "PE-UMBRELLA", rawCourseName: "体育1", normalizedCourseName: "体育1", rawTeacherLabels: ["黄丽萍"], normalizedTeacherLabels: ["黄丽萍"], row: 5 }),
    ];
    const peInput = input({
      inventory: records,
      courses: [
        course({ courseCode: "PE-BASKET2", currentName: "篮球2", normalizedCurrentName: "篮球2" }),
        course({ courseCode: "PE-BASKET-TH", currentName: "篮球专项理论与实践1", normalizedCurrentName: "篮球专项理论与实践1" }),
        course({ courseCode: "PE-AERO", currentName: "健身教练", normalizedCurrentName: "健身教练" }),
        course({ courseCode: "PE-WUSHU", currentName: "武术", normalizedCurrentName: "武术" }),
        course({ courseCode: "PE-UMBRELLA", currentName: "体育1", normalizedCurrentName: "体育1" }),
      ],
      teachers: [teacher("教师甲"), teacher("教师乙"), teacher("刘春来"), teacher("黄丽萍")],
      relations: [
        relation("PE-BASKET2", "教师甲"),
        relation("PE-BASKET-TH", "教师甲"),
        relation("PE-AERO", "教师乙"),
        relation("PE-WUSHU", "刘春来"),
        relation("PE-UMBRELLA", "黄丽萍"),
      ],
    });
    const first = evaluateCatalogQuality(peInput, []);
    const peConflict = first.conflicts.find((item) => item.code === "PE_SPECIALIZATION_MAPPING_REQUIRED")!;
    expect(first.relations.find((item) => item.courseCode === "PE-BASKET2")?.peSpecialization).toMatchObject({
      sourceKind: "direct_skill",
      normalizedSpecialization: "篮球",
      displaySemantics: "keep_source_name",
    });
    expect(first.relations.find((item) => item.courseCode === "PE-BASKET-TH")?.peSpecialization?.normalizedSpecialization).toBe("篮球");
    expect(first.relations.find((item) => item.courseCode === "PE-AERO")?.peSpecialization).toMatchObject({
      normalizedSpecialization: "健美操",
      displaySemantics: "keep_source_name",
    });
    expect(first.relations.find((item) => item.courseCode === "PE-WUSHU")?.peSpecialization).toMatchObject({
      sourceKind: "direct_skill",
      normalizedSpecialization: "武术",
      displaySemantics: "keep_source_name",
    });
    expect(first.relations.find((item) => item.courseCode === "PE-UMBRELLA")?.peSpecialization).toBeNull();
    expect(peConflict).toMatchObject({ status: "pending" });
    expect(JSON.parse(peConflict.evidence[0])).toMatchObject({ sourceTeacherLabel: "黄丽萍", sourceCourseName: "体育1", sourceKind: "umbrella" });
    expect(first.coverage.status).toBe("review_required");

    expect(() => evaluateCatalogQuality(peInput, [decision(peConflict.conflictId, "exclude")])).toThrow(/PE_SPECIALIZATION_MAPPING_REQUIRED/);
    expect(() => evaluateCatalogQuality(peInput, [decision(peConflict.conflictId, "include")])).toThrow(/correctedValue/i);
    expect(() => evaluateCatalogQuality(peInput, [decision(peConflict.conflictId, "include", "体育1")])).toThrow(/correctedValue/i);

    const mapped = evaluateCatalogQuality(peInput, [decision(peConflict.conflictId, "include", "健身教练")]);
    expect(mapped.relations.find((item) => item.courseCode === "PE-UMBRELLA")?.peSpecialization).toMatchObject({
      sourceKind: "umbrella",
      normalizedSpecialization: "健美操",
      displaySemantics: "umbrella_prefixed",
      evidence: { kind: "human_decision", rawSpecializationName: "健身教练", sourceTeacherLabel: "黄丽萍" },
    });
    expect(mapped.relations.find((item) => item.courseCode === "PE-WUSHU")?.peSpecialization?.displaySemantics).toBe("keep_source_name");

    const acknowledged = evaluateCatalogQuality(peInput, [decision(peConflict.conflictId, "coverage_exception")]);
    expect(acknowledged.relations.find((item) => item.courseCode === "PE-UMBRELLA")?.peSpecialization).toBeNull();
    expect(acknowledged.coverageExceptions).toContainEqual(expect.objectContaining({ subjectKey: peConflict.conflictId }));
    expect(acknowledged.relations.find((item) => item.courseCode === "PE-UMBRELLA")).toMatchObject({ courseCode: "PE-UMBRELLA", sourceTeacherLabel: "黄丽萍" });
  });

  it("rejects decisions outside the three terminal values or without audit fields", () => {
    expect(() => validateQualityDecisions([{ ...decision("unit:x"), decision: "later" as "include" }])).toThrow(/decision/i);
    expect(() => validateQualityDecisions([{ ...decision("unit:x"), reviewer: "" }])).toThrow(/reviewer/i);
  });

  it("is invariant to input and provenance order", () => {
    const records = [
      inventory(),
      inventory({ recordId: "query-2:0001:0001", queryId: "query-2", courseCode: "COURSE-2", rawCourseName: "课程二", normalizedCourseName: "课程二", rawTeacherLabels: ["教师二"], normalizedTeacherLabels: ["教师二"], sourceHomeUnit: "本校单位乙", sourceHomeUnitCode: "UNIT-2", sourceCategoryText: "选修课" }),
    ];
    const relations = [
      { ...relation(), provenance: [relation().provenance[0], { ...relation().provenance[0], semester: "2025-2", educationLevel: "graduate", grade: "2024" }] },
      { ...relation("COURSE-2", "教师二"), provenance: [{ ...relation().provenance[0], queryId: "query-2" }] },
    ];
    const original = input({
      inventory: records,
      courses: [course(), course({ courseCode: "COURSE-2", currentName: "课程二", normalizedCurrentName: "课程二" })],
      teachers: [teacher(), teacher("教师二")],
      relations,
    });
    const permuted = {
      ...original,
      inventory: [...original.inventory].reverse(),
      courses: [...original.courses].reverse(),
      teachers: [...original.teachers].reverse(),
      relations: [...original.relations].reverse().map((item) => ({ ...item, provenance: [...item.provenance].reverse() })),
    };
    expect(evaluateCatalogQuality(permuted, [])).toEqual(evaluateCatalogQuality(original, []));
  });

  it("writes byte-identical quality artifacts after verifying derivation hashes", async () => {
    const root = join(tmpdir(), `jufexk-quality-${crypto.randomUUID()}`);
    const derivationRoot = join(root, "derived");
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    try {
      await writeDerivation(derivationRoot, input());
      const first = await runCatalogQuality(derivationRoot, firstRoot);
      const second = await runCatalogQuality(derivationRoot, secondRoot);
      expect(second).toEqual(first);
      for (const name of await readdir(firstRoot)) expect(await readFile(join(secondRoot, name))).toEqual(await readFile(join(firstRoot, name)));
      const conflicts = (await readFile(join(firstRoot, "conflicts.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const golden = (await readFile(join(firstRoot, "golden-sample.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      const decisionsPath = join(root, "decisions.jsonl");
      const decisions = [
        decision(conflicts.find((item) => item.code === "UNIT_DECISION_REQUIRED").conflictId),
        decision(golden.find((item) => item.kind === "relation").sampleId),
      ];
      await writeFile(decisionsPath, `${decisions.map((item) => JSON.stringify(item)).join("\n")}\n`);
      const decidedRoot = join(root, "decided");
      const decided = await runCatalogQuality(derivationRoot, decidedRoot, decisionsPath);
      expect(decided.decisionsSha256).not.toBe(createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
      expect(await readFile(join(decidedRoot, "conflicts.jsonl"), "utf8")).toContain('"status":"resolved"');
      expect(await readFile(join(decidedRoot, "golden-sample.jsonl"), "utf8")).toContain('"verified":true');
      const manifestPath = join(derivationRoot, "manifest.json");
      const manifestBytes = await readFile(manifestPath);
      const forgedManifest = JSON.parse(manifestBytes.toString("utf8"));
      const { contentSha256: _oldHash, ...forgedContent } = { ...forgedManifest, schemaVersion: "catalog-baseline-derivation/v999" };
      forgedManifest.schemaVersion = forgedContent.schemaVersion;
      forgedManifest.contentSha256 = createHash("sha256").update(stableJson(forgedContent)).digest("hex");
      await writeFile(manifestPath, `${JSON.stringify(forgedManifest, null, 2)}\n`);
      await expect(runCatalogQuality(derivationRoot, join(root, "forged-schema"))).rejects.toThrow(/manifest schema/i);
      await writeFile(manifestPath, manifestBytes);
      await writeFile(join(derivationRoot, "courses.jsonl"), "tampered\n");
      await expect(runCatalogQuality(derivationRoot, join(root, "tampered"))).rejects.toThrow(/integrity/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
