import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validateCapturePackage, type CaptureQuery } from "./capture-package";
import { cellValue, mapColumns, parseCourseCell, tableGrid } from "./parse-table";
import {
  CATALOG_MATCH_SCHEMA_VERSION,
  COURSE_SCHEMA_VERSION,
  DERIVATION_SCHEMA_VERSION,
  EXCEPTION_SCHEMA_VERSION,
  compareText,
  sha256,
  stableJson,
} from "./shared";

export interface ProgramPlanHours {
  total: string;
  lecture: string;
  experiment: string;
  practice: string;
  other: string;
  weekly: string;
}

export interface ProgramPlanCourseRecord {
  schemaVersion: typeof COURSE_SCHEMA_VERSION;
  recordId: string;
  grade: string;
  departmentCode: string;
  departmentName: string;
  majorCode: string;
  majorName: string;
  studyKind: "主修";
  courseCode: string;
  courseName: string;
  credits: string;
  categoryText: string;
  courseStatus: string;
  examMethod: string;
  suggestedTerm: string;
  hours: ProgramPlanHours;
  provenance: { queryId: string; page: number; row: number };
}

export type ExceptionCode =
  | "GBK_DECODE_ERROR"
  | "UNKNOWN_TABLE_STRUCTURE"
  | "MISSING_COURSE_CODE"
  | "PARSED_RECORD_COUNT_MISMATCH";

export interface ProgramPlanException {
  schemaVersion: typeof EXCEPTION_SCHEMA_VERSION;
  code: ExceptionCode;
  queryId: string;
  page: number;
  row?: number;
  detail: string;
}

export interface CatalogMatchRecord {
  schemaVersion: typeof CATALOG_MATCH_SCHEMA_VERSION;
  courseCode: string;
  status: "matched" | "unmatched" | "unchecked";
}

export interface ArtifactManifest {
  path: string;
  records: number;
  bytes: number;
  sha256: string;
}

export interface DerivationManifest {
  schemaVersion: typeof DERIVATION_SCHEMA_VERSION;
  captureBatchId: string;
  captureManifestContentSha256: string;
  status: "derived" | "derived_with_exceptions";
  files: ArtifactManifest[];
  contentSha256: string;
}

function decodeGbk(bytes: Uint8Array) {
  try {
    return new TextDecoder("gbk").decode(bytes);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "GBK decode failed");
  }
}

function recordId(grade: string, majorCode: string, courseCode: string, suggestedTerm: string) {
  return `${grade}:${majorCode}:${courseCode}:${suggestedTerm}`;
}

function hoursOf(row: string[], columns: NonNullable<ReturnType<typeof mapColumns>>): ProgramPlanHours {
  return {
    total: cellValue(row, columns.hoursTotal),
    lecture: cellValue(row, columns.hoursLecture),
    experiment: cellValue(row, columns.hoursExperiment),
    practice: cellValue(row, columns.hoursPractice),
    other: cellValue(row, columns.hoursOther),
    weekly: cellValue(row, columns.hoursWeekly),
  };
}

function sortCourses(left: ProgramPlanCourseRecord, right: ProgramPlanCourseRecord) {
  return compareText(left.recordId, right.recordId) || compareText(left.provenance.queryId, right.provenance.queryId);
}

