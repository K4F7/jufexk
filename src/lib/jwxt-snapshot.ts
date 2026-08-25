/**
 * 版本化教务快照 DTO：协议闸门失败时的浏览器同源 JSON 导入/导出。
 * 导出 JSON 不得含 Cookie、学生学号、学生姓名。
 */
import {
  JWXT_DTO_VERSION,
  JWXT_MAJOR_REQUIRED_MESSAGE,
  isJwxtFilterSelected,
  looksLikeForbidden,
  offeringKey,
  offeringHasForbidden,
  type JwxtCategoryOption,
  type JwxtFilterOption,
  type JwxtOffering,
} from "./jwxt-offering";
import { parseJwxtTableHtml, type JwxtSelectParse, type JwxtTableParse } from "./jwxt-table";

export const JWXT_SNAPSHOT_VERSION = JWXT_DTO_VERSION;
export const JWXT_SNAPSHOT_SOURCE = "browser-export" as const;
export const JWXT_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
export type JwxtSnapshotBucket = "enrolled" | "planned" | "public";
const ALL_BUCKETS: JwxtSnapshotBucket[] = ["enrolled", "planned", "public"];

export type JwxtSnapshotV1 = {
  version: typeof JWXT_SNAPSHOT_VERSION;
  source: typeof JWXT_SNAPSHOT_SOURCE;
  term: JwxtFilterOption;
  educationLevel: JwxtFilterOption;
  grade: JwxtFilterOption;
  major: JwxtFilterOption;
  terms: JwxtFilterOption[];
  educationLevels: JwxtFilterOption[];
  grades: JwxtFilterOption[];
  majors: JwxtFilterOption[];
  categories: JwxtCategoryOption[];
  captured?: JwxtSnapshotBucket[];
  enrolled: JwxtOffering[];
  planned: JwxtOffering[];
  publicElectives: JwxtOffering[];
};

export type SnapshotImportResult =
  | { ok: true; snapshot: JwxtSnapshotV1 }
  | { ok: false; kind: "login-expired" | "malformed" | "forbidden"; message: string };

function isFilter(value: unknown): value is JwxtFilterOption {
  if (!value || typeof value !== "object") return false;
  const item = value as JwxtFilterOption;
  return typeof item.id === "string" && typeof item.label === "string" && !looksLikeForbidden(`${item.id}${item.label}`);
}

function isCategory(value: unknown): value is JwxtCategoryOption {
  return isFilter(value) && ((value as JwxtCategoryOption).kind === "planned" || (value as JwxtCategoryOption).kind === "public");
}

function isMeeting(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as { weekday?: unknown; startPeriod?: unknown; endPeriod?: unknown; weeks?: unknown; place?: unknown };
  return (
    typeof item.weekday === "number" && Number.isInteger(item.weekday) && item.weekday >= 1 && item.weekday <= 7 &&
    typeof item.startPeriod === "number" && Number.isInteger(item.startPeriod) && item.startPeriod >= 1 && item.startPeriod <= 20 &&
    typeof item.endPeriod === "number" && Number.isInteger(item.endPeriod) && item.endPeriod >= item.startPeriod && item.endPeriod <= 20 &&
    Array.isArray(item.weeks) &&
    item.weeks.every((week) => Number.isInteger(week) && week >= 1 && week <= 60) &&
    typeof item.place === "string"
  );
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isNullableId(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && Number(value) > 0);
}

function isOffering(value: unknown): value is JwxtOffering {
  if (!value || typeof value !== "object") return false;
  const item = value as JwxtOffering;
  if (
    typeof item.courseName !== "string" || !item.courseName.trim() ||
    typeof item.courseCode !== "string" ||
    typeof item.categoryPath !== "string" ||
    typeof item.section !== "string" ||
    typeof item.teacherName !== "string" ||
    typeof item.campus !== "string" ||
    typeof item.weekText !== "string" ||
    typeof item.timeText !== "string" ||
    typeof item.place !== "string" ||
    typeof item.enrollStatus !== "string" ||
    !isNullableNumber(item.credits) ||
    !isNullableNumber(item.capacityLimit) ||
    !isNullableNumber(item.capacitySelected) ||
    !isNullableNumber(item.capacityAvailable) ||
    !isNullableId(item.catalogCourseId) ||
    !isNullableId(item.catalogTeacherId) ||
    (item.catalogRating !== undefined && !isNullableNumber(item.catalogRating)) ||
    (item.catalogReviewCount !== undefined && (!Number.isInteger(item.catalogReviewCount) || item.catalogReviewCount < 0))
  ) return false;
  if (offeringHasForbidden(item)) return false;
  if (!Array.isArray(item.meetings) || !item.meetings.every(isMeeting)) return false;
  return true;
}

