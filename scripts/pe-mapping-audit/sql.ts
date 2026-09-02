import {
  peDirectSkillNormalizedSql,
  peUmbrellaCourseNamePredicate,
} from "../../src/lib/pe-specialization-mapping";
import { VIRTUAL_PE_SPORTS } from "../../src/lib/public-course-presentation";

const WRITE_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|TRUNCATE|REPLACE)\b/i;
const FORBIDDEN_RELATION =
  /\b(reviews|review_comments|users|email_verifications|admin_student_bindings|cookies?|jsessionid|castgc|student_id)\b/i;

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function virtualPeSportLabelSql(alias = "t"): string {
  const branches = VIRTUAL_PE_SPORTS.flatMap((sport) =>
    (sport.teacherNames as readonly string[]).map(
      (name) =>
        `WHEN ${alias}.source_teacher_label = ${sqlStringLiteral(name)} THEN ${sqlStringLiteral(sport.label)}`,
    ),
  );
  return `CASE ${branches.join(" ")} ELSE NULL END`;
}

export function virtualPeSportIdSql(alias = "t"): string {
  const branches = VIRTUAL_PE_SPORTS.flatMap((sport) =>
    (sport.teacherNames as readonly string[]).map(
      (name) =>
        `WHEN ${alias}.source_teacher_label = ${sqlStringLiteral(name)} THEN ${sport.id}`,
    ),
  );
  return `CASE ${branches.join(" ")} ELSE NULL END`;
}

export function stripSqlStringsAndComments(sql: string): string {
  let out = "";
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") break;
        i += 1;
      }
      out += "''";
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
  }
  return out;
}

export function assertReadOnlySelectSql(sql: string): void {
  const trimmed = sql.trim();
  if (!trimmed) throw new Error("审计 SQL 为空");
  if (FORBIDDEN_RELATION.test(trimmed)) {
    throw new Error("审计 SQL 不得访问评价、用户身份或会话表");
  }
  const stripped = stripSqlStringsAndComments(trimmed);
  if (WRITE_KEYWORD.test(stripped)) {
    throw new Error("审计 SQL 必须只读，禁止 INSERT/UPDATE/DELETE/DROP/ALTER 等写语句");
  }
  const statements = stripped
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (!statements.length) throw new Error("审计 SQL 为空");
  for (const statement of statements) {
    if (!/^(WITH|SELECT)\b/i.test(statement)) {
      throw new Error(`审计 SQL 只允许 SELECT/WITH，收到: ${statement.slice(0, 80)}`);
    }
  }
}

export function buildExpectedPeSourceSelectSql(): string {
  const umbrella = peUmbrellaCourseNamePredicate("c");
  const family = peDirectSkillNormalizedSql("c");
  return `SELECT
  ct.course_id AS course_id,
  ct.teacher_id AS teacher_id,
  c.code AS course_code,
  c.name AS course_name,
  t.source_teacher_label AS source_teacher_label,
  CASE
    WHEN ${umbrella} THEN 'umbrella'
    ELSE 'direct_skill'
  END AS source_kind,
  CASE
    WHEN ${umbrella} THEN NULL
    ELSE (${family})
  END AS expected_family,
  m.normalized_specialization AS mapped_specialization,
  m.source_kind AS mapped_source_kind,
  CASE WHEN m.course_id IS NOT NULL THEN 1 ELSE 0 END AS is_mapped,
  CASE WHEN q.course_id IS NOT NULL THEN 1 ELSE 0 END AS in_queue,
  q.reason AS queue_reason,
  ${virtualPeSportLabelSql("t")} AS virtual_sport_label,
  ${virtualPeSportIdSql("t")} AS virtual_course_id
FROM course_teachers ct
JOIN courses c ON c.id = ct.course_id
JOIN teachers t ON t.id = ct.teacher_id
LEFT JOIN catalog_relation_pe_specializations m
  ON m.course_id = ct.course_id AND m.teacher_id = ct.teacher_id
LEFT JOIN catalog_pe_specialization_review_queue q
  ON q.course_id = ct.course_id AND q.teacher_id = ct.teacher_id
WHERE ${umbrella} OR (${family}) IS NOT NULL
ORDER BY c.code, t.source_teacher_label, ct.course_id, ct.teacher_id`;
}

export function buildReviewQueueSelectSql(): string {
  return `SELECT
  q.course_id AS course_id,
  q.teacher_id AS teacher_id,
  q.course_code AS course_code,
  q.course_name AS course_name,
  q.source_teacher_label AS source_teacher_label,
  q.reason AS reason
FROM catalog_pe_specialization_review_queue q
ORDER BY q.course_code, q.source_teacher_label, q.course_id, q.teacher_id`;
}

export function buildMappingCountSelectSql(): string {
  return `SELECT COUNT(*) AS mapping_rows FROM catalog_relation_pe_specializations`;
}

export function buildPeMappingAuditSql(): string {
  const sql = [
    buildExpectedPeSourceSelectSql(),
    buildReviewQueueSelectSql(),
    buildMappingCountSelectSql(),
  ].join(";\n");
  assertReadOnlySelectSql(sql);
  return sql;
}
