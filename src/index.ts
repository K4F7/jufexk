import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  applyRelationAdditions,
  CatalogRelationAdditionError,
  parseOfficialRelationPackage,
  parseRelationPairs,
  previewRelationAdditions,
} from "./catalog-relation-additions";
import {
  BaselineImportError,
  baselineUploadStatus,
  createBaselineUpload,
  finalizeBaselineUpload,
  previewBaselineUpload,
  publishBaselineUpload,
  putBaselineChunk,
  readBoundedJson,
} from "./catalog-baseline-import";
import {
  isVirtualPeSportId,
  publicCourseCategory,
  publicCourseDisplayName,
  publicCourseVisibleSql,
  publicPeCanonicalCourseSql,
  publicPeFamilySearchSql,
  publicPeResolveCanonicalIdSql,
  publicPeSkillFamilySql,
  publicSportsMatchSql,
  VIRTUAL_PE_SPORTS,
  virtualPeSportById,
  virtualPeSportForTeacherName,
  virtualPeSportMatchesQuery,
} from "./lib/public-course-presentation";
import {
  HistoricalBatchImportError,
  importIssue111HistoricalBatch,
} from "./historical-batch-imports";
import { handleCampusAuthStatus } from "./campus-jwt";
import {
  handleRequestOrdinaryUserDeletion,
  handleRestoreOrdinaryUserDeletion,
  USER_DELETION_PATH,
  USER_DELETION_RESTORE_PATH,
} from "./ordinary-user-account";
import {
  canOrdinaryUserWrite,
  handleCampusAuthCallback,
  handleOrdinaryUserLogout,
  handleOrdinaryUserSession,
  resolveOrdinaryUser,
} from "./ordinary-user-session";
import {
  decoratePublicReviews,
  handleCreateEndorsement,
  handleWithdrawEndorsement,
} from "./review-endorsements";
import { API_CONTENT_SECURITY_POLICY } from "./security-headers";
import { readSecret, turnstileMode } from "./secrets";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_NAME: string;
  UNIVERSITY_NAME: string;
  HISTORICAL_IMPORT_ARTIFACT_SHA256: string;
  HISTORICAL_IMPORT_MANIFEST_SHA256: string;
  ISSUE111_RELATION_MANIFEST_SHA256?: string;
  ISSUE111_IMPORT_ARTIFACT_SHA256?: string;
  ISSUE111_IMPORT_MANIFEST_SHA256?: string;
  ADMIN_PASSWORD?: string | { get(): Promise<string> };
  IP_HASH_SECRET: string | { get(): Promise<string> };
  TURNSTILE_SECRET?: string | { get(): Promise<string> };
  TURNSTILE_SITE_KEY?: string;
  ORDINARY_USER_TEST_AUTH_SECRET?: string;
  CAMPUS_JWT_SECRET?: string | { get(): Promise<string> };
  CAMPUS_JWT_AUD?: string;
  CAMPUS_JWT_AES_KEY?: string | { get(): Promise<string> };
  CAMPUS_IDENTITY_SECRET?: string | { get(): Promise<string> };
  CAMPUS_JWT_ENABLED?: string;
  CAMPUS_APP_ID?: string;
  AUTHBRIDGE_BASE_URL?: string;
};
type Vars = {
  adminSession?: string;
  adminSessionId?: string;
  adminCsrf?: string;
};
type StashedReview = {
  attendance: string;
  grading: string;
  gradingScore: number | null;
  workload: string;
  rescue: string;
  assessment: string;
  teaching: string;
  clarity: number | null;
  knowledge: number | null;
  workloadScore: number | null;
  fairness: number | null;
  overall: number;
  comment: string;
  term: string;
};
const HISTORICAL_FREEZE_CONTRACT = "legacy-historical-production-freeze-v2";
const HISTORICAL_SOURCE_CONTRACT = "legacy-historical-approved-package-v1";
const HISTORICAL_RECORD_SCHEMA = "legacy-approved-review-v1";
const HISTORICAL_IMPORTABLE_COUNT = 522;
const HISTORICAL_RELATION_UNAVAILABLE_COUNT = 419;
const HISTORICAL_FREEZE_CONTENT_SHA256 =
  "1b4ca0728d9883c0d9267cc0ede033bbeebcb0fb3a3cdff333816c36e414a421";
const APPROVED_HISTORICAL_MANIFEST_SHA256 =
  "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af";
const APPROVED_CATALOG_CONTENT_SHA256 =
  "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588";
const app = new Hono<{ Bindings: Bindings; Variables: Vars }>();
type AppContext = Context<{ Bindings: Bindings; Variables: Vars }>;
const clean = (v: unknown, n = 500) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
const nullableClean = (v: unknown, n = 500) => clean(v, n) || null;
const integer = (v: unknown) => {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v !== "string" || !/^-?(?:0|[1-9]\d*)$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};
const rating = (v: unknown) => {
  if (v === "" || v == null) return null;
  const n = integer(v);
  return n !== null && n >= 1 && n <= 5 ? n : null;
};
const parseStashedReview = (json: string): StashedReview | null => {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const scoreFields = [
    "gradingScore",
    "clarity",
    "knowledge",
    "workloadScore",
    "fairness",
  ] as const;
  const scores = Object.fromEntries(
    scoreFields.map((field) => [field, rating(object[field])]),
  ) as Record<(typeof scoreFields)[number], number | null>;
  if (
    scoreFields.some((field) => {
      const raw = object[field];
      return raw !== undefined && raw !== null && raw !== "" && scores[field] === null;
    })
  )
    return null;
  const overall = rating(object.overall);
  if (!overall) return null;
  return {
    attendance: clean(object.attendance, 120),
    grading: clean(object.grading, 120),
    gradingScore: scores.gradingScore,
    workload: clean(object.workload, 120),
    rescue: clean(object.rescue, 120),
    assessment: clean(object.assessment, 200),
    teaching: clean(object.teaching, 600),
    clarity: scores.clarity,
    knowledge: scores.knowledge,
    workloadScore: scores.workloadScore,
    fairness: scores.fairness,
    overall,
    comment: clean(object.comment, 1200),
    term: clean(object.term, 30),
  };
};
const digest = async (s: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const keyedDigest = async (s: string, secret: string) => {
  if (!secret) throw new Error("IP_HASH_SECRET is not configured");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(s)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const token = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const fail = (c: any, error: string, status = 400) => c.json({ error }, status);
const publicCourseRawName = (row: {
  name?: unknown;
  course_name?: unknown;
}) =>
  typeof row.name === "string"
    ? row.name
    : typeof row.course_name === "string"
      ? row.course_name
      : "";
const withPublicCourseCategory = <
  T extends { category?: unknown; name?: unknown; course_name?: unknown },
>(
  row: T,
) => {
  const rawName = publicCourseRawName(row);
  const displayName = publicCourseDisplayName(rawName);
  return {
    ...row,
    ...(typeof row.name === "string" ? { name: displayName } : {}),
    ...(typeof row.course_name === "string" ? { course_name: displayName } : {}),
    category: publicCourseCategory(
      rawName,
      typeof row.category === "string" ? row.category : "",
    ),
  };
};
const virtualPeSportItem = (
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
  teachers: Array<{ id: number; name: string }>,
) => ({
  id: sport.id,
  code: "",
  name: sport.label,
  category: "sports" as const,
  department: "",
  teachers: teachers.map((teacher) => teacher.name).join(","),
  teacher_refs: teachers
    .map((teacher) => `${teacher.id}:${teacher.name}`)
    .join(","),
  review_count: 0,
  rating: null,
});
const loadVirtualPeSportItems = async (
  db: D1Database,
  search: string,
  teacherId: number | null,
  department: string,
) => {
  if (department) return [];
  const items: Array<ReturnType<typeof virtualPeSportItem>> = [];
  for (const sport of VIRTUAL_PE_SPORTS) {
    if (!virtualPeSportMatchesQuery(sport, search)) continue;
    const placeholders = sport.teacherNames.map(() => "?").join(",");
    const teachers = (
      await db
        .prepare(
          `SELECT id,name FROM teachers WHERE name IN (${placeholders}) ORDER BY name,id`,
        )
        .bind(...sport.teacherNames)
        .all<{ id: number; name: string }>()
    ).results;
    if (!teachers.length) continue;
    if (teacherId && !teachers.some((teacher) => teacher.id === teacherId))
      continue;
    items.push(virtualPeSportItem(sport, teachers));
  }
  return items;
};
const pageArgs = (c: any) => ({
  page: Math.max(1, integer(c.req.query("page")) || 1),
  size: Math.min(50, Math.max(1, integer(c.req.query("pageSize")) || 20)),
});
const originOk = (c: any) => {
  const origin = c.req.header("Origin");
  return origin === new URL(c.req.url).origin;
};
const publicReviewBinding = `
       AND EXISTS(
         SELECT 1 FROM course_teachers public_relation
         WHERE public_relation.course_id=r.course_id
           AND public_relation.teacher_id=r.teacher_id
       )
       AND (
         r.offering_id IS NULL OR EXISTS(
           SELECT 1
           FROM offerings public_offering
           JOIN offering_teachers public_offering_teacher
             ON public_offering_teacher.offering_id=public_offering.id
            AND public_offering_teacher.teacher_id=r.teacher_id
           WHERE public_offering.id=r.offering_id
             AND public_offering.course_id=r.course_id
         )
       )`;
const publicTextReviewCounts = `
  SELECT course_id,teacher_id,COUNT(*) review_count
  FROM (
    SELECT r.course_id,r.teacher_id
    FROM reviews r
    WHERE r.status='approved'
      AND trim(COALESCE(r.comment,''))<>''${publicReviewBinding}
    UNION ALL
    SELECT phr.course_id,phr.teacher_id
    FROM public_historical_reviews phr
    UNION ALL
    SELECT lr.course_id,lr.teacher_id
    FROM legacy_reviews lr
    JOIN courses legacy_course ON legacy_course.id=lr.course_id
    JOIN teachers legacy_teacher ON legacy_teacher.id=lr.teacher_id
    WHERE lr.status='approved'
      AND trim(COALESCE(lr.comment,''))<>''
  ) visible_text_reviews
  GROUP BY course_id,teacher_id`;
type PublicReviewCursor = { source: number; key: string };
const publicReviewPageSize = (c: any) =>
  Math.min(50, Math.max(1, integer(c.req.query("pageSize")) || 20));
const decodePublicReviewCursor = (value: string | undefined): PublicReviewCursor | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value)) as PublicReviewCursor;
    return Number.isInteger(parsed.source) && typeof parsed.key === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
};
const encodePublicReviewCursor = (cursor: PublicReviewCursor) =>
  btoa(JSON.stringify(cursor));
const getPublicTextReviewCount = async (
  db: D1Database,
  subject: "course_id" | "teacher_id",
  id: number | null,
) => {
  const result = await db
    .prepare(
      `SELECT COALESCE(SUM(review_count),0) count
       FROM (${publicTextReviewCounts})
       WHERE ${subject}=?`,
    )
    .bind(id)
    .first<{ count: number }>();
  return result?.count || 0;
};
const getPublicReviewPage = async (
  db: D1Database,
  subject: "course_id" | "teacher_id",
  id: number | null,
  size: number,
  cursor: PublicReviewCursor | null,
  viewerUserId: string | null = null,
  teacherId: number | null = null,
) => {
  const cursorSource = cursor?.source ?? -1;
  const cursorKey = cursor?.key ?? "";
  /** 课程页评价按 课程×教师 作用域展示：选定教师时追加逐分支过滤。 */
  const teacherFilter = (alias: string) =>
    teacherId ? ` AND ${alias}.teacher_id=?` : "";
  const teacherBinds = teacherId ? [teacherId] : [];
  const { results } = await db
    .prepare(
      `SELECT source_order,sort_key,id,course_id,teacher_id,comment,
         course_name,course_code,teacher_name,endorsement_count
       FROM (
         SELECT 0 source_order,phr.id sort_key,'historical:' || phr.id id,
           phr.course_id,phr.teacher_id,phr.comment,
           c.name course_name,c.code course_code,t.name teacher_name,
           0 endorsement_count
         FROM public_historical_reviews phr
         JOIN courses c ON c.id=phr.course_id
         JOIN teachers t ON t.id=phr.teacher_id
         WHERE phr.${subject}=?${teacherFilter("phr")}
         UNION ALL
         SELECT 1 source_order,printf('%020d',lr.id) sort_key,'legacy:' || lr.id id,
           lr.course_id,lr.teacher_id,lr.comment,
           c.name course_name,c.code course_code,t.name teacher_name,
           0 endorsement_count
         FROM legacy_reviews lr
         JOIN courses c ON c.id=lr.course_id
         JOIN teachers t ON t.id=lr.teacher_id
         WHERE lr.${subject}=? AND lr.status='approved'
           AND trim(COALESCE(lr.comment,''))<>''${teacherFilter("lr")}
         UNION ALL
         SELECT 2 source_order,printf('%020d',r.id) sort_key,'review:' || r.id id,
           r.course_id,r.teacher_id,r.comment,
           c.name course_name,c.code course_code,t.name teacher_name,
           (SELECT COUNT(*) FROM review_endorsements e WHERE e.review_id=r.id) endorsement_count
         FROM reviews r
         JOIN courses c ON c.id=r.course_id
         JOIN teachers t ON t.id=r.teacher_id
         WHERE r.${subject}=? AND r.status='approved'
           AND trim(COALESCE(r.comment,''))<>''${publicReviewBinding}${teacherFilter("r")}
       ) public_reviews
       WHERE source_order>? OR (source_order=? AND sort_key>?)
       ORDER BY source_order,sort_key
       LIMIT ?`,
    )
    .bind(
      id,
      ...teacherBinds,
      id,
      ...teacherBinds,
      id,
      ...teacherBinds,
      cursorSource,
      cursorSource,
      cursorKey,
      size + 1,
    )
    .all();
  const typedResults = results as Array<
    Record<string, unknown> & { source_order: number; sort_key: string }
  >;
  const hasMore = typedResults.length > size;
  const page = typedResults.slice(0, size);
  const last = page.at(-1);
  return {
    items: await decoratePublicReviews(
      db,
      page.map(({ source_order: _source, sort_key: _key, ...review }) => review),
      viewerUserId,
    ),
    nextCursor:
      hasMore && last
        ? encodePublicReviewCursor({ source: last.source_order, key: last.sort_key })
        : null,
  };
};
const publicReviewViewerId = async (c: AppContext) => {
  const viewer = await resolveOrdinaryUser(c);
  return viewer && canOrdinaryUserWrite(viewer) ? viewer.id : null;
};
const getPublicReviewPageFor = async (
  c: AppContext,
  subject: "course_id" | "teacher_id",
  id: number | null,
  size: number,
  cursor: PublicReviewCursor | null,
  teacherId: number | null = null,
) =>
  getPublicReviewPage(
    c.env.DB,
    subject,
    id,
    size,
    cursor,
    await publicReviewViewerId(c),
    teacherId,
  );
