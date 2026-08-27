import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hmacHex } from "../src/ordinary-user-authentication";
import {
  ORDINARY_TEST_AUTH_SECRET,
  ordinaryWriteHeaders,
  ordinaryWriteSession,
  WRITE_ORIGIN,
} from "./ordinary-write-session";

async function stableUserId(userId: string) {
  return hmacHex(
    `ordinary-test-user:${userId}`,
    ORDINARY_TEST_AUTH_SECRET,
  );
}

async function insertReview(input: {
  authorUserId?: string;
  status?: "pending" | "approved";
  comment: string;
}) {
  const result = await env.DB.prepare(
    `INSERT INTO reviews(
       course_id,teacher_id,category,overall,comment,status,submitter_hash,
       author_user_id,reviewed_at
     ) VALUES(1,1,'general',4,?,?,?, ?,
       CASE WHEN ?='approved' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
  )
    .bind(
      input.comment,
      input.status ?? "approved",
      `comment-${crypto.randomUUID()}`,
      input.authorUserId ?? null,
      input.status ?? "approved",
    )
    .run();
  return Number(result.meta.last_row_id);
}

type Session = Awaited<ReturnType<typeof ordinaryWriteSession>>;

function commentHeaders(session: Session, idempotencyKey?: string) {
  return ordinaryWriteHeaders(session, {
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  });
}

async function postComment(
  reviewId: number | string,
  session: Session,
  body: string,
  parentCommentId?: number | string | null,
  idempotencyKey = crypto.randomUUID(),
) {
  return SELF.fetch(`${WRITE_ORIGIN}/api/reviews/${reviewId}/comments`, {
    method: "POST",
    headers: commentHeaders(session, idempotencyKey),
    body: JSON.stringify({
      body,
      ...(parentCommentId != null ? { parentCommentId } : {}),
    }),
  });
}

async function listComments(reviewId: number | string, session?: Session) {
  const response = await SELF.fetch(
    `${WRITE_ORIGIN}/api/reviews/${reviewId}/comments`,
    session ? { headers: commentHeaders(session) } : undefined,
  );
  return {
    response,
    body: await response.json<{
      items?: Array<Record<string, unknown>>;
      error?: string;
    }>(),
  };
}

async function inbox(session: Session) {
  const response = await SELF.fetch(`${WRITE_ORIGIN}/api/user/notifications`, {
    headers: commentHeaders(session),
  });
  return response.json<{
    items: Array<Record<string, unknown>>;
    total: number;
  }>();
}

describe("review comments API", () => {
  it("creates and lists comments with public handles only", async () => {
    const author = await ordinaryWriteSession("comment-review-author");
    const commenter = await ordinaryWriteSession("comment-author");
    const reviewId = await insertReview({
      authorUserId: await stableUserId(author.userId),
      comment: "回复区测试评价",
    });

    const created = await postComment(reviewId, commenter, "例题确实很有用");
    expect(created.status).toBe(200);
    const createdBody = await created.json<{
      comment: Record<string, unknown>;
    }>();
    expect(createdBody.comment).toMatchObject({
      body: "例题确实很有用",
      parentId: null,
    });
    expect(typeof createdBody.comment.authorPublicCode).toBe("number");
    expect(createdBody.comment.authorPublicCode).toBeGreaterThanOrEqual(1);

    const listed = await listComments(reviewId);
    expect(listed.response.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items?.[0]).toMatchObject({
      id: createdBody.comment.id,
      body: "例题确实很有用",
      authorPublicCode: createdBody.comment.authorPublicCode,
    });
    const raw = JSON.stringify(listed.body);
    expect(raw).not.toContain("comment-author");
    expect(raw).not.toMatch(/author_user_id|user_id/);
  });

  it("notifies the review author on a top-level comment", async () => {
    const author = await ordinaryWriteSession("notify-review-author");
    const commenter = await ordinaryWriteSession("notify-commenter");
    const reviewId = await insertReview({
      authorUserId: await stableUserId(author.userId),
      comment: "回复通知测试评价",
    });

    const created = await postComment(reviewId, commenter, "收到通知了吗");
    expect(created.status).toBe(200);

    const authorInbox = await inbox(author);
    expect(authorInbox.total).toBe(1);
    expect(authorInbox.items[0]).toMatchObject({
      type: "review_comment_replied",
      message: "你对测试课程 · 测试教师的任课评价有了新回复",
      link: `/courses/1?teacher=1#review-${reviewId}`,
      read: false,
    });

    const commenterInbox = await inbox(commenter);
    expect(commenterInbox.total).toBe(0);
  });

  it("notifies the parent comment author on a reply, not the review author", async () => {
    const reviewAuthor = await ordinaryWriteSession("notify-reply-review");
    const parentAuthor = await ordinaryWriteSession("notify-reply-parent");
    const replier = await ordinaryWriteSession("notify-reply-replier");
    const reviewId = await insertReview({
      authorUserId: await stableUserId(reviewAuthor.userId),
      comment: "楼中楼通知测试评价",
    });

    const parent = await postComment(reviewId, parentAuthor, "一楼回复");
    expect(parent.status).toBe(200);
    const parentId = (await parent.json<{ comment: { id: string } }>()).comment
      .id;

    const reply = await postComment(
      reviewId,
      replier,
      "回复一楼",
      parentId,
    );
    expect(reply.status).toBe(200);
    const replyBody = await reply.json<{ comment: { parentId: string } }>();
    expect(replyBody.comment.parentId).toBe(parentId);

    // 被回复者收到「你的回复有了新回复」。
    const parentInbox = await inbox(parentAuthor);
    expect(parentInbox.items).toEqual([
      expect.objectContaining({
        type: "review_comment_replied",
        message: "你在测试课程 · 测试教师评价下的回复有了新回复",
        link: `/courses/1?teacher=1#review-${reviewId}`,
        read: false,
      }),
    ]);

    // 评价作者只收到一楼那条顶层回复的通知，楼中楼不再额外通知。
    const reviewAuthorInbox = await inbox(reviewAuthor);
    expect(reviewAuthorInbox.items).toEqual([
      expect.objectContaining({
        type: "review_comment_replied",
        message: "你对测试课程 · 测试教师的任课评价有了新回复",
      }),
    ]);

    const replierInbox = await inbox(replier);
    expect(replierInbox.total).toBe(0);
  });

  it("does not notify when commenting on your own review or replying to yourself", async () => {
    const author = await ordinaryWriteSession("notify-self");
    const reviewId = await insertReview({
      authorUserId: await stableUserId(author.userId),
      comment: "自评自复测试评价",
    });

    const own = await postComment(reviewId, author, "自己补充一句");
    expect(own.status).toBe(200);
    const ownId = (await own.json<{ comment: { id: string } }>()).comment.id;
    const selfReply = await postComment(reviewId, author, "再补充", ownId);
    expect(selfReply.status).toBe(200);

    const authorInbox = await inbox(author);
    expect(authorInbox.total).toBe(0);
  });

  it("rejects guests, bad CSRF, empty or overlong bodies and missing parents", async () => {
    const reviewId = await insertReview({ comment: "回复校验测试评价" });
    const session = await ordinaryWriteSession("comment-validation");

    const anonymous = await SELF.fetch(
      `${WRITE_ORIGIN}/api/reviews/${reviewId}/comments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: WRITE_ORIGIN,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ body: "游客回复" }),
      },
    );
    expect(anonymous.status).toBe(401);

    const badCsrf = await SELF.fetch(
      `${WRITE_ORIGIN}/api/reviews/${reviewId}/comments`,
      {
        method: "POST",
        headers: {
          ...commentHeaders(session),
          "X-CSRF-Token": "not-the-csrf",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ body: "CSRF 回复" }),
      },
    );
    expect(badCsrf.status).toBe(403);

    const missingKey = await SELF.fetch(
      `${WRITE_ORIGIN}/api/reviews/${reviewId}/comments`,
      {
        method: "POST",
        headers: commentHeaders(session),
        body: JSON.stringify({ body: "缺幂等键" }),
      },
    );
    expect(missingKey.status).toBe(400);

    const empty = await postComment(reviewId, session, "   ");
    expect(empty.status).toBe(400);
    const overlong = await postComment(reviewId, session, "长".repeat(501));
    expect(overlong.status).toBe(400);

    const missingParent = await postComment(
      reviewId,
      session,
      "回复不存在的楼层",
      9_999_999,
    );
    expect(missingParent.status).toBe(404);

    const listed = await listComments(reviewId);
    expect(listed.body.items).toEqual([]);
  });

  it("rejects comments on pending, score-only or missing reviews", async () => {
    const session = await ordinaryWriteSession("comment-eligibility");
    const pending = await insertReview({
      comment: "待审核补充说明",
      status: "pending",
    });
    const scoreOnly = await insertReview({ comment: "   " });

    for (const target of [pending, scoreOnly, 9_999_999]) {
      const created = await postComment(target, session, "不可回复");
      expect(created.status, String(target)).toBe(404);
      const listed = await listComments(target);
      expect(listed.response.status, String(target)).toBe(404);
    }
  });

  it("replays the same idempotency key without duplicating the comment", async () => {
    const reviewId = await insertReview({ comment: "幂等回复测试评价" });
    const session = await ordinaryWriteSession("comment-idempotent");
    const key = crypto.randomUUID();

    const first = await postComment(reviewId, session, "幂等回复", null, key);
    expect(first.status).toBe(200);
    const replay = await postComment(reviewId, session, "幂等回复", null, key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());

    const conflict = await postComment(reviewId, session, "换了正文", null, key);
    expect(conflict.status).toBe(409);

    const listed = await listComments(reviewId);
    expect(listed.body.items).toHaveLength(1);
  });

  it("deletes only your own comment and hides it from the list", async () => {
    const reviewId = await insertReview({ comment: "删除回复测试评价" });
    const owner = await ordinaryWriteSession("comment-delete-owner");
    const other = await ordinaryWriteSession("comment-delete-other");

    const created = await postComment(reviewId, owner, "待删除的回复");
    const commentId = (await created.json<{ comment: { id: string } }>())
      .comment.id;

    const wrongUser = await SELF.fetch(
      `${WRITE_ORIGIN}/api/reviews/${reviewId}/comments/${commentId}`,
      { method: "DELETE", headers: commentHeaders(other) },
    );
    expect(wrongUser.status).toBe(404);

    const removed = await SELF.fetch(
      `${WRITE_ORIGIN}/api/reviews/${reviewId}/comments/${commentId}`,
      { method: "DELETE", headers: commentHeaders(owner) },
    );
    expect(removed.status).toBe(200);

    const listed = await listComments(reviewId);
    expect(listed.body.items).toEqual([]);
  });

  it("exposes comment_count on the public review stream", async () => {
    const reviewId = await insertReview({ comment: "回复计数测试评价" });
    const session = await ordinaryWriteSession("comment-count");
    expect((await postComment(reviewId, session, "第一条")).status).toBe(200);
    expect((await postComment(reviewId, session, "第二条")).status).toBe(200);

    const stream = await SELF.fetch(
      `${WRITE_ORIGIN}/api/courses/1/reviews?teacherId=1`,
    );
    expect(stream.status).toBe(200);
    const body = await stream.json<{
      items: Array<{ id: string; comment_count?: number }>;
    }>();
    const row = body.items.find((item) => item.id === `review:${reviewId}`);
    expect(row?.comment_count).toBe(2);
  });

  it("creates and withdraws comment endorsements", async () => {
    const reviewId = await insertReview({ comment: "回复认可测试评价" });
    const author = await ordinaryWriteSession("comment-endorse-author");
    const created = await postComment(reviewId, author, "请认可这条回复");
    expect(created.status).toBe(200);
    const commentId = (await created.json<{ comment: { id: string } }>()).comment
      .id;
    const voter = await ordinaryWriteSession("comment-endorse-voter");

    const put = await SELF.fetch(
      `${WRITE_ORIGIN}/api/reviews/${reviewId}/comments/${commentId}/endorsement`,
      {
        method: "PUT",
        headers: commentHeaders(voter, crypto.randomUUID()),
      },
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      endorsementCount: 1,
      viewerEndorsed: true,
    });

    const listed = await listComments(reviewId, voter);
    expect(listed.body.items?.[0]).toMatchObject({
      id: commentId,
      endorsementCount: 1,
      viewerEndorsed: true,
    });

    const withdrawn = await SELF.fetch(
      `${WRITE_ORIGIN}/api/reviews/${reviewId}/comments/${commentId}/endorsement`,
      {
        method: "DELETE",
        headers: commentHeaders(voter, crypto.randomUUID()),
      },
    );
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toEqual({
      endorsementCount: 0,
      viewerEndorsed: false,
    });
  });
});
