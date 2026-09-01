import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  isExcludedCourseName,
  normalizeCourseNameForPolicy,
} from "../../src/lib/course-catalog-policy";
import {
  classifyPeSourceCourseName,
  mappingFromDirectSkillCourseName,
  type RelationPeSpecializationMapping,
} from "../../src/lib/pe-specialization-mapping";
import { validateCapturePackage, type CaptureManifest, type CaptureQuery } from "./capture-package";

export const DERIVATION_SCHEMA_VERSION = "catalog-baseline-derivation/v1" as const;
export const INVENTORY_SCHEMA_VERSION = "catalog-baseline-inventory/v3" as const;
export const COURSE_SCHEMA_VERSION = "catalog-baseline-course/v1" as const;
export const TEACHER_SCHEMA_VERSION = "catalog-baseline-teacher/v1" as const;
export const RELATION_SCHEMA_VERSION_V2 = "catalog-baseline-relation/v2" as const;
export const RELATION_SCHEMA_VERSION = "catalog-baseline-relation/v3" as const;
export const EXCEPTION_SCHEMA_VERSION = "catalog-baseline-exception/v1" as const;

const artifactNames = ["inventory.jsonl", "courses.jsonl", "teachers.jsonl", "relations.jsonl", "exceptions.jsonl"] as const;
const expectedHeaders = ["课程", "开课校区", "学分", "总学时", "课程类别", "承担单位", "上课班号", "上课班组", "上课班级名称", "限选人数", "已选/免听", "可选人数", "周次", "授课方式", "任课教师", "上课时间", "上课地点", "双语教学", "精品课程", "上课班号", "授课方式", "校区代码"];

export interface SourceLocation { queryId: string; page: number; row: number; semester: string; educationLevel: string; grade: string }
export interface InventoryRecord extends SourceLocation {
  schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
  recordId: string;
  courseCode: string;
  rawCourseName: string;
  normalizedCourseName: string;
  rawTeacherLabels: string[];
  normalizedTeacherLabels: string[];
  sourceCampus: string;
  sourceCategoryText: string;
  sourceHomeUnit: string;
  sourceHomeUnitCode: string;
  sourceLocation: string;
}
export interface CourseVariant { rawName: string; normalizedName: string; firstSemester: string; lastSemester: string; occurrences: number }
export interface CourseRecord { schemaVersion: typeof COURSE_SCHEMA_VERSION; courseCode: string; currentName: string; normalizedCurrentName: string; nameVariants: CourseVariant[] }
export interface TeacherRecord { schemaVersion: typeof TEACHER_SCHEMA_VERSION; sourceTeacherLabel: string; normalizedTeacherLabel: string }
export interface RelationRecord {
  schemaVersion: typeof RELATION_SCHEMA_VERSION | typeof RELATION_SCHEMA_VERSION_V2;
  courseCode: string;
  sourceTeacherLabel: string;
  provenance: SourceLocation[];
  peSpecialization?: RelationPeSpecializationMapping | null;
}
export interface ExceptionRecord {
  schemaVersion: typeof EXCEPTION_SCHEMA_VERSION;
  code: "GBK_DECODE_ERROR" | "UNKNOWN_TABLE_STRUCTURE" | "MISSING_COURSE_CODE" | "UNKNOWN_TEACHER_STRUCTURE" | "PARSED_RECORD_COUNT_MISMATCH" | "NORMALIZED_TEACHER_COLLISION" | "UNKNOWN_HOME_UNIT_LABEL" | "AMBIGUOUS_HOME_UNIT_LABEL";
  queryId: string;
  page: number;
  row?: number;
  detail: string;
}
export interface ArtifactManifest { path: string; records: number; bytes: number; sha256: string }
export interface DerivationManifest {
  schemaVersion: typeof DERIVATION_SCHEMA_VERSION;
  captureBatchId: string;
  captureManifestContentSha256: string;
  status: "derived" | "derived_with_exceptions";
  files: ArtifactManifest[];
  contentSha256: string;
}

interface HtmlCell { text: string; rowspan: number; colspan: number }

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeSourceLabel(value: string) {
  return normalizeCourseNameForPolicy(value);
}

