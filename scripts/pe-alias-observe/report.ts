import type { WorkerDeploymentRecord } from "../pe-mapping-audit/execute";
import { ALIAS_ANALYTICS_DEFINITION } from "./analytics";
import {
  PE_ALIAS_OBSERVE_WRITE_TABLES,
  VIRTUAL_PE_OBSERVE_IDS,
  type PeAliasObserveTableKind,
} from "./sql";

export const PE_ALIAS_OBSERVE_SCHEMA = "pe-alias-observe/v1" as const;

/** First production Worker deploy that contains both #841 and #842. */
export const PE_ALIAS_RC_DEPLOY_NOT_BEFORE = "2026-09-01T22:14:00.000Z";

export const PE_ALIAS_OBSERVE_DATA_SCOPE =
  "生产 D1 数据库 jufexk（wrangler database_name=jufexk）中关注、推荐等写表的 800001/800002 计数，以及 Workers Analytics Engine jufexk_events 中 blob3 为这两个旧 alias 的 beacon。观察只读 SELECT/WITH，不读取评价正文、Cookie、CAS 凭据或学生身份，不执行 d1 export 或任何 INSERT/UPDATE/DELETE。";

export const ANALYTICS_VS_D1_GAPS = [
  "Analytics Engine 只记录客户端 beacon（blob1=review_view/review_dwell，blob3=courseId）；D1 记录关注/推荐等写表的 course_id。二者不是同一事件。",
  "公开展示 pe:<专项> 的详情页 Number(id) 为 NaN，不会打 review_view；旧数字 alias 800001/800002 才会进入 Analytics blob3。",
  "Analytics Engine 没有 HTTP 状态码，无法从 BI 计算 alias 请求失败率；review_view 只覆盖成功渲染后的 beacon。",
  "映射成功的关注/推荐写入来源 Relation 的 course_id，不会在 D1 写表中显示为 800001/800002。",
  "瑜伽/武术未映射时 fallback 仍可能把关注/推荐写成 800001/800002。",
  "若 dataset 最新时间早于观察窗口，窗口内 0 次 alias beacon 不能当作访问量证据。",
] as const;

export type PeAliasObserveDeploy = {
  id: string | null;
  versionId: string | null;
  createdOn: string | null;
  sha: string | null;
};

export type PeAliasObserveWriteCount = {
  table: string;
  kind: PeAliasObserveTableKind;
  idColumn: string;
  totalRows: number;
  count800001: number;
  count800002: number;
  windowVirtual: number | null;
  window800001: number | null;
  window800002: number | null;
  firstVirtualAt: string | null;
  lastVirtualAt: string | null;
};

export type PeAliasObserveAliasEvent = {
  event: string;
  courseId: string;
  n: number;
};

export type PeAliasObserveAliasCoverage = {
  windowEventCount: number | null;
  datasetFirstTs: string | null;
  datasetLastTs: string | null;
  datasetEventCount30d: number | null;
  windowCovered: boolean;
};

export type PeAliasObserveAliasMetrics = {
  source: "analytics_engine" | "unavailable";
  dataset: string | null;
  configured: boolean;
  error: string | null;
  events: PeAliasObserveAliasEvent[];
  requests: number;
  successes: number | null;
  failures: number | null;
  successRate: number | null;
  failureRate: number | null;
  successPercent: string | null;
  failurePercent: string | null;
  coverage: PeAliasObserveAliasCoverage;
  definition: string;
};

export type PeAliasObserveReport = {
  schemaVersion: typeof PE_ALIAS_OBSERVE_SCHEMA;
  readOnly: true;
  queriedAt: string;
  windowStart: string;
  windowEnd: string | null;
  cycleComplete: boolean;
  deploySha: string;
  workerVersion: string | null;
  workerVersionId: string | null;
  deployments: {
    start: PeAliasObserveDeploy | null;
    end: PeAliasObserveDeploy | null;
    latest: PeAliasObserveDeploy | null;
  };
  dataScope: string;
  writes: {
    tables: PeAliasObserveWriteCount[];
    userWriteVirtualLifetime: number;
    userWriteVirtualInWindow: number;
    noNewVirtualUserWrites: boolean;
  };
  discoveredCourseIdTables: string[];
  alias: PeAliasObserveAliasMetrics;
  analyticsVsD1: {
    definition: string;
    gaps: string[];
  };
  status: {
    cycleComplete: boolean;
    noNewVirtualUserWrites: boolean;
    aliasMetricsAvailable: boolean;
  };
};