const csrfOk = (c: any, expected: string) => {
  const header = c.req.header("X-CSRF-Token"),
    cookie = getCookie(c, "jufexk_csrf");
  return !!header && header === cookie && header === expected;
};
const takeRateLimit = async (
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

app.use("/api/*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Content-Security-Policy", API_CONTENT_SECURITY_POLICY);
});

app.get("/api/config", async (c) => {
  const turnstileSecret = await readSecret(c.env.TURNSTILE_SECRET);
  return c.json({
    siteName: c.env.SITE_NAME,
    universityName: c.env.UNIVERSITY_NAME,
    admin: false,
    turnstileSiteKey:
      c.env.TURNSTILE_SITE_KEY && turnstileSecret
        ? c.env.TURNSTILE_SITE_KEY
        : "",
  });
});
app.get("/api/courses", async (c) => {
  const { page, size } = pageArgs(c),
    search = clean(c.req.query("q"), 80),
    q = `%${search}%`,
    prefix = `${search}%`,
    cat = clean(c.req.query("category"), 20),
    department = clean(c.req.query("department"), 80),
    teacherId = integer(c.req.query("teacherId"));
  if (cat && cat !== "sports")
    return fail(c, "公开筛选仅支持 sports");
  const where = `${publicCourseVisibleSql("c")} AND ${publicPeCanonicalCourseSql("c")} AND (?='' OR ${publicSportsMatchSql("c")}) AND (?='' OR trim(c.department)=trim(?)) AND (? IS NULL OR ct.teacher_id=?) AND (c.name LIKE ? OR c.code LIKE ? OR c.department LIKE ? OR t.name LIKE ? OR EXISTS(SELECT 1 FROM course_name_variants cnv WHERE cnv.course_id=c.id AND cnv.name LIKE ?) OR ${publicPeFamilySearchSql("c")})`;
  const args = [
    cat,
    department,
    department,
    teacherId,
    teacherId,
    q,
    q,
    q,
    q,
    q,
    q,
    q,
    q,
  ];
  const searchRankArgs = [
    search,
    search,
    search,
    search,
    prefix,
    prefix,
    search,
    prefix,
    search,
    search,
    prefix,
    prefix,
  ];
  const total = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT c.id) n FROM courses c LEFT JOIN course_teachers ct ON ct.course_id=c.id LEFT JOIN teachers t ON t.id=ct.teacher_id WHERE ${where}`,
  )
    .bind(...args)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT c.*,
       GROUP_CONCAT(DISTINCT t.id || ':' || t.name) teacher_refs,
       GROUP_CONCAT(DISTINCT t.name) teachers,
       COALESCE(course_review_counts.review_count,0) review_count,
       (SELECT ROUND(AVG(r.overall),1) FROM reviews r
        WHERE r.course_id=c.id AND r.status='approved'${publicReviewBinding}) rating
     FROM courses c
     LEFT JOIN course_teachers ct ON ct.course_id=c.id
     LEFT JOIN teachers t ON t.id=ct.teacher_id
     LEFT JOIN (SELECT course_id,SUM(review_count) review_count FROM (${publicTextReviewCounts}) GROUP BY course_id) course_review_counts ON course_review_counts.course_id=c.id
     WHERE ${where}
     GROUP BY c.id
     ORDER BY CASE
       WHEN ?='' THEN 0
       WHEN c.name=? OR c.code=? OR (${publicPeSkillFamilySql("c")})=? THEN 0
       WHEN c.name LIKE ? OR c.code LIKE ? THEN 1
       WHEN c.department=? THEN 2
       WHEN c.department LIKE ? THEN 3
       WHEN EXISTS(SELECT 1 FROM course_teachers rank_ct JOIN teachers rank_t ON rank_t.id=rank_ct.teacher_id WHERE rank_ct.course_id=c.id AND rank_t.name=?)
         OR EXISTS(SELECT 1 FROM course_name_variants rank_cnv WHERE rank_cnv.course_id=c.id AND rank_cnv.name=?) THEN 4
       WHEN EXISTS(SELECT 1 FROM course_teachers rank_ct JOIN teachers rank_t ON rank_t.id=rank_ct.teacher_id WHERE rank_ct.course_id=c.id AND rank_t.name LIKE ?)
         OR EXISTS(SELECT 1 FROM course_name_variants rank_cnv WHERE rank_cnv.course_id=c.id AND rank_cnv.name LIKE ?) THEN 5
       ELSE 6
     END,review_count DESC,c.name,c.code,c.id
     LIMIT ? OFFSET ?`,
  )
    .bind(...args, ...searchRankArgs, size, (page - 1) * size)
    .all();
  const virtualItems = await loadVirtualPeSportItems(
    c.env.DB,
    search,
    teacherId,
    department,
  );
  const listed = results.map(withPublicCourseCategory);
  const extras = virtualItems.filter(
    (item) => !listed.some((row) => row.name === item.name),
  );
  const totalCount = (total?.n || 0) + extras.length;
  return c.json({
    items: page === 1 ? [...listed, ...extras] : listed,
    page,
    pageSize: size,
    total: totalCount,
    pages: Math.ceil(totalCount / size),
  });
});
app.get("/api/teachers", async (c) => {
  const { page, size } = pageArgs(c);
  const search = clean(c.req.query("q"), 80);
  const q = `%${search}%`;
  const prefix = `${search}%`;
  const where = "t.name LIKE ? OR t.department LIKE ?";
  const args = [q, q];
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM teachers t WHERE ${where}`,
  )
    .bind(...args)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT t.*,
       (SELECT COUNT(DISTINCT ${publicPeResolveCanonicalIdSql("c")}) FROM course_teachers ct JOIN courses c ON c.id=ct.course_id WHERE ct.teacher_id=t.id AND ${publicCourseVisibleSql("c")}) course_count,
       COALESCE(teacher_review_counts.review_count,0) review_count,
       (SELECT ROUND(AVG(r.overall),1) FROM reviews r WHERE r.teacher_id=t.id AND r.status='approved'${publicReviewBinding}) rating
     FROM teachers t
     LEFT JOIN (SELECT teacher_id,SUM(review_count) review_count FROM (${publicTextReviewCounts}) GROUP BY teacher_id) teacher_review_counts ON teacher_review_counts.teacher_id=t.id
     WHERE ${where}
     ORDER BY CASE
       WHEN ?='' THEN 0
       WHEN t.name=? THEN 0
       WHEN t.name LIKE ? THEN 1
       WHEN t.department=? THEN 2
       WHEN t.department LIKE ? THEN 3
       ELSE 4
     END,review_count DESC,t.name,t.department,t.id
     LIMIT ? OFFSET ?`,
  )
    .bind(...args, search, search, prefix, search, prefix, size, (page - 1) * size)
    .all();
  const totalCount = total?.n || 0;
  return c.json({
    items: results.map((row: { name?: string; course_count?: number }) => {
      const sport = virtualPeSportForTeacherName(
        typeof row.name === "string" ? row.name : "",
      );
      if (!sport) return row;
      return { ...row, course_count: Number(row.course_count || 0) + 1 };
    }),
    page,
    pageSize: size,
    total: totalCount,
    pages: Math.ceil(totalCount / size),
  });
});
app.get("/api/teachers/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const teacher = await c.env.DB.prepare(
    `SELECT t.*,
       (SELECT COUNT(DISTINCT ${publicPeResolveCanonicalIdSql("c")}) FROM course_teachers ct JOIN courses c ON c.id=ct.course_id WHERE ct.teacher_id=t.id AND ${publicCourseVisibleSql("c")}) course_count,
       (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id=t.id AND r.status='approved'${publicReviewBinding}) review_count,
       (SELECT ROUND(AVG(r.overall),1) FROM reviews r WHERE r.teacher_id=t.id AND r.status='approved'${publicReviewBinding}) rating
     FROM teachers t WHERE t.id=?`,
  )
    .bind(id)
    .first();
  if (!teacher) return fail(c, "教师不存在", 404);
  const reviewCount = await getPublicTextReviewCount(c.env.DB, "teacher_id", id);
  const reviewPage = await getPublicReviewPageFor(c, "teacher_id", id, 20, null);
  const courses = (
    await c.env.DB.prepare(
      `SELECT c.*,COALESCE(visible_counts.review_count,0) review_count,
         (SELECT ROUND(AVG(r.overall),1) FROM reviews r WHERE r.course_id=c.id AND r.teacher_id=? AND r.status='approved'${publicReviewBinding}) rating
       FROM course_teachers ct
       JOIN courses taught ON taught.id=ct.course_id
       JOIN courses c ON c.id=${publicPeResolveCanonicalIdSql("taught")}
       LEFT JOIN (${publicTextReviewCounts}) visible_counts ON visible_counts.course_id=c.id AND visible_counts.teacher_id=ct.teacher_id
       WHERE ct.teacher_id=? AND ${publicCourseVisibleSql("taught")} AND ${publicCourseVisibleSql("c")}
       GROUP BY c.id
       ORDER BY review_count DESC,c.name,c.id`,
    )
      .bind(id, id)
      .all()
  ).results;
  const publicCourses = courses.map(withPublicCourseCategory);
  const visibleSport = virtualPeSportForTeacherName(
    typeof (teacher as { name?: string }).name === "string"
      ? (teacher as { name: string }).name
      : "",
  );
  if (
    visibleSport &&
    !publicCourses.some((course) => course.name === visibleSport.label)
  ) {
    publicCourses.push(
      virtualPeSportItem(visibleSport, [
        {
          id: id as number,
          name: (teacher as { name: string }).name,
        },
      ]),
    );
    (teacher as { course_count: number }).course_count =
      Number((teacher as { course_count?: number }).course_count || 0) + 1;
  }
  return c.json({
    teacher,
    courses: publicCourses,
    reviews: reviewPage.items,
    reviewCount,
    nextReviewCursor: reviewPage.nextCursor,
  });
});
app.get("/api/teachers/:id/reviews", async (c) => {
  const id = integer(c.req.param("id"));
  const teacher = await c.env.DB.prepare("SELECT id FROM teachers WHERE id=?").bind(id).first();
  if (!teacher) return fail(c, "教师不存在", 404);
  const rawCursor = c.req.query("cursor");
  const cursor = decodePublicReviewCursor(rawCursor);
  if (rawCursor && !cursor) return fail(c, "评价游标无效", 400);
  const page = await getPublicReviewPageFor(
    c,
    "teacher_id",
    id,
    publicReviewPageSize(c),
    cursor,
  );
  return c.json(page);
});
app.get("/api/courses/options", async (c) => {
  const { page, size } = pageArgs(c);
  const search = clean(c.req.query("q"), 80);
  const q = `%${search}%`;
  const where = `${publicCourseVisibleSql("c")} AND ${publicPeCanonicalCourseSql("c")} AND (?='' OR c.name LIKE ? OR c.code LIKE ? OR EXISTS (SELECT 1 FROM course_teachers search_ct JOIN teachers search_t ON search_t.id=search_ct.teacher_id WHERE search_ct.course_id=c.id AND (search_t.name LIKE ? OR search_t.department LIKE ?)) OR ${publicPeFamilySearchSql("c")})`;
  const args = [search, q, q, q, q, q, q, q];
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM courses c WHERE ${where}`,
  )
    .bind(...args)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT c.id,c.code,c.name,c.category,c.department,GROUP_CONCAT(DISTINCT t.name) teachers FROM courses c LEFT JOIN course_teachers ct ON ct.course_id=c.id LEFT JOIN teachers t ON t.id=ct.teacher_id WHERE ${where} GROUP BY c.id ORDER BY c.name,c.id LIMIT ? OFFSET ?`,
  )
    .bind(...args, size, (page - 1) * size)
    .all();
  const totalCount = total?.n || 0;
  return c.json({
    items: results.map(withPublicCourseCategory),
    page,
    pageSize: size,
    total: totalCount,
    pages: Math.ceil(totalCount / size),
  });
});
app.get("/api/courses/departments", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT trim(c.department) department
     FROM courses c
     WHERE ${publicCourseVisibleSql("c")} AND ${publicPeCanonicalCourseSql("c")}
       AND trim(COALESCE(c.department,''))<>''
     ORDER BY trim(c.department)`,
  ).all<{ department: string }>();
  return c.json({ items: results.map((row) => row.department) });
});
app.get("/api/courses/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const virtual = id ? virtualPeSportById(id) : null;
  if (virtual) {
    const placeholders = virtual.teacherNames.map(() => "?").join(",");
    const teachers = (
      await c.env.DB.prepare(
        `SELECT t.*,0 review_count,NULL rating FROM teachers t
         WHERE t.name IN (${placeholders}) ORDER BY t.name,t.id`,
      )
        .bind(...virtual.teacherNames)
        .all()
    ).results;
    if (!teachers.length) return fail(c, "课程不存在", 404);
    return c.json({
      course: {
        id: virtual.id,
        code: "",
        name: virtual.label,
        category: "sports",
        department: "",
        teachers,
        nameVariants: [],
      },
      reviewCount: 0,
    });
  }
  const course = await c.env.DB.prepare(
    `SELECT c.*,
       (SELECT ROUND(AVG(r.overall),1) FROM reviews r WHERE r.course_id=c.id AND r.status='approved'${publicReviewBinding}) rating
     FROM courses c WHERE c.id=?`,
  )
    .bind(id)
    .first();
  if (!course) return fail(c, "课程不存在", 404);
  const reviewCount = await getPublicTextReviewCount(c.env.DB, "course_id", id);
  const teachers = (
    await c.env.DB.prepare(
      `SELECT t.*,COALESCE(visible_counts.review_count,0) review_count,
         (SELECT ROUND(AVG(r.overall),1) FROM reviews r WHERE r.course_id=? AND r.teacher_id=t.id AND r.status='approved'${publicReviewBinding}) rating
       FROM teachers t
       JOIN course_teachers ct ON ct.teacher_id=t.id
       JOIN courses taught ON taught.id=ct.course_id
       JOIN courses requested ON requested.id=?
       LEFT JOIN (${publicTextReviewCounts}) visible_counts ON visible_counts.course_id=requested.id AND visible_counts.teacher_id=t.id
       WHERE ${publicCourseVisibleSql("taught")}
         AND (taught.id=requested.id
           OR ((${publicPeSkillFamilySql("taught")}) IS NOT NULL
             AND (${publicPeSkillFamilySql("taught")}) = (${publicPeSkillFamilySql("requested")})))
       GROUP BY t.id
       ORDER BY review_count DESC,t.name,t.id`,
    )
    .bind(id, id)
    .all()
  ).results;
  const nameVariants = (
    await c.env.DB.prepare(
      "SELECT name,created_at FROM course_name_variants WHERE course_id=? ORDER BY name",
    )
      .bind(id)
      .all()
  ).results;
  // 课程详情不再直接返回评价流：评价按 课程×教师 作用域经 /reviews?teacherId= 获取。
  return c.json({
    course: { ...withPublicCourseCategory(course), teachers, nameVariants },
    reviewCount,
  });
});
app.get("/api/courses/:id/reviews", async (c) => {
  const id = integer(c.req.param("id"));
  const teacherId = integer(c.req.query("teacherId"));
  if (id && isVirtualPeSportId(id)) {
    // 虚拟体育课没有课程级评价行：未选教师时返回空页，选定教师后按其教师流展示。
    if (!teacherId) return c.json({ items: [], nextCursor: null });
    const virtual = virtualPeSportById(id);
    const teacher = await c.env.DB.prepare(
      "SELECT id,name FROM teachers WHERE id=?",
    )
      .bind(teacherId)
      .first<{ id: number; name: string }>();
    if (
      !virtual ||
      !teacher ||
      !(virtual.teacherNames as readonly string[]).includes(teacher.name)
    )
      return fail(c, "课程不存在", 404);
    const rawVirtualCursor = c.req.query("cursor");
    const virtualCursor = decodePublicReviewCursor(rawVirtualCursor);
    if (rawVirtualCursor && !virtualCursor) return fail(c, "评价游标无效", 400);
    return c.json(
      await getPublicReviewPageFor(
        c,
        "teacher_id",
        teacherId,
        publicReviewPageSize(c),
        virtualCursor,
      ),
    );
  }
  const course = await c.env.DB.prepare("SELECT id FROM courses WHERE id=?").bind(id).first();
  if (!course) return fail(c, "课程不存在", 404);
  const rawCursor = c.req.query("cursor");
  const cursor = decodePublicReviewCursor(rawCursor);
  if (rawCursor && !cursor) return fail(c, "评价游标无效", 400);
  const page = await getPublicReviewPageFor(
    c,
    "course_id",
    id,
    publicReviewPageSize(c),
    cursor,
    teacherId,
  );
  return c.json(page);
});

app.get("/api/user/session", handleOrdinaryUserSession);
app.post("/api/user/logout", handleOrdinaryUserLogout);
app.post(USER_DELETION_PATH, handleRequestOrdinaryUserDeletion);
app.post(USER_DELETION_RESTORE_PATH, handleRestoreOrdinaryUserDeletion);
app.get("/api/auth/campus", handleCampusAuthStatus);
app.post("/api/auth/callback", handleCampusAuthCallback);
app.put("/api/reviews/:id/endorsement", handleCreateEndorsement);
app.delete("/api/reviews/:id/endorsement", handleWithdrawEndorsement);

async function verifyTurnstile(c: any, response: string, ip: string) {
  const secret = await readSecret(c.env.TURNSTILE_SECRET);
  const mode = turnstileMode(c.env.TURNSTILE_SITE_KEY, secret);
  if (mode !== "enabled") return mode !== "secret-only";
  if (!response) return false;
  try {
    const body = new URLSearchParams({
      secret,
      response,
      remoteip: ip,
    });
    const r = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    if (!r.ok) return false;
    const result = await r.json<{ success: boolean }>();
    return result.success === true;
  } catch {
    return false;
  }
}
app.get("/api/offerings", async (c) => {
  const courseId = integer(c.req.query("courseId"));
  if (!courseId) return fail(c, "courseId is required");
  const results = (
    await c.env.DB.prepare(
      `SELECT o.*,GROUP_CONCAT(t.id) teacher_ids,GROUP_CONCAT(t.name) teachers FROM offerings o LEFT JOIN offering_teachers ot ON ot.offering_id=o.id LEFT JOIN teachers t ON t.id=ot.teacher_id WHERE o.course_id=? AND o.status='active' GROUP BY o.id ORDER BY o.term DESC,o.section`,
    )
      .bind(courseId)
      .all()
  ).results;
  return c.json(results);
});
app.get("/api/offerings/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const offering = await c.env.DB.prepare(
    `SELECT o.*,c.name course_name,c.category FROM offerings o JOIN courses c ON c.id=o.course_id WHERE o.id=?`,
  )
    .bind(id)
    .first();
  if (!offering) return fail(c, "开课班不存在", 404);
  const teachers = (
    await c.env.DB.prepare(
      `SELECT t.* FROM offering_teachers ot JOIN teachers t ON t.id=ot.teacher_id WHERE ot.offering_id=? ORDER BY t.name`,
    )
      .bind(id)
      .all()
  ).results;
  return c.json({ offering: withPublicCourseCategory(offering), teachers });
});
app.post("/api/reviews", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  if (clean(b.website)) return c.json({ ok: true });
  const captchaMode = turnstileMode(
    c.env.TURNSTILE_SITE_KEY,
    await readSecret(c.env.TURNSTILE_SECRET),
  );
  if (captchaMode === "secret-only")
    return fail(c, "人机验证配置异常", 503);
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  let courseId = integer(b.courseId);
  const rawOfferingId = b.offeringId,
    offeringId = integer(rawOfferingId),
    teacherId = integer(b.teacherId),
    overall = rating(b.overall),
    ip = c.req.header("CF-Connecting-IP") || "unknown",
    ipHash = await keyedDigest(ip, await readSecret(c.env.IP_HASH_SECRET));
  if (
    rawOfferingId !== undefined &&
    rawOfferingId !== null &&
    rawOfferingId !== "" &&
    (!offeringId || offeringId < 1)
  )
    return fail(c, "开课班无效");
  if (!(await verifyTurnstile(c, clean(b.turnstileToken, 2048), ip)))
    return fail(c, "人机验证失败，请重试", 403);
  if (!courseId || !teacherId || !overall)
    return fail(c, "请选择有效的课程、任课教师和总体评分");
  const course = offeringId
    ? await c.env.DB.prepare(
        `SELECT c.id course_id,c.category,o.term offering_term
         FROM offerings o JOIN courses c ON c.id=o.course_id
         JOIN offering_teachers ot ON ot.offering_id=o.id
         JOIN course_teachers ct
           ON ct.course_id=o.course_id AND ct.teacher_id=ot.teacher_id
         WHERE o.id=? AND o.course_id=? AND o.status='active' AND ot.teacher_id=? LIMIT 1`,
      )
        .bind(offeringId, courseId, teacherId)
        .first<{ course_id: number; category: string; offering_term: string }>()
    : await c.env.DB.prepare(
        `SELECT c.id course_id,c.category FROM courses c JOIN course_teachers ct ON ct.course_id=c.id WHERE c.id=? AND ct.teacher_id=? LIMIT 1`,
      )
        .bind(courseId, teacherId)
        .first<{
          course_id: number;
          category: string;
          offering_term?: string;
        }>();
  if (course) courseId = course.course_id;
  if (!course || !overall)
    return fail(c, "请选择有效的课程、任课教师和总体评分");
  const clarity = rating(b.clarity),
    knowledge = rating(b.knowledge),
    gradingScore = rating(b.gradingScore),
    workloadScore = rating(b.workloadScore),
    fairness = rating(b.fairness);
  const provided = (value: unknown) =>
    value !== undefined && value !== null && value !== "";
  if (
    (provided(b.clarity) && !clarity) ||
    (provided(b.knowledge) && !knowledge) ||
    (provided(b.gradingScore) && !gradingScore) ||
    (provided(b.workloadScore) && !workloadScore) ||
    (provided(b.fairness) && !fairness)
  )
    return fail(c, "评分必须在 1 到 5 之间");
  if (!(await takeRateLimit(c.env.DB, `review-submit:${ipHash}`, 3600, 5)))
    return fail(c, "提交过于频繁，请稍后再试", 429);
  const term = offeringId
    ? clean(course.offering_term, 30)
    : clean(b.term, 30);
  const dedupeKey = await digest(
    `${courseId}|${teacherId}|${offeringId || 0}|${term}|${ipHash}`,
  );
  await c.env.DB.prepare(
    "DELETE FROM review_dedupe WHERE key=? AND created_at<datetime('now','-30 days')",
  )
    .bind(dedupeKey)
    .run();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO review_dedupe(key) VALUES(?)").bind(
        dedupeKey,
      ),
      c.env.DB.prepare(
        `INSERT INTO reviews(course_id,teacher_id,offering_id,category,attendance,grading,grading_score,workload,rescue,assessment,teaching,clarity,knowledge,interest,practicality,workload_score,fairness,organization,overall,comment,term,submitter_hash)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        courseId,
        teacherId,
        offeringId,
        course.category,
        clean(b.attendance, 120),
        clean(b.grading, 120),
        gradingScore,
        clean(b.workload, 120),
        "",
        clean(b.assessment, 200),
        clean(b.teaching, 600),
        clarity,
        knowledge,
        null,
        null,
        workloadScore,
        fairness,
        null,
        overall,
        clean(b.comment, 1200),
        term,
        ipHash,
      ),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      return fail(c, "近期已提交过这位教师的同一课程评价", 409);
    throw error;
  }
  return c.json({ ok: true, message: "投稿已进入审核队列" });
});
app.post("/api/catalog-requests", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  if (clean(b.website)) return c.json({ ok: true });
  const captchaMode = turnstileMode(
    c.env.TURNSTILE_SITE_KEY,
    await readSecret(c.env.TURNSTILE_SECRET),
  );
  if (captchaMode === "secret-only")
    return fail(c, "人机验证配置异常", 503);
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  const kind = clean(b.kind, 20),
    courseCode = clean(b.courseCode, 40),
    courseName = clean(b.courseName, 200),
    category = clean(b.category, 20),
    teacherSourceLabel = clean(b.teacherSourceLabel, 120),
    department = clean(b.department, 80),
    ip = c.req.header("CF-Connecting-IP") || "unknown",
    ipHash = await keyedDigest(ip, await readSecret(c.env.IP_HASH_SECRET));
  if (!(await verifyTurnstile(c, clean(b.turnstileToken, 2048), ip)))
    return fail(c, "人机验证失败，请重试", 403);
  if (!["course", "teacher"].includes(kind))
    return fail(c, "申请类型必须是 course 或 teacher");
  if (kind === "teacher" && (courseCode || courseName || category || b.review != null))
    return fail(c, "教师申请不得携带课程字段或随附评价");
  if (kind === "course" && (!courseCode || !courseName))
    return fail(c, "请填写课号和课程名称");
  if (!teacherSourceLabel) return fail(c, "请填写来源教师名");
  if (kind === "course" && !category) return fail(c, "请选择评价模板类型");
  if (category && !["general", "sports"].includes(category))
    return fail(c, "评价模板类型必须为 general 或 sports");
  const rawReview = b.review;
  if (
    rawReview !== undefined &&
    rawReview !== null &&
    (typeof rawReview !== "object" || Array.isArray(rawReview))
  )
    return fail(c, "随附评价格式无效");
  const review = rawReview as Record<string, unknown> | null;
  if (review && (!courseCode || !courseName || !teacherSourceLabel))
    return fail(c, "随附评价必须同时填写课程和教师，以便绑定任课关系");
  const overall = review ? rating(review.overall) : null;
  if (review && !overall) return fail(c, "随附评价必须包含 1 到 5 的总体评分");
  const reviewScores = review
    ? {
        clarity: rating(review.clarity),
        knowledge: rating(review.knowledge),
        gradingScore: rating(review.gradingScore),
        workloadScore: rating(review.workloadScore),
        fairness: rating(review.fairness),
      }
    : null;
  if (
    review &&
    Object.entries({
      clarity: review.clarity,
      knowledge: review.knowledge,
      gradingScore: review.gradingScore,
      workloadScore: review.workloadScore,
      fairness: review.fairness,
    }).some(
      ([field, value]) =>
        value !== undefined && value !== null && value !== "" &&
        !reviewScores?.[field as keyof typeof reviewScores],
    )
  )
    return fail(c, "评分必须在 1 到 5 之间");
  const stashedReview: StashedReview | null = review
    ? {
        attendance: clean(review.attendance, 120),
        grading: clean(review.grading, 120),
        gradingScore: reviewScores?.gradingScore || null,
        workload: clean(review.workload, 120),
        rescue: clean(review.rescue, 120),
        assessment: clean(review.assessment, 200),
        teaching: clean(review.teaching, 600),
        clarity: reviewScores?.clarity || null,
        knowledge: reviewScores?.knowledge || null,
        workloadScore: reviewScores?.workloadScore || null,
        fairness: reviewScores?.fairness || null,
        overall: overall as number,
        comment: clean(review.comment, 1200),
        term: clean(review.term, 30),
      }
    : null;
  if (!(await takeRateLimit(c.env.DB, `catalog-request:${ipHash}`, 3600, 5)))
    return fail(c, "提交过于频繁，请稍后再试", 429);
  const result = await c.env.DB.prepare(
    `INSERT INTO catalog_requests(kind,course_code,course_name,category,teacher_name,teacher_source_label,department,note,pending_review_json,submitter_hash)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      kind,
      courseCode,
      courseName,
      category,
      teacherSourceLabel,
      teacherSourceLabel,
      department,
      clean(b.note, 500),
      stashedReview ? JSON.stringify(stashedReview) : "",
      ipHash,
    )
    .run();
  return c.json({
    ok: true,
    id: Number(result.meta.last_row_id),
    message: "补充申请已提交，待管理员审核",
  });
});

// Admin password sessions are separate from ordinary-user campus JWT.
app.post("/api/admin/login", async (c) => {
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  const ipHash = await keyedDigest(
    c.req.header("CF-Connecting-IP") || "unknown",
    await readSecret(c.env.IP_HASH_SECRET),
  );
  if (!(await takeRateLimit(c.env.DB, `admin-login:${ipHash}`, 900, 8)))
    return fail(c, "登录尝试过多，请稍后再试", 429);
  const b = await c.req.json<{ password?: string }>();
  const adminPassword = await readSecret(c.env.ADMIN_PASSWORD);
  const ok =
    !!adminPassword && clean(b.password, 200) === adminPassword;
  await c.env.DB.prepare(
    "INSERT INTO admin_login_attempts(ip_hash,success) VALUES(?,?)",
  )
    .bind(ipHash, ok ? 1 : 0)
    .run();
  if (!ok) return fail(c, "口令错误", 401);
  const raw = token(),
    sessionId = token().slice(0, 32),
    csrf = token();
  await c.env.DB.prepare(
    `INSERT INTO admin_sessions(token_hash,csrf_token,ip_hash,expires_at,session_id) VALUES(?,?,?,datetime('now','+24 hours'),?)`,
  )
    .bind(await digest(raw), csrf, ipHash, sessionId)
    .run();
  setCookie(c, "jufexk_admin", raw, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 86400,
  });
  setCookie(c, "jufexk_csrf", csrf, {
    httpOnly: false,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 86400,
  });
  return c.json({ ok: true, kind: "admin", csrfToken: csrf });
});
app.use("/api/admin/*", async (c, next) => {
  const raw = getCookie(c, "jufexk_admin");
  if (!raw) return fail(c, "请先登录管理员后台", 401);
  const session = await c.env.DB.prepare(
    `SELECT token_hash,session_id,csrf_token FROM admin_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP`,
  )
    .bind(await digest(raw))
    .first<{ token_hash: string; session_id: string; csrf_token: string }>();
  if (!session) return fail(c, "会话已失效，请重新登录", 401);
  c.set("adminSession", session.token_hash);
  c.set("adminSessionId", session.session_id);
  c.set("adminCsrf", session.csrf_token);
  if (
    c.req.method !== "GET" &&
    (!originOk(c) || !csrfOk(c, session.csrf_token))
  )
    return fail(c, "安全校验失败，请刷新后重试", 403);
  await next();
});
app.get("/api/admin/session", (c) =>
  c.json({ ok: true, kind: "admin", csrfToken: c.get("adminCsrf") }),
);
const relationAdditionFailure = (c: AppContext, error: unknown) => {
  if (error instanceof CatalogRelationAdditionError)
    return fail(c, error.message, error.status);
  throw error;
};
const historicalBatchFailure = (c: AppContext, error: unknown) => {
  if (error instanceof HistoricalBatchImportError)
    return fail(c, error.message, error.status);
  throw error;
};
const readOfficialRelationPackage = async (c: AppContext) => {
  const body = await c.req.json<{
    manifest?: unknown;
    artifact?: unknown;
    pairs?: unknown;
  }>();
  if (body.pairs != null)
    throw new CatalogRelationAdditionError(
      "官方任课关系入口只接受候选包，pairs 请走 /api/admin/import/relations",
    );
  if (typeof body.manifest === "string" && typeof body.artifact === "string")
    return parseOfficialRelationPackage(
      body.manifest,
      body.artifact,
      c.env.ISSUE111_RELATION_MANIFEST_SHA256 || "manifest",
    );
  throw new CatalogRelationAdditionError("缺少任课关系补充包");
};
const readRedundantRelationPairs = async (c: AppContext) => {
  const body = await c.req.json<{
    manifest?: unknown;
    artifact?: unknown;
    pairs?: unknown;
  }>();
  if (Array.isArray(body.pairs)) return parseRelationPairs(body.pairs);
  if (typeof body.manifest === "string" && typeof body.artifact === "string")
    return parseOfficialRelationPackage(
      body.manifest,
      body.artifact,
      c.env.ISSUE111_RELATION_MANIFEST_SHA256 || "manifest",
    );
  throw new CatalogRelationAdditionError("缺少任课关系补充包或 pairs 列表");
};
app.post("/api/admin/catalog-relation-additions/preview", async (c) => {
  try {
    return c.json(
      await previewRelationAdditions(
        c.env.DB,
        await readOfficialRelationPackage(c),
      ),
    );
  } catch (error) {
    return relationAdditionFailure(c, error);
  }
});
app.post("/api/admin/catalog-relation-additions", async (c) => {
  try {
    const result = await applyRelationAdditions(
      c.env.DB,
      await readOfficialRelationPackage(c),
    );
    return c.json(result, result.created ? 201 : 200);
  } catch (error) {
    return relationAdditionFailure(c, error);
  }
});
app.post("/api/admin/import/relations/preview", async (c) => {
  try {
    return c.json(
      await previewRelationAdditions(
        c.env.DB,
        await readRedundantRelationPairs(c),
      ),
    );
  } catch (error) {
    return relationAdditionFailure(c, error);
  }
});
app.post("/api/admin/import/relations", async (c) => {
  try {
    const result = await applyRelationAdditions(
      c.env.DB,
      await readRedundantRelationPairs(c),
    );
    return c.json(result, result.created ? 201 : 200);
  } catch (error) {
    return relationAdditionFailure(c, error);
  }
});
app.post("/api/admin/historical-review-batch-imports", async (c) => {
  try {
    const result = await importIssue111HistoricalBatch(
      c.env.DB,
      await c.req.json(),
      c.env.ISSUE111_IMPORT_MANIFEST_SHA256 || "manifest",
      c.env.ISSUE111_IMPORT_ARTIFACT_SHA256 || "manifest",
    );
    return c.json(result, result.created ? 201 : 200);
  } catch (error) {
    return historicalBatchFailure(c, error);
  }
});
app.post("/api/admin/historical-review-imports", async (c) => {
  type HistoricalImportManifest = {
    contractVersion?: unknown;
    contentSha256?: unknown;
    status?: unknown;
    counts?: {
      importable?: unknown;
      catalogRelationUnavailable?: unknown;
    };
    files?: Record<string, { rows?: unknown; sha256?: unknown }>;
    schemas?: Record<string, unknown>;
    lineage?: {
      approvedCatalogContentSha256?: unknown;
      approvedPackageManifestSha256?: unknown;
      approvedPackageContract?: unknown;
    };
  };
  const body = await c.req.json<{
    manifest?: unknown;
    artifact?: unknown;
    offset?: unknown;
  }>();
  const configuredManifestSha256 = c.env.HISTORICAL_IMPORT_MANIFEST_SHA256;
  if (
    typeof body.manifest !== "string" ||
    (configuredManifestSha256 !== "manifest" &&
      (await digest(body.manifest)) !== configuredManifestSha256)
  )
    return fail(c, "历史评价冻结 manifest 哈希不匹配", 422);
  let manifest: HistoricalImportManifest;
  try {
    manifest = JSON.parse(body.manifest) as HistoricalImportManifest;
  } catch {
    return fail(c, "历史评价冻结 manifest 不是有效 JSON", 422);
  }
  if (
    manifest?.contractVersion !== HISTORICAL_FREEZE_CONTRACT ||
    manifest.contentSha256 !== HISTORICAL_FREEZE_CONTENT_SHA256 ||
    manifest.status !== "package_ready" ||
    manifest.counts?.importable !== HISTORICAL_IMPORTABLE_COUNT ||
    manifest.counts.catalogRelationUnavailable !==
      HISTORICAL_RELATION_UNAVAILABLE_COUNT ||
    manifest.schemas?.["importable-legacy-reviews.jsonl"] !==
      HISTORICAL_RECORD_SCHEMA ||
    manifest.lineage?.approvedPackageContract !== HISTORICAL_SOURCE_CONTRACT ||
    manifest.lineage?.approvedPackageManifestSha256 !==
      APPROVED_HISTORICAL_MANIFEST_SHA256 ||
    manifest.lineage?.approvedCatalogContentSha256 !==
      APPROVED_CATALOG_CONTENT_SHA256
  )
    return fail(c, "历史评价批准包身份或内容哈希不匹配", 422);

  const artifactDescriptor =
    manifest.files?.["importable-legacy-reviews.jsonl"];
  const configuredArtifactSha256 = c.env.HISTORICAL_IMPORT_ARTIFACT_SHA256;
  const expectedArtifactSha256 =
    configuredArtifactSha256 === "manifest"
      ? artifactDescriptor?.sha256
      : configuredArtifactSha256;
  if (
    typeof body.artifact !== "string" ||
    !body.artifact.endsWith("\n") ||
    artifactDescriptor?.rows !== HISTORICAL_IMPORTABLE_COUNT ||
    typeof expectedArtifactSha256 !== "string" ||
    artifactDescriptor.sha256 !== expectedArtifactSha256 ||
    (await digest(body.artifact)) !== expectedArtifactSha256
  )
    return fail(c, "历史评价可导入 artifact 哈希或行数不匹配", 422);

  let records: Record<string, unknown>[];
  try {
    records = body.artifact
      .slice(0, -1)
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return fail(c, "历史评价 artifact 不是有效 JSONL", 422);
  }
  if (records.length !== HISTORICAL_IMPORTABLE_COUNT)
    return fail(c, "历史评价 artifact 行数不匹配", 422);
  if (
    typeof body.offset !== "number" ||
    !Number.isInteger(body.offset) ||
    body.offset < 0 ||
    body.offset >= HISTORICAL_IMPORTABLE_COUNT ||
    body.offset % 50 !== 0
  )
    return fail(c, "历史评价批次偏移量不合法", 422);

  const requiredFields = new Set([
    "catalog_course_code",
    "catalog_teacher_label",
    "category",
    "comment",
    "decision_basis",
    "duplicate_group",
    "proposed_teacher_label",
    "review_id",
    "schema_version",
    "source_column",
    "source_evaluation_id",
    "source_row",
    "worksheet",
  ]);
  const selectedRecords = records.slice(body.offset, body.offset + 50);
  const seen = new Set<string>();
  const pending: Array<{
    reviewId: string;
    courseId: number;
    teacherId: number;
    comment: string;
  }> = [];
  let existingCount = 0;
  for (const record of selectedRecords) {
    if (
      !record ||
      Object.keys(record).length !== requiredFields.size ||
      Object.keys(record).some((field) => !requiredFields.has(field)) ||
      record.schema_version !== HISTORICAL_RECORD_SCHEMA
    )
      return fail(c, "历史评价记录不符合批准包固定 schema", 422);

    const reviewId = clean(record.review_id, 200);
    const courseCode = clean(record.catalog_course_code, 100);
    const teacherLabel = clean(record.catalog_teacher_label, 200);
    const comment = clean(record.comment, 4000);
    if (!reviewId || !courseCode || !teacherLabel || !comment)
      return fail(c, "历史评价记录缺少稳定身份、目录身份或正文", 422);
    if (seen.has(reviewId)) return fail(c, "历史评价批次包含重复稳定身份", 422);
    seen.add(reviewId);

    const identity = await c.env.DB.prepare(
      `SELECT c.id course_id,t.id teacher_id,
           EXISTS(
             SELECT 1 FROM course_teachers ct
             WHERE ct.course_id=c.id AND ct.teacher_id=t.id
           ) relation_exists
         FROM courses c CROSS JOIN teachers t
         WHERE c.code=? AND t.source_teacher_label=?`,
    )
      .bind(courseCode, teacherLabel)
      .first<{ course_id: number; teacher_id: number; relation_exists: number }>();
    if (!identity || !identity.relation_exists)
      return fail(c, "历史评价引用的课程、教师或任课关系不存在", 422);

    const existing = await c.env.DB.prepare(
      `SELECT course_id,teacher_id,comment FROM public_historical_reviews WHERE id=?`,
    )
      .bind(reviewId)
      .first<{ course_id: number; teacher_id: number; comment: string }>();
    if (existing) {
      if (
        existing.course_id !== identity.course_id ||
        existing.teacher_id !== identity.teacher_id ||
        existing.comment !== comment
      )
        return fail(c, "稳定评价身份已绑定到不同内容", 409);
      existingCount += 1;
      continue;
    }
    pending.push({
      reviewId,
      courseId: identity.course_id,
      teacherId: identity.teacher_id,
      comment,
    });
  }

  let createdCount = 0;
  if (pending.length) {
    const insertResults = await c.env.DB.batch(
      pending.map(({ reviewId, courseId, teacherId, comment }) =>
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO public_historical_reviews(
             id,course_id,teacher_id,comment,package_contract,
             approved_package_manifest_sha256,approved_catalog_content_sha256
           ) VALUES(?,?,?,?,?,?,?)`,
        ).bind(
          reviewId,
          courseId,
          teacherId,
          comment,
          HISTORICAL_FREEZE_CONTRACT,
          APPROVED_HISTORICAL_MANIFEST_SHA256,
          APPROVED_CATALOG_CONTENT_SHA256,
        ),
      ),
    );
    createdCount = insertResults.reduce(
      (total, result) => total + Number(result.meta.changes ?? 0),
      0,
    );
    existingCount += pending.length - createdCount;
  }
  return c.json(
    {
      offset: body.offset,
      total: selectedRecords.length,
      created: createdCount,
      existing: existingCount,
    },
    createdCount ? 201 : 200,
  );
});
app.post("/api/admin/logout", async (c) => {
  await c.env.DB.prepare(
    "UPDATE admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?",
  )
    .bind(c.get("adminSession"))
    .run();
  deleteCookie(c, "jufexk_admin", { path: "/" });
  deleteCookie(c, "jufexk_csrf", { path: "/" });
  return c.json({ ok: true });
});
app.get("/api/admin/sessions", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM admin_sessions WHERE expires_at<datetime('now','-7 days')",
    ),
    c.env.DB.prepare(
      "DELETE FROM rate_limit_counters WHERE window_start<unixepoch()-86400",
    ),
    c.env.DB.prepare(
      "DELETE FROM review_dedupe WHERE created_at<datetime('now','-30 days')",
    ),
    c.env.DB.prepare(
      "DELETE FROM admin_login_attempts WHERE created_at<datetime('now','-30 days')",
    ),
  ]);
  const sessions = (
    await c.env.DB.prepare(
      `SELECT session_id,created_at,expires_at,revoked_at
       FROM admin_sessions ORDER BY created_at DESC LIMIT 100`,
    ).all()
  ).results.map((row: any) => ({
    ...row,
    current: row.session_id === c.get("adminSessionId"),
  }));
  return c.json({ sessions });
});
app.post("/api/admin/sessions/:id/revoke", async (c) => {
  const id = clean(c.req.param("id"), 64);
  if (id === c.get("adminSessionId"))
    return fail(c, "请使用退出功能注销当前会话", 400);
  const result = await c.env.DB.prepare(
    "UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE session_id=?",
  )
    .bind(id)
    .run();
  return c.json({ ok: true, count: result.meta.changes || 0 });
});
app.post("/api/admin/sessions/revoke-others", async (c) => {
  const result = await c.env.DB.prepare(
    "UPDATE admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_id<>? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP",
  )
    .bind(c.get("adminSessionId"))
    .run();
  return c.json({ ok: true, count: result.meta.changes || 0 });
});
app.get("/api/admin/reviews", async (c) => {
  const { page, size } = pageArgs(c),
    status = clean(c.req.query("status"), 20) || "pending",
    q = `%${clean(c.req.query("q"), 80)}%`;
  if (!["pending", "approved", "rejected", "all"].includes(status))
    return fail(c, "无效审核状态");
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM reviews r JOIN courses c ON c.id=r.course_id LEFT JOIN teachers t ON t.id=r.teacher_id WHERE (?='all' OR r.status=?) AND(c.name LIKE ? OR c.code LIKE ? OR t.name LIKE ? OR r.comment LIKE ? OR r.teaching LIKE ? OR r.term LIKE ?)`,
  )
    .bind(status, status, q, q, q, q, q, q)
    .first<{ n: number }>();
  const results = (
    await c.env.DB.prepare(
      `SELECT r.id,r.course_id,r.teacher_id,r.offering_id,r.category,
        r.attendance,r.grading,r.grading_score,r.workload,r.rescue,
        r.assessment,r.teaching,r.clarity,r.knowledge,r.overall,
        r.interest,r.practicality,r.workload_score,r.fairness,r.organization,
        r.comment,r.term,r.status,r.moderator_note,r.created_at,r.reviewed_at,
        c.name course_name,c.code,t.name teacher_name
       FROM reviews r JOIN courses c ON c.id=r.course_id
       LEFT JOIN teachers t ON t.id=r.teacher_id
       WHERE (?='all' OR r.status=?)
         AND(c.name LIKE ? OR c.code LIKE ? OR t.name LIKE ? OR r.comment LIKE ? OR r.teaching LIKE ? OR r.term LIKE ?)
       ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(status, status, q, q, q, q, q, q, size, (page - 1) * size)
      .all()
  ).results;
  return c.json({
    items: results,
    total: total?.n || 0,
    page,
    pages: Math.ceil((total?.n || 0) / size),
  });
});
app.get("/api/admin/catalog-requests", async (c) => {
  const { page, size } = pageArgs(c),
    status = clean(c.req.query("status"), 20) || "pending";
  if (!["pending", "approved", "rejected", "all"].includes(status))
    return fail(c, "无效审核状态");
  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) n FROM catalog_requests WHERE (?='all' OR status=?)",
  )
    .bind(status, status)
    .first<{ n: number }>();
  const results = (
    await c.env.DB.prepare(
      `SELECT id,kind,course_code,course_name,category,teacher_name,teacher_source_label,department,note,status,moderator_note,
              created_course_id,created_teacher_id,created_review_id,created_at,reviewed_at,
              pending_review_json<>'' AS has_review
       FROM catalog_requests WHERE (?='all' OR status=?) ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(status, status, size, (page - 1) * size)
      .all()
  ).results;
  return c.json({
    items: results,
    total: total?.n || 0,
    page,
    pages: Math.ceil((total?.n || 0) / size),
  });
});
app.patch("/api/admin/catalog-requests/:id", async (c) => {
  const id = integer(c.req.param("id")),
    b = await c.req.json<Record<string, unknown>>(),
    status = clean(b.status, 20),
    note = clean(b.note, 500);
  if (!id) return fail(c, "无效申请 ID");
  if (!["approved", "rejected"].includes(status))
    return fail(c, "审核结果必须是 approved 或 rejected");
  const request = await c.env.DB.prepare(
    "SELECT * FROM catalog_requests WHERE id=?",
  )
    .bind(id)
    .first<Record<string, any>>();
  if (!request) return fail(c, "补充申请不存在", 404);
  if (request.status !== "pending")
    return fail(c, "该申请已审核，不能重复处理", 409);
  if (status === "rejected") {
    if (!note) return fail(c, "驳回必须填写理由");
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE catalog_requests SET status='rejected',moderator_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",
      ).bind(note, id),
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO catalog_request_moderation_events(
           catalog_request_id,action,note,actor_session_id
         )
         SELECT ?,?,?,? WHERE EXISTS(
           SELECT 1 FROM catalog_requests WHERE id=? AND status='rejected'
         ) AND NOT EXISTS(
           SELECT 1 FROM catalog_request_moderation_events
           WHERE catalog_request_id=?
         )`,
      ).bind(id, status, note, c.get("adminSessionId"), id, id),
    ]);
    if (!(results[0].meta.changes || 0))
      return fail(c, "该申请已审核，不能重复处理", 409);
    return c.json({ ok: true });
  }
  const statements: D1PreparedStatement[] = [];
  const createsCourse = request.kind === "course";
  const createsReview = createsCourse && Boolean(request.pending_review_json);
  if (createsReview && (!request.course_code || !request.course_name || !request.teacher_source_label))
    return fail(c, "暂存评价无法绑定课程与任课教师", 409);
  if (request.teacher_source_label)
    statements.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO teachers(source_teacher_label,name,department)
         SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM catalog_requests WHERE id=? AND status='pending')`,
      ).bind(
        request.teacher_source_label,
        request.teacher_name || request.teacher_source_label,
        nullableClean(request.department, 80),
        id,
      ),
    );
  if (createsCourse && request.course_code && request.course_name)
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO courses(code,name,category,department)
         SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM catalog_requests WHERE id=? AND status='pending')
         ON CONFLICT(code) DO UPDATE SET name=excluded.name`,
      ).bind(
        request.course_code,
        request.course_name,
        request.category,
        request.department,
        id,
      ),
    );
  if (createsCourse && request.course_code && request.teacher_source_label)
    statements.push(
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO course_teachers(course_id,teacher_id)
         SELECT c.id,t.id FROM courses c,teachers t
         WHERE c.code=? AND t.source_teacher_label=?
           AND EXISTS(SELECT 1 FROM catalog_requests WHERE id=? AND status='pending')`,
      ).bind(
        request.course_code,
        request.teacher_source_label,
        id,
      ),
    );
  if (createsReview) {
    const stashed = parseStashedReview(request.pending_review_json);
    if (!stashed) return fail(c, "暂存评价数据无效", 409);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO reviews(
           course_id,teacher_id,category,attendance,grading,grading_score,
           workload,rescue,assessment,teaching,clarity,knowledge,
           workload_score,fairness,overall,comment,
           term,submitter_hash
         )
         SELECT c.id,t.id,c.category,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
         FROM courses c,teachers t
         WHERE c.code=? AND t.source_teacher_label=?
           AND EXISTS(SELECT 1 FROM catalog_requests WHERE id=? AND status='pending')`,
      ).bind(
        stashed.attendance || "",
        stashed.grading || "",
        stashed.gradingScore ?? null,
        stashed.workload || "",
        stashed.rescue || "",
        stashed.assessment || "",
        stashed.teaching || "",
        stashed.clarity ?? null,
        stashed.knowledge ?? null,
        stashed.workloadScore ?? null,
        stashed.fairness ?? null,
        stashed.overall,
        stashed.comment || "",
        stashed.term || "",
        request.submitter_hash,
        request.course_code,
        request.teacher_source_label,
        id,
      ),
    );
  }
  const updateIndex = statements.length;
  statements.push(
    c.env.DB.prepare(
      `UPDATE catalog_requests SET status='approved',moderator_note=?,reviewed_at=CURRENT_TIMESTAMP,
         created_course_id=CASE WHEN ?='course' THEN (SELECT id FROM courses WHERE code=?) ELSE NULL END,
         created_teacher_id=(SELECT id FROM teachers WHERE source_teacher_label=?),
         created_review_id=${createsReview ? "last_insert_rowid()" : "NULL"}
       WHERE id=? AND status='pending'`,
    ).bind(
      note,
      request.kind,
      request.course_code,
      request.teacher_source_label,
      id,
    ),
  );
  statements.push(
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO catalog_request_moderation_events(
         catalog_request_id,action,note,actor_session_id
       )
       SELECT ?,?,?,? WHERE EXISTS(
         SELECT 1 FROM catalog_requests WHERE id=? AND status='approved'
       ) AND NOT EXISTS(
         SELECT 1 FROM catalog_request_moderation_events
         WHERE catalog_request_id=?
       )`,
    ).bind(id, status, note, c.get("adminSessionId"), id, id),
  );
  const results = await c.env.DB.batch(statements);
  if (!(results[updateIndex].meta.changes || 0))
    return fail(c, "该申请已审核，不能重复处理", 409);
  const approved = await c.env.DB.prepare(
    "SELECT created_course_id courseId,created_teacher_id teacherId,created_review_id reviewId FROM catalog_requests WHERE id=?",
  )
    .bind(id)
    .first<{
      courseId: number | null;
      teacherId: number | null;
      reviewId: number | null;
    }>();
  return c.json({ ok: true, ...approved });
});
app.get("/api/admin/catalog-requests/:id/events", async (c) => {
  const id = integer(c.req.param("id"));
  if (
    !(await c.env.DB.prepare("SELECT 1 FROM catalog_requests WHERE id=?")
      .bind(id)
      .first())
  )
    return fail(c, "补充申请不存在", 404);
  return c.json(
    (
      await c.env.DB.prepare(
        `SELECT id,action,note,created_at
         FROM catalog_request_moderation_events
         WHERE catalog_request_id=?
         ORDER BY created_at DESC,id DESC`,
      )
        .bind(id)
        .all()
    ).results,
  );
});
app.patch("/api/admin/reviews/:id", async (c) => {
  const b = await c.req.json<Record<string, unknown>>(),
    status = clean(b.status, 20),
    note = clean(b.note, 500),
    id = integer(c.req.param("id"));
  if (!id) return fail(c, "评价 ID 无效");
  if (!["approved", "rejected"].includes(status)) return fail(c, "无效状态");
  if (status === "rejected" && !note) return fail(c, "驳回时必须填写理由");
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE reviews SET status=?,moderator_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",
    ).bind(status, note, id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO review_moderation_events(review_id,action,note)
       SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM reviews WHERE id=? AND status=?)
       AND NOT EXISTS(
         SELECT 1 FROM review_moderation_events
         WHERE review_id=? AND action IN('approved','rejected')
       )`,
    ).bind(id, status, note, id, status, id),
  ]);
  if (!(results[0].meta.changes || 0)) {
    const exists = await c.env.DB.prepare("SELECT 1 FROM reviews WHERE id=?")
      .bind(id)
      .first();
    return exists
      ? fail(c, "评价已经审核", 409)
      : fail(c, "评价不存在", 404);
  }
  return c.json({ ok: true });
});
app.patch("/api/admin/reviews/:id/content", async (c) => {
  const b = await c.req.json<Record<string, unknown>>(),
    id = integer(c.req.param("id"));
  const current = await c.env.DB.prepare("SELECT id FROM reviews WHERE id=?")
    .bind(id)
    .first();
  if (!current) return fail(c, "评价不存在", 404);
  const scoreFields = [
    ["clarity", "clarity"],
    ["knowledge", "knowledge"],
    ["gradingScore", "grading_score"],
    ["workloadScore", "workload_score"],
    ["fairness", "fairness"],
  ] as const;
  const rawScores = scoreFields.map(([field]) => b[field]);
  const scores = rawScores.map((value) => (value === undefined ? null : rating(value)));
  if (
    rawScores.some(
      (value, index) =>
        value !== undefined && value !== "" && value != null && !scores[index],
    )
  )
    return fail(c, "评分必须在 1 到 5 之间");
  const updates: string[] = [];
  const values: unknown[] = [];
  const textFields = [
    ["comment", "comment", 1200],
    ["teaching", "teaching", 600],
    ["attendance", "attendance", 120],
    ["grading", "grading", 120],
    ["workload", "workload", 120],
    ["assessment", "assessment", 200],
  ] as const;
  for (const [field, column, max] of textFields) {
    if (Object.hasOwn(b, field)) {
      updates.push(`${column}=?`);
      values.push(clean(b[field], max));
    }
  }
  scoreFields.forEach(([field, column], index) => {
    if (rawScores[index] !== undefined) {
      updates.push(`${column}=?`);
      values.push(scores[index]);
    }
  });
  updates.push("rescue=''", "interest=NULL", "practicality=NULL", "organization=NULL");
  const update = c.env.DB.prepare(`UPDATE reviews SET ${updates.join(",")} WHERE id=?`).bind(
    ...values,
    id,
  );
  const event = c.env.DB.prepare(
    `INSERT INTO review_moderation_events(review_id,action,note)
     SELECT ?,'edited',? WHERE EXISTS(SELECT 1 FROM reviews WHERE id=?)`,
  ).bind(id, clean(b.note, 500), id);
  const results = await c.env.DB.batch([update, event]);
  if (!(results[0].meta.changes || 0)) return fail(c, "评价不存在", 404);
  return c.json({ ok: true });
});
app.get("/api/admin/reviews/:id/events", async (c) => {
  const id = integer(c.req.param("id"));
  const review = await c.env.DB.prepare("SELECT id FROM reviews WHERE id=?")
    .bind(id)
    .first();
  if (!review) return fail(c, "评价不存在", 404);
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,action,note,created_at FROM review_moderation_events WHERE review_id=? ORDER BY created_at DESC",
      )
        .bind(id)
        .all()
    ).results,
  );
});
app.get("/api/admin/legacy-reviews", async (c) => {
  const { page, size } = pageArgs(c),
    status = clean(c.req.query("status"), 20) || "pending",
    batchId = clean(c.req.query("batchId"), 80),
    q = `%${clean(c.req.query("q"), 100)}%`;
  if (!["pending", "approved", "rejected", "all"].includes(status))
    return fail(c, "无效历史审核状态");
  const where = `(?='all' OR lr.status=?) AND (?='' OR lr.import_batch_id=?) AND
    (lr.comment LIKE ? OR lr.raw_ocr_text LIKE ? OR lr.ocr_course_name LIKE ? OR lr.ocr_teacher_name LIKE ? OR lr.source_file LIKE ? OR lr.term LIKE ? OR c.name LIKE ? OR c.code LIKE ? OR t.name LIKE ?)`;
  const values = [status, status, batchId, batchId, q, q, q, q, q, q, q, q, q];
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM legacy_reviews lr LEFT JOIN courses c ON c.id=lr.course_id LEFT JOIN teachers t ON t.id=lr.teacher_id WHERE ${where}`,
  )
    .bind(...values)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT lr.id,lr.import_batch_id,lr.source_file,lr.sheet_name,lr.source_row,lr.raw_ocr_text,
      lr.ocr_confidence,lr.inherited_from,lr.ocr_course_name,lr.course_id,lr.ocr_teacher_name,
      lr.teacher_id,lr.offering_id,lr.category,lr.comment,lr.term,lr.source_type,lr.source_label,
      lr.status,lr.duplicate_group,lr.duplicate_action,lr.review_note,
      lr.moderator_note,lr.created_at,lr.reviewed_at,
      c.name course_name,c.code,t.name teacher_name
     FROM legacy_reviews lr LEFT JOIN courses c ON c.id=lr.course_id LEFT JOIN teachers t ON t.id=lr.teacher_id
     WHERE ${where} ORDER BY lr.created_at DESC,lr.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...values, size, (page - 1) * size)
    .all();
  return c.json({
    items: results,
    total: total?.n || 0,
    page,
    pages: Math.max(1, Math.ceil((total?.n || 0) / size)),
  });
});
app.get("/api/admin/legacy-reviews/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const review = await c.env.DB.prepare(
    `SELECT lr.*,c.name course_name,c.code,t.name teacher_name,o.section offering_section
     FROM legacy_reviews lr LEFT JOIN courses c ON c.id=lr.course_id LEFT JOIN teachers t ON t.id=lr.teacher_id
     LEFT JOIN offerings o ON o.id=lr.offering_id WHERE lr.id=?`,
  )
    .bind(id)
    .first();
  if (!review) return fail(c, "历史评价不存在", 404);
  return c.json(review);
});
app.patch("/api/admin/legacy-reviews/:id", async (c) => {
  const id = integer(c.req.param("id")),
    body = await c.req.json<Record<string, unknown>>(),
    status = clean(body.status, 20),
    note = clean(body.note, 500);
  if (!["approved", "rejected"].includes(status)) return fail(c, "无效状态");
  if (status === "rejected" && !note) return fail(c, "驳回时必须填写理由");
  const current = await c.env.DB.prepare(
    "SELECT status FROM legacy_reviews WHERE id=?",
  )
    .bind(id)
    .first<{ status: string }>();
  if (!current) return fail(c, "历史评价不存在", 404);
  if (current.status !== "pending") return fail(c, "历史评价已经审核", 409);
  const approvalBindingGuard = status === "approved"
    ? ` AND EXISTS(
         SELECT 1 FROM legacy_reviews candidate
         JOIN courses course
           ON course.id=candidate.course_id AND course.category=candidate.category
         JOIN teachers teacher ON teacher.id=candidate.teacher_id
         JOIN course_teachers relation
           ON relation.course_id=candidate.course_id
          AND relation.teacher_id=candidate.teacher_id
         WHERE candidate.id=legacy_reviews.id
           AND (
             candidate.offering_id IS NULL OR EXISTS(
               SELECT 1 FROM offerings offering
               JOIN offering_teachers assigned
                 ON assigned.offering_id=offering.id
                AND assigned.teacher_id=candidate.teacher_id
               WHERE offering.id=candidate.offering_id
                 AND offering.course_id=candidate.course_id
                 AND trim(offering.term)=trim(candidate.term)
             )
           )
       )`
    : "";
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE legacy_reviews
       SET status=?,moderator_note=?,reviewed_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='pending'${approvalBindingGuard}`,
    ).bind(status, note, id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO legacy_review_moderation_events(legacy_review_id,action,note,actor_session_id)
       SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM legacy_reviews WHERE id=? AND status=?)`,
    ).bind(id, status, note, c.get("adminSessionId"), id, status),
  ]);
  if (!(results[0].meta.changes || 0))
    return fail(c, "历史评价绑定已经失效，或评价已经审核", 409);
  return c.json({ ok: true, id, status });
});
app.get("/api/admin/legacy-reviews/:id/events", async (c) => {
  const id = integer(c.req.param("id"));
  if (
    !(await c.env.DB.prepare("SELECT 1 FROM legacy_reviews WHERE id=?")
      .bind(id)
      .first())
  )
    return fail(c, "历史评价不存在", 404);
  const { results } = await c.env.DB.prepare(
    "SELECT id,action,note,created_at FROM legacy_review_moderation_events WHERE legacy_review_id=? ORDER BY created_at DESC,id DESC",
  )
    .bind(id)
    .all();
  return c.json(results);
});
app.get("/api/admin/offerings", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        `SELECT o.*,c.name course_name,c.code,GROUP_CONCAT(t.id) teacher_ids,GROUP_CONCAT(t.name) teachers FROM offerings o JOIN courses c ON c.id=o.course_id LEFT JOIN offering_teachers ot ON ot.offering_id=o.id LEFT JOIN teachers t ON t.id=ot.teacher_id GROUP BY o.id ORDER BY o.term DESC,c.name,o.section`,
      ).all()
    ).results,
  ),
);
app.post("/api/admin/offerings", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const rawTeacherIds = Array.isArray(b.teacherIds) ? b.teacherIds : [];
  const parsedTeacherIds = rawTeacherIds.map(integer);
  if (parsedTeacherIds.some((teacherId) => teacherId === null || teacherId < 1))
    return fail(c, "任课教师列表无效");
  const courseId = integer(b.courseId),
    term = clean(b.term, 30),
    section = clean(b.section, 80),
    status = clean(b.status, 20) || "active",
    teacherIds = [...new Set(parsedTeacherIds as number[])];
  if (!courseId || !term || !section || !["active", "archived"].includes(status))
    return fail(c, "课程、学期、班次和状态无效");
  if (!teacherIds.length) return fail(c, "请至少选择一位任课教师");
  const courseExists = await c.env.DB.prepare(
    "SELECT id FROM courses WHERE id=?",
  )
    .bind(courseId)
    .first();
  if (!courseExists) return fail(c, "课程不存在", 400);
  const validTeachers = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM teachers WHERE id IN (${teacherIds.map(() => "?").join(",")})`,
  )
    .bind(...teacherIds)
    .first<{ n: number }>();
  if (validTeachers?.n !== teacherIds.length)
    return fail(c, "任课教师中存在无效记录");
  const relatedTeachers = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM course_teachers
     WHERE course_id=? AND teacher_id IN (${teacherIds.map(() => "?").join(",")})`,
  )
    .bind(courseId, ...teacherIds)
    .first<{ n: number }>();
  if (relatedTeachers?.n !== teacherIds.length)
    return fail(c, "任课教师不属于该课程");
  let offeringId = integer(b.id);
  const statements: D1PreparedStatement[] = [];
  if (offeringId) {
    const existing = await c.env.DB.prepare(
      "SELECT course_id,term,section FROM offerings WHERE id=?",
    )
      .bind(offeringId)
      .first<{ course_id: number; term: string; section: string }>();
    if (!existing) return fail(c, "开课班不存在", 404);
    const used = await c.env.DB.prepare(
      `SELECT 1 used FROM reviews WHERE offering_id=?
       UNION ALL
       SELECT 1 FROM legacy_reviews
       WHERE offering_id=? AND status IN('pending','approved')
       LIMIT 1`,
    )
      .bind(offeringId, offeringId)
      .first();
    if (
      used &&
      (existing.course_id !== courseId ||
        existing.term !== term ||
        existing.section !== section)
    )
      return fail(c, "已有评价的开课班不能修改课程、学期或班次", 409);
    const removedReviewedTeacher = await c.env.DB.prepare(
      `SELECT 1 FROM reviews
       WHERE offering_id=? AND teacher_id IS NOT NULL
         AND teacher_id NOT IN (${teacherIds.map(() => "?").join(",")})
       UNION ALL
       SELECT 1 FROM legacy_reviews
       WHERE offering_id=? AND status IN('pending','approved')
         AND teacher_id IS NOT NULL
         AND teacher_id NOT IN (${teacherIds.map(() => "?").join(",")})
       LIMIT 1`,
    )
      .bind(offeringId, ...teacherIds, offeringId, ...teacherIds)
      .first();
    if (removedReviewedTeacher)
      return fail(c, "已有评价的教师不能从开课班移除", 409);
    statements.push(
      c.env.DB.prepare(
        "UPDATE offerings SET course_id=?,term=?,section=?,campus=?,schedule=?,status=? WHERE id=?",
      ).bind(
        courseId,
        term,
        section,
        clean(b.campus, 80),
        clean(b.schedule, 160),
        status,
        offeringId,
      ),
    );
  } else {
    offeringId = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO offerings(id,course_id,term,section,campus,schedule,status) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        offeringId,
        courseId,
        term,
        section,
        clean(b.campus, 80),
        clean(b.schedule, 160),
        status,
      ),
    );
  }
  statements.push(
    c.env.DB.prepare("DELETE FROM offering_teachers WHERE offering_id=?").bind(
      offeringId,
    ),
    ...teacherIds.map((teacherId) =>
      c.env.DB.prepare(
        "INSERT INTO offering_teachers(offering_id,teacher_id) VALUES(?,?)",
      ).bind(offeringId, teacherId),
    ),
  );
  await c.env.DB.batch(statements);
  return c.json({ ok: true, id: offeringId });
});
app.delete("/api/admin/offerings/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const used = await c.env.DB.prepare(
    `SELECT id FROM reviews WHERE offering_id=?
     UNION ALL
     SELECT id FROM legacy_reviews
     WHERE offering_id=? AND status IN('pending','approved')
     LIMIT 1`,
  )
    .bind(id, id)
    .first();
  if (used) return fail(c, "已有评价的开课班不能删除", 409);
  await c.env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});
app.get("/api/admin/courses", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        `SELECT c.*,GROUP_CONCAT(t.id) teacher_ids,GROUP_CONCAT(t.name) teachers FROM courses c LEFT JOIN course_teachers ct ON ct.course_id=c.id LEFT JOIN teachers t ON t.id=ct.teacher_id GROUP BY c.id ORDER BY c.name`,
      ).all()
    ).results,
  ),
);
app.post("/api/admin/courses", async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const name = clean(b.name, 120),
    code = clean(b.code, 40),
    category = clean(b.category, 20),
    department = clean(b.department, 80),
    description = clean(b.description, 500),
    teacherIdsProvided = Object.hasOwn(b, "teacherIds");
  if (!code || !name || !["general", "sports"].includes(category))
    return fail(c, "课号、课程名称和类别无效");
  let id = integer(b.id);
  const existing = id
    ? await c.env.DB.prepare("SELECT * FROM courses WHERE id=?")
        .bind(id)
        .first<Record<string, any>>()
    : null;
  if (id && !existing) return fail(c, "课程不存在", 404);
  const baselinePublished = !!(await c.env.DB.prepare(
    "SELECT 1 FROM catalog_baseline_marker WHERE singleton=1",
  ).first());
  if (baselinePublished && !id)
    return fail(c, "基线发布后新增课程必须通过目录补充申请", 409);
  if (existing && existing.code !== code)
    return fail(c, "课号是稳定身份，创建后不可修改", 409);
  let teacherIds: number[] | undefined;
  if (teacherIdsProvided) {
    if (!Array.isArray(b.teacherIds)) return fail(c, "任课教师列表无效");
    const parsed = b.teacherIds.map(integer);
    if (parsed.some((teacherId) => teacherId === null || teacherId < 1))
      return fail(c, "任课教师列表无效");
    teacherIds = [...new Set(parsed as number[])];
    if (teacherIds.length) {
      const validTeachers = await c.env.DB.prepare(
        `SELECT COUNT(*) n FROM teachers WHERE id IN (${teacherIds
          .map(() => "?")
          .join(",")})`,
      )
        .bind(...teacherIds)
        .first<{ n: number }>();
      if (validTeachers?.n !== teacherIds.length)
        return fail(c, "任课教师中存在无效记录");
    }
  }
  const creditsProvided = Object.hasOwn(b, "credits");
  let credits = existing?.credits ?? null;
  if (creditsProvided) {
    if (b.credits === "" || b.credits == null) credits = null;
    else {
      credits = Number(b.credits);
      if (!Number.isFinite(credits) || credits < 0)
        return fail(c, "学分必须是非负数字");
    }
  }
  if (id) {
    if (category !== existing!.category) {
      const legacyCategoryDependency = await c.env.DB.prepare(
        `SELECT 1 FROM legacy_reviews
         WHERE course_id=? AND status IN('pending','approved') LIMIT 1`,
      )
        .bind(id)
        .first();
      if (legacyCategoryDependency)
        return fail(c, "已有待审或已批准历史评价，不能修改课程类别", 409);
    }
    const currentRelations = (
      await c.env.DB.prepare(
        "SELECT teacher_id FROM course_teachers WHERE course_id=?",
      )
        .bind(id)
        .all<{ teacher_id: number }>()
    ).results.map((row) => row.teacher_id);
    if (teacherIdsProvided) {
      if (
        baselinePublished &&
        JSON.stringify([...teacherIds!].sort((left, right) => left - right)) !==
          JSON.stringify([...currentRelations].sort((left, right) => left - right))
      )
        return fail(c, "基线发布后新增任课关系必须通过目录补充申请", 409);
      const removed = currentRelations.filter(
        (teacherId) => !teacherIds!.includes(teacherId),
      );
      if (removed.length) {
        const placeholders = removed.map(() => "?").join(",");
        const reviewDependency = await c.env.DB.prepare(
          `SELECT 1 FROM reviews WHERE course_id=? AND teacher_id IN (${placeholders})
           UNION ALL
           SELECT 1 FROM legacy_reviews
           WHERE course_id=? AND status IN('pending','approved')
             AND teacher_id IN (${placeholders})
           LIMIT 1`,
        )
          .bind(id, ...removed, id, ...removed)
          .first();
        const offeringDependency = await c.env.DB.prepare(
          `SELECT 1 FROM offerings o JOIN offering_teachers ot ON ot.offering_id=o.id
           WHERE o.course_id=? AND ot.teacher_id IN (${placeholders}) LIMIT 1`,
        )
          .bind(id, ...removed)
          .first();
        if (reviewDependency || offeringDependency)
          return fail(c, "已有评价或开课班依赖该任课关系，不能删除", 409);
      }
    }
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        "UPDATE courses SET code=?,name=?,category=?,department=?,credits=?,description=? WHERE id=?",
      ).bind(code, name, category, department, credits, description, id),
    ];
    if (teacherIdsProvided) {
      statements.push(
        c.env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(
          id,
        ),
        ...teacherIds!.map((teacherId) =>
          c.env.DB.prepare(
            "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
          ).bind(id, teacherId),
        ),
      );
    }
    await c.env.DB.batch(statements);
  } else {
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        "INSERT INTO courses(code,name,category,department,credits,description) VALUES(?,?,?,?,?,?)",
      ).bind(code, name, category, department, credits, description),
    ];
    if (teacherIds?.length) {
      statements.push(
        ...teacherIds.map((teacherId) =>
          c.env.DB.prepare(
            `INSERT INTO course_teachers(course_id,teacher_id)
             SELECT id,? FROM courses WHERE code=? AND name=?`,
          ).bind(teacherId, code, name),
        ),
      );
    }
    const results = await c.env.DB.batch(statements);
    id = Number(results[0].meta.last_row_id);
  }
  return c.json({ ok: true, id });
});
app.delete("/api/admin/courses/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const used = await c.env.DB.prepare(
    "SELECT id FROM reviews WHERE course_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (used) return fail(c, "已有评价的课程不能删除", 409);
  const legacyUsed = await c.env.DB.prepare(
    "SELECT id FROM legacy_reviews WHERE course_id=? AND status IN('pending','approved') LIMIT 1",
  )
    .bind(id)
    .first();
  if (legacyUsed) return fail(c, "已有审核通过的历史评价，不能删除", 409);
  const catalogReference = await c.env.DB.prepare(
    "SELECT id FROM catalog_requests WHERE created_course_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (catalogReference) return fail(c, "已有补充申请记录引用该课程，不能删除", 409);
  await c.env.DB.prepare("DELETE FROM courses WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});
app.get("/api/admin/teachers", async (c) =>
  c.json(
    (await c.env.DB.prepare("SELECT * FROM teachers ORDER BY name").all())
      .results,
  ),
);
app.post("/api/admin/teachers", async (c) => {
  const b = await c.req.json<Record<string, unknown>>(),
    sourceTeacherLabel = clean(b.sourceTeacherLabel, 120),
    name = clean(b.name, 120) || sourceTeacherLabel,
    department = nullableClean(b.department, 80);
  const existingId = integer(b.id);
  if (
    !existingId &&
    (await c.env.DB.prepare(
      "SELECT 1 FROM catalog_baseline_marker WHERE singleton=1",
    ).first())
  )
    return fail(c, "基线发布后新增教师必须通过目录补充申请", 409);
  let id = existingId;
  if (existingId) {
    const existing = await c.env.DB.prepare(
      "SELECT source_teacher_label FROM teachers WHERE id=?",
    )
      .bind(existingId)
      .first<{ source_teacher_label: string }>();
    if (!existing) return fail(c, "教师不存在", 404);
    if (sourceTeacherLabel && sourceTeacherLabel !== existing.source_teacher_label)
      return fail(c, "来源教师名是稳定身份，创建后不可修改", 409);
    if (!name) return fail(c, "教师显示名不能为空");
    await c.env.DB.prepare(
      "UPDATE teachers SET name=?,department=?,title=?,bio=? WHERE id=?",
    )
      .bind(
        name,
        department,
        clean(b.title, 80),
        clean(b.bio, 1000),
        existingId,
      )
      .run();
  } else {
    if (!sourceTeacherLabel || !name) return fail(c, "来源教师名不能为空");
    const result = await c.env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department,title,bio) VALUES(?,?,?,?,?)",
    )
      .bind(
        sourceTeacherLabel,
        name,
        department,
        clean(b.title, 80),
        clean(b.bio, 1000),
      )
      .run();
    id = Number(result.meta.last_row_id);
  }
  return c.json({ ok: true, id });
});
app.delete("/api/admin/teachers/:id", async (c) => {
  const id = integer(c.req.param("id"));
  const used = await c.env.DB.prepare(
    "SELECT id FROM reviews WHERE teacher_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (used) return fail(c, "已有评价的教师不能删除", 409);
  const legacyUsed = await c.env.DB.prepare(
    "SELECT id FROM legacy_reviews WHERE teacher_id=? AND status IN('pending','approved') LIMIT 1",
  )
    .bind(id)
    .first();
  if (legacyUsed) return fail(c, "已有审核通过的历史评价，不能删除", 409);
  const catalogReference = await c.env.DB.prepare(
    "SELECT id FROM catalog_requests WHERE created_teacher_id=? LIMIT 1",
  )
    .bind(id)
    .first();
  if (catalogReference) return fail(c, "已有补充申请记录引用该教师，不能删除", 409);
  const soleActiveOffering = await c.env.DB.prepare(
    `SELECT 1
     FROM offerings o JOIN offering_teachers ot ON ot.offering_id=o.id
     WHERE o.status='active' AND ot.teacher_id=?
       AND (SELECT COUNT(*) FROM offering_teachers other WHERE other.offering_id=o.id)=1
     LIMIT 1`,
  )
    .bind(id)
    .first();
  if (soleActiveOffering)
    return fail(c, "该教师是开课班唯一任课教师，不能删除", 409);
  await c.env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(id).run();
  return c.json({ ok: true });
});
app.put("/api/admin/courses/:id/teachers", async (c) => {
  if (
    await c.env.DB.prepare(
      "SELECT 1 FROM catalog_baseline_marker WHERE singleton=1",
    ).first()
  )
    return fail(c, "基线发布后变更任课关系必须通过目录补充申请", 409);
  const courseId = integer(c.req.param("id")),
    b = await c.req.json<{ teacherIds?: unknown[] }>(),
    rawIds = b.teacherIds || [];
  if (!courseId) return fail(c, "课程 ID 无效");
  if (!Array.isArray(rawIds)) return fail(c, "任课教师列表无效");
  const parsedIds = rawIds.map(integer);
  if (parsedIds.some((id) => id === null || id < 1))
    return fail(c, "任课教师列表无效");
  const ids = [...new Set(parsedIds as number[])];
  if (
    !(await c.env.DB.prepare("SELECT id FROM courses WHERE id=?")
      .bind(courseId)
      .first())
  )
    return fail(c, "课程不存在", 404);
  if (ids.length) {
    const validTeachers = await c.env.DB.prepare(
      `SELECT COUNT(*) n FROM teachers WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .first<{ n: number }>();
    if (validTeachers?.n !== ids.length)
      return fail(c, "任课教师中存在无效记录");
  }
  const currentIds = (
    await c.env.DB.prepare(
      "SELECT teacher_id FROM course_teachers WHERE course_id=?",
    )
      .bind(courseId)
      .all<{ teacher_id: number }>()
  ).results.map((row) => row.teacher_id);
  const removed = currentIds.filter((teacherId) => !ids.includes(teacherId));
  if (removed.length) {
    const placeholders = removed.map(() => "?").join(",");
    const reviewDependency = await c.env.DB.prepare(
      `SELECT 1 FROM reviews WHERE course_id=? AND teacher_id IN (${placeholders})
       UNION ALL
       SELECT 1 FROM legacy_reviews
       WHERE course_id=? AND status IN('pending','approved')
         AND teacher_id IN (${placeholders})
       LIMIT 1`,
    )
      .bind(courseId, ...removed, courseId, ...removed)
      .first();
    const offeringDependency = await c.env.DB.prepare(
      `SELECT 1 FROM offerings o JOIN offering_teachers ot ON ot.offering_id=o.id
       WHERE o.course_id=? AND ot.teacher_id IN (${placeholders}) LIMIT 1`,
    )
      .bind(courseId, ...removed)
      .first();
    if (reviewDependency || offeringDependency)
      return fail(c, "已有评价或开课班依赖该任课关系，不能删除", 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(
      courseId,
    ),
    ...ids.map((id) =>
      c.env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
      ).bind(courseId, id),
    ),
  ]);
  return c.json({ ok: true });
});
app.post("/api/admin/import/preview", (c) =>
  fail(c, "旧式可合并/跳过导入入口已永久禁用；基线后新增请使用目录补充申请", 409),
);
app.post("/api/admin/import", (c) =>
  fail(c, "旧式可合并/跳过导入入口已永久禁用；基线后新增请使用目录补充申请", 409),
);

