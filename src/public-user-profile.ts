import {
  publicCourseCategory,
  publicCourseDisplayName,
} from "./lib/public-course-presentation";
import {
  publicCreatedAt,
  publicGrade,
  publicHeadline,
} from "./lib/public-review-fields";
import {
  isOrdinaryUserAuthenticated,
  requireOrdinaryWriteUser,
  resolveOrdinaryUser,
} from "./ordinary-user-session";
import {
  FIRST_USER_PUBLIC_CODE,
  RESERVED_PUBLIC_CODE,
  defaultAvatarKey,
  formatPublicHandle,
  parsePublicCodeParam,
} from "./public-handle";
import { publicReviewBindingSql } from "./public-review-visibility";
import type { AppContext } from "./routes/types";

const fail = (c: AppContext, error: string, status = 400) =>
  c.json({ error }, status as 400);

const reservedReviewsUnion = `
  SELECT 'historical:' || phr.id id, phr.course_id, phr.teacher_id, phr.comment,
    NULL comment_format, '' headline, NULL grade,
    c.name course_name, c.code course_code, t.name teacher_name,
    phr.imported_at created_at
  FROM public_historical_reviews phr
  JOIN courses c ON c.id=phr.course_id
  JOIN teachers t ON t.id=phr.teacher_id
  UNION ALL
  SELECT 'legacy:' || lr.id id, lr.course_id, lr.teacher_id, lr.comment,
    NULL comment_format, '' headline, NULL grade,
    c.name course_name, c.code course_code, t.name teacher_name,
    lr.created_at
  FROM legacy_reviews lr
  JOIN courses c ON c.id=lr.course_id
  JOIN teachers t ON t.id=lr.teacher_id
  WHERE lr.status='approved' AND trim(COALESCE(lr.comment,''))<>''
  UNION ALL
  SELECT 'review:' || r.id id, r.course_id, r.teacher_id, r.comment,
    r.comment_format, r.headline, r.grade,
    c.name course_name, c.code course_code, t.name teacher_name,
    r.created_at
  FROM reviews r
  JOIN courses c ON c.id=r.course_id
  JOIN teachers t ON t.id=r.teacher_id
  WHERE r.status='approved'
    AND r.author_user_id IS NULL
    AND trim(COALESCE(r.comment,''))<>''${publicReviewBindingSql}
`;

const authoredReviewsSql = `
  SELECT 'review:' || r.id id, r.course_id, r.teacher_id, r.comment,
    r.comment_format, r.headline, r.grade,
    c.name course_name, c.code course_code, t.name teacher_name,
    r.created_at
  FROM reviews r
  JOIN courses c ON c.id=r.course_id
  JOIN teachers t ON t.id=r.teacher_id
  WHERE r.status='approved'
    AND r.author_user_id=?
    AND trim(COALESCE(r.comment,''))<>''${publicReviewBindingSql}
`;

type PublicAuthorReviewRow = {
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
};

function mapPublicAuthorReviews(
  rows: PublicAuthorReviewRow[],
  publicCode: number,
  avatarKey: number,
) {
  return rows.map((row) => {
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
      author_public_code: publicCode,
      author_avatar_key: avatarKey,
    };
  });
}

async function loadReservedProfile(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT id,course_id,teacher_id,comment,comment_format,headline,grade,
              course_name,course_code,teacher_name,created_at
       FROM (${reservedReviewsUnion}) reserved_reviews
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
    )
    .all<PublicAuthorReviewRow>();
  return {
    public_code: RESERVED_PUBLIC_CODE,
    handle: formatPublicHandle(RESERVED_PUBLIC_CODE),
    avatar_key: defaultAvatarKey(RESERVED_PUBLIC_CODE),
    reserved: true,
    followable: false,
    viewer_followed: false,
    viewer_is_self: false,
    note: "来自以前的学长学姐的评价",
    review_count: results.length,
    reviews: mapPublicAuthorReviews(
      results,
      RESERVED_PUBLIC_CODE,
      defaultAvatarKey(RESERVED_PUBLIC_CODE),
    ),
  };
}

