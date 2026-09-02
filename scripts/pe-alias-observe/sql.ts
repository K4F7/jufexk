import { VIRTUAL_PE_SPORTS } from "../../src/lib/public-course-presentation";
import { stripSqlStringsAndComments } from "../pe-mapping-audit/sql";

const WRITE_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|TRUNCATE|REPLACE|EXPORT)\b/i;
const FORBIDDEN_IDENTITY =
  /\b(users|email_verifications|admin_student_bindings|cookies?|jsessionid|castgc|student_id)\b/i;
const FORBIDDEN_BODY =
  /\b(comment|html|note|moderator_note|evidence_json|pending_review_json|response_json|bio|message)\b/i;
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

export const VIRTUAL_PE_OBSERVE_IDS = VIRTUAL_PE_SPORTS.map((sport) => sport.id);

export type PeAliasObserveTableKind =
  | "user_write"
  | "catalog"
  | "precompute"
  | "seed";

export type PeAliasObserveWriteTable = {
  table: string;
  kind: PeAliasObserveTableKind;
  idColumn: string;
  timeColumn: string | null;
};

export const PE_ALIAS_OBSERVE_WRITE_TABLES: readonly PeAliasObserveWriteTable[] = [
  {
    table: "relation_follows",
    kind: "user_write",
    idColumn: "course_id",
    timeColumn: "created_at",
  },
  {
    table: "relation_recommendations",
    kind: "user_write",
    idColumn: "course_id",
    timeColumn: "created_at",
  },
  {
    table: "reviews",
    kind: "user_write",
    idColumn: "course_id",
    timeColumn: "created_at",
  },
  {
    table: "catalog_requests",
    kind: "user_write",
    idColumn: "created_course_id",
    timeColumn: "created_at",
  },
  {
    table: "public_historical_reviews",
    kind: "catalog",
    idColumn: "course_id",
    timeColumn: "imported_at",
  },
  {
    table: "course_teachers",
    kind: "catalog",
    idColumn: "course_id",
    timeColumn: null,
  },
  {
    table: "public_review_counts",
    kind: "precompute",
    idColumn: "course_id",
    timeColumn: null,
  },
  {
    table: "public_relation_ratings",
    kind: "precompute",
    idColumn: "course_id",
    timeColumn: null,
  },
  {
    table: "virtual_pe_notification_courses",
    kind: "seed",
    idColumn: "virtual_course_id",
    timeColumn: null,
  },
  {
    table: "courses",
    kind: "catalog",
    idColumn: "id",
    timeColumn: "created_at",
  },
];

export function toUtcDateTimeLiteral(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`invalid datetime: ${iso}`);
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`invalid ${label}: ${value}`);
  return value;
}

export function assertReadOnlyObserveSql(sql: string): void {
  const trimmed = sql.trim();
  if (!trimmed) throw new Error("观察 SQL 为空");
  if (FORBIDDEN_IDENTITY.test(trimmed)) {
    throw new Error("观察 SQL 不得访问用户身份或会话表");
  }
  const stripped = stripSqlStringsAndComments(trimmed);
  if (WRITE_KEYWORD.test(stripped)) {
    throw new Error("观察 SQL 必须只读，禁止 INSERT/UPDATE/DELETE/DROP/ALTER/EXPORT 等写语句");
  }
  if (FORBIDDEN_BODY.test(stripped)) {
    throw new Error("观察 SQL 不得读取评价正文、备注或证据 JSON");
  }
  const statements = stripped
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (!statements.length) throw new Error("观察 SQL 为空");
  for (const statement of statements) {
    if (!/^(WITH|SELECT)\b/i.test(statement)) {
      throw new Error(`观察 SQL 只允许 SELECT/WITH，收到: ${statement.slice(0, 80)}`);
    }
  }
}

function virtualIdPredicate(column: string): string {
  return `${column} IN (${VIRTUAL_PE_OBSERVE_IDS.join(", ")})`;
}

