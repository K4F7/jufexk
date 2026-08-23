import type { Context } from "hono";
import {
  canOrdinaryUserWrite,
  resolveOrdinaryUser,
} from "./ordinary-user-session";
import { reviewHtmlToText } from "./review-summary";

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

  return c.json({
    review_count: reviews.length,
    follow_count: follows.length,
    reviews,
    follows,
  });
}
