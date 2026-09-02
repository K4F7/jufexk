/**
 * Historical PE queue closeout.
 *
 *   pnpm closeout:pe-queue -- --print-sql
 *   pnpm closeout:pe-queue -- --remote
 *   pnpm closeout:pe-queue -- --remote --apply
 *
 * SELECT first, then write explicit per-row INSERT/UPDATE. Never d1 export.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  collectRowEvidence,
  formatPeQueueCloseoutMarkdown,
  parsePeQueueDisposition,
  proposeHistoricalDisposition,
  publicPeSkillLabel,
  type PeCloseoutEvidenceItem,
  type PeQueueRow,
  type ProposedPeDisposition,
  HISTORICAL_CLOSEOUT_ACTOR,
  PE_QUEUE_CLOSEOUT_REPORT_SCHEMA,
} from "../../src/lib/pe-queue-closeout";
import {
  createWranglerD1ExecuteCommand,
  createWranglerD1ExecuteFileCommand,
  parseWranglerD1ExecuteJson,
  resultRows,
} from "../pe-mapping-audit/execute";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chunkStatements } from "../cta-sync/apply-remote";
import {
  assertCloseoutSelectSql,
  buildDispositionWriteSql,
  buildPeQueueCloseoutSelectSql,
} from "./sql";

const execFileAsync = promisify(execFile);

function asRecordRows(rows: unknown[]): Array<Record<string, unknown>> {
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`D1 行 ${index} 不是对象`);
    }
    return row as Record<string, unknown>;
  });
}

function asInt(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) throw new Error(`invalid integer ${field}`);
  return n;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`invalid string ${field}`);
  return value;
}

function asText(value: unknown): string {
  return value == null ? "" : String(value);
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length ? text : null;
}

function parseQueueRow(row: Record<string, unknown>): PeQueueRow {
  return {
    courseId: asInt(row.course_id, "course_id"),
    teacherId: asInt(row.teacher_id, "teacher_id"),
    courseCode: asString(row.course_code, "course_code"),
    courseName: asString(row.course_name, "course_name"),
    sourceTeacherLabel: asString(row.source_teacher_label, "source_teacher_label"),
    reason: asString(row.reason, "reason"),
    disposition: parsePeQueueDisposition(row.disposition),
    dispositionReason: "",
    disposedBy: "",
    disposedAt: null,
  };
}

function skillItem(
  kind: PeCloseoutEvidenceItem["kind"],
  row: Record<string, unknown>,
  mappedSpecialization?: string | null,
): PeCloseoutEvidenceItem | null {
  const courseName = asText(row.course_name);
  const teacher = asText(row.source_teacher_label).trim();
  const specialization = mappedSpecialization || publicPeSkillLabel(courseName);
  if (!specialization || !teacher) return null;
  return {
    kind,
    specialization,
    sourceCourseCode: asText(row.course_code),
    sourceCourseName: courseName,
    sourceTeacherLabel: teacher,
  };
}

export function proposalsFromQueryBatches(
  batches: Array<{ results?: unknown[] }>,
): ProposedPeDisposition[] {
  if (batches.length < 4) throw new Error(`收口查询应返回至少 4 组结果，实际 ${batches.length}`);
  const queueRows = asRecordRows(resultRows(batches[0])).map(parseQueueRow);
  const mappings = asRecordRows(resultRows(batches[1]));
  const historical = asRecordRows(resultRows(batches[2]))
    .map((row) => skillItem("historical_visible_binding", row))
    .filter((item): item is PeCloseoutEvidenceItem => item != null);
  const offerings = asRecordRows(resultRows(batches[3]))
    .map((row) => skillItem("offering_skill_name", row))
    .filter((item): item is PeCloseoutEvidenceItem => item != null);
  const openRows = queueRows.filter((row) => !row.disposition);
  return openRows.map((row) => {
    const own = mappings.filter(
      (mapping) =>
        asInt(mapping.course_id, "course_id") === row.courseId &&
        asInt(mapping.teacher_id, "teacher_id") === row.teacherId,
    );
    const siblings = mappings.filter(
      (mapping) =>
        asInt(mapping.teacher_id, "teacher_id") === row.teacherId &&
        mapping.source_kind === "direct_skill" &&
        asInt(mapping.course_id, "course_id") !== row.courseId,
    );
    return proposeHistoricalDisposition({
      row,
      evidence: collectRowEvidence({
        row,
        existingMappings: own
          .map((mapping) => skillItem("existing_mapping", mapping, asString(mapping.normalized_specialization, "normalized_specialization")))
          .filter((item): item is PeCloseoutEvidenceItem => item != null),
        siblingMappings: siblings
          .map((mapping) => skillItem("catalog_course_name", mapping, asString(mapping.normalized_specialization, "normalized_specialization")))
          .filter((item): item is PeCloseoutEvidenceItem => item != null),
        historicalBindings: historical,
        offeringSkills: offerings,
      }),
    });
  });
}

async function executeSql(sql: string, remote: boolean) {
  const command = createWranglerD1ExecuteCommand({ sql, remote });
  const result = await execFileAsync(command.executable, command.args, {
    cwd: process.cwd(),
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return parseWranglerD1ExecuteJson(result.stdout || result.stderr || "");
}

async function executeSqlFile(sql: string, remote: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "pe-queue-closeout-"));
  const file = join(dir, "batch.sql");
  await writeFile(file, `${sql}\n`, "utf8");
  try {
    const command = createWranglerD1ExecuteFileCommand({ file, remote });
    const result = await execFileAsync(command.executable, command.args, {
      cwd: process.cwd(),
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseWranglerD1ExecuteJson(result.stdout || result.stderr || "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runPeQueueCloseout(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      remote: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      "print-sql": { type: "boolean", default: false },
      output: { type: "string" },
    },
  });
  const sql = buildPeQueueCloseoutSelectSql();
  assertCloseoutSelectSql(sql);
  if (values["print-sql"] || !values.remote) {
    if (values.output) await writeFile(values.output, `${sql}\n`, "utf8");
    return { sql, printed: sql };
  }
  const batches = await executeSql(sql, true);
  const proposals = proposalsFromQueryBatches(batches);
  const report = {
    schemaVersion: PE_QUEUE_CLOSEOUT_REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    liveEnqueueEnabled: false,
    counts: {
      mapped: proposals.filter((item) => item.disposition === "mapped").length,
      withheld: proposals.filter((item) => item.disposition === "withheld_permanent_exception").length,
      conflict: proposals.filter((item) => item.disposition === "conflict_recapture").length,
      open: 0,
    },
    allDisposed: true,
    items: proposals.map((item) => ({
      courseCode: item.courseCode,
      courseName: item.courseName,
      sourceTeacherLabel: item.sourceTeacherLabel,
      disposition: item.disposition,
      specialization: item.specialization,
      reason: item.reason,
    })),
  };
  const markdown = formatPeQueueCloseoutMarkdown(report);
  let applied = 0;
  if (values.apply) {
    const writes = buildDispositionWriteSql(proposals, HISTORICAL_CLOSEOUT_ACTOR);
    for (const chunk of chunkStatements(writes)) {
      await executeSqlFile(chunk, true);
    }
    applied = writes.length;
  }
  const printed = `${JSON.stringify({ report, applied, apply: Boolean(values.apply) }, null, 2)}\n\n${markdown}`;
  if (values.output) await writeFile(values.output, printed, "utf8");
  return { sql, proposals, report, printed, applied };
}

async function main() {
  const { printed } = await runPeQueueCloseout();
  process.stdout.write(printed);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
