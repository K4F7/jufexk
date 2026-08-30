import type { Context } from "hono";
import {
  publicCourseCategory,
  publicCourseDisplayName,
} from "./lib/public-course-presentation";
import {
  publicCreatedAt,
  publicGrade,
  publicHeadline,
} from "./lib/public-review-fields";
import { reviewPublicFoldSql } from "./lib/recognition";
import {
  authoredReviewAuthorSql,
  authoredReviewJoinSql,
  publicAuthorFields,
  reservedAuthorSql,
} from "./public-handle";
import {
  guestReviewBindingSql,
  historicalPublicVisibleSql,
  legacyPublicVisibleSql,
} from "./public-review-visibility";

const fail = (c: Context, error: string, status = 400) =>
  c.json({ error }, status as 400);

const integer = (v: unknown) => {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v !== "string" || !/^-?(?:0|[1-9]\d*)$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};

type LatestCursor = { t: string; id: string };

const encodeLatestCursor = (cursor: LatestCursor) =>
  btoa(JSON.stringify(cursor));

const decodeLatestCursor = (value: string | undefined): LatestCursor | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value)) as LatestCursor;
    return typeof parsed.t === "string" && typeof parsed.id === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
};

const latestUnion = `
  SELECT 'historical:' || phr.id id, phr.course_id, phr.teacher_id, phr.comment,
    NULL comment_format, '' headline, NULL grade,
    c.name course_name, c.code course_code, t.name teacher_name,
    phr.imported_at created_at, ${reservedAuthorSql},
    (SELECT COUNT(*) FROM historical_review_endorsements e
     WHERE e.historical_review_id=phr.id) endorsement_count,
    (SELECT COUNT(*) FROM historical_review_challenges e
     WHERE e.historical_review_id=phr.id) challenge_count
  FROM public_historical_reviews phr
  JOIN courses c ON c.id=phr.course_id
  JOIN teachers t ON t.id=phr.teacher_id
  WHERE 1=1${historicalPublicVisibleSql("phr")}
  UNION ALL
  SELECT 'legacy:' || lr.id id, lr.course_id, lr.teacher_id, lr.comment,
    NULL comment_format, '' headline, NULL grade,
    c.name course_name, c.code course_code, t.name teacher_name,
    lr.created_at, ${reservedAuthorSql},
    (SELECT COUNT(*) FROM legacy_review_endorsements e
     WHERE e.legacy_review_id=lr.id) endorsement_count,
    (SELECT COUNT(*) FROM legacy_review_challenges e
     WHERE e.legacy_review_id=lr.id) challenge_count
  FROM legacy_reviews lr
  JOIN courses c ON c.id=lr.course_id
  JOIN teachers t ON t.id=lr.teacher_id
  WHERE lr.status='approved' AND trim(COALESCE(lr.comment,''))<>''${legacyPublicVisibleSql("lr")}
  UNION ALL
  SELECT 'review:' || r.id id, r.course_id, r.teacher_id, r.comment,
    r.comment_format, r.headline, r.grade,
    c.name course_name, c.code course_code, t.name teacher_name,
    r.created_at, ${authoredReviewAuthorSql},
    (SELECT COUNT(*) FROM review_endorsements e WHERE e.review_id=r.id) endorsement_count,
    (SELECT COUNT(*) FROM review_challenges e WHERE e.review_id=r.id) challenge_count
  FROM reviews r
  JOIN courses c ON c.id=r.course_id
  JOIN teachers t ON t.id=r.teacher_id
  ${authoredReviewJoinSql}
  WHERE r.status='approved'
    AND trim(COALESCE(r.comment,''))<>''${guestReviewBindingSql}
`;

export async function handleLatestPublicReviews(c: Context) {
  const size = Math.min(50, Math.max(1, integer(c.req.query("pageSize")) || 20));
  const rawCursor = c.req.query("cursor");
  const cursor = decodeLatestCursor(rawCursor);
  if (rawCursor && !cursor) return fail(c, "评价游标无效", 400);
  const foldFilter = `NOT ${reviewPublicFoldSql()}`;
  const cursorFilter = cursor
    ? "AND (created_at<? OR (created_at=? AND id<?))"
    : "";
  const raw = await c.env.DB.prepare(
    `SELECT id,course_id,teacher_id,comment,comment_format,headline,grade,course_name,course_code,teacher_name,created_at,author_public_code,author_avatar_key
     FROM (${latestUnion}) latest_reviews
     WHERE ${foldFilter}
     ${cursorFilter}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
  )
    .bind(
      ...(cursor ? [cursor.t, cursor.t, cursor.id] : []),
      size + 1,
    )
    .all();
  const results = raw.results as Array<{
    id: string;
    course_id: number;
    teacher_id: number;
    comment: string;
    comment_format: string | null;
    headline: string | null;
    grade: string | null;
    course_name: string;
    course_code: string;
    teacher_name: string;
    created_at: string;
    author_public_code: number | null;
    author_avatar_key: number | null;
  }>;
  const hasMore = results.length > size;
  const page = results.slice(0, size);
  const last = page.at(-1);
  return c.json({
    items: page.map((row) => {
      const rawName = row.course_name || "";
      const grade = publicGrade(row.grade);
      return {
        id: row.id,
        course_id: row.course_id,
        teacher_id: row.teacher_id,
        comment: row.comment,
        comment_format: row.comment_format || null,
        headline: publicHeadline(row.headline),
        ...(grade == null ? {} : { grade }),
        course_name: publicCourseDisplayName(rawName),
        course_code: row.course_code,
        teacher_name: row.teacher_name,
        category: publicCourseCategory(rawName, ""),
        created_at: publicCreatedAt(row.created_at),
        ...publicAuthorFields(row),
      };
    }),
    nextCursor:
      hasMore && last
        ? encodeLatestCursor({ t: last.created_at, id: last.id })
        : null,
  });
}