export async function deriveProgramPlan(
  captureRoot: string,
  outputRoot: string,
  options: { catalogCourseCodes?: Iterable<string> } = {},
): Promise<DerivationManifest> {
  const capture = await validateCapturePackage(captureRoot);
  const queryLines = (await readFile(join(captureRoot, "queries.jsonl"), "utf8")).trim().split("\n").filter(Boolean);
  const queries = queryLines.map((line) => JSON.parse(line) as CaptureQuery);
  const courses: ProgramPlanCourseRecord[] = [];
  const exceptions: ProgramPlanException[] = [];
  const seen = new Map<string, ProgramPlanCourseRecord>();

  for (const query of queries) {
    if (query.status !== "complete") continue;
    for (let page = 1; page <= query.pageCount; page += 1) {
      const bytes = await readFile(join(captureRoot, `snapshots/${query.queryId}/page-${String(page).padStart(4, "0")}.html`));
      let html: string;
      try {
        html = decodeGbk(bytes);
      } catch (error) {
        exceptions.push({
          schemaVersion: EXCEPTION_SCHEMA_VERSION,
          code: "GBK_DECODE_ERROR",
          queryId: query.queryId,
          page,
          detail: error instanceof Error ? error.message : "GBK decode failed",
        });
        continue;
      }
      const grid = tableGrid(html);
      const columns = grid ? mapColumns(grid.headers) : undefined;
      if (!grid || !columns) {
        exceptions.push({
          schemaVersion: EXCEPTION_SCHEMA_VERSION,
          code: "UNKNOWN_TABLE_STRUCTURE",
          queryId: query.queryId,
          page,
          detail: "The theoretical-course table does not contain 学年学期 and 课程 columns.",
        });
        continue;
      }
      let parsedRows = 0;
      for (const [index, row] of grid.rows.entries()) {
        parsedRows += 1;
        const course = parseCourseCell(cellValue(row, columns.course));
        if (!course) {
          exceptions.push({
            schemaVersion: EXCEPTION_SCHEMA_VERSION,
            code: "MISSING_COURSE_CODE",
            queryId: query.queryId,
            page,
            row: index + 1,
            detail: cellValue(row, columns.course) || "empty course cell",
          });
          continue;
        }
        const suggestedTerm = cellValue(row, columns.term);
        const id = recordId(query.dimensions.grade, query.dimensions.majorCode, course.courseCode, suggestedTerm);
        const record: ProgramPlanCourseRecord = {
          schemaVersion: COURSE_SCHEMA_VERSION,
          recordId: id,
          grade: query.dimensions.grade,
          departmentCode: query.dimensions.departmentCode,
          departmentName: query.dimensions.departmentName,
          majorCode: query.dimensions.majorCode,
          majorName: query.dimensions.majorName,
          studyKind: "主修",
          courseCode: course.courseCode,
          courseName: course.courseName,
          credits: cellValue(row, columns.credits),
          categoryText: cellValue(row, columns.category),
          courseStatus: cellValue(row, columns.status),
          examMethod: cellValue(row, columns.exam),
          suggestedTerm,
          hours: hoursOf(row, columns),
          provenance: { queryId: query.queryId, page, row: index + 1 },
        };
        const existing = seen.get(id);
        if (!existing) {
          seen.set(id, record);
          courses.push(record);
        }
      }
      if (query.pageCount === 1 && parsedRows !== query.declaredRecordCount && query.declaredRecordCount > 0) {
        exceptions.push({
          schemaVersion: EXCEPTION_SCHEMA_VERSION,
          code: "PARSED_RECORD_COUNT_MISMATCH",
          queryId: query.queryId,
          page,
          detail: `expected ${query.declaredRecordCount}, parsed ${parsedRows}`,
        });
      }
    }
  }

  courses.sort(sortCourses);
  exceptions.sort((left, right) => compareText(`${left.queryId}:${left.page}:${left.row ?? 0}:${left.code}`, `${right.queryId}:${right.page}:${right.row ?? 0}:${right.code}`));

  const catalog = options.catalogCourseCodes ? new Set(options.catalogCourseCodes) : undefined;
  const uniqueCodes = [...new Set(courses.map((course) => course.courseCode))].sort(compareText);
  const matches: CatalogMatchRecord[] = uniqueCodes.map((courseCode) => ({
    schemaVersion: CATALOG_MATCH_SCHEMA_VERSION,
    courseCode,
    status: catalog ? (catalog.has(courseCode) ? "matched" : "unmatched") : "unchecked",
  }));

  const files = [
    ["courses.jsonl", courses],
    ["exceptions.jsonl", exceptions],
    ["catalog-match.jsonl", matches],
  ] as const;
  await mkdir(outputRoot, { recursive: true });
  if ((await readdir(outputRoot)).length) throw new Error("derivation output directory must be empty");
  const artifacts: ArtifactManifest[] = [];
  for (const [path, records] of files) {
    const bytes = Buffer.from(records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
    await writeFile(join(outputRoot, path), bytes);
    artifacts.push({ path, records: records.length, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  const manifestContent = {
    schemaVersion: DERIVATION_SCHEMA_VERSION,
    captureBatchId: capture.batchId,
    captureManifestContentSha256: capture.manifestContentSha256,
    status: exceptions.length ? "derived_with_exceptions" as const : "derived" as const,
    files: artifacts,
  };
  const manifest: DerivationManifest = { ...manifestContent, contentSha256: sha256(stableJson(manifestContent)) };
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
