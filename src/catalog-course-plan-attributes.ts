export class CoursePlanAttributeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type CoursePlanAttributeItem = {
  courseCode: string;
  credits?: number | null;
  department?: string;
  enrollmentCategory?: string;
  teachingType?: string;
  courseLevel?: string;
};

export type CoursePlanAttributeResult = {
  received: number;
  updated: number;
  missing: string[];
};

const MAX_ITEMS = 200;
const COURSE_CODE_MAX = 100;

const asText = (value: unknown, max: number) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new CoursePlanAttributeError("课程方案字段必须是文本");
  return value.normalize("NFC").trim().slice(0, max);
};

const asCredits = (value: unknown) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const credits = Number(value);
  if (!Number.isFinite(credits) || credits < 0)
    throw new CoursePlanAttributeError("学分必须是非负数字");
  return credits;
};

export function parseCoursePlanAttributeItems(
  raw: unknown,
): CoursePlanAttributeItem[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new CoursePlanAttributeError("缺少课程方案属性列表");
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items) || !items.length)
    throw new CoursePlanAttributeError("课程方案属性列表不能为空");
  if (items.length > MAX_ITEMS)
    throw new CoursePlanAttributeError(`单次最多 ${MAX_ITEMS} 门课`);
  const parsed: CoursePlanAttributeItem[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new CoursePlanAttributeError(`第 ${index + 1} 条无效`);
    const row = item as Record<string, unknown>;
    if (row.courseCode !== undefined && typeof row.courseCode !== "string")
      throw new CoursePlanAttributeError("课程方案字段必须是文本");
    const courseCode =
      typeof row.courseCode === "string"
        ? row.courseCode.normalize("NFC").trim()
        : "";
    if (!courseCode)
      throw new CoursePlanAttributeError(`第 ${index + 1} 条缺少课号`);
    if (courseCode.length > COURSE_CODE_MAX)
      throw new CoursePlanAttributeError(`第 ${index + 1} 条课号过长`);
    if (seen.has(courseCode))
      throw new CoursePlanAttributeError(`课号重复：${courseCode}`);
    seen.add(courseCode);
    parsed.push({
      courseCode,
      credits: asCredits(row.credits),
      department: asText(row.department, 80),
      enrollmentCategory: asText(row.enrollmentCategory, 40),
      teachingType: asText(row.teachingType, 40),
      courseLevel: asText(row.courseLevel, 80),
    });
  }
  return parsed;
}

export async function applyCoursePlanAttributes(
  db: D1Database,
  items: CoursePlanAttributeItem[],
): Promise<CoursePlanAttributeResult> {
  const codes = items.map((item) => item.courseCode);
  const existing = new Map<string, number>();
  const chunkSize = 80;
  for (let offset = 0; offset < codes.length; offset += chunkSize) {
    const chunk = codes.slice(offset, offset + chunkSize);
    const { results } = await db
      .prepare(
        `SELECT id,code FROM courses WHERE code IN (${chunk
          .map(() => "?")
          .join(",")})`,
      )
      .bind(...chunk)
      .all<{ id: number; code: string }>();
    for (const row of results) existing.set(row.code, row.id);
  }
  const missing = items
    .filter((item) => !existing.has(item.courseCode))
    .map((item) => item.courseCode);
  const present = items.filter((item) => existing.has(item.courseCode));
  if (!present.length) return { received: items.length, updated: 0, missing };

  const statements = present.map((item) => {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    if (item.department !== undefined) {
      sets.push("department=?");
      values.push(item.department);
    }
    if (item.credits !== undefined) {
      sets.push("credits=?");
      values.push(item.credits);
    }
    if (item.enrollmentCategory !== undefined) {
      sets.push("enrollment_category=?");
      values.push(item.enrollmentCategory);
    }
    if (item.teachingType !== undefined) {
      sets.push("teaching_type=?");
      values.push(item.teachingType);
    }
    if (item.courseLevel !== undefined) {
      sets.push("course_level=?");
      values.push(item.courseLevel);
    }
    if (!sets.length)
      throw new CoursePlanAttributeError(`课号 ${item.courseCode} 没有可更新字段`);
    values.push(item.courseCode);
    return db
      .prepare(`UPDATE courses SET ${sets.join(",")} WHERE code=?`)
      .bind(...values);
  });
  await db.batch(statements);
  return { received: items.length, updated: present.length, missing };
}