export type GithubDeployRun = {
  headSha: string;
  updatedAt: string;
  conclusion?: string;
};

function asInt(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) throw new Error(`invalid integer ${field}: ${String(value)}`);
  return n;
}

function asNullableInt(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  return asInt(value, field);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`invalid string ${field}: ${String(value)}`);
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function asKind(value: unknown): PeAliasObserveTableKind {
  if (
    value === "user_write" ||
    value === "catalog" ||
    value === "precompute" ||
    value === "seed"
  ) {
    return value;
  }
  throw new Error(`invalid kind: ${String(value)}`);
}

export function toObserveDeploy(
  record: WorkerDeploymentRecord | null | undefined,
  sha?: string | null,
): PeAliasObserveDeploy | null {
  if (!record) return null;
  return {
    id: record.id,
    versionId: record.versionId,
    createdOn: record.createdOn,
    sha: sha ?? null,
  };
}

export function matchDeploySha(
  createdOn: string | null | undefined,
  runs: readonly GithubDeployRun[],
  maxDeltaMs = 5 * 60 * 1000,
): string | null {
  if (!createdOn) return null;
  const createdMs = Date.parse(createdOn);
  if (!Number.isFinite(createdMs)) return null;
  let best: { sha: string; dist: number } | null = null;
  for (const run of runs) {
    if (run.conclusion && run.conclusion !== "success") continue;
    const updatedMs = Date.parse(run.updatedAt);
    if (!Number.isFinite(updatedMs)) continue;
    const dist = Math.abs(updatedMs - createdMs);
    if (dist > maxDeltaMs) continue;
    if (!best || dist < best.dist) best = { sha: run.headSha, dist };
  }
  return best?.sha ?? null;
}

export function resolveObservationWindow(
  deployments: readonly WorkerDeploymentRecord[],
  queriedAt: string,
  overrides?: {
    windowStart?: string;
    windowEnd?: string | null;
  },
): {
  windowStart: string;
  windowEnd: string | null;
  cycleComplete: boolean;
  sqlWindowEnd: string;
  start: WorkerDeploymentRecord | null;
  end: WorkerDeploymentRecord | null;
  latest: WorkerDeploymentRecord | null;
} {
  const latest = deployments.at(-1) ?? null;
  if (overrides?.windowStart) {
    const windowStart = overrides.windowStart;
    const windowEnd =
      overrides.windowEnd === undefined ? null : overrides.windowEnd;
    const start =
      deployments.find((item) => item.createdOn === windowStart) ??
      deployments.find((item) => item.createdOnMs >= Date.parse(windowStart)) ??
      null;
    const startIndex = start ? deployments.indexOf(start) : -1;
    const end =
      windowEnd != null
        ? (deployments.find((item) => item.createdOn === windowEnd) ??
          (startIndex >= 0 ? (deployments[startIndex + 1] ?? null) : null))
        : startIndex >= 0
          ? (deployments[startIndex + 1] ?? null)
          : null;
    const resolvedEnd = windowEnd ?? end?.createdOn ?? null;
    return {
      windowStart,
      windowEnd: resolvedEnd,
      cycleComplete: Boolean(resolvedEnd),
      sqlWindowEnd: resolvedEnd ?? queriedAt,
      start,
      end,
      latest,
    };
  }
  const minMs = Date.parse(PE_ALIAS_RC_DEPLOY_NOT_BEFORE);
  const start = deployments.find((item) => item.createdOnMs >= minMs) ?? null;
  if (!start) {
    return {
      windowStart: PE_ALIAS_RC_DEPLOY_NOT_BEFORE,
      windowEnd: null,
      cycleComplete: false,
      sqlWindowEnd: queriedAt,
      start: null,
      end: null,
      latest,
    };
  }
  const startIndex = deployments.indexOf(start);
  const end = deployments[startIndex + 1] ?? null;
  const windowEnd = end?.createdOn ?? null;
  return {
    windowStart: start.createdOn ?? PE_ALIAS_RC_DEPLOY_NOT_BEFORE,
    windowEnd,
    cycleComplete: Boolean(windowEnd),
    sqlWindowEnd: windowEnd ?? queriedAt,
    start,
    end,
    latest,
  };
}

