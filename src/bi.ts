import type { Context } from "hono";
import {
  hmacHex,
  resolveOrdinaryUser,
} from "./ordinary-user-authentication";
import { isOrdinaryUserAuthenticated, originOk } from "./ordinary-user-write-authorization";
import { readSecret } from "./secrets";
import type { AdminBiPayload } from "./lib/admin-bi";

const reject = (c: Context, error: string, status: 400 | 403 | 429 = 400) =>
  c.json({ error }, status);

export type { AdminBiPayload } from "./lib/admin-bi";

export const BI_BEACON_PATH = "/api/bi/beacon";
export const ADMIN_BI_PATH = "/api/admin/bi";

export const BI_EVENTS = [
  "review_view",
  "review_dwell",
  "login_view",
  "login_submit",
  "login_success",
  "login_fail",
] as const;
export type BiEvent = (typeof BI_EVENTS)[number];

export const BI_BEACON_EVENTS = ["review_view", "review_dwell", "login_view"] as const;
export type BiBeaconEvent = (typeof BI_BEACON_EVENTS)[number];

export const BI_ACTORS = ["guest", "user"] as const;
export type BiActor = (typeof BI_ACTORS)[number];

const BEACON_RATE_SECONDS = 60;
const BEACON_RATE_LIMIT = 60;
const DWELL_MS_MIN = 1000;
const DWELL_MS_MAX = 30 * 60 * 1000;

export type BiWriteEnv = {
  BI?: { writeDataPoint(event: AnalyticsEngineDataPoint): void };
  IP_HASH_SECRET?: string | { get(): Promise<string> };
  DB?: D1Database;
};

const isBiEvent = (value: string): value is BiEvent =>
  (BI_EVENTS as readonly string[]).includes(value);

const isBeaconEvent = (value: string): value is BiBeaconEvent =>
  (BI_BEACON_EVENTS as readonly string[]).includes(value);

const catalogId = (value: unknown): string => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9]\d{0,8})$/.test(value) && Number(value) > 0) {
    return value;
  }
  return "";
};

export function biDatasetName(surface: string | undefined) {
  return surface === "preview" ? "jufexk_events_preview" : "jufexk_events";
}

export async function biActor(c: Context): Promise<BiActor> {
  const user = await resolveOrdinaryUser(c);
  return user && isOrdinaryUserAuthenticated(user) ? "user" : "guest";
}

export function writeBiEvent(
  env: BiWriteEnv | undefined,
  event: BiEvent,
  fields: {
    actor: BiActor;
    courseId?: unknown;
    teacherId?: unknown;
    method?: string;
    durationMs?: number;
  },
) {
  if (!env?.BI) return;
  const duration =
    event === "review_dwell" &&
    typeof fields.durationMs === "number" &&
    Number.isFinite(fields.durationMs)
      ? Math.min(DWELL_MS_MAX, Math.max(0, Math.round(fields.durationMs)))
      : 0;
  if (event === "review_dwell" && duration < DWELL_MS_MIN) return;
  const method = typeof fields.method === "string" ? fields.method.slice(0, 32) : "";
  try {
    env.BI.writeDataPoint({
      blobs: [
        event,
        fields.actor,
        catalogId(fields.courseId),
        catalogId(fields.teacherId),
        method,
      ],
      doubles: [1, duration],
    });
  } catch {
    /* Analytics Engine writes are best-effort. */
  }
}

export async function trackLogin(
  c: Context,
  event: "login_submit" | "login_success" | "login_fail",
  method: string,
  actor?: BiActor,
) {
  writeBiEvent(c.env as BiWriteEnv, event, {
    actor: actor ?? (await biActor(c)),
    method,
  });
}

async function takeBeaconRateLimit(db: D1Database, key: string) {
  const result = await db
    .prepare(
      `INSERT INTO rate_limit_counters(key,window_start,count) VALUES(?,unixepoch(),1)
       ON CONFLICT(key) DO UPDATE SET
         count=CASE WHEN rate_limit_counters.window_start<=unixepoch()-? THEN 1 ELSE rate_limit_counters.count+1 END,
         window_start=CASE WHEN rate_limit_counters.window_start<=unixepoch()-? THEN unixepoch() ELSE rate_limit_counters.window_start END
       WHERE rate_limit_counters.window_start<=unixepoch()-? OR rate_limit_counters.count<?`,
    )
    .bind(key, BEACON_RATE_SECONDS, BEACON_RATE_SECONDS, BEACON_RATE_SECONDS, BEACON_RATE_LIMIT)
    .run();
  return (result.meta.changes || 0) === 1;
}

