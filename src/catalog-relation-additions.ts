export const RELATION_ADDITION_CONTRACT = "legacy-issue111-relation-addition-v1";
export const RELATION_ADDITION_COUNT = 61;
const ACCEPTED_STATUSES = new Set([
  "package_ready_for_owner_review",
  "addition_requests_approved",
]);
const ARTIFACT_NAMES = [
  "catalog-addition-requests.jsonl",
  "relations.jsonl",
] as const;

export class CatalogRelationAdditionError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

export type RelationPair = {
  courseCode: string;
  teacherLabel: string;
};

export type RelationInspection = RelationPair & {
  courseExists: boolean;
  teacherExists: boolean;
  relationExists: boolean;
  ok: boolean;
};

export type RelationAdditionResult = {
  mode: "preview" | "apply";
  pairs: number;
  created: number;
  existing: number;
  coursesPresent: number;
  teachersPresent: number;
  relationsAbsent: number;
  relationsPresent: number;
  failures: Array<{
    courseCode: string;
    teacherLabel: string;
    reason: string;
  }>;
};

const digest = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const clean = (value: unknown, limit = 200) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

export function parseRelationPairs(rows: unknown[]): RelationPair[] {
  const pairs: RelationPair[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new CatalogRelationAdditionError(`任课关系第 ${index + 1} 行不是对象`);
    const record = row as Record<string, unknown>;
    const courseCode = clean(
      record.catalog_course_code ?? record.courseCode ?? record.course_code,
      100,
    );
    const teacherLabel = clean(
      record.catalog_teacher_label ??
        record.sourceTeacherLabel ??
        record.source_teacher_label ??
        record.teacher_label,
      200,
    );
    if (!courseCode || !teacherLabel)
      throw new CatalogRelationAdditionError(
        `任课关系第 ${index + 1} 行缺少课号或来源教师名`,
      );
    if (
      record.request_kind != null &&
      record.request_kind !== "relation"
    )
      throw new CatalogRelationAdditionError(
        `任课关系第 ${index + 1} 行不是 request_kind=relation`,
      );
    const key = `${courseCode}\0${teacherLabel}`;
    if (seen.has(key))
      throw new CatalogRelationAdditionError(
        `任课关系包含重复对: ${courseCode} × ${teacherLabel}`,
      );
    seen.add(key);
    pairs.push({ courseCode, teacherLabel });
  }
  return pairs;
}

export async function parseOfficialRelationPackage(
  manifestText: string,
  artifactText: string,
  configuredManifestSha256 = "manifest",
): Promise<RelationPair[]> {
  if (configuredManifestSha256 !== "manifest") {
    if ((await digest(manifestText)) !== configuredManifestSha256)
      throw new CatalogRelationAdditionError("任课关系补充包 manifest 哈希不匹配");
  }
  let manifest: {
    contract_version?: unknown;
    status?: unknown;
    counts?: { relations?: unknown };
    files?: Record<string, { rows?: unknown; sha256?: unknown }>;
  };
  try {
    manifest = JSON.parse(manifestText) as typeof manifest;
  } catch {
    throw new CatalogRelationAdditionError("任课关系补充包 manifest 不是有效 JSON");
  }
  if (
    manifest.contract_version !== RELATION_ADDITION_CONTRACT ||
    !ACCEPTED_STATUSES.has(String(manifest.status || "")) ||
    manifest.counts?.relations !== RELATION_ADDITION_COUNT
  )
    throw new CatalogRelationAdditionError("任课关系补充包契约、状态或计数不匹配");

  const artifactSha256 = await digest(artifactText);
  const artifactName = ARTIFACT_NAMES.find(
    (name) => manifest.files?.[name]?.sha256 === artifactSha256,
  );
  const descriptor = artifactName ? manifest.files?.[artifactName] : undefined;
  if (
    !descriptor ||
    descriptor.rows !== RELATION_ADDITION_COUNT ||
    descriptor.sha256 !== artifactSha256 ||
    !artifactText.endsWith("\n")
  )
    throw new CatalogRelationAdditionError(
      "任课关系补充包 artifact 哈希、行数或换行不匹配",
    );

  let rows: unknown[];
  try {
    rows = artifactText
      .slice(0, -1)
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    throw new CatalogRelationAdditionError("任课关系补充包 artifact 不是有效 JSONL");
  }
  const pairs = parseRelationPairs(rows);
  if (pairs.length !== RELATION_ADDITION_COUNT)
    throw new CatalogRelationAdditionError("任课关系补充包行数不匹配");
  return pairs;
}