export function parseWriteCountRow(
  row: Record<string, unknown>,
): PeAliasObserveWriteCount {
  return {
    table: asString(row.table_name, "table_name"),
    kind: asKind(row.kind),
    idColumn: asString(row.id_column, "id_column"),
    totalRows: asInt(row.total_rows, "total_rows"),
    count800001: asInt(row.count_800001, "count_800001"),
    count800002: asInt(row.count_800002, "count_800002"),
    windowVirtual: asNullableInt(row.window_virtual, "window_virtual"),
    window800001: asNullableInt(row.window_800001, "window_800001"),
    window800002: asNullableInt(row.window_800002, "window_800002"),
    firstVirtualAt: asNullableString(row.first_virtual_at),
    lastVirtualAt: asNullableString(row.last_virtual_at),
  };
}

export function parseAeDateTime(value: unknown): string | null {
  const text = asNullableString(value);
  if (!text) return null;
  const iso = text.includes("T") ? text : `${text.replace(" ", "T")}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : text;
}

export function parseAliasWindowEventCount(rows: unknown[]): number {
  return rows.reduce<number>((sum, row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`analytics window row ${index} 不是对象`);
    }
    return sum + asInt((row as Record<string, unknown>).n, "n");
  }, 0);
}

export function parseAliasFreshness(rows: unknown[]): {
  firstTs: string | null;
  lastTs: string | null;
  n: number | null;
} {
  const row = rows[0];
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { firstTs: null, lastTs: null, n: 0 };
  }
  const record = row as Record<string, unknown>;
  return {
    firstTs: parseAeDateTime(record.first_ts),
    lastTs: parseAeDateTime(record.last_ts),
    n: asNullableInt(record.n, "n"),
  };
}

export function aliasWindowCovered(input: {
  windowStart: string;
  windowEventCount: number | null;
  datasetLastTs: string | null;
}): boolean {
  if ((input.windowEventCount ?? 0) > 0) return true;
  if (!input.datasetLastTs) return false;
  const lastMs = Date.parse(input.datasetLastTs);
  const startMs = Date.parse(input.windowStart);
  return Number.isFinite(lastMs) && Number.isFinite(startMs) && lastMs >= startMs;
}

export function parseAliasAnalyticsRows(
  rows: unknown[],
): PeAliasObserveAliasEvent[] {
  const allowed = new Set(VIRTUAL_PE_OBSERVE_IDS.map(String));
  return rows
    .map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`analytics row ${index} 不是对象`);
      }
      const record = row as Record<string, unknown>;
      const courseId = String(record.course_id ?? "");
      const n = asInt(record.n, "n");
      return {
        event: asString(record.event, "event"),
        courseId,
        n,
      };
    })
    .filter((row) => allowed.has(row.courseId))
    .sort((left, right) => {
      const event = left.event.localeCompare(right.event);
      if (event) return event;
      return left.courseId.localeCompare(right.courseId);
    });
}

export function buildAliasMetrics(input: {
  source: "analytics_engine" | "unavailable";
  dataset?: string | null;
  error?: string | null;
  rows?: unknown[];
  windowStart?: string;
  windowTotals?: unknown[];
  freshness?: unknown[];
}): PeAliasObserveAliasMetrics {
  const events =
    input.source === "analytics_engine" && input.rows
      ? parseAliasAnalyticsRows(input.rows)
      : [];
  const requests = events
    .filter((row) => row.event === "review_view")
    .reduce((sum, row) => sum + row.n, 0);
  const freshness = input.freshness
    ? parseAliasFreshness(input.freshness)
    : { firstTs: null, lastTs: null, n: null };
  const windowEventCount =
    input.windowTotals != null ? parseAliasWindowEventCount(input.windowTotals) : null;
  const windowCovered =
    input.source === "analytics_engine" && !input.error
      ? aliasWindowCovered({
          windowStart: input.windowStart ?? "",
          windowEventCount,
          datasetLastTs: freshness.lastTs,
        })
      : false;
  const configured = input.source === "analytics_engine";
  const error =
    input.error ??
    (configured && !windowCovered ? "analytics_engine_window_uncovered" : null);
  return {
    source: input.source,
    dataset: input.dataset ?? null,
    configured,
    error,
    events,
    requests,
    successes: configured && !error ? requests : null,
    failures: null,
    successRate: null,
    failureRate: null,
    successPercent: null,
    failurePercent: null,
    coverage: {
      windowEventCount,
      datasetFirstTs: freshness.firstTs,
      datasetLastTs: freshness.lastTs,
      datasetEventCount30d: freshness.n,
      windowCovered,
    },
    definition: ALIAS_ANALYTICS_DEFINITION,
  };
}

export function buildPeAliasObserveReport(input: {
  queriedAt: string;
  windowStart: string;
  windowEnd: string | null;
  cycleComplete: boolean;
  deploySha: string;
  workerVersion?: string | null;
  deployments: {
    start: PeAliasObserveDeploy | null;
    end: PeAliasObserveDeploy | null;
    latest: PeAliasObserveDeploy | null;
  };
  writeRows: Array<Record<string, unknown>>;
  discoveredTables: unknown[];
  alias: PeAliasObserveAliasMetrics;
  dataScope?: string;
}): PeAliasObserveReport {
  const tables = input.writeRows.map(parseWriteCountRow);
  const expected = PE_ALIAS_OBSERVE_WRITE_TABLES.map((spec) => spec.table);
  if (tables.map((row) => row.table).join("\0") !== expected.join("\0")) {
    throw new Error(
      `写表计数顺序应为 ${expected.join(", ")}，实际 ${tables.map((row) => row.table).join(", ")}`,
    );
  }
  const userWrites = tables.filter((row) => row.kind === "user_write");
  const userWriteVirtualLifetime = userWrites.reduce(
    (sum, row) => sum + row.count800001 + row.count800002,
    0,
  );
  const userWriteVirtualInWindow = userWrites.reduce(
    (sum, row) => sum + (row.windowVirtual ?? 0),
    0,
  );
  const discoveredCourseIdTables = input.discoveredTables.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`discovery row ${index} 不是对象`);
    }
    return asString((row as Record<string, unknown>).table_name, "table_name");
  });
  const noNewVirtualUserWrites = userWriteVirtualInWindow === 0;
  const aliasMetricsAvailable =
    input.alias.source === "analytics_engine" &&
    !input.alias.error &&
    input.alias.coverage.windowCovered;
  const workerVersion =
    input.workerVersion ?? input.deployments.start?.versionId ?? null;
  return {
    schemaVersion: PE_ALIAS_OBSERVE_SCHEMA,
    readOnly: true,
    queriedAt: input.queriedAt,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    cycleComplete: input.cycleComplete,
    deploySha: input.deploySha,
    workerVersion,
    workerVersionId: workerVersion,
    deployments: input.deployments,
    dataScope: input.dataScope ?? PE_ALIAS_OBSERVE_DATA_SCOPE,
    writes: {
      tables,
      userWriteVirtualLifetime,
      userWriteVirtualInWindow,
      noNewVirtualUserWrites,
    },
    discoveredCourseIdTables,
    alias: input.alias,
    analyticsVsD1: {
      definition:
        "Analytics 计旧数字 alias 页成功渲染 beacon；D1 计写表中的虚拟课程 id。映射后的写入与 pe:<专项> 浏览都不在同一口径。",
      gaps: [...ANALYTICS_VS_D1_GAPS],
    },
    status: {
      cycleComplete: input.cycleComplete,
      noNewVirtualUserWrites,
      aliasMetricsAvailable,
    },
  };
}

function formatDeploy(label: string, deploy: PeAliasObserveDeploy | null): string {
  if (!deploy) return `- ${label}: （无）`;
  return [
    `- ${label}:`,
    `  - id: ${deploy.id ?? "（无）"}`,
    `  - version: ${deploy.versionId ?? "（无）"}`,
    `  - created_on: ${deploy.createdOn ?? "（无）"}`,
    `  - sha: ${deploy.sha ?? "（未匹配）"}`,
  ].join("\n");
}

function formatRate(value: string | null): string {
  return value ?? "（无法从 Analytics Engine 计算）";
}

export function formatPeAliasObserveMarkdown(report: PeAliasObserveReport): string {
  const writeRows = report.writes.tables
    .map(
      (row) =>
        `| ${row.table} | ${row.kind} | ${row.count800001} | ${row.count800002} | ${row.window800001 ?? "—"} | ${row.window800002 ?? "—"} | ${row.windowVirtual ?? "—"} | ${row.firstVirtualAt ?? "—"} | ${row.lastVirtualAt ?? "—"} |`,
    )
    .join("\n");
  const aliasEvents = report.alias.events.length
    ? report.alias.events
        .map((row) => `- ${row.event} / ${row.courseId}: ${row.n}`)
        .join("\n")
    : "- （无）";
  const counted = new Set(report.writes.tables.map((row) => row.table));
  const uncounted = report.discoveredCourseIdTables.filter((name) => !counted.has(name));
  return [
    "# 生产旧 alias 观察快照",
    "",
    `- 查询时间: ${report.queriedAt}`,
    `- 窗口起: ${report.windowStart}`,
    `- 窗口止: ${report.windowEnd ?? "（仍开放，未到下一生产 Worker 部署）"}`,
    `- 完整发布周期: ${report.cycleComplete ? "是" : "否"}`,
    `- 窗口内部署 SHA: ${report.deploySha}`,
    `- Worker version: ${report.workerVersion ?? "（未取得）"}`,
    `- 只读: ${report.readOnly ? "是" : "否"}`,
    `- schema: ${report.schemaVersion}`,
    "",
    "## 数据范围",
    "",
    report.dataScope,
    "",
    "## 部署",
    "",
    formatDeploy("窗口起始部署（含 #841/#842）", report.deployments.start),
    formatDeploy("窗口结束部署（下一生产 Worker）", report.deployments.end),
    formatDeploy("当前最新部署", report.deployments.latest),
    "",
    "## 写表中的 800001/800002",
    "",
    `- 用户写表窗口内新增虚拟身份: ${report.writes.userWriteVirtualInWindow}`,
    `- 用户写表生命周期虚拟身份: ${report.writes.userWriteVirtualLifetime}`,
    `- 窗口内无新增旧虚拟身份: ${report.writes.noNewVirtualUserWrites ? "是" : "否"}`,
    "",
    "| 表 | 类型 | 800001 | 800002 | 窗口 800001 | 窗口 800002 | 窗口合计 | 首次 | 最近 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    writeRows,
    "",
    "用户写表：relation_follows、relation_recommendations、reviews、catalog_requests。窗口计数按 created_at/imported_at；无时间列的表窗口列为 —。",
    "",
    "## 含 course_id 的其它表（仅表名）",
    "",
    uncounted.length ? uncounted.map((name) => `- ${name}`).join("\n") : "- （无）",
    "",
    "## 旧 alias 访问",
    "",
    `- 来源: ${report.alias.source}`,
    `- dataset: ${report.alias.dataset ?? "（无）"}`,
    `- 可用: ${report.status.aliasMetricsAvailable ? "是" : "否"}`,
    `- 错误: ${report.alias.error ?? "（无）"}`,
    `- 访问量（review_view）: ${report.alias.requests}`,
    `- 成功: ${report.alias.successes ?? "（无）"}`,
    `- 失败: ${report.alias.failures ?? "（无）"}`,
    `- 成功率: ${formatRate(report.alias.successPercent)}`,
    `- 失败率: ${formatRate(report.alias.failurePercent)}`,
    `- 窗口内全部 BI 事件: ${report.alias.coverage.windowEventCount ?? "（无）"}`,
    `- dataset 30 日最早: ${report.alias.coverage.datasetFirstTs ?? "（无）"}`,
    `- dataset 30 日最晚: ${report.alias.coverage.datasetLastTs ?? "（无）"}`,
    `- dataset 30 日事件: ${report.alias.coverage.datasetEventCount30d ?? "（无）"}`,
    `- 窗口被 AE 覆盖: ${report.alias.coverage.windowCovered ? "是" : "否"}`,
    "",
    report.alias.definition,
    "",
    "事件：",
    aliasEvents,
    "",
    "## Analytics 与 D1 口径差异",
    "",
    report.analyticsVsD1.definition,
    "",
    ...report.analyticsVsD1.gaps.map((gap) => `- ${gap}`),
    "",
    "## 关闭门槛",
    "",
    `- 完整发布周期: ${report.status.cycleComplete ? "是" : "否"}`,
    `- 窗口内无新增旧虚拟身份写入: ${report.status.noNewVirtualUserWrites ? "是" : "否"}`,
    `- alias 指标可用: ${report.status.aliasMetricsAvailable ? "是" : "否"}`,
    "",
  ].join("\n");
}
