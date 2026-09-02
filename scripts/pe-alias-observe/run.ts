/**
 * Read-only PE alias observation snapshot.
 *
 *   pnpm observe:pe-alias -- --print-sql
 *   pnpm observe:pe-alias -- --local
 *   pnpm observe:pe-alias -- --remote
 */
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  createWranglerJsonCommand,
  executeReadOnlyD1Sql,
  parseWorkerDeploymentRecords,
  resultRows,
  type WorkerDeploymentRecord,
} from "../pe-mapping-audit/execute";
import {
  analyticsDatasetName,
  buildAliasAnalyticsFreshnessSql,
  buildAliasAnalyticsSql,
  buildAliasAnalyticsWindowTotalsSql,
  PE_ALIAS_ANALYTICS_ACCOUNT_ID,
  queryAnalyticsEngineSql,
  resolveAnalyticsToken,
} from "./analytics";
import {
  buildAliasMetrics,
  buildPeAliasObserveReport,
  formatPeAliasObserveMarkdown,
  matchDeploySha,
  PE_ALIAS_OBSERVE_DATA_SCOPE,
  resolveObservationWindow,
  toObserveDeploy,
  type GithubDeployRun,
  type PeAliasObserveReport,
} from "./report";
import {
  assertReadOnlyObserveSql,
  buildPeAliasObserveSql,
  PE_ALIAS_OBSERVE_WRITE_TABLES,
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

async function readDeploySha(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const result = await execFileAsync("git", ["rev-parse", "origin/main"], {
    cwd: process.cwd(),
  });
  const sha = result.stdout.trim();
  if (!sha) throw new Error("无法读取 origin/main SHA");
  return sha;
}

async function readWorkerDeployments(
  explicitJson?: string,
): Promise<WorkerDeploymentRecord[]> {
  if (explicitJson) return parseWorkerDeploymentRecords(explicitJson);
  try {
    const command = createWranglerJsonCommand(["deployments", "list", "--json"]);
    const result = await execFileAsync(command.executable, command.args, {
      cwd: process.cwd(),
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseWorkerDeploymentRecords(result.stdout || result.stderr);
  } catch {
    return [];
  }
}

async function readGithubDeployRuns(): Promise<GithubDeployRun[]> {
  try {
    const result = await execFileAsync(
      "gh",
      [
        "run",
        "list",
        "--workflow=deploy.yml",
        "--limit",
        "30",
        "--json",
        "headSha,updatedAt,conclusion",
      ],
      { cwd: process.cwd(), timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed: unknown = JSON.parse(result.stdout || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      if (typeof row.headSha !== "string" || typeof row.updatedAt !== "string") {
        return [];
      }
      return [
        {
          headSha: row.headSha,
          updatedAt: row.updatedAt,
          conclusion: typeof row.conclusion === "string" ? row.conclusion : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

function analyticsToken(explicit?: string): string {
  return resolveAnalyticsToken(explicit);
}

export function reportFromQueryBatches(
  batches: Array<{ results?: unknown[] }>,
  meta: {
    queriedAt: string;
    windowStart: string;
    windowEnd: string | null;
    cycleComplete: boolean;
    deploySha: string;
    workerVersion?: string | null;
    deployments: PeAliasObserveReport["deployments"];
    alias: PeAliasObserveReport["alias"];
  },
): PeAliasObserveReport {
  const expected = PE_ALIAS_OBSERVE_WRITE_TABLES.length + 1;
  if (batches.length !== 2 && batches.length !== expected) {
    throw new Error(`观察查询应返回 2 或 ${expected} 组结果，实际 ${batches.length}`);
  }
  const writeRows =
    batches.length === 2
      ? asRecordRows(resultRows(batches[0]))
      : batches.slice(0, -1).flatMap((batch) => asRecordRows(resultRows(batch)));
  return buildPeAliasObserveReport({
    queriedAt: meta.queriedAt,
    windowStart: meta.windowStart,
    windowEnd: meta.windowEnd,
    cycleComplete: meta.cycleComplete,
    deploySha: meta.deploySha,
    workerVersion: meta.workerVersion,
    deployments: meta.deployments,
    writeRows,
    discoveredTables: resultRows(batches.at(-1)),
    alias: meta.alias,
    dataScope: PE_ALIAS_OBSERVE_DATA_SCOPE,
  });
}

export async function runPeAliasObserve(argv = process.argv.slice(2)): Promise<{
  sql: string;
  report?: PeAliasObserveReport;
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
      "end-sha": { type: "string" },
      "queried-at": { type: "string" },
      "window-start": { type: "string" },
      "window-end": { type: "string" },
      "worker-version": { type: "string" },
      "deployments-json": { type: "string" },
      "analytics-token": { type: "string" },
      "skip-analytics": { type: "boolean", default: false },
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

  const queriedAt = values["queried-at"] || new Date().toISOString();
  const deployments =
    values["deployments-json"] || values.remote || values.local
      ? await readWorkerDeployments(values["deployments-json"])
      : [];
  const window = resolveObservationWindow(deployments, queriedAt, {
    windowStart: values["window-start"],
    windowEnd: values["window-end"],
  });
  const sql = buildPeAliasObserveSql(window.windowStart, window.sqlWindowEnd);
  assertReadOnlyObserveSql(sql);
  if (values["print-sql"] || (!values.remote && !values.local)) {
    if (values.output) await writeFile(values.output, `${sql}\n`, "utf8");
    return { sql, printed: sql };
  }

  const [batches, githubRuns, originSha] = await Promise.all([
    executeReadOnlyD1Sql({
      sql,
      remote: Boolean(values.remote),
      assertSql: assertReadOnlyObserveSql,
    }),
    readGithubDeployRuns(),
    readDeploySha(values["deploy-sha"]),
  ]);
  const startSha =
    matchDeploySha(window.start?.createdOn, githubRuns) ??
    values["deploy-sha"] ??
    null;
  const endSha =
    matchDeploySha(window.end?.createdOn, githubRuns) ??
    values["end-sha"] ??
    null;
  const latestSha = matchDeploySha(window.latest?.createdOn, githubRuns);
  const deploySha = startSha ?? originSha;
  const workerVersion =
    values["worker-version"] || window.start?.versionId || window.latest?.versionId || null;

  const dataset = analyticsDatasetName("production");
  let alias = buildAliasMetrics({
    source: "unavailable",
    dataset,
    error: "analytics_skipped",
  });
  if (!values["skip-analytics"]) {
    const token = analyticsToken(values["analytics-token"]);
    const bounds = {
      dataset,
      windowStart: window.windowStart,
      windowEnd: window.sqlWindowEnd,
    };
    const [events, totals, freshness] = await Promise.all([
      queryAnalyticsEngineSql({
        accountId: PE_ALIAS_ANALYTICS_ACCOUNT_ID,
        token,
        sql: buildAliasAnalyticsSql(bounds),
      }),
      queryAnalyticsEngineSql({
        accountId: PE_ALIAS_ANALYTICS_ACCOUNT_ID,
        token,
        sql: buildAliasAnalyticsWindowTotalsSql(bounds),
      }),
      queryAnalyticsEngineSql({
        accountId: PE_ALIAS_ANALYTICS_ACCOUNT_ID,
        token,
        sql: buildAliasAnalyticsFreshnessSql(dataset),
      }),
    ]);
    alias = events.ok
      ? buildAliasMetrics({
          source: "analytics_engine",
          dataset,
          rows: events.rows,
          windowStart: window.windowStart,
          windowTotals: totals.ok ? totals.rows : [],
          freshness: freshness.ok ? freshness.rows : [],
          error: totals.ok && freshness.ok ? undefined : "analytics_engine_coverage_incomplete",
        })
      : buildAliasMetrics({
          source: "unavailable",
          dataset,
          error: events.error,
        });
  }

  const report = reportFromQueryBatches(batches, {
    queriedAt,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    cycleComplete: window.cycleComplete,
    deploySha,
    workerVersion,
    deployments: {
      start: toObserveDeploy(window.start, startSha),
      end: toObserveDeploy(window.end, endSha),
      latest: toObserveDeploy(window.latest, latestSha),
    },
    alias,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const markdown = `${formatPeAliasObserveMarkdown(report)}\n`;
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
  const { printed } = await runPeAliasObserve();
  process.stdout.write(printed);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