async function loadNumberedProfile(
  db: D1Database,
  publicCode: number,
  viewerId: string | null,
) {
  const author = await db
    .prepare(
      "SELECT id,public_code,avatar_key FROM users WHERE public_code=?",
    )
    .bind(publicCode)
    .first<{ id: string; public_code: number; avatar_key: number | null }>();
  if (!author) return null;
  const { results } = await db
    .prepare(
      `${authoredReviewsSql}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 50`,
    )
    .bind(author.id)
    .all<PublicAuthorReviewRow>();
  const viewerIsSelf = Boolean(viewerId && viewerId === author.id);
  let viewerFollowed = false;
  if (viewerId && !viewerIsSelf) {
    const follow = await db
      .prepare(
        "SELECT 1 ok FROM user_follows WHERE follower_user_id=? AND followed_user_id=?",
      )
      .bind(viewerId, author.id)
      .first<{ ok: number }>();
    viewerFollowed = Boolean(follow);
  }
  const avatarKey = author.avatar_key ?? defaultAvatarKey(publicCode);
  return {
    public_code: publicCode,
    handle: formatPublicHandle(publicCode),
    avatar_key: avatarKey,
    reserved: false,
    followable: Boolean(viewerId && !viewerIsSelf),
    viewer_followed: viewerFollowed,
    viewer_is_self: viewerIsSelf,
    note: null,
    review_count: results.length,
    reviews: mapPublicAuthorReviews(results, publicCode, avatarKey),
  };
}

export async function handlePublicUserProfile(c: AppContext) {
  const publicCode = parsePublicCodeParam(c.req.param("code"));
  if (publicCode == null) return fail(c, "公开编号无效", 404);
  const viewer = await resolveOrdinaryUser(c);
  const viewerId =
    viewer && isOrdinaryUserAuthenticated(viewer) ? viewer.id : null;
  if (publicCode === RESERVED_PUBLIC_CODE) {
    return c.json(await loadReservedProfile(c.env.DB));
  }
  const profile = await loadNumberedProfile(c.env.DB, publicCode, viewerId);
  if (!profile) return fail(c, "公开编号不存在", 404);
  return c.json(profile);
}

async function resolveFollowTarget(c: AppContext) {
  const publicCode = parsePublicCodeParam(c.req.param("code"));
  if (publicCode == null) return { error: fail(c, "公开编号无效", 404) };
  if (publicCode < FIRST_USER_PUBLIC_CODE) {
    return { error: fail(c, "不能关注学长学姐匿名评价", 400) };
  }
  const auth = await requireOrdinaryWriteUser(
    c,
    "请先登录后再关注",
    "当前账号无法关注用户",
  );
  if ("error" in auth) return { error: auth.error };
  const target = await c.env.DB.prepare(
    "SELECT id FROM users WHERE public_code=?",
  )
    .bind(publicCode)
    .first<{ id: string }>();
  if (!target) return { error: fail(c, "公开编号不存在", 404) };
  if (target.id === auth.user.id) {
    return { error: fail(c, "不能关注自己", 400) };
  }
  return { user: auth.user, targetId: target.id, publicCode };
}

export async function handleFollowPublicUser(c: AppContext) {
  const resolved = await resolveFollowTarget(c);
  if ("error" in resolved) return resolved.error;
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO user_follows(follower_user_id,followed_user_id) VALUES(?,?)",
  )
    .bind(resolved.user.id, resolved.targetId)
    .run();
  return c.json({
    ok: true,
    public_code: resolved.publicCode,
    handle: formatPublicHandle(resolved.publicCode),
    viewer_followed: true,
  });
}

export async function handleUnfollowPublicUser(c: AppContext) {
  const resolved = await resolveFollowTarget(c);
  if ("error" in resolved) return resolved.error;
  await c.env.DB.prepare(
    "DELETE FROM user_follows WHERE follower_user_id=? AND followed_user_id=?",
  )
    .bind(resolved.user.id, resolved.targetId)
    .run();
  return c.json({
    ok: true,
    public_code: resolved.publicCode,
    handle: formatPublicHandle(resolved.publicCode),
    viewer_followed: false,
  });
}
