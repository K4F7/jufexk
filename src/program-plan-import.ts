import {
  PROGRAM_PLAN_RECORD_SCHEMA,
  programPlanRowKey,
  type ProgramPlanCourse,
} from "./lib/program-plan";

export class ProgramPlanImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type ProgramPlanImportResult = {
  received: number;
  upserted: number;
  matchedCatalog: number;
};

const MAX_RECORDS = 20_000;
const TEXT_MAX = {
  grade: 16,
  departmentCode: 32,
  departmentName: 80,
  majorCode: 32,
  majorName: 80,
  courseCode: 40,
  courseName: 200,
  categoryPath: 200,
  courseStanding: 80,
  assessment: 40,
  suggestedTerm: 80,
};

function asText(value: unknown, max: number, label: string) {
  if (typeof value !== "string") throw new ProgramPlanImportError(`${label}必须是文本`);
  const text = value.normalize("NFC").trim();
  if (!text) throw new ProgramPlanImportError(`${label}不能为空`);
  if (text.length > max) throw new ProgramPlanImportError(`${label}过长`);
  return text;
}

function asOptionalText(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ProgramPlanImportError(`${label}必须是文本`);
  return value.normalize("NFC").trim().slice(0, max);
}

function asHours(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) throw new ProgramPlanImportError(`${label}必须是非负数字`);
  return hours;
}

function parseRecord(raw: unknown, index: number): ProgramPlanCourse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProgramPlanImportError(`第 ${index + 1} 条无效`);
  }
  const row = raw as Record<string, unknown>;
  if (row.schemaVersion !== PROGRAM_PLAN_RECORD_SCHEMA) {
    throw new ProgramPlanImportError(`第 ${index + 1} 条 schema 不受支持`);
  }
  if (row.studyKind !== "主修") {
    throw new ProgramPlanImportError(`第 ${index + 1} 条只接受主修`);
  }
  return {
    schemaVersion: PROGRAM_PLAN_RECORD_SCHEMA,
    grade: asText(row.grade, TEXT_MAX.grade, "年级"),
    departmentCode: asOptionalText(row.departmentCode, TEXT_MAX.departmentCode, "院系代码"),
    departmentName: asOptionalText(row.departmentName, TEXT_MAX.departmentName, "院系"),
    majorCode: asText(row.majorCode, TEXT_MAX.majorCode, "专业代码"),
    majorName: asText(row.majorName, TEXT_MAX.majorName, "专业"),
    studyKind: "主修",
    courseCode: asText(row.courseCode, TEXT_MAX.courseCode, "课号"),
    courseName: asText(row.courseName, TEXT_MAX.courseName, "课名"),
    credits: asHours(row.credits, "学分"),
    categoryPath: asOptionalText(row.categoryPath, TEXT_MAX.categoryPath, "课程类别"),
    courseStanding: asOptionalText(row.courseStanding, TEXT_MAX.courseStanding, "课程地位"),
    assessment: asOptionalText(row.assessment, TEXT_MAX.assessment, "考核方式"),
    suggestedTerm: asText(row.suggestedTerm, TEXT_MAX.suggestedTerm, "学年学期"),
    totalHours: asHours(row.totalHours, "总学时"),
    lectureHours: asHours(row.lectureHours, "讲授学时"),
    labHours: asHours(row.labHours, "实验学时"),
    practiceHours: asHours(row.practiceHours, "实践学时"),
    otherHours: asHours(row.otherHours, "其它学时"),
    weeklyHours: asHours(row.weeklyHours, "周学时"),
    catalogCourseId: null,
  };
}

export function parseProgramPlanImportRecords(raw: unknown): ProgramPlanCourse[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProgramPlanImportError("缺少培养方案记录列表");
  }
  const records = (raw as { records?: unknown }).records;
  if (!Array.isArray(records) || !records.length) {
    throw new ProgramPlanImportError("培养方案记录列表不能为空");
  }
  if (records.length > MAX_RECORDS) {
    throw new ProgramPlanImportError(`单次最多 ${MAX_RECORDS} 条`);
  }
  const parsed: ProgramPlanCourse[] = [];
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    const item = parseRecord(record, index);
    const key = programPlanRowKey(item);
    if (seen.has(key)) throw new ProgramPlanImportError(`记录重复：${item.courseCode}`);
    seen.add(key);
    parsed.push(item);
  }
  return parsed;
}