export async function inspectRelationPairs(
  db: D1Database,
  pairs: RelationPair[],
): Promise<RelationInspection[]> {
  const inspected: RelationInspection[] = [];
  for (const pair of pairs) {
    const course = await db
      .prepare("SELECT id FROM courses WHERE code=?")
      .bind(pair.courseCode)
      .first<{ id: number }>();
    const teacher = await db
      .prepare("SELECT id FROM teachers WHERE source_teacher_label=?")
      .bind(pair.teacherLabel)
      .first<{ id: number }>();
    const relation =
      course && teacher
        ? await db
            .prepare(
              "SELECT 1 present FROM course_teachers WHERE course_id=? AND teacher_id=?",
            )
            .bind(course.id, teacher.id)
            .first()
        : null;
    const courseExists = Boolean(course);
    const teacherExists = Boolean(teacher);
    const relationExists = Boolean(relation);
    inspected.push({
      ...pair,
      courseExists,
      teacherExists,
      relationExists,
      ok: courseExists && teacherExists && !relationExists,
    });
  }
  return inspected;
}

function summarize(
  inspected: RelationInspection[],
  mode: "preview" | "apply",
  created: number,
  existing: number,
): RelationAdditionResult {
  const failures = inspected
    .filter((row) => !row.courseExists || !row.teacherExists)
    .map((row) => ({
      courseCode: row.courseCode,
      teacherLabel: row.teacherLabel,
      reason: !row.courseExists
        ? "课程不存在"
        : "教师不存在",
    }));
  return {
    mode,
    pairs: inspected.length,
    created,
    existing,
    coursesPresent: inspected.filter((row) => row.courseExists).length,
    teachersPresent: inspected.filter((row) => row.teacherExists).length,
    relationsAbsent: inspected.filter(
      (row) => row.courseExists && row.teacherExists && !row.relationExists,
    ).length,
    relationsPresent: inspected.filter((row) => row.relationExists).length,
    failures,
  };
}

export async function previewRelationAdditions(
  db: D1Database,
  pairs: RelationPair[],
): Promise<RelationAdditionResult> {
  if (!pairs.length)
    throw new CatalogRelationAdditionError("任课关系列表不能为空");
  return summarize(await inspectRelationPairs(db, pairs), "preview", 0, 0);
}

export async function applyRelationAdditions(
  db: D1Database,
  pairs: RelationPair[],
): Promise<RelationAdditionResult> {
  if (!pairs.length)
    throw new CatalogRelationAdditionError("任课关系列表不能为空");
  const inspected = await inspectRelationPairs(db, pairs);
  const missingIdentity = inspected.some(
    (row) => !row.courseExists || !row.teacherExists,
  );
  if (missingIdentity)
    throw new CatalogRelationAdditionError(
      "存在课程或教师身份缺失，整批停止",
    );
  const present = inspected.filter((row) => row.relationExists).length;
  const absent = inspected.length - present;
  if (present && absent)
    throw new CatalogRelationAdditionError(
      "任课关系部分已存在、部分缺失，整批停止",
    );
  if (present)
    return summarize(inspected, "apply", 0, present);

  const insertResults = await db.batch(
    pairs.map((pair) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO course_teachers(course_id,teacher_id)
           SELECT c.id,t.id FROM courses c CROSS JOIN teachers t
           WHERE c.code=? AND t.source_teacher_label=?
           RETURNING course_id,teacher_id`,
        )
        .bind(pair.courseCode, pair.teacherLabel),
    ),
  );
  const created = insertResults.reduce(
    (total, result) => total + result.results.length,
    0,
  );
  if (created !== pairs.length)
    throw new CatalogRelationAdditionError(
      "任课关系写入计数与预检不一致，已停止后续处理",
      409,
    );
  return summarize(inspected, "apply", created, 0);
}
