import {
  CAPTURE_PACKAGE_SCHEMA_VERSION,
  COVERAGE_SCHEMA_VERSION,
  compareText,
  sha256,
  stableJson,
} from "./shared";

export interface SourceOption {
  id: string;
  label: string;
}

export interface CascadeNode {
  grade: SourceOption;
  department: SourceOption;
  majors: SourceOption[];
}

export interface ProgramPlanDimensions {
  grade: string;
  departmentCode: string;
  departmentName: string;
  majorCode: string;
  majorName: string;
  studyKind: "主修";
  majorDirection: "";
}

export interface ProgramPlanFilters {
  grade: string;
  department: string;
  major: string;
  majorDirection: "";
  studyKind: "主修";
}

export interface PlannedQuery {
  schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION;
  queryId: string;
  kind: "main";
  dimensions: ProgramPlanDimensions;
  filters: ProgramPlanFilters;
}

export type CoverageStatus = "complete" | "empty" | "exception";

export interface CoverageEntry {
  grade: string;
  departmentCode: string;
  departmentName: string;
  majorCode: string;
  majorName: string;
  studyKind: "主修";
  status: CoverageStatus;
  queryId?: string;
  declaredRecordCount?: number;
  reason?: string;
}

export interface CoverageDeclaration {
  schemaVersion: typeof COVERAGE_SCHEMA_VERSION;
  batchId: string;
  grades: string[];
  entries: CoverageEntry[];
}

export interface FrozenSourceDictionary {
  schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION;
  grades: SourceOption[];
  departments: SourceOption[];
  majors: SourceOption[];
  studyKinds: SourceOption[];
  cascade: CascadeNode[];
  capturedAt?: string;
  sha256: string;
}

function normalizeOption(option: SourceOption, name: string): SourceOption {
  const id = option.id.trim();
  const label = option.label.trim();
  if (!id || !label) throw new Error(`${name} options require non-empty id and label`);
  return { id, label };
}

function uniqueOptions(name: string, options: SourceOption[], sort = true) {
  const seen = new Map<string, string>();
  const normalized = options.map((option) => normalizeOption(option, name));
  const ordered = sort ? [...normalized].sort((left, right) => compareText(left.id, right.id)) : normalized;
  return ordered.filter((option) => {
    const existing = seen.get(option.id);
    if (existing === option.label) return false;
    if (existing) throw new Error(`${name} contains duplicate id ${option.id}`);
    seen.set(option.id, option.label);
    return true;
  });
}

export function isPlaceholderOption(option: SourceOption) {
  return !option.id.trim() || /请选择|全部|--/.test(option.label);
}

export function optionYear(option: SourceOption) {
  const token = /^\d{4}$/.test(option.id) ? option.id : option.label.match(/\d{4}/)?.[0];
  return token ? Number(token) : Number.NaN;
}

export function selectCurrentUndergraduateGrades(options: SourceOption[], now = new Date()) {
  const years = options.filter((option) => Number.isSafeInteger(optionYear(option)));
  const incoming = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const window = new Set([incoming, incoming - 1, incoming - 2, incoming - 3].map(String));
  const inWindow = years.filter((option) => window.has(String(optionYear(option))));
  const picked = (inWindow.length ? inWindow : [...years].sort((left, right) => optionYear(right) - optionYear(left)).slice(0, 4));
  return [...picked].sort((left, right) => optionYear(left) - optionYear(right));
}

export function safeQueryIdPart(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blank";
}

export function queryIdFor(grade: string, departmentCode: string, majorCode: string) {
  return `main-${safeQueryIdPart(grade)}-${safeQueryIdPart(departmentCode)}-${safeQueryIdPart(majorCode)}`;
}

export function sourceDictionaryContentSha256(dictionary: Omit<FrozenSourceDictionary, "sha256"> | FrozenSourceDictionary) {
  return sha256(stableJson({
    schemaVersion: dictionary.schemaVersion,
    grades: dictionary.grades,
    departments: dictionary.departments,
    majors: dictionary.majors,
    studyKinds: dictionary.studyKinds,
    cascade: dictionary.cascade,
    capturedAt: undefined,
  }));
}

export function freezeSourceDictionary(cascade: CascadeNode[], capturedAt?: string): FrozenSourceDictionary {
  const grades = uniqueOptions("grades", cascade.map((node) => node.grade));
  const departments = uniqueOptions("departments", cascade.map((node) => node.department));
  const majors = uniqueOptions("majors", cascade.flatMap((node) => node.majors));
  const content = {
    schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION,
    grades,
    departments,
    majors,
    studyKinds: [{ id: "主修", label: "主修" }],
    cascade: cascade.map((node) => ({
      grade: normalizeOption(node.grade, "grades"),
      department: normalizeOption(node.department, "departments"),
      majors: uniqueOptions("majors", node.majors, false),
    })),
    capturedAt,
  };
  return { ...content, sha256: sourceDictionaryContentSha256(content) };
}

export function freezeQueryPlan(dictionary: FrozenSourceDictionary): {
  queries: PlannedQuery[];
  coverage: CoverageEntry[];
} {
  const queries: PlannedQuery[] = [];
  const coverage: CoverageEntry[] = [];
  for (const node of dictionary.cascade) {
    if (node.majors.length === 0) {
      coverage.push({
        grade: node.grade.id,
        departmentCode: node.department.id,
        departmentName: node.department.label,
        majorCode: "",
        majorName: "",
        studyKind: "主修",
        status: "exception",
        reason: "department_has_no_majors",
      });
      continue;
    }
    for (const major of node.majors) {
      const queryId = queryIdFor(node.grade.id, node.department.id, major.id);
      queries.push({
        schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION,
        queryId,
        kind: "main",
        dimensions: {
          grade: node.grade.id,
          departmentCode: node.department.id,
          departmentName: node.department.label,
          majorCode: major.id,
          majorName: major.label,
          studyKind: "主修",
          majorDirection: "",
        },
        filters: {
          grade: node.grade.id,
          department: node.department.id,
          major: major.id,
          majorDirection: "",
          studyKind: "主修",
        },
      });
      coverage.push({
        grade: node.grade.id,
        departmentCode: node.department.id,
        departmentName: node.department.label,
        majorCode: major.id,
        majorName: major.label,
        studyKind: "主修",
        status: "complete",
        queryId,
      });
    }
  }
  return { queries, coverage };
}

export function coverageFromQueries(
  batchId: string,
  dictionary: FrozenSourceDictionary,
  queries: Array<{ queryId: string; status: string; declaredRecordCount: number }>,
): CoverageDeclaration {
  const planned = freezeQueryPlan(dictionary);
  const byId = new Map(queries.map((query) => [query.queryId, query]));
  const entries = planned.coverage.map((entry) => {
    if (!entry.queryId) return entry;
    const query = byId.get(entry.queryId);
    if (!query) return { ...entry, status: "exception" as const, reason: "query_missing" };
    if (query.status === "exception" || query.status === "failed") {
      return { ...entry, status: "exception" as const, declaredRecordCount: query.declaredRecordCount, reason: "query_failed" };
    }
    if (query.status === "complete" && query.declaredRecordCount === 0) {
      return { ...entry, status: "empty" as const, declaredRecordCount: 0, reason: "empty_result" };
    }
    return { ...entry, status: "complete" as const, declaredRecordCount: query.declaredRecordCount };
  });
  return {
    schemaVersion: COVERAGE_SCHEMA_VERSION,
    batchId,
    grades: dictionary.grades.map((grade) => grade.id),
    entries,
  };
}