export type ProgramPlanPublicRow = {
  courseCode: string;
  courseName: string;
  credits: number | null;
  categoryPath: string;
  courseStanding: string;
  suggestedTerm: string;
  catalogCourseId: number | null;
};

export async function applyProgramPlanImport(
  db: D1Database,
  records: ProgramPlanCourse[],
): Promise<ProgramPlanImportResult> {
  const codes = [...new Set(records.map((record) => record.courseCode))];
  const catalogIds = new Map<string, number>();
  const chunkSize = 80;
  for (let offset = 0; offset < codes.length; offset += chunkSize) {
    const chunk = codes.slice(offset, offset + chunkSize);
    const { results } = await db
      .prepare(
        `SELECT code, MIN(id) AS id FROM courses WHERE code IN (${chunk.map(() => "?").join(",")}) GROUP BY code`,
      )
      .bind(...chunk)
      .all<{ code: string; id: number }>();
    for (const row of results) catalogIds.set(row.code, row.id);
  }

  const statements = records.map((record) =>
    db
      .prepare(
        `INSERT INTO program_plan_courses (
           grade, department_code, department_name, major_code, major_name, study_kind,
           course_code, course_name, credits, category_path, course_standing, assessment,
           suggested_term, total_hours, lecture_hours, lab_hours, practice_hours, other_hours,
           weekly_hours, catalog_course_id, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(grade, major_code, course_code, suggested_term) DO UPDATE SET
           department_code=excluded.department_code,
           department_name=excluded.department_name,
           major_name=excluded.major_name,
           course_name=excluded.course_name,
           credits=excluded.credits,
           category_path=excluded.category_path,
           course_standing=excluded.course_standing,
           assessment=excluded.assessment,
           total_hours=excluded.total_hours,
           lecture_hours=excluded.lecture_hours,
           lab_hours=excluded.lab_hours,
           practice_hours=excluded.practice_hours,
           other_hours=excluded.other_hours,
           weekly_hours=excluded.weekly_hours,
           catalog_course_id=excluded.catalog_course_id,
           updated_at=CURRENT_TIMESTAMP`,
      )
      .bind(
        record.grade,
        record.departmentCode,
        record.departmentName,
        record.majorCode,
        record.majorName,
        record.studyKind,
        record.courseCode,
        record.courseName,
        record.credits,
        record.categoryPath,
        record.courseStanding,
        record.assessment,
        record.suggestedTerm,
        record.totalHours,
        record.lectureHours,
        record.labHours,
        record.practiceHours,
        record.otherHours,
        record.weeklyHours,
        catalogIds.get(record.courseCode) ?? null,
      ),
  );
  for (let offset = 0; offset < statements.length; offset += 40) {
    await db.batch(statements.slice(offset, offset + 40));
  }
  return {
    received: records.length,
    upserted: records.length,
    matchedCatalog: records.filter((record) => catalogIds.has(record.courseCode)).length,
  };
}

export async function listProgramPlanCourses(
  db: D1Database,
  grade: string,
  major: string,
): Promise<ProgramPlanPublicRow[]> {
  const { results } = await db
    .prepare(
      `SELECT
         p.course_code AS courseCode,
         p.course_name AS courseName,
         p.credits,
         p.category_path AS categoryPath,
         p.course_standing AS courseStanding,
         p.suggested_term AS suggestedTerm,
         COALESCE(p.catalog_course_id, (
           SELECT c.id FROM courses c WHERE c.code = p.course_code ORDER BY c.id LIMIT 1
         )) AS catalogCourseId
       FROM program_plan_courses p
       WHERE p.grade = ? AND (p.major_name = ? OR p.major_code = ?)
       ORDER BY p.suggested_term, p.course_code`,
    )
    .bind(grade, major, major)
    .all<ProgramPlanPublicRow>();
  return results;
}
