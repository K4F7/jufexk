import {
  HISTORICAL_CLOSEOUT_ACTOR,
  type ProposedPeDisposition,
} from "../../src/lib/pe-queue-closeout";

const WRITE_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|TRUNCATE|REPLACE)\b/i;
const FORBIDDEN_COLUMN =
  /\b(comment|pending_review_json|submitter_hash|cookie|jsessionid|castgc|student_id|cas_subject)\b/i;

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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
    out += ch;
  }
  return out;
}

export function assertCloseoutSelectSql(sql: string): void {
  const trimmed = sql.trim();
  if (!trimmed) throw new Error("收口 SELECT 为空");
  const stripped = stripSqlStringsAndComments(trimmed);
  if (WRITE_KEYWORD.test(stripped)) {
    throw new Error("收口证据查询必须只读");
  }
  if (FORBIDDEN_COLUMN.test(stripped)) {
    throw new Error("收口证据查询不得读取评价正文、Cookie 或学生身份");
  }
  const statements = stripped
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    if (!/^(WITH|SELECT)\b/i.test(statement)) {
      throw new Error(`收口证据查询只允许 SELECT/WITH: ${statement.slice(0, 80)}`);
    }
  }
}

export function buildPeQueueCloseoutSelectSql(): string {
  const sql = `SELECT
  q.course_id AS course_id,
  q.teacher_id AS teacher_id,
  q.course_code AS course_code,
  q.course_name AS course_name,
  q.source_teacher_label AS source_teacher_label,
  q.reason AS reason,
  q.disposition AS disposition
FROM catalog_pe_specialization_review_queue q
ORDER BY q.course_code, q.source_teacher_label, q.course_id, q.teacher_id;
SELECT
  m.course_id AS course_id,
  m.teacher_id AS teacher_id,
  c.code AS course_code,
  c.name AS course_name,
  t.source_teacher_label AS source_teacher_label,
  m.source_kind AS source_kind,
  m.normalized_specialization AS normalized_specialization
FROM catalog_relation_pe_specializations m
JOIN courses c ON c.id = m.course_id
JOIN teachers t ON t.id = m.teacher_id
ORDER BY c.code, t.source_teacher_label;
SELECT
  phr.teacher_id AS teacher_id,
  t.source_teacher_label AS source_teacher_label,
  c.code AS course_code,
  c.name AS course_name
FROM public_historical_reviews phr
JOIN courses c ON c.id = phr.course_id
JOIN teachers t ON t.id = phr.teacher_id;
SELECT
  o.catalog_teacher_id AS teacher_id,
  o.teacher_source_label AS source_teacher_label,
  o.course_code AS course_code,
  o.course_name AS course_name
FROM jwxt_sync_offerings o
WHERE o.status = 'active';
SELECT live_enqueue_enabled AS live_enqueue_enabled
FROM catalog_pe_specialization_queue_state
WHERE singleton = 1`;
  assertCloseoutSelectSql(sql);
  return sql;
}

export function buildDispositionWriteSql(
  proposals: ProposedPeDisposition[],
  actor = HISTORICAL_CLOSEOUT_ACTOR,
): string[] {
  const statements: string[] = [];
  for (const proposal of proposals) {
    if (proposal.disposition === "mapped" && proposal.mapping) {
      const evidence = JSON.stringify(proposal.mapping.evidence);
      statements.push(
        `INSERT OR IGNORE INTO catalog_relation_pe_specializations(course_id,teacher_id,source_kind,normalized_specialization,display_semantics,evidence_json) VALUES(${proposal.courseId},${proposal.teacherId},${sqlString(proposal.mapping.sourceKind)},${sqlString(proposal.mapping.normalizedSpecialization)},${sqlString(proposal.mapping.displaySemantics)},${sqlString(evidence)})`,
      );
    }
    statements.push(
      `UPDATE catalog_pe_specialization_review_queue SET disposition=${sqlString(proposal.disposition)},disposition_reason=${sqlString(proposal.reason)},disposition_evidence_json=${sqlString(JSON.stringify(proposal.evidence))},disposed_by=${sqlString(actor)},disposed_at=CURRENT_TIMESTAMP WHERE course_id=${proposal.courseId} AND teacher_id=${proposal.teacherId} AND disposition IS NULL`,
    );
  }
  return statements;
}
