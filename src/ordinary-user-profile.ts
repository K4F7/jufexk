import type { Context } from "hono";
import { resolveOrdinaryUser } from "./ordinary-user-authentication";
import {
  canOrdinaryUserWrite,
  requireOrdinaryWriteUser,
} from "./ordinary-user-write-authorization";
import {
  AVATAR_KEY_COUNT,
  ensureUserPublicHandle,
  formatPublicHandle,
} from "./public-handle";
import { reviewHtmlToText } from "./html";

export const USER_PROFILE_PATH = "/api/user/profile";
const COMMENT_SUMMARY_LENGTH = 180;

type ProfileReviewRow = {
  id: number;
  course_id: number;
  course_name: string;
  teacher_id: number;
  teacher_name: string;
  term: string;
  headline: string;
  comment: string;
  created_at: string;
  status: "pending" | "approved" | "rejected";
};

type ProfileFollowRow = {
  course_id: number;
  course_name: string;
  teacher_id: number;
  teacher_name: string;
  created_at: string;
};

function commentSummary(comment: string) {
  const text = reviewHtmlToText(comment).replace(/\s+/g, " ");
  const characters = [...text];
  if (characters.length <= COMMENT_SUMMARY_LENGTH) return text;
  return `${characters.slice(0, COMMENT_SUMMARY_LENGTH).join("")}…`;
}

/** Private aggregate for the currently authenticated active ordinary user. */
export async function handleOrdinaryUserProfile(c: Context) {
  const user = await resolveOrdinaryUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);
  if (!canOrdinaryUserWrite(user))
    return c.json({ error: "当前账号无法访问个人主页" }, 403);
  const handleUser = await ensureUserPublicHandle(c.env.DB, user);

  const [reviewResult, followResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT r.id,r.course_id,c.name course_name,
              r.teacher_id,t.name teacher_name,r.term,r.headline,r.comment,
              r.created_at,r.status
       FROM reviews r
       JOIN courses c ON c.id=r.course_id
       JOIN teachers t ON t.id=r.teacher_id
       WHERE r.author_user_id=?
       ORDER BY r.created_at DESC,r.id DESC`,
    ).bind(user.id),
    c.env.DB.prepare(
      `SELECT rf.course_id,c.name course_name,
              rf.teacher_id,t.name teacher_name,rf.created_at
       FROM relation_follows rf
       JOIN course_teachers ct
         ON ct.course_id=rf.course_id AND ct.teacher_id=rf.teacher_id
       JOIN courses c ON c.id=rf.course_id
       JOIN teachers t ON t.id=rf.teacher_id
       WHERE rf.user_id=?
       ORDER BY rf.created_at DESC,rf.course_id,rf.teacher_id`,
    ).bind(user.id),
  ]);
  const reviews = (reviewResult.results as ProfileReviewRow[]).map((review) => ({
    ...review,
    comment: commentSummary(review.comment),
  }));
  const follows = followResult.results as ProfileFollowRow[];
  const counts = (await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM user_follows WHERE follower_user_id=?) AS following_user_count,
       (SELECT COUNT(*) FROM user_follows WHERE followed_user_id=?) AS follower_count`,
  )
    .bind(user.id, user.id)
    .first()) as {
    following_user_count: number;
    follower_count: number;
  } | null;

  return c.json({
    public_code: handleUser.public_code,
    handle: formatPublicHandle(handleUser.public_code),
    avatar_key: handleUser.avatar_key,
    review_count: reviews.length,
    follow_count: follows.length,
    following_user_count: Number(counts?.following_user_count) || 0,
    follower_count: Number(counts?.follower_count) || 0,
    reviews,
    follows,
  });
}

export async function handleUpdateOrdinaryUserAvatar(c: Context) {
  const auth = await requireOrdinaryWriteUser(
    c,
    "请先登录",
    "当前账号无法修改头像",
  );
  if ("error" in auth) return auth.error;
  let avatarKey: unknown;
  try {
    const body = await c.req.json<{ avatar_key?: unknown }>();
    avatarKey = body.avatar_key;
  } catch {
    return c.json({ error: "请选择官方头像" }, 400);
  }
  if (
    typeof avatarKey !== "number" ||
    !Number.isInteger(avatarKey) ||
    avatarKey < 0 ||
    avatarKey >= AVATAR_KEY_COUNT
  ) {
    return c.json({ error: "请选择官方头像" }, 400);
  }
  await c.env.DB.prepare("UPDATE users SET avatar_key=? WHERE id=?")
    .bind(avatarKey, auth.user.id)
    .run();
  return c.json({
    ok: true,
    public_code: auth.user.public_code,
    handle:
      auth.user.public_code == null
        ? undefined
        : formatPublicHandle(auth.user.public_code),
    avatar_key: avatarKey,
  });
}
