import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPeSpecializationMapping,
  classifyPeSourceCourseName,
  normalizeConfirmedPeSpecialization,
} from "../../src/lib/pe-specialization-mapping";
import {
  COURSE_SCHEMA_VERSION,
  DERIVATION_SCHEMA_VERSION,
  EXCEPTION_SCHEMA_VERSION,
  INVENTORY_SCHEMA_VERSION,
  RELATION_SCHEMA_VERSION,
  RELATION_SCHEMA_VERSION_V2,
  TEACHER_SCHEMA_VERSION,
  type CourseRecord,
  type DerivationManifest,
  type ExceptionRecord,
  type InventoryRecord,
  type RelationRecord,
  type SourceLocation,
  type TeacherRecord,
} from "./derive";

export const QUALITY_DECISION_SCHEMA_VERSION = "catalog-baseline-quality-decision/v1" as const;
export const QUALITY_CONFLICT_SCHEMA_VERSION = "catalog-baseline-quality-conflict/v2" as const;
export const QUALITY_EXCLUSION_SCHEMA_VERSION = "catalog-baseline-quality-exclusion/v1" as const;
export const QUALITY_COVERAGE_SCHEMA_VERSION = "catalog-baseline-quality-coverage/v2" as const;
export const QUALITY_GOLDEN_SCHEMA_VERSION = "catalog-baseline-quality-golden/v2" as const;
export const QUALITY_MANIFEST_SCHEMA_VERSION = "catalog-baseline-quality-manifest/v2" as const;
export const QUALITY_COVERAGE_EXCEPTION_SCHEMA_VERSION = "catalog-baseline-quality-coverage-exception/v1" as const;

const outputNames = ["courses.jsonl", "teachers.jsonl", "relations.jsonl", "conflicts.jsonl", "exclusions.jsonl", "coverage-exceptions.jsonl", "golden-sample.jsonl", "coverage.json"] as const;
const scriptRoot = dirname(fileURLToPath(import.meta.url));

export type CatalogCategory = "general" | "sports";

export interface QualityDecision {
  schemaVersion: typeof QUALITY_DECISION_SCHEMA_VERSION;
  subjectKey: string;
  decision: "include" | "exclude" | "coverage_exception";
  correctedValue?: string;
  reason: string;
  reviewer: string;
}

export interface QualityInput {
  inventory: InventoryRecord[];
  courses: CourseRecord[];
  teachers: TeacherRecord[];
  relations: RelationRecord[];
  sourceExceptions: ExceptionRecord[];
  boundaryEvidence?: Record<string, BoundaryEvidence>;
}

export interface BoundaryEvidence { status: "proven" | "not_observed"; fixtures: string[]; detail: string }

export interface QualityCourse extends CourseRecord {
  category: CatalogCategory;
  sourceCategoryTexts: string[];
}

export interface QualityConflict {
  schemaVersion: typeof QUALITY_CONFLICT_SCHEMA_VERSION;
  conflictId: string;
  code: "SOURCE_DERIVATION_EXCEPTION" | "COURSE_SAME_SEMESTER_NAME_CONFLICT" | "UNIT_DECISION_REQUIRED" | "UNIT_CODE_LABEL_CONFLICT" | "UNIT_EVIDENCE_MISSING" | "LOCATION_EVIDENCE_UNKNOWN" | "TEACHER_PLACEHOLDER_SUSPECTED" | "PE_SPECIALIZATION_MAPPING_REQUIRED";
  status: "pending" | "resolved";
  courseCode?: string;
  detail: string;
  evidence: string[];
  decision?: QualityDecision;
}

export interface QualityExclusion {
  schemaVersion: typeof QUALITY_EXCLUSION_SCHEMA_VERSION;
  exclusionId: string;
  code: "TEACHER_PLACEHOLDER" | "REVIEW_EXCLUDE";
  sourceTeacherLabel?: string;
  subjectKey: string;
  detail: string;
}

export interface GoldenSampleRecord {
  schemaVersion: typeof QUALITY_GOLDEN_SCHEMA_VERSION;
  kind: "relation";
  sampleId: string;
  courseCode: string;
  sourceTeacherLabel: string;
  verified: boolean;
  provenance: RelationRecord["provenance"];
}

export interface GoldenBoundaryRecord {
  schemaVersion: typeof QUALITY_GOLDEN_SCHEMA_VERSION;
  kind: "boundary_fixture";
  sampleId: string;
  boundary: string;
  fixture: string;
  verified: true;
}

export interface QualityCoverageException {
  schemaVersion: typeof QUALITY_COVERAGE_EXCEPTION_SCHEMA_VERSION;
  coverageExceptionId: string;
  subjectKey: string;
  detail: string;
  decision: QualityDecision;
}

export interface QualityCoverage {
  schemaVersion: typeof QUALITY_COVERAGE_SCHEMA_VERSION;
  status: "quality_passed" | "review_required";
  counts: {
    inventory: number;
    courses: number;
    teachers: number;
    relations: number;
    conflicts: number;
    pendingConflicts: number;
    exclusions: number;
    coverageExceptions: number;
    goldenSample: number;
    goldenRelations: number;
    goldenBoundaries: number;
    goldenUnverified: number;
  };
  categoryCounts: Record<CatalogCategory, number>;
  locationEvidence: Record<"mailu" | "fenglin" | "jiaoquiao" | "mooc" | "unknown", number>;
  unitEvidence: { codedRows: number; blankRows: number; coursesRecoveredFromOtherRows: number; coursesMissingAllEvidence: number };
  teacherEvidence: { emptyTeacherRows: number; coursesWithoutTeacher: number; placeholderRows: number; suspectedTeacherLabels: number };
  boundaries: Record<string, BoundaryEvidence>;
  blockerIds: string[];
}