function isBucket(value: unknown): value is JwxtSnapshotBucket {
  return value === "enrolled" || value === "planned" || value === "public";
}

function firstOption(list: JwxtFilterOption[], fallback: JwxtFilterOption): JwxtFilterOption {
  return list[0] ?? fallback;
}

function pickDimension(
  current: JwxtFilterOption,
  parsed: JwxtSelectParse,
  fallbackList: JwxtFilterOption[],
): JwxtFilterOption {
  if (isJwxtFilterSelected(current)) return current;
  if (parsed.selected) return parsed.selected;
  if (parsed.hasPlaceholder) return { id: "", label: "" };
  return firstOption(fallbackList, current);
}

export function emptySnapshot(): JwxtSnapshotV1 {
  const unknown = { id: "", label: "" };
  return {
    version: JWXT_SNAPSHOT_VERSION,
    source: JWXT_SNAPSHOT_SOURCE,
    term: unknown,
    educationLevel: unknown,
    grade: unknown,
    major: unknown,
    terms: [],
    educationLevels: [],
    grades: [],
    majors: [],
    categories: [],
    captured: [],
    enrolled: [],
    planned: [],
    publicElectives: [],
  };
}

export function snapshotHasForbidden(snapshot: JwxtSnapshotV1): boolean {
  if (looksLikeForbidden(JSON.stringify(snapshot))) return true;
  return (
    snapshot.enrolled.some(offeringHasForbidden) ||
    snapshot.planned.some(offeringHasForbidden) ||
    snapshot.publicElectives.some(offeringHasForbidden)
  );
}

export function serializeSnapshot(snapshot: JwxtSnapshotV1): string {
  if (snapshotHasForbidden(snapshot)) {
    throw new Error("快照含 Cookie、学号或姓名，已拒绝导出");
  }
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (new TextEncoder().encode(json).byteLength > JWXT_MAX_SNAPSHOT_BYTES) {
    throw new Error("教务快照超过 2 MB，已拒绝导出");
  }
  return json;
}

export function parseSnapshotObject(value: unknown): SnapshotImportResult {
  if (!value || typeof value !== "object") {
    return { ok: false, kind: "malformed", message: "不是 JSON 对象" };
  }
  const raw = value as Partial<JwxtSnapshotV1> & { version?: unknown };
  if (looksLikeForbidden(JSON.stringify(value))) {
    return { ok: false, kind: "forbidden", message: "JSON 含 Cookie、学生学号或学生姓名" };
  }
  if (raw.version !== JWXT_SNAPSHOT_VERSION) {
    return { ok: false, kind: "malformed", message: "不支持的快照版本" };
  }
  if (raw.source !== JWXT_SNAPSHOT_SOURCE) {
    return { ok: false, kind: "malformed", message: "不是浏览器导出快照" };
  }
  if (
    !isFilter(raw.term) || !isFilter(raw.educationLevel) || !isFilter(raw.grade) || !isFilter(raw.major) ||
    !Array.isArray(raw.terms) || !raw.terms.every(isFilter) ||
    !Array.isArray(raw.educationLevels) || !raw.educationLevels.every(isFilter) ||
    !Array.isArray(raw.grades) || !raw.grades.every(isFilter) ||
    !Array.isArray(raw.majors) || !raw.majors.every(isFilter) ||
    !Array.isArray(raw.categories) || !raw.categories.every(isCategory) ||
    !Array.isArray(raw.enrolled) || !raw.enrolled.every(isOffering) ||
    !Array.isArray(raw.planned) || !raw.planned.every(isOffering) ||
    !Array.isArray(raw.publicElectives) || !raw.publicElectives.every(isOffering) ||
    (raw.captured !== undefined && (!Array.isArray(raw.captured) || !raw.captured.every(isBucket)))
  ) {
    return { ok: false, kind: "malformed", message: "快照字段或开课班格式无效" };
  }
  const snapshot: JwxtSnapshotV1 = {
    version: JWXT_SNAPSHOT_VERSION,
    source: JWXT_SNAPSHOT_SOURCE,
    term: raw.term,
    educationLevel: raw.educationLevel,
    grade: raw.grade,
    major: raw.major,
    terms: raw.terms,
    educationLevels: raw.educationLevels,
    grades: raw.grades,
    majors: raw.majors,
    categories: raw.categories,
    captured: raw.captured ? [...new Set(raw.captured)] : [...ALL_BUCKETS],
    enrolled: raw.enrolled,
    planned: raw.planned,
    publicElectives: raw.publicElectives,
  };
  if (snapshotHasForbidden(snapshot)) {
    return { ok: false, kind: "forbidden", message: "JSON 含 Cookie、学生学号或学生姓名" };
  }
  return { ok: true, snapshot };
}

