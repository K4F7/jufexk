/**
 * 任课评价回复（评论区）：当前评价（review:NNN）下的公开回复。
 * GET 公开（游客视图排除仅限登录评价的回复）；POST/DELETE 走普通用户写闸门。
 * 顶层回复经 0046 触发器通知评价作者，回复他人的回复通知被回复者
 * （review_comment_replied），与认可/关注消息共用 user_notifications 收件箱。
 */
import { resolveOrdinaryUser } from "./ordinary-user-authentication";
import {
  isOrdinaryUserAuthenticated,
  requireOrdinaryWriteUser,
} from "./ordinary-user-write-authorization";
import { ensureUserPublicHandle } from "./public-handle";
import {
  guestReviewBindingSql,
  publicReviewBindingSql,
} from "./public-review-visibility";
import {
  parseCurrentReviewId,
  parseIdempotencyKey,
  readIdempotency,
  saveIdempotency,
} from "./review-endorsements";
import { digest, fail, integer, takeRateLimit } from "./routes/support";
import type { AppContext } from "./routes/types";

export const COMMENT_CREATE_OPERATION = "review-comment.create";

/** 回复正文：去空白后 1–500 字（补充说明为 10–1200，回复从简）。 */
const COMMENT_BODY_MAX = 500;

type CommentRow = {
  id: number;
  body: string;
  parentCommentId: number | null;
  createdAt: string;
  authorPublicCode: number | null;
  authorAvatarKey: number | null;
  endorsementCount?: number;
  viewerEndorsed?: boolean;
};

function mapComment(row: CommentRow) {
  return {
    id: String(row.id),
    authorPublicCode: row.authorPublicCode ?? 0,
    authorAvatarKey: row.authorAvatarKey ?? 0,
    body: row.body,
    createdAt: row.createdAt,
    parentId: row.parentCommentId != null ? String(row.parentCommentId) : null,
    endorsementCount: Number(row.endorsementCount) || 0,
    viewerEndorsed: row.viewerEndorsed === true,
  };
}

async function decorateCommentEndorsements(
  db: D1Database,
  items: ReturnType<typeof mapComment>[],
  viewerUserId: string | null,
) {
  if (!items.length) return items;
  const ids = items.map((item) => Number(item.id));
  const placeholders = ids.map(() => "?").join(",");
  try {
    const { results } = await db
      .prepare(
        `SELECT comment_id, COUNT(*) count FROM review_comment_endorsements
         WHERE comment_id IN (${placeholders})
         GROUP BY comment_id`,
      )
      .bind(...ids)
      .all<{ comment_id: number; count: number }>();
    const counts = new Map(
      results.map((row) => [row.comment_id, Number(row.count) || 0]),
    );
    const endorsed = new Set<number>();
    if (viewerUserId) {
      const { results: rows } = await db
        .prepare(
          `SELECT comment_id FROM review_comment_endorsements
           WHERE user_id=? AND comment_id IN (${placeholders})`,
        )
        .bind(viewerUserId, ...ids)
        .all<{ comment_id: number }>();
      for (const row of rows) endorsed.add(row.comment_id);
    }
    return items.map((item) => {
      const id = Number(item.id);
      return {
        ...item,
        endorsementCount: counts.get(id) ?? 0,
        viewerEndorsed: endorsed.has(id),
      };
    });
  } catch {
    return items;
  }
}

/** 与公开文字流一致的评价可见性；游客额外排除 login_only。 */
async function loadCommentableReview(
  db: D1Database,
  reviewId: number,
  guest: boolean,
) {
  return db
    .prepare(
      `SELECT r.id FROM reviews r
       WHERE r.id=? AND r.status='approved' AND trim(COALESCE(r.comment,''))<>''
       ${guest ? guestReviewBindingSql : publicReviewBindingSql}`,
    )
    .bind(reviewId)
    .first<{ id: number }>();
}

function parseParentCommentId(raw: unknown): number | null | undefined {
  if (raw == null || raw === "") return null;
  const value = integer(raw);
  if (value == null || value <= 0) return undefined;
  return value;
}

export async function handleListReviewComments(c: AppContext) {
  const reviewId = parseCurrentReviewId(c.req.param("id"));
  if (!reviewId) return fail(c, "评价不存在", 404);
  const viewer = await resolveOrdinaryUser(c);
  const guest = !viewer || !isOrdinaryUserAuthenticated(viewer);
  const review = await loadCommentableReview(c.env.DB, reviewId, guest);
  if (!review) return fail(c, "评价不存在", 404);
  const { results } = await c.env.DB.prepare(
    `SELECT rc.id, rc.body, rc.parent_comment_id AS parentCommentId,
            rc.created_at AS createdAt,
            author.public_code AS authorPublicCode,
            author.avatar_key AS authorAvatarKey
     FROM review_comments rc
     JOIN users author ON author.id = rc.author_user_id
     WHERE rc.review_id=? AND rc.deleted_at IS NULL
     ORDER BY rc.created_at ASC, rc.id ASC`,
  )
    .bind(reviewId)
    .all<CommentRow>();
  const items = await decorateCommentEndorsements(
    c.env.DB,
    results.map(mapComment),
    viewer?.id ?? null,
  );
  return c.json({ items });
}

