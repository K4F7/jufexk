import { getCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppContext } from "./types";
import { parseOverallRating } from "../lib/review-overall";
import {
  isCourseTag,
  isSchemeKey,
  type CourseTag,
  type SchemeKey,
} from "../lib/review-schemes";
import { REVIEW_NOTE_HTML_MAX_LENGTH } from "../lib/review-note-html";
import {
  publicCourseCategory,
  publicCourseDisplayName,
} from "../lib/public-course-presentation";

export const clean = (v: unknown, n = 500) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
export const markPublicCatalogCacheChanged = (c: AppContext) =>
  c.set("publicCatalogCacheChanged", true);
export const nullableClean = (v: unknown, n = 500) => clean(v, n) || null;
export const integer = (v: unknown) => {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v !== "string" || !/^-?(?:0|[1-9]\d*)$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};
export const rating = (v: unknown) => parseOverallRating(v);
export type StashedReview = {
  scores: unknown;
  overall: number;
  comment: string;
};
export const parseStashedReview = (json: string): StashedReview | null => {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const overall = rating(object.overall);
  if (!overall) return null;
  return {
    scores: object.scores,
    overall,
    // 暂存的是提交时已消毒的补充说明；HTML 标记不计入 10–1200 字门槛，
    // 这里只按存储上限截断，批准时 snapshotReviewScores 会重新消毒校验。
    comment: clean(object.comment, REVIEW_NOTE_HTML_MAX_LENGTH),
  };
};
export const parseTagCsv = (value: unknown) =>
  typeof value === "string" && value
    ? value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
export type AdminFieldParse<T> =
  | { provided: false }
  | { provided: true; value: T }
  | { provided: true; error: string };
export const parseAdminSchemeKey = (
  raw: unknown,
): AdminFieldParse<SchemeKey> => {
  if (raw === undefined) return { provided: false };
  if (typeof raw !== "string" || !isSchemeKey(raw))
    return { provided: true, error: "评价规则无效" };
  return { provided: true, value: raw };
};
export const parseAdminTags = (raw: unknown): AdminFieldParse<CourseTag[]> => {
  if (raw === undefined) return { provided: false };
  if (!Array.isArray(raw)) return { provided: true, error: "课程标签无效" };
  const tags: CourseTag[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !isCourseTag(item))
      return { provided: true, error: "未知课程标签" };
    if (!tags.includes(item)) tags.push(item);
  }
  return { provided: true, value: tags };
};
export const loadCourseSchemeInput = (db: D1Database, courseCode: string) =>
  db
    .prepare(
      `SELECT scheme_key, category,
         (SELECT GROUP_CONCAT(tag) FROM course_tags WHERE course_id=courses.id) tag_csv
       FROM courses WHERE code=? LIMIT 1`,
    )
    .bind(courseCode)
    .first<{
      scheme_key: string | null;
      category: string;
      tag_csv: string | null;
    }>();
export const digest = async (s: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

/** 有效管理员 cookie，不走 /api/admin/* CSRF。公开 GET 可据此下发已屏蔽条目。 */
export async function hasValidAdminSession(c: AppContext) {
  const raw = getCookie(c, "jufexk_admin");
  if (!raw) return false;
  const session = await c.env.DB.prepare(
    `SELECT 1 ok FROM admin_sessions
     WHERE token_hash=? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP`,
  )
    .bind(await digest(raw))
    .first();
  return Boolean(session);
}
export const keyedDigest = async (s: string, secret: string) => {
  if (!secret) throw new Error("IP_HASH_SECRET is not configured");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(s))),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};
export const token = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export const fail = (c: AppContext, error: string, status = 400) =>
  c.json({ error }, status as ContentfulStatusCode);
export const publicCourseRawName = (row: {
  name?: unknown;
  course_name?: unknown;
}) =>
  typeof row.name === "string"
    ? row.name
    : typeof row.course_name === "string"
      ? row.course_name
      : "";
export const withMappedCourseNames = <
  T extends { category?: unknown; name?: unknown; course_name?: unknown },
>(
  row: T,
  displayName: string,
) => {
  const rawName = publicCourseRawName(row);
  return {
    ...row,
    ...(typeof row.name === "string" ? { name: displayName } : {}),
    ...(typeof row.course_name === "string"
      ? { course_name: displayName }
      : {}),
    category: publicCourseCategory(
      rawName,
      typeof row.category === "string" ? row.category : "",
    ),
  };
};
export const withPublicCourseCategory = <
  T extends { category?: unknown; name?: unknown; course_name?: unknown },
>(
  row: T,
) =>
  withMappedCourseNames(row, publicCourseDisplayName(publicCourseRawName(row)));
export const pageArgs = (c: AppContext) => ({
  page: Math.max(1, integer(c.req.query("page")) || 1),
  size: Math.min(50, Math.max(1, integer(c.req.query("pageSize")) || 20)),
});
export type WindowedRow = { window_total?: number };
export const stripWindowTotal = <T extends WindowedRow>(row: T) => {
  const { window_total: _total, ...rest } = row;
  return rest;
};
/** 列表查询用 COUNT(*) OVER() 带出总数；越界空页没有行可读窗口值，才回退 COUNT。 */
export const windowedPage = async <T extends WindowedRow>(
  rows: T[],
  page: number,
  fallbackTotal: () => Promise<number>,
) => ({
  items: rows.map(stripWindowTotal),
  total: rows.length
    ? Number(rows[0].window_total) || 0
    : page > 1
      ? await fallbackTotal()
      : 0,
});
export const originOk = (c: AppContext) => {
  const origin = c.req.header("Origin");
  return origin === new URL(c.req.url).origin;
};
export const LOCAL_UNUSED_TURNSTILE_SECRET = "local-unused-turnstile";
export const skipTurnstile = (secret: string) =>
  secret === LOCAL_UNUSED_TURNSTILE_SECRET;
export const csrfOk = (c: AppContext, expected: string) => {
  const header = c.req.header("X-CSRF-Token"),
    cookie = getCookie(c, "jufexk_csrf");
  return !!header && header === cookie && header === expected;
};
export const takeRateLimit = async (
  db: D1Database,
  key: string,
  seconds: number,
  limit: number,
) => {
  const result = await db
    .prepare(
      `INSERT INTO rate_limit_counters(key,window_start,count) VALUES(?,unixepoch(),1)
       ON CONFLICT(key) DO UPDATE SET
         count=CASE WHEN rate_limit_counters.window_start<=unixepoch()-? THEN 1 ELSE rate_limit_counters.count+1 END,
         window_start=CASE WHEN rate_limit_counters.window_start<=unixepoch()-? THEN unixepoch() ELSE rate_limit_counters.window_start END
       WHERE rate_limit_counters.window_start<=unixepoch()-? OR rate_limit_counters.count<?`,
    )
    .bind(key, seconds, seconds, seconds, limit)
    .run();
  return (result.meta.changes || 0) === 1;
};