function mergeFilters(base: JwxtSnapshotV1, incoming: JwxtTableParse) {
  if (!incoming.ok) return base;
  const pick = (current: JwxtFilterOption[], extra: JwxtFilterOption[]) => {
    const seen = new Set(current.map((item) => item.id));
    const next = [...current];
    for (const item of extra) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        next.push(item);
      }
    }
    return next;
  };
  return {
    ...base,
    terms: pick(base.terms, incoming.filters.terms),
    educationLevels: pick(base.educationLevels, incoming.filters.educationLevels),
    grades: pick(base.grades, incoming.filters.grades),
    majors: pick(base.majors, incoming.filters.majors),
    categories: pick(base.categories, incoming.filters.categories) as JwxtCategoryOption[],
  };
}

export function snapshotFromHtml(
  html: string,
  bucket: "enrolled" | "planned" | "public" = "planned",
  current: JwxtSnapshotV1 = emptySnapshot(),
): SnapshotImportResult {
  const parsed = parseJwxtTableHtml(html);
  if (!parsed.ok) {
    return { ok: false, kind: parsed.kind, message: parsed.message };
  }
  const merged = mergeFilters(current, parsed);
  const term = isFilter(merged.term) && merged.term.id ? merged.term : firstOption(merged.terms, merged.term);
  const grade = pickDimension(merged.grade, parsed.gradeSelect, merged.grades);
  const major = pickDimension(merged.major, parsed.majorSelect, merged.majors);
  if (
    (bucket === "planned" || bucket === "public") &&
    (
      (parsed.gradeSelect.hasPlaceholder && !isJwxtFilterSelected(grade)) ||
      (parsed.majorSelect.hasPlaceholder && !isJwxtFilterSelected(major))
    )
  ) {
    return { ok: false, kind: "malformed", message: JWXT_MAJOR_REQUIRED_MESSAGE };
  }
  const next: JwxtSnapshotV1 = {
    ...merged,
    term,
    educationLevel: merged.educationLevel.id ? merged.educationLevel : firstOption(merged.educationLevels, merged.educationLevel),
    grade,
    major,
    captured: [...new Set([...(merged.captured ?? []), bucket])],
    enrolled: bucket === "enrolled" ? parsed.offerings : merged.enrolled,
    planned: bucket === "planned"
      ? mergeOfferingBuckets(term.id, merged.planned, parsed.offerings)
      : merged.planned,
    publicElectives: bucket === "public"
      ? mergeOfferingBuckets(term.id, merged.publicElectives, parsed.offerings)
      : merged.publicElectives,
  };
  if (snapshotHasForbidden(next)) {
    return { ok: false, kind: "forbidden", message: "解析结果含 Cookie、学号或姓名" };
  }
  return { ok: true, snapshot: next };
}

export function inferHtmlBucket(html: string): "enrolled" | "planned" | "public" {
  if (/S2020302|S20301|选课结果|已选/.test(html) && !/S2020103/.test(html)) return "enrolled";
  if (/公共选修|公选/.test(html)) return "public";
  return "planned";
}