function windowPredicate(timeColumn: string, windowStart: string, windowEnd: string): string {
  return `datetime(${timeColumn}) >= datetime(${sqlStringLiteral(toUtcDateTimeLiteral(windowStart))}) AND datetime(${timeColumn}) < datetime(${sqlStringLiteral(toUtcDateTimeLiteral(windowEnd))})`;
}

function writeTableSelectSql(
  spec: PeAliasObserveWriteTable,
  windowStart: string,
  windowEnd: string,
): string {
  const table = assertIdentifier(spec.table, "table");
  const idColumn = assertIdentifier(spec.idColumn, "idColumn");
  const timeColumn = spec.timeColumn
    ? assertIdentifier(spec.timeColumn, "timeColumn")
    : null;
  const id800001 = VIRTUAL_PE_OBSERVE_IDS[0];
  const id800002 = VIRTUAL_PE_OBSERVE_IDS[1];
  if (id800001 == null || id800002 == null) {
    throw new Error("VIRTUAL_PE_SPORTS 缺少 800001/800002");
  }
  const windowVirtual = timeColumn
    ? `IFNULL(SUM(CASE WHEN ${virtualIdPredicate(idColumn)} AND ${windowPredicate(timeColumn, windowStart, windowEnd)} THEN 1 ELSE 0 END), 0)`
    : "NULL";
  const window800001 = timeColumn
    ? `IFNULL(SUM(CASE WHEN ${idColumn} = ${id800001} AND ${windowPredicate(timeColumn, windowStart, windowEnd)} THEN 1 ELSE 0 END), 0)`
    : "NULL";
  const window800002 = timeColumn
    ? `IFNULL(SUM(CASE WHEN ${idColumn} = ${id800002} AND ${windowPredicate(timeColumn, windowStart, windowEnd)} THEN 1 ELSE 0 END), 0)`
    : "NULL";
  const firstVirtual = timeColumn
    ? `MIN(CASE WHEN ${virtualIdPredicate(idColumn)} THEN ${timeColumn} END)`
    : "NULL";
  const lastVirtual = timeColumn
    ? `MAX(CASE WHEN ${virtualIdPredicate(idColumn)} THEN ${timeColumn} END)`
    : "NULL";
  return `SELECT
  '${table}' AS table_name,
  '${spec.kind}' AS kind,
  '${idColumn}' AS id_column,
  COUNT(*) AS total_rows,
  IFNULL(SUM(CASE WHEN ${idColumn} = ${id800001} THEN 1 ELSE 0 END), 0) AS count_800001,
  IFNULL(SUM(CASE WHEN ${idColumn} = ${id800002} THEN 1 ELSE 0 END), 0) AS count_800002,
  ${windowVirtual} AS window_virtual,
  ${window800001} AS window_800001,
  ${window800002} AS window_800002,
  ${firstVirtual} AS first_virtual_at,
  ${lastVirtual} AS last_virtual_at
FROM ${table}`;
}

export function buildWriteTableCountSql(windowStart: string, windowEnd: string): string {
  toUtcDateTimeLiteral(windowStart);
  toUtcDateTimeLiteral(windowEnd);
  return PE_ALIAS_OBSERVE_WRITE_TABLES.map((spec) =>
    writeTableSelectSql(spec, windowStart, windowEnd),
  ).join(";\n");
}

export function buildCourseIdTableDiscoverySql(): string {
  return `SELECT name AS table_name
FROM sqlite_master
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
  AND name NOT LIKE '_cf_%'
  AND instr(lower(coalesce(sql, '')), 'course_id') > 0
ORDER BY name`;
}

export function buildPeAliasObserveSql(windowStart: string, windowEnd: string): string {
  const sql = [
    buildWriteTableCountSql(windowStart, windowEnd),
    buildCourseIdTableDiscoverySql(),
  ].join(";\n");
  assertReadOnlyObserveSql(sql);
  return sql;
}
