/**
 * 版本化教务快照 DTO：协议闸门失败时的浏览器同源 JSON 导入/导出。
 * 导出 JSON 不得含 Cookie、学号、姓名。
 */
import {
  JWXT_DTO_VERSION,
  looksLikeForbidden,
  offeringHasForbidden,
  type JwxtCategoryOption,
  type JwxtFilterOption,
  type JwxtOffering,
} from "./jwxt-offering";
import { parseJwxtTableHtml, type JwxtTableParse } from "./jwxt-table";

export const JWXT_SNAPSHOT_VERSION = JWXT_DTO_VERSION;
export const JWXT_SNAPSHOT_SOURCE = "browser-export" as const;

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
    typeof item.weekday === "number" &&
    typeof item.startPeriod === "number" &&
    typeof item.endPeriod === "number" &&
    Array.isArray(item.weeks) &&
    item.weeks.every((week) => typeof week === "number") &&
    typeof item.place === "string"
  );
}

function isOffering(value: unknown): value is JwxtOffering {
  if (!value || typeof value !== "object") return false;
  const item = value as JwxtOffering;
  if (typeof item.courseName !== "string" || typeof item.courseCode !== "string") return false;
  if (offeringHasForbidden(item as JwxtOffering)) return false;
  if (!Array.isArray(item.meetings) || !item.meetings.every(isMeeting)) return false;
  return true;
}

function firstOption(list: JwxtFilterOption[], fallback: JwxtFilterOption): JwxtFilterOption {
  return list[0] ?? fallback;
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
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function parseSnapshotObject(value: unknown): SnapshotImportResult {
  if (!value || typeof value !== "object") {
    return { ok: false, kind: "malformed", message: "不是 JSON 对象" };
  }
  const raw = value as Partial<JwxtSnapshotV1> & { version?: unknown };
  if (raw.version !== JWXT_SNAPSHOT_VERSION) {
    return { ok: false, kind: "malformed", message: "不支持的快照版本" };
  }
  if (raw.source !== JWXT_SNAPSHOT_SOURCE) {
    return { ok: false, kind: "malformed", message: "不是浏览器导出快照" };
  }
  const buckets = [raw.enrolled, raw.planned, raw.publicElectives];
  if (buckets.some((bucket) => Array.isArray(bucket) && bucket.some((item) => looksLikeForbidden(JSON.stringify(item))))) {
    return { ok: false, kind: "forbidden", message: "JSON 含 Cookie、学号或姓名" };
  }
  const enrolled = Array.isArray(raw.enrolled) ? raw.enrolled.filter(isOffering) : [];
  const planned = Array.isArray(raw.planned) ? raw.planned.filter(isOffering) : [];
  const publicElectives = Array.isArray(raw.publicElectives) ? raw.publicElectives.filter(isOffering) : [];
  const snapshot: JwxtSnapshotV1 = {
    version: JWXT_SNAPSHOT_VERSION,
    source: JWXT_SNAPSHOT_SOURCE,
    term: isFilter(raw.term) ? raw.term : { id: "", label: "" },
    educationLevel: isFilter(raw.educationLevel) ? raw.educationLevel : { id: "", label: "" },
    grade: isFilter(raw.grade) ? raw.grade : { id: "", label: "" },
    major: isFilter(raw.major) ? raw.major : { id: "", label: "" },
    terms: Array.isArray(raw.terms) ? raw.terms.filter(isFilter) : [],
    educationLevels: Array.isArray(raw.educationLevels) ? raw.educationLevels.filter(isFilter) : [],
    grades: Array.isArray(raw.grades) ? raw.grades.filter(isFilter) : [],
    majors: Array.isArray(raw.majors) ? raw.majors.filter(isFilter) : [],
    categories: Array.isArray(raw.categories) ? raw.categories.filter(isCategory) : [],
    enrolled,
    planned,
    publicElectives,
  };
  if (snapshotHasForbidden(snapshot)) {
    return { ok: false, kind: "forbidden", message: "JSON 含 Cookie、学号或姓名" };
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
  const next: JwxtSnapshotV1 = {
    ...merged,
    term,
    educationLevel: merged.educationLevel.id ? merged.educationLevel : firstOption(merged.educationLevels, merged.educationLevel),
    grade: merged.grade.id ? merged.grade : firstOption(merged.grades, merged.grade),
    major: merged.major.id ? merged.major : firstOption(merged.majors, merged.major),
    enrolled: bucket === "enrolled" ? parsed.offerings : merged.enrolled,
    planned: bucket === "planned" ? parsed.offerings : merged.planned,
    publicElectives: bucket === "public" ? parsed.offerings : merged.publicElectives,
  };
  if (snapshotHasForbidden(next)) {
    return { ok: false, kind: "forbidden", message: "解析结果含 Cookie、学号或姓名" };
  }
  return { ok: true, snapshot: next };
}

export function inferHtmlBucket(html: string): "enrolled" | "planned" | "public" {
  if (/S20301|选课结果|已选/.test(html) && !/S2020103/.test(html)) return "enrolled";
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
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseSnapshotObject(JSON.parse(trimmed));
    } catch {
      return { ok: false, kind: "malformed", message: "JSON 无法解析" };
    }
  }
  return snapshotFromHtml(trimmed, bucket ?? inferHtmlBucket(trimmed), current);
}

export function exportedJsonIsClean(json: string): boolean {
  return !looksLikeForbidden(json);
}