export function importSnapshotText(
  text: string,
  bucket?: "enrolled" | "planned" | "public",
  current: JwxtSnapshotV1 = emptySnapshot(),
): SnapshotImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, kind: "malformed", message: "空内容" };
  if (new TextEncoder().encode(trimmed).byteLength > JWXT_MAX_SNAPSHOT_BYTES) {
    return { ok: false, kind: "malformed", message: "教务快照超过 2 MB" };
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseSnapshotObject(JSON.parse(trimmed));
    } catch {
      return { ok: false, kind: "malformed", message: "JSON 无法解析" };
    }
  }
  return snapshotFromHtml(trimmed, bucket ?? inferHtmlBucket(trimmed), current);
}

export function snapshotSelectionKey(snapshot: Pick<JwxtSnapshotV1, "term" | "educationLevel" | "grade" | "major">): string {
  return [snapshot.term.id, snapshot.educationLevel.id, snapshot.grade.id, snapshot.major.id]
    .map((part) => encodeURIComponent(part.trim()))
    .join("|");
}

function mergeOptions<T extends JwxtFilterOption>(base: T[], incoming: T[]): T[] {
  const merged = new Map(base.map((option) => [option.id, option]));
  for (const option of incoming) merged.set(option.id, option);
  return [...merged.values()];
}

function mergeOfferingBuckets(
  termId: string,
  base: JwxtOffering[],
  incoming: JwxtOffering[],
): JwxtOffering[] {
  if (incoming.length === 0) return [];
  const merged = new Map(base.map((offering) => [
    offeringKey(termId, offering.courseCode, offering.section, offering.courseName),
    offering,
  ]));
  for (const offering of incoming) {
    const key = offeringKey(termId, offering.courseCode, offering.section, offering.courseName);
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, offering);
      continue;
    }
    const teachers = new Set(
      `${previous.teacherName}、${offering.teacherName}`
        .split(/[、,，/]/)
        .map((teacher) => teacher.trim())
        .filter(Boolean),
    );
    const meetings = new Map(previous.meetings.map((meeting) => [
      `${meeting.weekday}:${meeting.startPeriod}:${meeting.endPeriod}:${meeting.weeks.join(",")}:${meeting.place}`,
      meeting,
    ]));
    for (const meeting of offering.meetings) {
      meetings.set(
        `${meeting.weekday}:${meeting.startPeriod}:${meeting.endPeriod}:${meeting.weeks.join(",")}:${meeting.place}`,
        meeting,
      );
    }
    merged.set(key, {
      ...previous,
      ...offering,
      teacherName: [...teachers].join("、"),
      meetings: [...meetings.values()],
    });
  }
  return [...merged.values()];
}

/** 合并同一筛选组合的分页/类别快照；captured 明确哪些桶是本次权威结果。 */
export function mergeSnapshots(base: JwxtSnapshotV1, incoming: JwxtSnapshotV1): JwxtSnapshotV1 {
  if (snapshotSelectionKey(base) !== snapshotSelectionKey(incoming)) return incoming;
  const captured = incoming.captured ?? ALL_BUCKETS;
  return {
    ...incoming,
    terms: mergeOptions(base.terms, incoming.terms),
    educationLevels: mergeOptions(base.educationLevels, incoming.educationLevels),
    grades: mergeOptions(base.grades, incoming.grades),
    majors: mergeOptions(base.majors, incoming.majors),
    categories: mergeOptions(base.categories, incoming.categories) as JwxtCategoryOption[],
    captured: [...new Set([...(base.captured ?? ALL_BUCKETS), ...captured])],
    enrolled: captured.includes("enrolled")
      ? mergeOfferingBuckets(incoming.term.id, base.enrolled, incoming.enrolled)
      : base.enrolled,
    planned: captured.includes("planned")
      ? mergeOfferingBuckets(incoming.term.id, base.planned, incoming.planned)
      : base.planned,
    publicElectives: captured.includes("public")
      ? mergeOfferingBuckets(incoming.term.id, base.publicElectives, incoming.publicElectives)
      : base.publicElectives,
  };
}

export function exportedJsonIsClean(json: string): boolean {
  return !looksLikeForbidden(json);
}