function teacherLabelsOf(value: string): { labels: string[]; hasUnknownStructure: boolean } {
  const raw = value.trim();
  if (!raw) return { labels: [], hasUnknownStructure: false };
  const normalized = normalizeSourceLabel(raw);
  const parts = normalized.split(" ");
  const chineseNameParts = parts.length > 1
    && !/\s{2,}/u.test(raw)
    && parts.every((part) => /^[\p{Script=Han}·]{2,}\d?$/u.test(part));
  if (chineseNameParts) return { labels: parts, hasUnknownStructure: false };
  if (/[、,，;；/]\s*\S/u.test(raw)) return { labels: [], hasUnknownStructure: true };
  return { labels: [raw], hasUnknownStructure: false };
}

function comparableHomeUnitLabel(value: string) {
  return normalizeSourceLabel(value).replace(/^\[\d+\]\s*/u, "");
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function textOf(html: string) {
  return decodeEntities(html.replace(/<br\s*\/?\s*>/gi, "、").replace(/<[^>]+>/g, " ")).trim();
}

function headerTextOf(html: string) {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function attributeNumber(attributes: string, name: string) {
  const value = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attributes)?.[1];
  const number = value ? Number(value) : 1;
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

function cellsOf(rowHtml: string): HtmlCell[] {
  return [...rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map((match) => ({
    text: textOf(match[2]),
    rowspan: attributeNumber(match[1], "rowspan"),
    colspan: attributeNumber(match[1], "colspan"),
  }));
}

function tableGrid(html: string): { headers: string[]; rows: string[][] } | undefined {
  const table = /<table\b[^>]*\bid\s*=\s*["']keywords["'][^>]*>[\s\S]*?<\/table>/i.exec(html)?.[0];
  if (!table) return undefined;
  const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(table)?.[1];
  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(table)?.[1];
  if (!head) return undefined;
  const headerRows = [...head.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (headerRows.length !== 1) return undefined;
  const headers = [...headerRows[0][1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((match) => headerTextOf(match[1]));
  const pending: Array<{ remaining: number; value: string } | undefined> = [];
  const rows: string[][] = [];
  for (const rowMatch of (body ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row: string[] = [];
    let column = 0;
    const inherit = () => {
      while (pending[column]?.remaining) {
        const item = pending[column]!;
        row[column] = item.value;
        item.remaining -= 1;
        if (item.remaining === 0) pending[column] = undefined;
        column += 1;
      }
    };
    for (const cell of cellsOf(rowMatch[1])) {
      inherit();
      for (let offset = 0; offset < cell.colspan; offset += 1) {
        row[column] = cell.text;
        if (cell.rowspan > 1) pending[column] = { remaining: cell.rowspan - 1, value: cell.text };
        column += 1;
      }
    }
    inherit();
    rows.push(row);
  }
  return { headers, rows };
}

function strictDecodeGbk(bytes: Uint8Array) {
  return new TextDecoder("gbk", { fatal: true }).decode(bytes);
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

function semesterParts(value: string) {
  return [...value.matchAll(/\d+/g)].map((match) => Number(match[0]));
}

function compareSemester(left: string, right: string) {
  const a = semesterParts(left);
  const b = semesterParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? -1) !== (b[index] ?? -1)) return (a[index] ?? -1) - (b[index] ?? -1);
  }
  return compareText(left, right);
}

async function readQueries(root: string) {
  const text = await readFile(join(root, "queries.jsonl"), "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as CaptureQuery);
}

function jsonLines(records: unknown[]) {
  return Buffer.from(records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
}

async function prepareOutput(root: string) {
  await mkdir(root, { recursive: true });
  const allowed = new Set<string>([...artifactNames, "manifest.json"]);
  const existing = await readdir(root, { withFileTypes: true });
  const unexpected = existing.filter((entry) => !entry.isFile() || !allowed.has(entry.name));
  if (unexpected.length) throw new Error(`derivation output directory contains unrelated entries: ${unexpected.map((entry) => entry.name).sort(compareText).join(", ")}`);
  await Promise.all(existing.map((entry) => unlink(join(root, entry.name))));
}

function sameHeaders(actual: string[]) {
  const canonical = (header: string) => header.replace(/\s+/g, "");
  return actual.length === expectedHeaders.length && actual.every((header, index) => canonical(header) === canonical(expectedHeaders[index]));
}

export async function deriveCatalogBaseline(captureDirectory: string, outputDirectory: string): Promise<DerivationManifest> {
  const captureRoot = resolve(captureDirectory);
  const outputRoot = resolve(outputDirectory);
  if (captureRoot === outputRoot) throw new Error("capture and derivation output directories must differ");
  const captureManifest: CaptureManifest = await validateCapturePackage(captureRoot);
  const sourceDictionary = JSON.parse(await readFile(join(captureRoot, "source-dictionary.json"), "utf8")) as { sha256: string; homeUnits: Array<{ id: string; label: string }> };
  if (sourceDictionary.sha256 !== captureManifest.sourceDictionarySha256 || !Array.isArray(sourceDictionary.homeUnits)) throw new Error("source dictionary does not match the validated capture manifest");
  const homeUnitsByLabel = new Map<string, Array<{ id: string; label: string }>>();
  for (const option of sourceDictionary.homeUnits) {
    const label = comparableHomeUnitLabel(option.label);
    homeUnitsByLabel.set(label, [...(homeUnitsByLabel.get(label) ?? []), option]);
  }
  const queries = await readQueries(captureRoot);
  const queryById = new Map(queries.map((query) => [query.queryId, query]));
  const inventory: InventoryRecord[] = [];
  const exceptions: ExceptionRecord[] = [];
  const inheritedCourseCellByQuery = new Map<string, string>();
  const snapshotFiles = captureManifest.files.filter((file) => /^snapshots\/.+\/page-\d{4}\.html$/.test(file.path)).sort((left, right) => compareText(left.path, right.path));

  for (const file of snapshotFiles) {
    const match = /^snapshots\/([^/]+)\/page-(\d{4})\.html$/.exec(file.path)!;
    const queryId = match[1];
    const page = Number(match[2]);
    const query = queryById.get(queryId);
    if (!query) throw new Error(`capture package references unknown query ${queryId}`);
    let html: string;
    try {
      html = strictDecodeGbk(await readFile(join(captureRoot, ...file.path.split("/"))));
    } catch {
      exceptions.push({ schemaVersion: EXCEPTION_SCHEMA_VERSION, code: "GBK_DECODE_ERROR", queryId, page, detail: "Snapshot is not strictly decodable as GBK." });
      continue;
    }
    const grid = tableGrid(html);
    if (!grid) {
      exceptions.push({ schemaVersion: EXCEPTION_SCHEMA_VERSION, code: "UNKNOWN_TABLE_STRUCTURE", queryId, page, detail: "The keywords table does not contain a supported header and row structure." });
      continue;
    }
    if (!sameHeaders(grid.headers)) {
      exceptions.push({ schemaVersion: EXCEPTION_SCHEMA_VERSION, code: "UNKNOWN_TABLE_STRUCTURE", queryId, page, detail: "Expected the known 22-column header order." });
      continue;
    }
    grid.rows.forEach((row, index) => {
      const rowNumber = index + 1;
      if (row.length !== expectedHeaders.length) {
        exceptions.push({ schemaVersion: EXCEPTION_SCHEMA_VERSION, code: "UNKNOWN_TABLE_STRUCTURE", queryId, page, row: rowNumber, detail: `Expected 22 expanded cells; received ${row.length}.` });
        return;
      }
      if (row[0]) inheritedCourseCellByQuery.set(queryId, row[0]);
      else if (inheritedCourseCellByQuery.has(queryId)) row[0] = inheritedCourseCellByQuery.get(queryId)!;
      const identity = /^\[([^\]]+)]\s*([\s\S]*)$/.exec(row[0]);
      if (!identity || !normalizeSourceLabel(identity[1]) || !normalizeSourceLabel(identity[2])) {
        exceptions.push({ schemaVersion: EXCEPTION_SCHEMA_VERSION, code: "MISSING_COURSE_CODE", queryId, page, row: rowNumber, detail: "Course cell does not contain a non-empty [course-code] course-name identity." });
        return;
      }
      const rawTeacher = row[14];
      const teacherResult = teacherLabelsOf(rawTeacher);
      if (teacherResult.hasUnknownStructure) {
        exceptions.push({ schemaVersion: EXCEPTION_SCHEMA_VERSION, code: "UNKNOWN_TEACHER_STRUCTURE", queryId, page, row: rowNumber, detail: "Teacher field contains an unverified multi-teacher separator." });
      }
      const rawTeacherLabels = teacherResult.labels;
      const rawHomeUnit = row[5];
      const homeUnitMatches = homeUnitsByLabel.get(comparableHomeUnitLabel(rawHomeUnit)) ?? [];
      if (rawHomeUnit && homeUnitMatches.length !== 1) {
        exceptions.push({
          schemaVersion: EXCEPTION_SCHEMA_VERSION,
          code: homeUnitMatches.length ? "AMBIGUOUS_HOME_UNIT_LABEL" : "UNKNOWN_HOME_UNIT_LABEL",
          queryId,
          page,
          row: rowNumber,
          detail: homeUnitMatches.length ? "Source home-unit label maps to multiple frozen dictionary codes." : "Source home-unit label does not exist in the frozen dictionary.",
        });
      }
      inventory.push({
        schemaVersion: INVENTORY_SCHEMA_VERSION,
        recordId: `${queryId}:${String(page).padStart(4, "0")}:${String(rowNumber).padStart(4, "0")}`,
        courseCode: normalizeSourceLabel(identity[1]),
        rawCourseName: identity[2],
        normalizedCourseName: normalizeSourceLabel(identity[2]),
        rawTeacherLabels,
        normalizedTeacherLabels: rawTeacherLabels.map(normalizeSourceLabel),
        sourceCampus: row[1],
        sourceCategoryText: row[4],
        sourceHomeUnit: rawHomeUnit,
        sourceHomeUnitCode: homeUnitMatches.length === 1 ? homeUnitMatches[0].id : "",
        sourceLocation: row[16],
        queryId,
        page,
        row: rowNumber,
        semester: query.dimensions.semester,
        educationLevel: query.dimensions.educationLevel,
        grade: query.dimensions.grade,
      });
    });
  }

  for (const query of queries) {
    const parsed = inventory.filter((record) => record.queryId === query.queryId).length;
    if (parsed !== query.declaredRecordCount) {
      exceptions.push({ schemaVersion: EXCEPTION_SCHEMA_VERSION, code: "PARSED_RECORD_COUNT_MISMATCH", queryId: query.queryId, page: 0, detail: `Parsed ${parsed} rows but the query declares ${query.declaredRecordCount}.` });
    }
  }

  for (let index = inventory.length - 1; index >= 0; index -= 1) {
    if (isExcludedCourseName(inventory[index].normalizedCourseName))
      inventory.splice(index, 1);
  }

  inventory.sort((left, right) => compareText(left.recordId, right.recordId));
  exceptions.sort((left, right) => compareText(`${left.queryId}:${String(left.page).padStart(4, "0")}:${String(left.row ?? 0).padStart(4, "0")}:${left.code}`, `${right.queryId}:${String(right.page).padStart(4, "0")}:${String(right.row ?? 0).padStart(4, "0")}:${right.code}`));

  const coursesByCode = new Map<string, InventoryRecord[]>();
  for (const record of inventory) coursesByCode.set(record.courseCode, [...(coursesByCode.get(record.courseCode) ?? []), record]);
  const courses: CourseRecord[] = [...coursesByCode.entries()].map(([courseCode, records]) => {
    const variants = new Map<string, InventoryRecord[]>();
    for (const record of records) variants.set(record.rawCourseName, [...(variants.get(record.rawCourseName) ?? []), record]);
    const current = [...records].sort((left, right) => compareSemester(right.semester, left.semester) || compareText(left.recordId, right.recordId))[0];
    return {
      schemaVersion: COURSE_SCHEMA_VERSION,
      courseCode,
      currentName: current.rawCourseName,
      normalizedCurrentName: current.normalizedCourseName,
      nameVariants: [...variants.entries()].sort(([left], [right]) => compareText(left, right)).map(([rawName, observations]) => ({
        rawName,
        normalizedName: normalizeSourceLabel(rawName),
        firstSemester: [...observations].sort((left, right) => compareSemester(left.semester, right.semester))[0].semester,
        lastSemester: [...observations].sort((left, right) => compareSemester(right.semester, left.semester))[0].semester,
        occurrences: observations.length,
      })),
    };
  }).sort((left, right) => compareText(left.courseCode, right.courseCode));

  const teachers = [...new Map(inventory.flatMap((record) => record.rawTeacherLabels).map((label) => [label, {
    schemaVersion: TEACHER_SCHEMA_VERSION,
    sourceTeacherLabel: label,
    normalizedTeacherLabel: normalizeSourceLabel(label),
  } satisfies TeacherRecord])).values()].sort((left, right) => compareText(left.sourceTeacherLabel, right.sourceTeacherLabel));
  const teachersByNormalizedLabel = new Map<string, TeacherRecord[]>();
  for (const teacher of teachers) {
    teachersByNormalizedLabel.set(teacher.normalizedTeacherLabel, [...(teachersByNormalizedLabel.get(teacher.normalizedTeacherLabel) ?? []), teacher]);
  }
  for (const collided of teachersByNormalizedLabel.values()) {
    if (collided.length < 2) continue;
    const source = inventory.find((record) => record.rawTeacherLabels.includes(collided[1].sourceTeacherLabel));
    if (!source) continue;
    exceptions.push({
      schemaVersion: EXCEPTION_SCHEMA_VERSION,
      code: "NORMALIZED_TEACHER_COLLISION",
      queryId: source.queryId,
      page: source.page,
      row: source.row,
      detail: "Multiple raw source teacher labels share one minimally normalized label; identities remain separate.",
    });
  }
  exceptions.sort((left, right) => compareText(`${left.queryId}:${String(left.page).padStart(4, "0")}:${String(left.row ?? 0).padStart(4, "0")}:${left.code}`, `${right.queryId}:${String(right.page).padStart(4, "0")}:${String(right.row ?? 0).padStart(4, "0")}:${right.code}`));

  const courseNameByCode = new Map(courses.map((course) => [course.courseCode, course.currentName]));
  const relationsByKey = new Map<string, RelationRecord>();
  for (const record of inventory) {
    for (const sourceTeacherLabel of record.rawTeacherLabels) {
      const key = `${record.courseCode}\u0000${sourceTeacherLabel}`;
      const relation = relationsByKey.get(key) ?? { schemaVersion: RELATION_SCHEMA_VERSION, courseCode: record.courseCode, sourceTeacherLabel, provenance: [] };
      relation.provenance.push({ queryId: record.queryId, page: record.page, row: record.row, semester: record.semester, educationLevel: record.educationLevel, grade: record.grade });
      relationsByKey.set(key, relation);
    }
  }
  const relations = [...relationsByKey.values()].sort((left, right) => compareText(`${left.courseCode}\u0000${left.sourceTeacherLabel}`, `${right.courseCode}\u0000${right.sourceTeacherLabel}`));
  for (const relation of relations) {
    relation.provenance.sort((left, right) => compareText(`${left.queryId}:${String(left.page).padStart(4, "0")}:${String(left.row).padStart(4, "0")}`, `${right.queryId}:${String(right.page).padStart(4, "0")}:${String(right.row).padStart(4, "0")}`));
    const courseName = courseNameByCode.get(relation.courseCode) ?? "";
    const directSkill = mappingFromDirectSkillCourseName({
      courseCode: relation.courseCode,
      courseName,
      sourceTeacherLabel: relation.sourceTeacherLabel,
    });
    if (directSkill) relation.peSpecialization = directSkill;
    else if (classifyPeSourceCourseName(courseName).sourceKind === "umbrella") relation.peSpecialization = null;
  }

  const recordsByName: Record<(typeof artifactNames)[number], unknown[]> = {
    "inventory.jsonl": inventory,
    "courses.jsonl": courses,
    "teachers.jsonl": teachers,
    "relations.jsonl": relations,
    "exceptions.jsonl": exceptions,
  };
  await prepareOutput(outputRoot);
  const files: ArtifactManifest[] = [];
  for (const path of artifactNames) {
    const bytes = jsonLines(recordsByName[path]);
    await writeFile(join(outputRoot, path), bytes);
    files.push({ path, records: recordsByName[path].length, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const manifestContent = {
    schemaVersion: DERIVATION_SCHEMA_VERSION,
    captureBatchId: captureManifest.batchId,
    captureManifestContentSha256: captureManifest.manifestContentSha256,
    status: exceptions.length ? "derived_with_exceptions" as const : "derived" as const,
    files,
  };
  const manifest: DerivationManifest = { ...manifestContent, contentSha256: sha256(stableJson(manifestContent)) };
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
