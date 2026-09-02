import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { toUtcDateTimeLiteral, VIRTUAL_PE_OBSERVE_IDS } from "./sql";

export const PE_ALIAS_ANALYTICS_ACCOUNT_ID = "fa1d0d91a980d4e2c22ac7272f038bf8";
export const PE_ALIAS_ANALYTICS_SQL_PATH = (accountId: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;

export const ALIAS_ANALYTICS_DEFINITION =
  "Workers Analytics Engine dataset jufexk_events：blob1=事件名，blob3=courseId。旧 alias 计 blob3 IN ('800001','800002')。review_view 只在课程×教师点评列表成功渲染后由客户端 beacon 打一次；没有 HTTP 状态码，无法从 BI 计算失败率。计数 SUM(_sample_interval)，必须带时间窗。窗口必须被 dataset 最新时间覆盖，否则访问量不能当作观察证据。";

const DATASET_NAME = /^(jufexk_events|jufexk_events_preview)$/;
const ACCOUNT_ID = /^[a-f0-9]{32}$/i;

export function analyticsDatasetName(surface?: string) {
  return surface === "preview" ? "jufexk_events_preview" : "jufexk_events";
}

function assertDataset(dataset: string): string {
  if (!DATASET_NAME.test(dataset)) throw new Error(`invalid analytics dataset: ${dataset}`);
  return dataset;
}

function windowClause(windowStart: string, windowEnd: string): string {
  const start = toUtcDateTimeLiteral(windowStart);
  const end = toUtcDateTimeLiteral(windowEnd);
  return `timestamp >= toDateTime('${start}') AND timestamp < toDateTime('${end}')`;
}

export function buildAliasAnalyticsSql(input: {
  dataset?: string;
  windowStart: string;
  windowEnd: string;
}): string {
  const dataset = assertDataset(input.dataset ?? analyticsDatasetName("production"));
  const ids = VIRTUAL_PE_OBSERVE_IDS.map((id) => `'${id}'`).join(", ");
  return `SELECT blob1 AS event, blob3 AS course_id, SUM(_sample_interval) AS n
FROM ${dataset}
WHERE ${windowClause(input.windowStart, input.windowEnd)}
  AND blob3 IN (${ids})
GROUP BY event, course_id
ORDER BY event, course_id`;
}

export function buildAliasAnalyticsWindowTotalsSql(input: {
  dataset?: string;
  windowStart: string;
  windowEnd: string;
}): string {
  const dataset = assertDataset(input.dataset ?? analyticsDatasetName("production"));
  return `SELECT blob1 AS event, SUM(_sample_interval) AS n
FROM ${dataset}
WHERE ${windowClause(input.windowStart, input.windowEnd)}
GROUP BY event
ORDER BY event`;
}

export function buildAliasAnalyticsFreshnessSql(dataset?: string): string {
  const name = assertDataset(dataset ?? analyticsDatasetName("production"));
  return `SELECT min(timestamp) AS first_ts, max(timestamp) AS last_ts, SUM(_sample_interval) AS n
FROM ${name}
WHERE timestamp >= NOW() - INTERVAL '30' DAY`;
}

export function wranglerConfigCandidates(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string[] {
  const paths: string[] = [];
  if (env.XDG_CONFIG_HOME) {
    paths.push(join(env.XDG_CONFIG_HOME, ".wrangler/config/default.toml"));
  }
  paths.push(join(home, ".config/.wrangler/config/default.toml"));
  paths.push(join(home, ".wrangler/config/default.toml"));
  if (env.APPDATA) {
    paths.push(join(env.APPDATA, "xdg.config/.wrangler/config/default.toml"));
    paths.push(join(env.APPDATA, ".wrangler/config/default.toml"));
  }
  return paths;
}

export function readWranglerOauthToken(options?: {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  readFile?: (path: string) => string;
}): string | null {
  const readFile = options?.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  for (const path of wranglerConfigCandidates(options?.env, options?.homedir ?? homedir())) {
    try {
      const text = readFile(path);
      const match = /oauth_token\s*=\s*"([^"]+)"/.exec(text);
      if (match?.[1]) return match[1];
    } catch {
      /* missing config is not an error */
    }
  }
  return null;
}

export function resolveAnalyticsToken(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.BI_ANALYTICS_READ_TOKEN?.trim() ||
    process.env.CLOUDFLARE_API_TOKEN?.trim() ||
    readWranglerOauthToken() ||
    ""
  );
}

export type AnalyticsEngineQueryResult =
  | { ok: true; rows: unknown[] }
  | { ok: false; status: number; error: string };

export async function queryAnalyticsEngineSql(options: {
  accountId?: string;
  token?: string | null;
  sql: string;
  fetchImpl?: typeof fetch;
}): Promise<AnalyticsEngineQueryResult> {
  const accountId = (options.accountId ?? PE_ALIAS_ANALYTICS_ACCOUNT_ID).trim();
  const token = options.token?.trim() ?? "";
  if (!ACCOUNT_ID.test(accountId)) {
    return { ok: false, status: 0, error: "invalid_account_id" };
  }
  if (!token) {
    return { ok: false, status: 0, error: "analytics_token_missing" };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(PE_ALIAS_ANALYTICS_SQL_PATH(accountId), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: options.sql,
    });
  } catch {
    return { ok: false, status: 0, error: "analytics_engine_network" };
  }
  if (!response.ok) {
    const status = response.status;
    const error =
      status === 401 || status === 403
        ? "analytics_engine_unauthorized"
        : `analytics_engine_sql:${status}`;
    return { ok: false, status, error };
  }
  let payload: { data?: unknown };
  try {
    payload = (await response.json()) as { data?: unknown };
  } catch {
    return { ok: false, status: response.status, error: "analytics_engine_invalid_json" };
  }
  return { ok: true, rows: Array.isArray(payload.data) ? payload.data : [] };
}