export async function handleCreateReviewComment(c: AppContext) {
  const auth = await requireOrdinaryWriteUser(
    c,
    "请先登录后再回复",
    "当前账号无法回复",
  );
  if ("error" in auth) return auth.error;
  const reviewId = parseCurrentReviewId(c.req.param("id"));
  if (!reviewId) return fail(c, "评价不存在或不可回复", 404);
  const idempotencyKey = parseIdempotencyKey(c.req.header("Idempotency-Key"));
  if (!idempotencyKey) return fail(c, "缺少有效的幂等键", 400);
  let payload: { body?: unknown; parentCommentId?: unknown };
  try {
    payload = await c.req.json();
  } catch {
    return fail(c, "请求体无效", 400);
  }
  const body =
    typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body || body.length > COMMENT_BODY_MAX)
    return fail(c, `回复需为 1–${COMMENT_BODY_MAX} 字`, 400);
  const parentCommentId = parseParentCommentId(payload.parentCommentId);
  if (parentCommentId === undefined) return fail(c, "回复目标无效", 400);

  const requestDigest = await digest(
    JSON.stringify({
      operation: COMMENT_CREATE_OPERATION,
      reviewId,
      body,
      parentCommentId,
    }),
  );
  const replay = await readIdempotency(
    c.env.DB,
    auth.user.id,
    COMMENT_CREATE_OPERATION,
    idempotencyKey,
  );
  if (replay) {
    if (replay.request_digest !== requestDigest)
      return fail(c, "幂等键与请求不匹配", 409);
    return c.json(JSON.parse(replay.response_json));
  }

  const review = await loadCommentableReview(c.env.DB, reviewId, false);
  if (!review) return fail(c, "评价不存在或不可回复", 404);
  if (parentCommentId != null) {
    const parent = await c.env.DB.prepare(
      "SELECT id FROM review_comments WHERE id=? AND review_id=? AND deleted_at IS NULL",
    )
      .bind(parentCommentId, reviewId)
      .first();
    if (!parent) return fail(c, "回复目标不存在", 404);
  }
  if (!(await takeRateLimit(c.env.DB, `review-comment:${auth.user.id}`, 600, 20)))
    return fail(c, "回复过于频繁，请稍后再试", 429);

  const handle = await ensureUserPublicHandle(c.env.DB, auth.user);
  const inserted = await c.env.DB.prepare(
    `INSERT INTO review_comments(review_id,parent_comment_id,author_user_id,body)
     VALUES(?,?,?,?)`,
  )
    .bind(reviewId, parentCommentId, auth.user.id, body)
    .run();
  const id = Number(inserted.meta.last_row_id);
  const created = await c.env.DB.prepare(
    "SELECT created_at AS createdAt FROM review_comments WHERE id=?",
  )
    .bind(id)
    .first<{ createdAt: string }>();
  const responseBody = {
    comment: mapComment({
      id,
      body,
      parentCommentId,
      createdAt: created?.createdAt ?? "",
      authorPublicCode: handle.public_code,
      authorAvatarKey: handle.avatar_key,
    }),
  };
  const stored = await saveIdempotency(
    c.env.DB,
    auth.user.id,
    COMMENT_CREATE_OPERATION,
    idempotencyKey,
    requestDigest,
    200,
    responseBody,
  );
  if (stored && stored.request_digest !== requestDigest)
    return fail(c, "幂等键与请求不匹配", 409);
  return c.json(stored ? JSON.parse(stored.response_json) : responseBody);
}

export async function handleDeleteReviewComment(c: AppContext) {
  const auth = await requireOrdinaryWriteUser(
    c,
    "请先登录后再删除",
    "当前账号无法删除回复",
  );
  if ("error" in auth) return auth.error;
  const reviewId = parseCurrentReviewId(c.req.param("id"));
  const commentId = integer(c.req.param("commentId"));
  if (!reviewId || !commentId) return fail(c, "回复不存在", 404);
  const own = await c.env.DB.prepare(
    `SELECT id FROM review_comments
     WHERE id=? AND review_id=? AND author_user_id=? AND deleted_at IS NULL`,
  )
    .bind(commentId, reviewId, auth.user.id)
    .first();
  if (!own) return fail(c, "回复不存在", 404);
  await c.env.DB.prepare(
    "UPDATE review_comments SET deleted_at=CURRENT_TIMESTAMP WHERE id=?",
  )
    .bind(commentId)
    .run();
  return c.json({ ok: true });
}