const baselineImportFailure = (c: AppContext, error: unknown) => {
  if (error instanceof BaselineImportError) return fail(c, error.message, error.status);
  console.error(JSON.stringify({ message: "catalog baseline import failed", error: error instanceof Error ? error.message : String(error) }));
  return fail(c, "目录基线操作失败", 500);
};
app.post("/api/admin/catalog-baseline/uploads", async (c) => {
  const contentLength = Number(c.req.header("Content-Length") || 0);
  if (contentLength > 100_000) return fail(c, "manifest 请求过大", 413);
  try { return c.json(await createBaselineUpload(c.env.DB, await readBoundedJson(c.req.raw, 100_000))) } catch (error) { return baselineImportFailure(c, error) }
});
const readCatalogMarker = (db: D1Database) => db.prepare(
    `SELECT batch_id,approved_schema_version,approved_manifest_content_sha256,artifact_sha256,
      courses,teachers,relations FROM catalog_baseline_marker WHERE singleton=1`,
  ).first();

app.get("/api/admin/catalog-baseline/status", async (c) => {
  const marker = await readCatalogMarker(c.env.DB);
  return c.json({ published: !!marker, marker: marker || null });
});

app.get("/api/admin/historical-review-status", async (c) => {
  const marker = await readCatalogMarker(c.env.DB);
  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM public_historical_reviews",
  ).first<{ count: number }>();
  const byCourse = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT course_id) AS count FROM public_historical_reviews",
  ).first<{ count: number }>();
  const byTeacher = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT teacher_id) AS count FROM public_historical_reviews",
  ).first<{ count: number }>();
  const catalog = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM courses) courses,
       (SELECT COUNT(*) FROM teachers) teachers,
       (SELECT COUNT(*) FROM course_teachers) relations`,
  ).first<{ courses: number; teachers: number; relations: number }>();
  return c.json({
    marker: marker || null,
    catalog: {
      courses: Number(catalog?.courses || 0),
      teachers: Number(catalog?.teachers || 0),
      relations: Number(catalog?.relations || 0),
    },
    historicalReviews: Number(total?.count || 0),
    coursesWithHistoricalReviews: Number(byCourse?.count || 0),
    teachersWithHistoricalReviews: Number(byTeacher?.count || 0),
  });
});
app.get("/api/admin/catalog-baseline/uploads/:batchId", async (c) => {
  try { return c.json(await baselineUploadStatus(c.env.DB, c.req.param("batchId"))) } catch (error) { return baselineImportFailure(c, error) }
});
app.put("/api/admin/catalog-baseline/uploads/:batchId/chunks/:chunkIndex", async (c) => {
  const contentLength = Number(c.req.header("Content-Length") || 0);
  if (contentLength > 1_000_000) return fail(c, "分块请求过大", 413);
  try { return c.json(await putBaselineChunk(c.env.DB, c.req.param("batchId"), Number(c.req.param("chunkIndex")), await readBoundedJson(c.req.raw, 1_000_000))) } catch (error) { return baselineImportFailure(c, error) }
});
app.post("/api/admin/catalog-baseline/uploads/:batchId/finalize", async (c) => {
  try { return c.json(await finalizeBaselineUpload(c.env.DB, c.req.param("batchId"))) } catch (error) { return baselineImportFailure(c, error) }
});
app.get("/api/admin/catalog-baseline/uploads/:batchId/preview", async (c) => {
  try { return c.json(await previewBaselineUpload(c.env.DB, c.req.param("batchId"), clean(c.req.query("type"), 20), integer(c.req.query("page")) ?? 1, integer(c.req.query("pageSize")) ?? 50)) } catch (error) { return baselineImportFailure(c, error) }
});
app.post("/api/admin/catalog-baseline/uploads/:batchId/publish", async (c) => {
  try { return c.json({ ok: true, marker: await publishBaselineUpload(c.env.DB, c.req.param("batchId")) }) } catch (error) { return baselineImportFailure(c, error) }
});

type LegacyApprovedRow = {
  course_id: number;
  teacher_id: number;
  offering_id: number | null;
  category: "general" | "sports";
  comment: string;
  term: string;
  source_file: string;
  sheet_name: string;
  source_row: string;
  raw_ocr_text: string;
  ocr_confidence: number;
  ocr_tokens_json: string;
  inherited_from: string;
  ocr_course_name: string;
  ocr_teacher_name: string;
  duplicate_group: string | null;
  duplicate_action: "" | "keep";
  review_note: string;
};

async function validateLegacyApproved(
  db: D1Database,
  input: Record<string, unknown>[],
) {
  const errors: Array<{ row: number; field: string; message: string }> = [];
  const rows: LegacyApprovedRow[] = [];
  const add = (row: number, field: string, message: string) =>
    errors.push({ row, field, message });
  input.forEach((raw, offset) => {
    const rowNumber = offset + 2;
    const courseId = integer(raw.course_id),
      teacherId = integer(raw.teacher_id),
      offeringId =
        raw.offering_id === "" || raw.offering_id == null
          ? null
          : integer(raw.offering_id),
      category = clean(raw.category, 20),
      comment = clean(raw.comment, 5000),
      sourceFile = clean(raw.source_file, 240),
      sourceRow = clean(raw.source_row, 80),
      rawText = clean(raw.raw_ocr_text, 10000),
      duplicateGroup = clean(raw.duplicate_group, 80),
      duplicateAction = clean(raw.duplicate_action, 20),
      reviewNote = clean(raw.review_note, 1000),
      confidence = Number(raw.ocr_confidence);
    if (typeof raw.comment !== "string" || raw.comment.length > 5000)
      add(rowNumber, "comment", "文字评价超过 5000 字限制");
    if (typeof raw.raw_ocr_text !== "string" || raw.raw_ocr_text.length > 10000)
      add(rowNumber, "raw_ocr_text", "原始 OCR 文本超过 10000 字限制");
    if (
      typeof raw.ocr_tokens_json !== "string" ||
      raw.ocr_tokens_json.length > 100000
    )
      add(rowNumber, "ocr_tokens_json", "OCR token JSON 超过 100000 字限制");
    if (!courseId || courseId < 1)
      add(rowNumber, "course_id", "必须填写现有课程 ID");
    if (!teacherId || teacherId < 1)
      add(rowNumber, "teacher_id", "必须填写现有教师 ID");
    if (
      raw.offering_id !== "" &&
      raw.offering_id != null &&
      (!offeringId || offeringId < 1)
    )
      add(rowNumber, "offering_id", "开课班 ID 无效");
    if (!(["general", "sports"] as string[]).includes(category))
      add(rowNumber, "category", "评价模板类型必须为 general 或 sports");
    if (!comment) add(rowNumber, "comment", "文字评价不能为空");
    if (!sourceFile) add(rowNumber, "source_file", "来源截图不能为空");
    if (!sourceRow) add(rowNumber, "source_row", "来源行不能为空");
    if (!rawText) add(rowNumber, "raw_ocr_text", "必须保留原始 OCR 文本");
    if (!reviewNote)
      add(rowNumber, "review_note", "批准记录必须填写逐行人工审核说明");
    if (duplicateGroup && duplicateAction !== "keep")
      add(
        rowNumber,
        "duplicate_action",
        "疑似重复记录必须明确填写 duplicate_action=keep",
      );
    if (!duplicateGroup && duplicateAction)
      add(rowNumber, "duplicate_action", "非重复记录不得填写重复保留决定");
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
      add(rowNumber, "ocr_confidence", "OCR 置信度必须在 0 到 1 之间");
    if (raw.source_type !== "legacy_ocr")
      add(rowNumber, "source_type", "来源类型必须为 legacy_ocr");
    if (raw.source_label !== "腾讯表格历史资料")
      add(rowNumber, "source_label", "来源标签不正确");
    if (
      Object.hasOwn(raw, "overall") &&
      raw.overall !== "" &&
      raw.overall != null
    )
      add(rowNumber, "overall", "历史文字评价禁止填写或推算 overall");
    try {
      const parsed = JSON.parse(clean(raw.ocr_tokens_json, 100000) || "[]");
      if (!Array.isArray(parsed)) throw new Error("not array");
    } catch {
      add(rowNumber, "ocr_tokens_json", "OCR token 必须是 JSON 数组");
    }
    rows.push({
      course_id: courseId || 0,
      teacher_id: teacherId || 0,
      offering_id: offeringId,
      category: category as LegacyApprovedRow["category"],
      comment,
      term: clean(raw.term, 80),
      source_file: sourceFile,
      sheet_name: clean(raw.sheet_name, 80),
      source_row: sourceRow,
      raw_ocr_text: rawText,
      ocr_confidence: confidence,
      ocr_tokens_json: clean(raw.ocr_tokens_json, 100000) || "[]",
      inherited_from: clean(raw.inherited_from, 240),
      ocr_course_name: clean(raw.ocr_course_name, 240),
      ocr_teacher_name: clean(raw.ocr_teacher_name, 240),
      duplicate_group: duplicateGroup || null,
      duplicate_action: duplicateAction as LegacyApprovedRow["duplicate_action"],
      review_note: reviewNote,
    });
  });
  if (errors.length) return { rows, errors };
  const courseIds = [...new Set(rows.map((row) => row.course_id))],
    teacherIds = [...new Set(rows.map((row) => row.teacher_id))],
    pairKeys = [
      ...new Set(rows.map((row) => `${row.course_id}:${row.teacher_id}`)),
    ],
    offeringIds = [
      ...new Set(
        rows.flatMap((row) => (row.offering_id ? [row.offering_id] : [])),
      ),
    ];
  const courses = await db
    .prepare(
      "SELECT id,category FROM courses WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))",
    )
    .bind(JSON.stringify(courseIds))
    .all<{ id: number; category: string }>();
  const teachers = await db
    .prepare(
      "SELECT id FROM teachers WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))",
    )
    .bind(JSON.stringify(teacherIds))
    .all<{ id: number }>();
  const pairs = await db
    .prepare(
      "SELECT course_id||':'||teacher_id key FROM course_teachers WHERE course_id||':'||teacher_id IN (SELECT value FROM json_each(?))",
    )
    .bind(JSON.stringify(pairKeys))
    .all<{ key: string }>();
  const offeringKeys = offeringIds.length
    ? await db
        .prepare(
          "SELECT o.id, o.course_id, ot.teacher_id, o.term FROM offerings o JOIN offering_teachers ot ON ot.offering_id=o.id WHERE o.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))",
        )
        .bind(JSON.stringify(offeringIds))
        .all<{
          id: number;
          course_id: number;
          teacher_id: number;
          term: string;
        }>()
    : {
        results: [] as Array<{
          id: number;
          course_id: number;
          teacher_id: number;
          term: string;
        }>,
      };
  const knownCourses = new Map(
      courses.results.map((row) => [row.id, row.category]),
    ),
    knownTeachers = new Set(teachers.results.map((row) => row.id)),
    knownPairs = new Set(pairs.results.map((row) => row.key)),
    knownOfferings = new Map(
      offeringKeys.results.map((row) => [
        `${row.id}:${row.course_id}:${row.teacher_id}`,
        clean(row.term, 80),
      ]),
    );
  rows.forEach((row, offset) => {
    const rowNumber = offset + 2;
    if (!knownCourses.has(row.course_id))
      add(rowNumber, "course_id", "课程不存在");
    else if (knownCourses.get(row.course_id) !== row.category)
      add(rowNumber, "category", "类别与现有课程不一致");
    if (!knownTeachers.has(row.teacher_id))
      add(rowNumber, "teacher_id", "教师不存在");
    if (!knownPairs.has(`${row.course_id}:${row.teacher_id}`))
      add(rowNumber, "teacher_id", "教师不在课程已有任课关系中");
    if (
      row.offering_id &&
      !knownOfferings.has(`${row.offering_id}:${row.course_id}:${row.teacher_id}`)
    )
      add(rowNumber, "offering_id", "开课班与课程、教师不一致");
    if (row.offering_id && !row.term)
      add(rowNumber, "term", "指定开课班时必须填写明确学期");
    if (
      row.offering_id &&
      knownOfferings.has(`${row.offering_id}:${row.course_id}:${row.teacher_id}`) &&
      knownOfferings.get(`${row.offering_id}:${row.course_id}:${row.teacher_id}`) !==
        clean(row.term, 80)
    )
      add(rowNumber, "term", "学期与开课班不一致");
  });
  return { rows, errors };
}

app.get("/api/admin/legacy-imports", async (c) => {
  const { page, size } = pageArgs(c),
    status = clean(c.req.query("status"), 20);
  if (
    status &&
    !["preview", "approved", "imported", "rolled_back", "failed"].includes(
      status,
    )
  )
    return fail(c, "批次状态无效");
  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) n FROM legacy_import_batches WHERE (?='' OR status=?)",
  )
    .bind(status, status)
    .first<{ n: number }>();
  const { results } = await c.env.DB.prepare(
    `SELECT b.id,b.source_type,b.source_label,b.status,b.row_count,b.created_at,b.imported_at,b.rolled_back_at,
      (SELECT COUNT(*) FROM legacy_reviews r WHERE r.import_batch_id=b.id AND r.status='pending') pending_count,
      (SELECT COUNT(*) FROM legacy_reviews r WHERE r.import_batch_id=b.id AND r.status='approved') approved_count,
      (SELECT COUNT(*) FROM legacy_reviews r WHERE r.import_batch_id=b.id AND r.status='rejected') rejected_count
     FROM legacy_import_batches b WHERE (?='' OR b.status=?)
     ORDER BY b.created_at DESC,b.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(status, status, size, (page - 1) * size)
    .all();
  return c.json({
    items: results,
    total: total?.n || 0,
    page,
    pages: Math.max(1, Math.ceil((total?.n || 0) / size)),
  });
});

