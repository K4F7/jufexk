/**
 * Read-only PE specialization mapping coverage audit.
 *
 *   pnpm audit:pe-mapping -- --print-sql
 *   pnpm audit:pe-mapping -- --local
 *   pnpm audit:pe-mapping -- --remote
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  createWranglerJsonCommand,
  executePeMappingAuditSql,
  parseWorkerVersionId,
  resultRows,
} from "./execute";
import {
  PE_MAPPING_AUDIT_DATA_SCOPE,
  buildPeMappingAuditReport,
  formatPeMappingAuditMarkdown,
  parseMappingRowCount,
  type PeMappingAuditReport,
} from "./report";
import { assertReadOnlySelectSql, buildPeMappingAuditSql } from "./sql";

const execFileAsync = promisify(execFile);

function asRecordRows(rows: unknown[]): Array<Record<string, unknown>> {
  return rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`D1 行 ${index} 不是对象`);
    }
    return row as Record<string, unknown>;
  });
}

async function readDeploySha(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const result = await execFileAsync("git", ["rev-parse", "origin/main"], {
    cwd: process.cwd(),
  });
  const sha = result.stdout.trim();
  if (!sha) throw new Error("无法读取 origin/main SHA");
  return sha;
}

async function readWorkerVersionId(explicit?: string): Promise<string | null> {
  if (explicit) return explicit;
  try {
    const command = createWranglerJsonCommand(["deployments", "list", "--json"]);
    const result = await execFileAsync(command.executable, command.args, {
      cwd: process.cwd(),
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseWorkerVersionId(result.stdout || result.stderr);
  } catch {
    return null;
  }
}

export function reportFromQueryBatches(
  batches: Array<{ results?: unknown[] }>,
  meta: {
    auditedAt: string;
    deploySha: string;
    workerVersionId?: string | null;
  },
): PeMappingAuditReport {
  if (batches.length < 3) {
    throw new Error(`审计查询应返回 3 组结果，实际 ${batches.length}`);
  }
  const expectedRows = asRecordRows(resultRows(batches[0]));
  const queueRows = asRecordRows(resultRows(batches[1]));
  const mappingRows = parseMappingRowCount(asRecordRows(resultRows(batches[2])));
  return buildPeMappingAuditReport({
    expectedRows,
    queueRows,
    mappingRows,
    meta: {
      ...meta,
      dataScope: PE_MAPPING_AUDIT_DATA_SCOPE,
    },
  });
}

export async function runPeMappingAudit(argv = process.argv.slice(2)): Promise<{
  sql: string;
  report?: PeMappingAuditReport;
  printed: string;
}> {
  const { values } = parseArgs({
    args: argv,
    options: {
      remote: { type: "boolean", default: false },
      local: { type: "boolean", default: false },
      "print-sql": { type: "boolean", default: false },
      format: { type: "string", default: "both" },
      "deploy-sha": { type: "string" },
      "audited-at": { type: "string" },
      "worker-version": { type: "string" },
      output: { type: "string" },
    },
  });
  const format = values.format ?? "both";
  if (format !== "json" && format !== "markdown" && format !== "both") {
    throw new Error("--format 只支持 json、markdown、both");
  }
  if (values.remote && values.local) {
    throw new Error("--remote 与 --local 不能同时使用");
  }

  const sql = buildPeMappingAuditSql();
  assertReadOnlySelectSql(sql);
  if (values["print-sql"] || (!values.remote && !values.local)) {
    if (values.output) await writeFile(values.output, `${sql}\n`, "utf8");
    return { sql, printed: sql };
  }

  const batches = await executePeMappingAuditSql({ sql, remote: Boolean(values.remote) });
  const report = reportFromQueryBatches(batches, {
    auditedAt: values["audited-at"] || new Date().toISOString(),
    deploySha: await readDeploySha(values["deploy-sha"]),
    workerVersionId: await readWorkerVersionId(values["worker-version"]),
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = `${formatPeMappingAuditMarkdown(report)}\n`;
  const printed =
    format === "json" ? json : format === "markdown" ? markdown : `${json}\n${markdown}`;
  if (values.output) {
    const output = values.output;
    const payload = /\.json$/i.test(output) ? json : /\.md$/i.test(output) ? markdown : printed;
    await writeFile(output, payload, "utf8");
    if (format !== "json" && /\.json$/i.test(output)) {
      await writeFile(output.replace(/\.json$/i, ".md"), markdown, "utf8");
    }
  }
  return { sql, report, printed };
}

async function main() {
  const { printed } = await runPeMappingAudit();
  process.stdout.write(printed);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