export async function handleBiBeacon(c: Context) {
  if (!originOk(c)) return reject(c, "来源校验失败", 403);
  const env = c.env as BiWriteEnv;
  const secret = await readSecret(env.IP_HASH_SECRET);
  if (secret && env.DB) {
    const ipHash = await hmacHex(c.req.header("CF-Connecting-IP") || "unknown", secret);
    if (!(await takeBeaconRateLimit(env.DB, `bi-beacon:${ipHash}`))) {
      return reject(c, "请求过于频繁，请稍后再试", 429);
    }
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await c.req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    return reject(c, "请求 JSON 格式错误");
  }
  const type = typeof body?.type === "string" ? body.type : "";
  if (!isBeaconEvent(type)) return reject(c, "事件无效");
  const ms = typeof body?.ms === "number" ? body.ms : undefined;
  writeBiEvent(env, type, {
    actor: await biActor(c),
    courseId: body?.courseId,
    teacherId: body?.teacherId,
    durationMs: ms,
  });
  return c.body(null, 204);
}

type AeEventRow = {
  event: string;
  actor: string;
  n: number | string;
  duration_ms_sum: number | string;
};

type AeTopRow = {
  course_id: string;
  teacher_id: string;
  views: number | string;
};

const asNumber = (value: number | string | undefined) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

async function queryAnalyticsEngine(
  env: {
    CLOUDFLARE_ACCOUNT_ID?: string;
    BI_ANALYTICS_READ_TOKEN?: string | { get(): Promise<string> };
    PUBLIC_SURFACE?: string;
  },
  sql: string,
): Promise<unknown[] | null> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = await readSecret(env.BI_ANALYTICS_READ_TOKEN);
  if (!accountId || !token) return null;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: sql,
    },
  );
  if (!response.ok) throw new Error(`analytics_engine_sql:${response.status}`);
  const payload = (await response.json()) as { data?: unknown };
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function loadAdminBi(
  env: {
    DB: D1Database;
    CLOUDFLARE_ACCOUNT_ID?: string;
    BI_ANALYTICS_READ_TOKEN?: string | { get(): Promise<string> };
    PUBLIC_SURFACE?: string;
  },
): Promise<AdminBiPayload> {
  const [days, total] = await Promise.all([
    env.DB.prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS new_users
       FROM users
       WHERE public_code >= 1
       GROUP BY 1
       ORDER BY 1`,
    ).all<{ day: string; new_users: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users WHERE public_code >= 1`,
    ).first<{ n: number }>(),
  ]);
  const payload: AdminBiPayload = {
    days: (days.results || []).map((row) => ({
      day: row.day,
      new_users: asNumber(row.new_users),
    })),
    total_users: asNumber(total?.n),
    events: { configured: false },
  };

  const dataset = biDatasetName(env.PUBLIC_SURFACE);
  try {
    const grouped = await queryAnalyticsEngine(
      env,
      `SELECT blob1 AS event, blob2 AS actor,
              SUM(_sample_interval) AS n,
              SUM(_sample_interval * double2) AS duration_ms_sum
       FROM ${dataset}
       WHERE timestamp >= NOW() - INTERVAL '30' DAY
       GROUP BY event, actor`,
    );
    if (grouped == null) return payload;
    const top = await queryAnalyticsEngine(
      env,
      `SELECT blob3 AS course_id, blob4 AS teacher_id,
              SUM(_sample_interval) AS views
       FROM ${dataset}
       WHERE blob1 = 'review_view'
         AND timestamp >= NOW() - INTERVAL '7' DAY
       GROUP BY course_id, teacher_id
       ORDER BY views DESC
       LIMIT 20`,
    );
    payload.events = {
      configured: true,
      range: { days: 30 },
      by_event: (grouped as AeEventRow[])
        .filter((row) => isBiEvent(String(row.event)))
        .map((row) => {
          const n = asNumber(row.n);
          const duration = asNumber(row.duration_ms_sum);
          return {
            event: String(row.event),
            actor: String(row.actor) === "user" ? "user" : "guest",
            n,
            avg_ms: n > 0 && duration > 0 ? duration / n : null,
          };
        }),
      top_relations: ((top as AeTopRow[]) || [])
        .filter((row) => row.course_id)
        .map((row) => ({
          course_id: String(row.course_id),
          teacher_id: String(row.teacher_id || ""),
          views: asNumber(row.views),
        })),
    };
  } catch {
    payload.events = { configured: true, error: "analytics_engine_unavailable" };
  }
  return payload;
}