app.post("/api/admin/legacy-imports/preview", async (c) => {
  if (!(await c.env.DB.prepare(
    "SELECT 1 FROM catalog_baseline_marker WHERE singleton=1",
  ).first()))
    return fail(c, "目录基线尚未发布，历史评价映射入口已锁定", 409);
  if (Number(c.req.header("Content-Length") || 0) > 2_000_000)
    return fail(c, "批准数据过大", 413);
  const body = await readBoundedJson(c.req.raw, 2_000_000) as {
    rows?: Record<string, unknown>[];
  };
  const input = Array.isArray(body.rows) ? body.rows : [];
  if (!input.length || input.length > 40)
    return fail(c, "每批必须包含 1–40 条记录");
  const validation = await validateLegacyApproved(c.env.DB, input);
  return c.json({
    ok: validation.errors.length === 0,
    total: input.length,
    errors: validation.errors,
  });
});

app.post("/api/admin/legacy-imports", async (c) => {
  if (!(await c.env.DB.prepare(
    "SELECT 1 FROM catalog_baseline_marker WHERE singleton=1",
  ).first()))
    return fail(c, "目录基线尚未发布，历史评价映射入口已锁定", 409);
  if (Number(c.req.header("Content-Length") || 0) > 2_000_000)
    return fail(c, "批准数据过大", 413);
  const body = await readBoundedJson(c.req.raw, 2_000_000) as {
    rows?: Record<string, unknown>[];
    manifest?: Record<string, unknown>;
    idempotencyKey?: string;
  };
  const input = Array.isArray(body.rows) ? body.rows : [];
  if (!input.length || input.length > 40)
    return fail(c, "每批必须包含 1–40 条记录");
  const idempotencyKey = clean(body.idempotencyKey, 64);
  if (!/^[a-f0-9]{32,64}$/.test(idempotencyKey))
    return fail(c, "缺少有效的幂等键");
  const canonicalKey = await digest(canonicalJson(input));
  if (idempotencyKey !== canonicalKey)
    return fail(c, "幂等键与批准数据内容不一致");
  const validation = await validateLegacyApproved(c.env.DB, input);
  if (validation.errors.length)
    return c.json(
      { error: "批准数据校验失败", errors: validation.errors },
      422,
    );
  const batchId = `legacy_${idempotencyKey}`;
  const existingBatch = await c.env.DB.prepare(
    "SELECT status FROM legacy_import_batches WHERE id=?",
  )
    .bind(batchId)
    .first<{ status: string }>();
  if (existingBatch?.status === "imported")
    return c.json({
      ok: true,
      idempotent: true,
      batchId,
      count: validation.rows.length,
      batchStatus: "imported",
      reviewStatus: "pending",
    });
  if (existingBatch)
    return fail(c, `相同批准数据对应的批次状态为 ${existingBatch.status}，不能作为已导入重试`, 409);
  const statements = [
    c.env.DB.prepare(
      "INSERT INTO legacy_import_batches(id,source_type,source_label,manifest_json,status,row_count,imported_at) VALUES(?,'legacy_ocr','腾讯表格历史资料',?,'imported',?,CURRENT_TIMESTAMP)",
    ).bind(
      batchId,
      JSON.stringify(body.manifest || {}),
      validation.rows.length,
    ),
    ...validation.rows.map((row) =>
      c.env.DB.prepare(
        `INSERT INTO legacy_reviews(import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,ocr_tokens_json,inherited_from,ocr_course_name,course_id,ocr_teacher_name,teacher_id,offering_id,category,comment,term,source_type,source_label,status,duplicate_group,duplicate_action,review_note)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'legacy_ocr','腾讯表格历史资料','pending',?,?,?)`,
      ).bind(
        batchId,
        row.source_file,
        row.sheet_name,
        row.source_row,
        row.raw_ocr_text,
        row.ocr_confidence,
        row.ocr_tokens_json,
        row.inherited_from,
        row.ocr_course_name,
        row.course_id,
        row.ocr_teacher_name,
        row.teacher_id,
        row.offering_id,
        row.category,
        row.comment,
        row.term,
        row.duplicate_group,
        row.duplicate_action,
        row.review_note,
      ),
    ),
  ];
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    if (
      String(error).includes("UNIQUE") &&
      (await c.env.DB.prepare("SELECT 1 FROM legacy_import_batches WHERE id=?")
        .bind(batchId)
        .first())
    )
      return c.json({
        ok: true,
        idempotent: true,
        batchId,
        count: validation.rows.length,
        batchStatus: "imported",
        reviewStatus: "pending",
      });
    throw error;
  }
  return c.json({
    ok: true,
    batchId,
    count: validation.rows.length,
    batchStatus: "imported",
    reviewStatus: "pending",
  });
});