export interface QualityResult {
  courses: QualityCourse[];
  teachers: TeacherRecord[];
  relations: RelationRecord[];
  conflicts: QualityConflict[];
  exclusions: QualityExclusion[];
  coverageExceptions: QualityCoverageException[];
  goldenSample: Array<GoldenSampleRecord | GoldenBoundaryRecord>;
  coverage: QualityCoverage;
}

interface SourceArtifact { path: string; records: number; bytes: number; sha256: string }
export interface QualityManifest {
  schemaVersion: typeof QUALITY_MANIFEST_SCHEMA_VERSION;
  captureManifestContentSha256: string;
  derivationContentSha256: string;
  decisionsSha256: string;
  boundaryFixtureContentSha256: string;
  status: QualityCoverage["status"];
  files: SourceArtifact[];
  contentSha256: string;
}

const teacherPlaceholders = new Set([
  "待定", "未安排", "外聘", "教师组",
  "暂无", "暂无教师", "暂无任课教师",
  "未知", "未知教师", "未知任课教师",
  "无", "无教师", "无任课教师",
]);
const automaticPolicyReviewer = "catalog-baseline-policy/v1";
const boundaryFixtureContract = {
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

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalize(value: string) {
  return value.normalize("NFC").replace(/[\s\u200B-\u200D\u2060\uFEFF]+/gu, " ").trim();
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
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

function provenanceKey(value: SourceLocation) {
  return [value.queryId, String(value.page).padStart(4, "0"), String(value.row).padStart(4, "0"), value.semester, value.educationLevel, value.grade].join("\u0000");
}

function jsonLines(records: unknown[]) {
  return Buffer.from(records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
}

function parseJsonLines<T>(bytes: Uint8Array): T[] {
  return new TextDecoder().decode(bytes).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

function conflictId(code: QualityConflict["code"], identity: string) {
  return `conflict:${code.toLowerCase()}:${digest(identity)}`;
}

export function validateQualityDecisions(decisions: QualityDecision[]) {
  const keys = new Set<string>();
  for (const decision of decisions) {
    if (decision.schemaVersion !== QUALITY_DECISION_SCHEMA_VERSION) throw new Error(`invalid decision schema for ${decision.subjectKey}`);
    if (!decision.subjectKey.trim()) throw new Error("decision subjectKey is required");
    if (!["include", "exclude", "coverage_exception"].includes(decision.decision)) throw new Error(`invalid decision for ${decision.subjectKey}`);
    if (!decision.reason.trim()) throw new Error(`decision reason is required for ${decision.subjectKey}`);
    if (!decision.reviewer.trim()) throw new Error(`decision reviewer is required for ${decision.subjectKey}`);
    if (keys.has(decision.subjectKey)) throw new Error(`duplicate decision for ${decision.subjectKey}`);
    keys.add(decision.subjectKey);
  }
}

export function validateBoundaryFixtureIndex(value: unknown): asserts value is { schemaVersion: "catalog-pilot-fixtures/v1"; boundaries: Record<keyof typeof boundaryFixtureContract, BoundaryEvidence> } {
  if (!value || typeof value !== "object") throw new Error("invalid boundary fixture index");
  const index = value as { schemaVersion?: unknown; boundaries?: unknown };
  if (index.schemaVersion !== "catalog-pilot-fixtures/v1") throw new Error("invalid boundary fixture index schema");
  if (!index.boundaries || typeof index.boundaries !== "object" || Array.isArray(index.boundaries)) throw new Error("invalid boundary fixture map");
  const boundaries = index.boundaries as Record<string, unknown>;
  const expectedKeys = Object.keys(boundaryFixtureContract).sort(compareText);
  const actualKeys = Object.keys(boundaries).sort(compareText);
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) throw new Error(`boundary fixture keys must be exactly ${expectedKeys.join(", ")}`);
  for (const boundary of expectedKeys as Array<keyof typeof boundaryFixtureContract>) {
    const evidence = boundaries[boundary];
    if (!evidence || typeof evidence !== "object") throw new Error(`invalid boundary evidence for ${boundary}`);
    const candidate = evidence as Partial<BoundaryEvidence>;
    if (!candidate.detail?.trim()) throw new Error(`boundary detail is required for ${boundary}`);
    if (!Array.isArray(candidate.fixtures) || !candidate.fixtures.every((fixture) => typeof fixture === "string")) throw new Error(`invalid boundary fixtures for ${boundary}`);
    if (candidate.status === "proven") {
      if (candidate.fixtures.length !== 1 || candidate.fixtures[0] !== boundaryFixtureContract[boundary]) throw new Error(`proven boundary ${boundary} must use ${boundaryFixtureContract[boundary]}`);
    } else if (candidate.status === "not_observed") {
      if (candidate.fixtures.length) throw new Error(`not-observed boundary ${boundary} cannot declare fixtures`);
    } else {
      throw new Error(`invalid boundary status for ${boundary}`);
    }
  }
}

function categorySignals(texts: string[]) {
  const segments = texts
    .flatMap((text) => normalize(text).split(/[\/、]/u))
    .map(normalize)
    .filter(Boolean);
  const affirmative = segments.filter((segment) => !segment.startsWith("非"));
  return {
    sports: affirmative.some((segment) => segment.includes("体育")),
  };
}

function categoryFor(observations: InventoryRecord[]): CatalogCategory {
  const texts = [...new Set(observations.map((record) => normalize(record.sourceCategoryText)).filter(Boolean))];
  return categorySignals(texts).sports ? "sports" : "general";
}

function locationKind(record: InventoryRecord): keyof QualityCoverage["locationEvidence"] {
  const evidence = `${record.sourceCampus}\n${record.sourceLocation}`;
  if (/MOOC/i.test(evidence)) return "mooc";
  if (evidence.includes("麦庐")) return "mailu";
  if (evidence.includes("枫林")) return "fenglin";
  if (evidence.includes("蛟桥")) return "jiaoquiao";
  return "unknown";
}

export function evaluateCatalogQuality(input: QualityInput, decisions: QualityDecision[]): QualityResult {
  validateQualityDecisions(decisions);
  const decisionByKey = new Map(decisions.map((decision) => [decision.subjectKey, decision]));
  const conflicts: QualityConflict[] = [];
  const exclusions: QualityExclusion[] = [];
  const coverageExceptions: QualityCoverageException[] = [];

  const addConflict = (code: QualityConflict["code"], identity: string, detail: string, evidence: string[], courseCode?: string, automaticDecision?: Pick<QualityDecision, "decision" | "correctedValue" | "reason" | "reviewer">) => {
    const id = conflictId(code, identity);
    const decision = decisionByKey.get(id) ?? (automaticDecision ? {
      schemaVersion: QUALITY_DECISION_SCHEMA_VERSION,
      subjectKey: id,
      ...automaticDecision,
    } : undefined);
    if (decision?.decision === "include" && code === "SOURCE_DERIVATION_EXCEPTION") throw new Error(`include is not valid for ${code}`);
    if (decision?.decision === "include" && code === "UNIT_EVIDENCE_MISSING") throw new Error(`include is not valid for ${code}`);
    if (decision?.decision === "exclude" && code === "PE_SPECIALIZATION_MAPPING_REQUIRED") throw new Error(`exclude is not valid for ${code}`);
    if (decision?.decision === "include" && code === "LOCATION_EVIDENCE_UNKNOWN" && !["mailu", "fenglin", "jiaoquiao", "mooc"].includes(decision.correctedValue ?? "")) throw new Error(`correctedValue required for ${code}`);
    if (decision?.decision === "coverage_exception" && !["SOURCE_DERIVATION_EXCEPTION", "LOCATION_EVIDENCE_UNKNOWN", "UNIT_EVIDENCE_MISSING", "PE_SPECIALIZATION_MAPPING_REQUIRED"].includes(code)) throw new Error(`coverage_exception is not valid for ${code}`);
    if (decision?.decision === "include" && code === "COURSE_SAME_SEMESTER_NAME_CONFLICT" && !decision.correctedValue?.trim()) throw new Error(`correctedValue required for ${code}`);
    if (decision?.decision === "include" && code === "UNIT_CODE_LABEL_CONFLICT" && !decision.correctedValue?.trim()) throw new Error(`correctedValue required for ${code}`);
    if (decision?.decision === "include" && code === "PE_SPECIALIZATION_MAPPING_REQUIRED" && !normalizeConfirmedPeSpecialization(decision.correctedValue)) throw new Error(`correctedValue required for ${code}`);
    if (decision?.decision === "coverage_exception") coverageExceptions.push({
      schemaVersion: QUALITY_COVERAGE_EXCEPTION_SCHEMA_VERSION,
      coverageExceptionId: `coverage-exception:${digest(id)}`,
      subjectKey: id,
      detail,
      decision,
    });
    conflicts.push({
      schemaVersion: QUALITY_CONFLICT_SCHEMA_VERSION,
      conflictId: id,
      code,
      status: decision ? "resolved" : "pending",
      courseCode,
      detail,
      evidence: [...evidence].sort(compareText),
      ...(decision ? { decision } : {}),
    });
    return decision;
  };

  for (const source of input.sourceExceptions) {
    addConflict("SOURCE_DERIVATION_EXCEPTION", `${source.queryId}:${source.page}:${source.row ?? 0}:${source.code}`, source.detail, [source.code]);
  }

  const unitLabelsByCode = new Map<string, Set<string>>();
  for (const record of input.inventory) {
    if (!record.sourceHomeUnitCode) continue;
    const labels = unitLabelsByCode.get(record.sourceHomeUnitCode) ?? new Set<string>();
    labels.add(normalize(record.sourceHomeUnit));
    unitLabelsByCode.set(record.sourceHomeUnitCode, labels);
  }
  const units = [...unitLabelsByCode.entries()]
    .map(([unitCode, labels]) => [unitCode, [...labels].sort(compareText)] as const)
    .sort(([left], [right]) => compareText(left, right));
  for (const [unitCode, unitLabels] of units) {
    if (unitLabels.length > 1) addConflict("UNIT_CODE_LABEL_CONFLICT", unitCode, "The same frozen home-unit code has multiple source labels.", [unitCode, ...unitLabels]);
    addConflict("UNIT_DECISION_REQUIRED", unitCode, "Source home unit requires an explicit in-scope decision.", [unitCode, ...unitLabels]);
  }
  const unitCodesByCourse = new Map<string, Set<string>>();
  for (const record of input.inventory) {
    const codes = unitCodesByCourse.get(record.courseCode) ?? new Set<string>();
    if (record.sourceHomeUnitCode) codes.add(record.sourceHomeUnitCode);
    unitCodesByCourse.set(record.courseCode, codes);
  }
  for (const [courseCode, codes] of [...unitCodesByCourse.entries()].sort(([left], [right]) => compareText(left, right))) {
    if (!codes.size) addConflict("UNIT_EVIDENCE_MISSING", courseCode, "Course has no frozen home-unit code in any provenance row.", [], courseCode);
  }

  const unknownLocations = input.inventory.filter((record) => locationKind(record) === "unknown");
  for (const record of unknownLocations) {
    const sourceLocationUnavailable = !normalize(record.sourceCampus) && !normalize(record.sourceLocation);
    addConflict("LOCATION_EVIDENCE_UNKNOWN", record.recordId, "Record has neither MOOC nor a recognized local-campus location signal.", [JSON.stringify({
      recordId: record.recordId,
      queryId: record.queryId,
      page: record.page,
      row: record.row,
      semester: record.semester,
      educationLevel: record.educationLevel,
      grade: record.grade,
      sourceCampus: record.sourceCampus,
      sourceLocation: record.sourceLocation,
      sourceHomeUnitCode: record.sourceHomeUnitCode,
      sourceHomeUnit: record.sourceHomeUnit,
      rawCourseName: record.rawCourseName,
    })], record.courseCode, sourceLocationUnavailable ? {
      decision: "coverage_exception",
      reason: "Source campus and location fields are both empty; preserve the catalog record without inferring a location.",
      reviewer: automaticPolicyReviewer,
    } : undefined);
  }
  const suspectedTeacherLabels = [...new Set(input.teachers.map((teacher) => teacher.normalizedTeacherLabel).filter((label) => !teacherPlaceholders.has(label) && (/(?:待定|未安排|外聘|教师组)/u.test(label) || /^(?:暂无|未知|无)(?:教师|任课教师)?$/u.test(label))))].sort(compareText);
  for (const label of suspectedTeacherLabels) addConflict("TEACHER_PLACEHOLDER_SUSPECTED", label, "Teacher label resembles a placeholder and requires an explicit identity decision.", [label]);

  const excludedUnitCodes = new Set(units.filter(([unitCode]) => decisionByKey.get(conflictId("UNIT_DECISION_REQUIRED", unitCode))?.decision === "exclude").map(([unitCode]) => unitCode));
  const excludedRecordIds = new Set(unknownLocations.filter((record) => decisionByKey.get(conflictId("LOCATION_EVIDENCE_UNKNOWN", record.recordId))?.decision === "exclude").map((record) => record.recordId));
  const excludedSourceScopes = input.sourceExceptions.filter((source) => ["exclude", "coverage_exception"].includes(decisionByKey.get(conflictId("SOURCE_DERIVATION_EXCEPTION", `${source.queryId}:${source.page}:${source.row ?? 0}:${source.code}`))?.decision ?? ""));
  const missingUnitCourseCodes = new Set(conflicts.filter((item) => item.code === "UNIT_EVIDENCE_MISSING" && ["exclude", "coverage_exception"].includes(item.decision?.decision ?? "") && item.courseCode).map((item) => item.courseCode!));
  let includedInventory = input.inventory.filter((record) => {
    const courseCodes = unitCodesByCourse.get(record.courseCode) ?? new Set<string>();
    const hasIncludedUnit = [...courseCodes].some((code) => !excludedUnitCodes.has(code));
    const excludedBySource = excludedSourceScopes.some((source) => source.queryId === record.queryId && (source.page === 0 || source.page === record.page) && (source.row === undefined || source.row === record.row));
    return !missingUnitCourseCodes.has(record.courseCode)
      && (record.sourceHomeUnitCode ? !excludedUnitCodes.has(record.sourceHomeUnitCode) : hasIncludedUnit)
      && !excludedRecordIds.has(record.recordId)
      && !excludedBySource;
  });

  const observationsByCourse = new Map<string, InventoryRecord[]>();
  for (const record of includedInventory) observationsByCourse.set(record.courseCode, [...(observationsByCourse.get(record.courseCode) ?? []), record]);
  const semesterNames = new Map<string, Set<string>>();
  for (const record of includedInventory) {
    const key = `${record.courseCode}\u0000${record.semester}`;
    const names = semesterNames.get(key) ?? new Set<string>();
    names.add(record.normalizedCourseName);
    semesterNames.set(key, names);
  }
  for (const [key, names] of [...semesterNames.entries()].sort(([left], [right]) => compareText(left, right))) {
    if (names.size < 2) continue;
    const [courseCode, semester] = key.split("\u0000");
    addConflict("COURSE_SAME_SEMESTER_NAME_CONFLICT", key, `The same course code has multiple names in semester ${semester}.`, [...names], courseCode);
  }

  const qualityCourses: QualityCourse[] = [];
  for (const course of [...input.courses].sort((left, right) => compareText(left.courseCode, right.courseCode))) {
    const observations = observationsByCourse.get(course.courseCode) ?? [];
    if (!observations.length) continue;
    const texts = [...new Set(observations.map((record) => normalize(record.sourceCategoryText)).filter(Boolean))].sort(compareText);
    const reviewedNames = conflicts.filter((conflict) => conflict.code === "COURSE_SAME_SEMESTER_NAME_CONFLICT" && conflict.courseCode === course.courseCode && conflict.decision?.decision === "include").map((conflict) => normalize(conflict.decision!.correctedValue!));
    if (new Set(reviewedNames).size > 1) throw new Error(`conflicting correctedValue decisions for course ${course.courseCode}`);
    const reviewedName = reviewedNames[0];
    qualityCourses.push({ ...course, ...(reviewedName ? { currentName: reviewedName, normalizedCurrentName: reviewedName } : {}), category: categoryFor(observations), sourceCategoryTexts: texts });
  }

  const excludedCourseCodes = new Set(conflicts.filter((conflict) => conflict.decision?.decision === "exclude" && conflict.courseCode).map((conflict) => conflict.courseCode!));
  includedInventory = includedInventory.filter((record) => !excludedCourseCodes.has(record.courseCode));
  const includedCourseCodes = new Set(includedInventory.map((record) => record.courseCode));
  const qualityCoursesFiltered = qualityCourses.filter((course) => includedCourseCodes.has(course.courseCode));
  for (const conflict of conflicts.filter((item) => item.decision?.decision === "exclude")) {
    exclusions.push({ schemaVersion: QUALITY_EXCLUSION_SCHEMA_VERSION, exclusionId: `exclusion:review:${digest(conflict.conflictId)}`, code: "REVIEW_EXCLUDE", subjectKey: conflict.conflictId, detail: conflict.decision!.reason });
  }

  const excludedTeachers = new Set<string>();
  for (const teacher of input.teachers) {
    if (!teacherPlaceholders.has(teacher.normalizedTeacherLabel)) continue;
    excludedTeachers.add(teacher.sourceTeacherLabel);
    exclusions.push({
      schemaVersion: QUALITY_EXCLUSION_SCHEMA_VERSION,
      exclusionId: `exclusion:teacher-placeholder:${digest(teacher.sourceTeacherLabel)}`,
      code: "TEACHER_PLACEHOLDER",
      sourceTeacherLabel: teacher.sourceTeacherLabel,
      subjectKey: teacher.sourceTeacherLabel,
      detail: "Known source placeholder is not a teacher identity.",
    });
  }
  for (const teacher of input.teachers) {
    const key = conflictId("TEACHER_PLACEHOLDER_SUSPECTED", teacher.normalizedTeacherLabel);
    if (decisionByKey.get(key)?.decision === "exclude") excludedTeachers.add(teacher.sourceTeacherLabel);
  }
  const allowedRelationKeys = new Set(includedInventory.flatMap((record) => record.rawTeacherLabels.map((label) => `${record.courseCode}\u0000${label}`)));
  const qualityCourseByCode = new Map(qualityCoursesFiltered.map((course) => [course.courseCode, course]));
  const relations = input.relations
    .filter((relation) => !excludedTeachers.has(relation.sourceTeacherLabel) && allowedRelationKeys.has(`${relation.courseCode}\u0000${relation.sourceTeacherLabel}`))
    .map((relation) => {
      const provenance = [...relation.provenance].sort((left, right) => compareText(provenanceKey(left), provenanceKey(right)));
      const course = qualityCourseByCode.get(relation.courseCode);
      const classified = classifyPeSourceCourseName(course?.currentName);
      if (classified.sourceKind === "direct_skill" && course) {
        return {
          schemaVersion: RELATION_SCHEMA_VERSION,
          courseCode: relation.courseCode,
          sourceTeacherLabel: relation.sourceTeacherLabel,
          provenance,
          peSpecialization: buildPeSpecializationMapping({
            sourceKind: "direct_skill",
            normalizedSpecialization: classified.normalizedSpecialization,
            evidenceKind: "catalog_course_name",
            sourceCourseCode: relation.courseCode,
            sourceCourseName: course.currentName,
            sourceTeacherLabel: relation.sourceTeacherLabel,
            rawSpecializationName: course.currentName,
          }),
        } satisfies RelationRecord;
      }
      if (classified.sourceKind === "umbrella" && course) {
        const decision = addConflict(
          "PE_SPECIALIZATION_MAPPING_REQUIRED",
          `${relation.courseCode}\u0000${relation.sourceTeacherLabel}`,
          "Umbrella PE source Relation has no confirmed 具体专项名.",
          [JSON.stringify({
            courseCode: relation.courseCode,
            sourceTeacherLabel: relation.sourceTeacherLabel,
            sourceCourseName: course.currentName,
            sourceKind: "umbrella",
          })],
          relation.courseCode,
        );
        const confirmed = decision?.decision === "include" ? normalizeConfirmedPeSpecialization(decision.correctedValue) : null;
        return {
          schemaVersion: RELATION_SCHEMA_VERSION,
          courseCode: relation.courseCode,
          sourceTeacherLabel: relation.sourceTeacherLabel,
          provenance,
          peSpecialization: confirmed
            ? buildPeSpecializationMapping({
                sourceKind: "umbrella",
                normalizedSpecialization: confirmed,
                evidenceKind: "human_decision",
                sourceCourseCode: relation.courseCode,
                sourceCourseName: course.currentName,
                sourceTeacherLabel: relation.sourceTeacherLabel,
                rawSpecializationName: decision!.correctedValue!,
              })
            : null,
        } satisfies RelationRecord;
      }
      return {
        schemaVersion: RELATION_SCHEMA_VERSION,
        courseCode: relation.courseCode,
        sourceTeacherLabel: relation.sourceTeacherLabel,
        provenance,
      } satisfies RelationRecord;
    })
    .sort((left, right) => compareText(`${left.courseCode}\u0000${left.sourceTeacherLabel}`, `${right.courseCode}\u0000${right.sourceTeacherLabel}`));
  const includedTeacherLabels = new Set(relations.map((relation) => relation.sourceTeacherLabel));
  const teachers = input.teachers
    .filter((teacher) => !excludedTeachers.has(teacher.sourceTeacherLabel) && includedTeacherLabels.has(teacher.sourceTeacherLabel))
    .sort((left, right) => compareText(left.sourceTeacherLabel, right.sourceTeacherLabel));

  const inventoryByLocation = new Map(includedInventory.map((record) => [`${record.queryId}:${record.page}:${record.row}`, record]));
  const strata = new Map<string, RelationRecord[]>();
  for (const relation of relations) {
    const source = relation.provenance[0];
    const observation = source ? inventoryByLocation.get(`${source.queryId}:${source.page}:${source.row}`) : undefined;
    const key = `${source?.semester ?? ""}\u0000${source?.educationLevel ?? ""}\u0000${normalize(observation?.sourceHomeUnit ?? "")}`;
    strata.set(key, [...(strata.get(key) ?? []), relation]);
  }
  for (const items of strata.values()) items.sort((left, right) => compareText(`${left.courseCode}\u0000${left.sourceTeacherLabel}`, `${right.courseCode}\u0000${right.sourceTeacherLabel}`));
  const selected: RelationRecord[] = [];
  const orderedStrata = [...strata.entries()].sort(([left], [right]) => compareText(left, right));
  for (let offset = 0; selected.length < Math.min(100, relations.length); offset += 1) {
    let added = false;
    for (const [, items] of orderedStrata) {
      if (items[offset]) {
        selected.push(items[offset]);
        added = true;
        if (selected.length === Math.min(100, relations.length)) break;
      }
    }
    if (!added) break;
  }
  const goldenSample = selected
    .map((relation): GoldenSampleRecord => {
      const sampleId = `golden:relation:${digest(`${relation.courseCode}\u0000${relation.sourceTeacherLabel}`)}`;
      return {
        schemaVersion: QUALITY_GOLDEN_SCHEMA_VERSION,
        kind: "relation",
        sampleId,
        courseCode: relation.courseCode,
        sourceTeacherLabel: relation.sourceTeacherLabel,
        verified: decisionByKey.get(sampleId)?.decision === "include",
        provenance: relation.provenance,
      };
    });
  const boundaryGolden: GoldenBoundaryRecord[] = Object.entries(input.boundaryEvidence ?? {}).sort(([left], [right]) => compareText(left, right)).flatMap(([boundary, evidence]) => evidence.status === "proven" ? [...evidence.fixtures].sort(compareText).map((fixture) => ({
    schemaVersion: QUALITY_GOLDEN_SCHEMA_VERSION,
    kind: "boundary_fixture" as const,
    sampleId: `golden:boundary:${boundary}:${fixture}`,
    boundary,
    fixture,
    verified: true as const,
  })) : []);
  const allGoldenSample: Array<GoldenSampleRecord | GoldenBoundaryRecord> = [...goldenSample, ...boundaryGolden];
  const boundarySubjectKeys = Object.entries(input.boundaryEvidence ?? {})
    .filter(([, evidence]) => evidence.status === "not_observed")
    .map(([boundary]) => `boundary:${boundary}`)
    .sort(compareText);
  for (const subjectKey of boundarySubjectKeys) {
    const decision = decisionByKey.get(subjectKey);
    if (!decision) continue;
    if (decision.decision !== "coverage_exception") throw new Error(`boundary decision must be coverage_exception for ${subjectKey}`);
    const boundary = subjectKey.slice("boundary:".length);
    const evidence = input.boundaryEvidence![boundary];
    coverageExceptions.push({
      schemaVersion: QUALITY_COVERAGE_EXCEPTION_SCHEMA_VERSION,
      coverageExceptionId: `coverage-exception:${digest(subjectKey)}`,
      subjectKey,
      detail: evidence.detail,
      decision,
    });
  }
  const validSubjectKeys = new Set([...conflicts.map((conflict) => conflict.conflictId), ...goldenSample.map((sample) => sample.sampleId), ...boundarySubjectKeys]);
  for (const decision of decisions) {
    if (!validSubjectKeys.has(decision.subjectKey)) throw new Error(`decision targets unknown subject ${decision.subjectKey}`);
    if (decision.subjectKey.startsWith("golden:") && decision.decision !== "include") throw new Error(`golden decision must be include for ${decision.subjectKey}`);
  }

  conflicts.sort((left, right) => compareText(left.conflictId, right.conflictId));
  exclusions.sort((left, right) => compareText(left.exclusionId, right.exclusionId));
  coverageExceptions.sort((left, right) => compareText(left.coverageExceptionId, right.coverageExceptionId));
  const pendingConflictIds = conflicts.filter((conflict) => conflict.status === "pending").map((conflict) => conflict.conflictId);
  const unverifiedGoldenIds = goldenSample.filter((sample) => !sample.verified).map((sample) => sample.sampleId);
  const boundaryBlockerIds = Object.entries(input.boundaryEvidence ?? {})
    .filter(([name, evidence]) => (evidence.status !== "proven" || !evidence.fixtures.length)
      && decisionByKey.get(`boundary:${name}`)?.decision !== "coverage_exception")
    .map(([name]) => `boundary:${name}`);
  const blockerIds = [...pendingConflictIds, ...unverifiedGoldenIds, ...boundaryBlockerIds].sort(compareText);
  const categoryCounts: QualityCoverage["categoryCounts"] = { general: 0, sports: 0 };
  for (const item of qualityCoursesFiltered) categoryCounts[item.category] += 1;
  const locationEvidence: QualityCoverage["locationEvidence"] = { mailu: 0, fenglin: 0, jiaoquiao: 0, mooc: 0, unknown: 0 };
  for (const record of includedInventory) {
    const correction = decisionByKey.get(conflictId("LOCATION_EVIDENCE_UNKNOWN", record.recordId));
    const kind = correction?.decision === "include" ? correction.correctedValue as keyof QualityCoverage["locationEvidence"] : locationKind(record);
    locationEvidence[kind] += 1;
  }
  const coursesWithBlankRows = new Set(input.inventory.filter((record) => !record.sourceHomeUnitCode).map((record) => record.courseCode));
  const unitEvidence: QualityCoverage["unitEvidence"] = {
    codedRows: input.inventory.filter((record) => !!record.sourceHomeUnitCode).length,
    blankRows: input.inventory.filter((record) => !record.sourceHomeUnitCode).length,
    coursesRecoveredFromOtherRows: [...coursesWithBlankRows].filter((courseCode) => (unitCodesByCourse.get(courseCode)?.size ?? 0) > 0).length,
    coursesMissingAllEvidence: [...unitCodesByCourse.values()].filter((codes) => codes.size === 0).length,
  };
  const coursesWithAnyTeacher = new Set(input.inventory.filter((record) => record.rawTeacherLabels.length > 0).map((record) => record.courseCode));
  const teacherEvidence: QualityCoverage["teacherEvidence"] = {
    emptyTeacherRows: input.inventory.filter((record) => record.rawTeacherLabels.length === 0).length,
    coursesWithoutTeacher: new Set(input.inventory.filter((record) => !coursesWithAnyTeacher.has(record.courseCode)).map((record) => record.courseCode)).size,
    placeholderRows: input.inventory.filter((record) => record.normalizedTeacherLabels.some((label) => teacherPlaceholders.has(label))).length,
    suspectedTeacherLabels: suspectedTeacherLabels.length,
  };
  const coverage: QualityCoverage = {
    schemaVersion: QUALITY_COVERAGE_SCHEMA_VERSION,
    status: blockerIds.length ? "review_required" : "quality_passed",
    counts: {
      inventory: input.inventory.length,
      courses: qualityCoursesFiltered.length,
      teachers: teachers.length,
      relations: relations.length,
      conflicts: conflicts.length,
      pendingConflicts: pendingConflictIds.length,
      exclusions: exclusions.length,
      coverageExceptions: coverageExceptions.length,
      goldenSample: allGoldenSample.length,
      goldenRelations: goldenSample.length,
      goldenBoundaries: boundaryGolden.length,
      goldenUnverified: unverifiedGoldenIds.length,
    },
    categoryCounts,
    locationEvidence,
    unitEvidence,
    teacherEvidence,
    boundaries: Object.fromEntries(Object.entries(input.boundaryEvidence ?? {}).sort(([left], [right]) => compareText(left, right))),
    blockerIds,
  };

  return { courses: qualityCoursesFiltered, teachers, relations, conflicts, exclusions, coverageExceptions, goldenSample: allGoldenSample, coverage };
}

async function prepareOutput(root: string) {
  await mkdir(root, { recursive: true });
  const allowed = new Set<string>([...outputNames, "manifest.json"]);
  const existing = await readdir(root, { withFileTypes: true });
  const unexpected = existing.filter((entry) => !entry.isFile() || !allowed.has(entry.name));
  if (unexpected.length) throw new Error(`quality output directory contains unrelated entries: ${unexpected.map((entry) => entry.name).sort(compareText).join(", ")}`);
  await Promise.all(existing.map((entry) => unlink(join(root, entry.name))));
}

async function readVerifiedSource<T extends { schemaVersion?: unknown }>(root: string, manifest: DerivationManifest, path: string, expectedSchemaVersion: string | readonly string[]): Promise<T[]> {
  const declaration = manifest.files.find((file) => file.path === path);
  if (!declaration) throw new Error(`derivation manifest does not declare ${path}`);
  const bytes = await readFile(join(root, path));
  if (bytes.byteLength !== declaration.bytes || sha256(bytes) !== declaration.sha256) throw new Error(`derivation artifact integrity check failed for ${path}`);
  const records = parseJsonLines<T>(bytes);
  if (records.length !== declaration.records) throw new Error(`derivation record count check failed for ${path}`);
  const expected = new Set(typeof expectedSchemaVersion === "string" ? [expectedSchemaVersion] : expectedSchemaVersion);
  const invalidIndex = records.findIndex((record) => !record || typeof record !== "object" || !expected.has(String(record.schemaVersion)));
  if (invalidIndex >= 0) throw new Error(`derivation record schema check failed for ${path} at record ${invalidIndex + 1}`);
  return records;
}

export async function runCatalogQuality(derivationDirectory: string, outputDirectory: string, decisionsPath?: string): Promise<QualityManifest> {
  const derivationRoot = resolve(derivationDirectory);
  const outputRoot = resolve(outputDirectory);
  if (derivationRoot === outputRoot) throw new Error("derivation and quality output directories must differ");
  const sourceManifest = JSON.parse(await readFile(join(derivationRoot, "manifest.json"), "utf8")) as DerivationManifest;
  if (sourceManifest.schemaVersion !== DERIVATION_SCHEMA_VERSION || !["derived", "derived_with_exceptions"].includes(sourceManifest.status) || !sourceManifest.contentSha256 || !Array.isArray(sourceManifest.files)) throw new Error("invalid derivation manifest schema");
  const expectedSourcePaths = ["courses.jsonl", "exceptions.jsonl", "inventory.jsonl", "relations.jsonl", "teachers.jsonl"];
  const declaredSourcePaths = sourceManifest.files.map((file) => file.path).sort(compareText);
  if (JSON.stringify(declaredSourcePaths) !== JSON.stringify(expectedSourcePaths)) throw new Error("derivation manifest must declare each expected artifact exactly once");
  const { contentSha256: declaredContentSha256, ...sourceManifestContent } = sourceManifest;
  if (sha256(stableJson(sourceManifestContent)) !== declaredContentSha256) throw new Error("derivation manifest content hash check failed");
  const [inventory, courses, teachers, relations, sourceExceptions] = await Promise.all([
    readVerifiedSource<InventoryRecord>(derivationRoot, sourceManifest, "inventory.jsonl", INVENTORY_SCHEMA_VERSION),
    readVerifiedSource<CourseRecord>(derivationRoot, sourceManifest, "courses.jsonl", COURSE_SCHEMA_VERSION),
    readVerifiedSource<TeacherRecord>(derivationRoot, sourceManifest, "teachers.jsonl", TEACHER_SCHEMA_VERSION),
    readVerifiedSource<RelationRecord>(derivationRoot, sourceManifest, "relations.jsonl", [RELATION_SCHEMA_VERSION, RELATION_SCHEMA_VERSION_V2]),
    readVerifiedSource<ExceptionRecord>(derivationRoot, sourceManifest, "exceptions.jsonl", EXCEPTION_SCHEMA_VERSION),
  ]);
  const decisionBytes = decisionsPath ? await readFile(resolve(decisionsPath)) : Buffer.alloc(0);
  const decisions = parseJsonLines<QualityDecision>(decisionBytes);
  const boundaryIndexPath = join(scriptRoot, "fixtures", "pilot", "index.json");
  const boundaryIndexBytes = await readFile(boundaryIndexPath);
  const boundaryIndex: unknown = JSON.parse(boundaryIndexBytes.toString("utf8"));
  validateBoundaryFixtureIndex(boundaryIndex);
  const boundaryHasher = createHash("sha256").update(boundaryIndexBytes);
  for (const fixture of [...new Set(Object.values(boundaryIndex.boundaries).flatMap((item) => item.fixtures))].sort(compareText)) {
    if (!/^[a-z0-9-]+\.html$/i.test(fixture)) throw new Error(`unsafe boundary fixture path ${fixture}`);
    boundaryHasher.update(fixture).update(await readFile(join(scriptRoot, "fixtures", "pilot", fixture)));
  }
  const boundaryFixtureContentSha256 = boundaryHasher.digest("hex");
  const result = evaluateCatalogQuality({ inventory, courses, teachers, relations, sourceExceptions, boundaryEvidence: boundaryIndex.boundaries }, decisions);
  const recordsByName: Record<(typeof outputNames)[number], unknown[] | object> = {
    "courses.jsonl": result.courses,
    "teachers.jsonl": result.teachers,
    "relations.jsonl": result.relations,
    "conflicts.jsonl": result.conflicts,
    "exclusions.jsonl": result.exclusions,
    "coverage-exceptions.jsonl": result.coverageExceptions,
    "golden-sample.jsonl": result.goldenSample,
    "coverage.json": result.coverage,
  };
  await prepareOutput(outputRoot);
  const files: SourceArtifact[] = [];
  for (const path of outputNames) {
    const value = recordsByName[path];
    const bytes = path.endsWith(".jsonl") ? jsonLines(value as unknown[]) : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    await writeFile(join(outputRoot, path), bytes);
    files.push({ path, records: Array.isArray(value) ? value.length : 1, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const content = {
    schemaVersion: QUALITY_MANIFEST_SCHEMA_VERSION,
    captureManifestContentSha256: sourceManifest.captureManifestContentSha256,
    derivationContentSha256: sourceManifest.contentSha256,
    decisionsSha256: sha256(decisionBytes),
    boundaryFixtureContentSha256,
    status: result.coverage.status,
    files,
  };
  const manifest: QualityManifest = { ...content, contentSha256: sha256(stableJson(content)) };
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
