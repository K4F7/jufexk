import { createHash } from "node:crypto";

export const CAPTURE_PACKAGE_SCHEMA_VERSION = "catalog-capture-package/v1" as const;

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface SourceOption {
  id: string;
  label: string;
}

export interface SourceDictionaryInput {
  semesters: SourceOption[];
  educationLevels: SourceOption[];
  grades: SourceOption[];
  homeUnits: SourceOption[];
}

export interface FrozenSourceDictionary extends SourceDictionaryInput {
  schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION;
  sha256: string;
}

export interface WideFilters {
  department: string;
  major: string;
  campus: string;
  category: string;
  courseName: string;
  teacherName: string;
  homeUnit: string;
}

export interface PlannedQuery {
  schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION;
  queryId: string;
  kind: "main" | "supplemental";
  dimensions: { semester: string; educationLevel: string; grade: string };
  filters: WideFilters;
}

export interface CounterexampleQuery {
  schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION;
  queryId: string;
  kind: "counterexample";
  baseQueryId: string;
  filters: WideFilters;
}

export interface QueryPlan {
  schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION;
  sourceDictionarySha256: string;
  queries: PlannedQuery[];
  counterexamples: CounterexampleQuery[];
}

const blankFilters = (): WideFilters => ({
  department: "",
  major: "",
  campus: "",
  category: "",
  courseName: "",
  teacherName: "",
  homeUnit: "",
});

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const fields = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeOptions(name: string, options: SourceOption[]) {
  const seen = new Set<string>();
  return options
    .map((option) => ({ id: option.id.trim(), label: option.label.trim() }))
    .sort((left, right) => compareText(left.id, right.id))
    .map((option) => {
      if (!option.id || !option.label) throw new Error(`${name} options require non-empty id and label`);
      if (seen.has(option.id)) throw new Error(`${name} contains duplicate id ${option.id}`);
      seen.add(option.id);
      return option;
    });
}

export function freezeSourceDictionary(input: SourceDictionaryInput): FrozenSourceDictionary {
  const content: SourceDictionaryInput & { schemaVersion: typeof CAPTURE_PACKAGE_SCHEMA_VERSION } = {
    schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION,
    semesters: normalizeOptions("semesters", input.semesters),
    educationLevels: normalizeOptions("educationLevels", input.educationLevels),
    grades: normalizeOptions("grades", input.grades),
    homeUnits: normalizeOptions("homeUnits", input.homeUnits),
  };
  return { ...content, sha256: sha256(stableJson(content)) };
}

function mainQueries(source: FrozenSourceDictionary, kind: "main" | "supplemental" = "main") {
  const queries: PlannedQuery[] = [];
  for (const semester of source.semesters) {
    for (const educationLevel of source.educationLevels) {
      for (const grade of source.grades) {
        queries.push({
          schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION,
          queryId: `${kind}-${semester.id}-${educationLevel.id}-${grade.id}`,
          kind,
          dimensions: { semester: semester.id, educationLevel: educationLevel.id, grade: grade.id },
          filters: blankFilters(),
        });
      }
    }
  }
  return queries;
}

export function freezeQueryPlan(
  source: FrozenSourceDictionary,
  options: { counterexamples?: Array<{ baseQueryId: string; dimension: "major" | "homeUnit"; value: string }> } = {},
): QueryPlan {
  const queries = mainQueries(source);
  const queryIds = new Set(queries.map((query) => query.queryId));
  const counterexamples = (options.counterexamples ?? []).map((item, index): CounterexampleQuery => {
    if (!queryIds.has(item.baseQueryId)) throw new Error(`unknown counterexample base query ${item.baseQueryId}`);
    if (!item.value) throw new Error("counterexample value must not be empty");
    return {
      schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION,
      queryId: `counterexample-${String(index + 1).padStart(4, "0")}`,
      kind: "counterexample",
      baseQueryId: item.baseQueryId,
      filters: { ...blankFilters(), [item.dimension]: item.value },
    };
  });
  return { schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION, sourceDictionarySha256: source.sha256, queries, counterexamples };
}

type DictionaryName = keyof SourceDictionaryInput;
type SourceChange = { dictionary: DictionaryName; kind: "added" | "removed" | "renamed"; id: string; before?: string; after?: string };

export function diffSourceDictionary(before: FrozenSourceDictionary, after: FrozenSourceDictionary): {
  status: "unchanged" | "source_changed";
  changes: SourceChange[];
  supplementalPlan: QueryPlan;
} {
  const changes: SourceChange[] = [];
  const names: DictionaryName[] = ["semesters", "educationLevels", "grades", "homeUnits"];
  for (const name of names) {
    const oldOptions = new Map(before[name].map((option) => [option.id, option.label]));
    const newOptions = new Map(after[name].map((option) => [option.id, option.label]));
    for (const [id, label] of newOptions) {
      if (!oldOptions.has(id)) changes.push({ dictionary: name, kind: "added", id, after: label });
      else if (oldOptions.get(id) !== label) changes.push({ dictionary: name, kind: "renamed", id, before: oldOptions.get(id), after: label });
    }
    for (const [id, label] of oldOptions) {
      if (!newOptions.has(id)) changes.push({ dictionary: name, kind: "removed", id, before: label });
    }
  }

  const affected = {
    semesters: new Set(changes.filter((item) => item.dictionary === "semesters" && item.kind !== "removed").map((item) => item.id)),
    educationLevels: new Set(changes.filter((item) => item.dictionary === "educationLevels" && item.kind !== "removed").map((item) => item.id)),
    grades: new Set(changes.filter((item) => item.dictionary === "grades" && item.kind !== "removed").map((item) => item.id)),
    homeUnits: new Set(changes.filter((item) => item.dictionary === "homeUnits" && item.kind !== "removed").map((item) => item.id)),
  };
  const supplemental = mainQueries(after, "supplemental").filter((query) =>
    affected.semesters.has(query.dimensions.semester)
    || affected.educationLevels.has(query.dimensions.educationLevel)
    || affected.grades.has(query.dimensions.grade),
  );
  for (const homeUnit of affected.homeUnits) {
    for (const query of mainQueries(after, "supplemental")) {
      supplemental.push({
        ...query,
        queryId: `supplemental-homeUnit-${homeUnit}-${query.dimensions.semester}-${query.dimensions.educationLevel}-${query.dimensions.grade}`,
        filters: { ...query.filters, homeUnit },
      });
    }
  }
  const supplementalPlan: QueryPlan = {
    schemaVersion: CAPTURE_PACKAGE_SCHEMA_VERSION,
    sourceDictionarySha256: after.sha256,
    queries: supplemental,
    counterexamples: [],
  };
  return { status: changes.length ? "source_changed" : "unchanged", changes, supplementalPlan };
}