app.post("/api/admin/legacy-imports/:id/rollback", async (c) => {
  const batchId = clean(c.req.param("id"), 80);
  const batch = await c.env.DB.prepare(
    "SELECT status FROM legacy_import_batches WHERE id=?",
  )
    .bind(batchId)
    .first<{ status: string }>();
  if (!batch) return fail(c, "导入批次不存在", 404);
  if (batch.status !== "imported")
    return fail(c, "只有 imported 批次可以回滚", 409);
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE legacy_import_batches SET status='rolled_back',rolled_back_at=CURRENT_TIMESTAMP
       WHERE id=? AND status='imported'
       AND NOT EXISTS(SELECT 1 FROM legacy_reviews WHERE import_batch_id=? AND status<>'pending')`,
    ).bind(batchId, batchId),
    c.env.DB.prepare(
      "DELETE FROM legacy_reviews WHERE import_batch_id=? AND EXISTS(SELECT 1 FROM legacy_import_batches WHERE id=? AND status='rolled_back')",
    ).bind(batchId, batchId),
  ]);
  if (!(results[0].meta.changes || 0))
    return fail(c, "批次包含已审核记录，或状态已经变化", 409);
  return c.json({ ok: true, batchId, status: "rolled_back" });
});

app.onError((e, c) => {
  if (e instanceof SyntaxError) return fail(c, "请求 JSON 格式错误", 400);
  console.error(
    JSON.stringify({
      event: "request_error",
      message: e.message,
      path: c.req.path,
    }),
  );
  return fail(c, "服务器暂时开小差了", 500);
});
export default app;
