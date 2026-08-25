import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { VIRTUAL_PE_SPORTS } from "../src/lib/public-course-presentation";
import { hmacHex } from "../src/ordinary-user-authentication";
import {
  ORDINARY_TEST_AUTH_SECRET,
  ordinaryWriteHeaders,
  ordinaryWriteSession,
  setOrdinaryUserStatus,
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
      `notification-${crypto.randomUUID()}`,
      input.authorUserId ?? null,
      input.status ?? "approved",
    )
    .run();
  return Number(result.meta.last_row_id);
}

async function getJson<T>(path: string, auth: Record<string, string>) {
  const response = await SELF.fetch(`${WRITE_ORIGIN}${path}`, { headers: auth });
  return { response, body: await response.json<T>() };
}

describe("ordinary-user notification API", () => {
  it("creates private notifications for followed relations and recognitions", async () => {
    const follower = await ordinaryWriteSession("notification-follower");
    const author = await ordinaryWriteSession("notification-author");
    const endorser = await ordinaryWriteSession("notification-endorser");
    const other = await ordinaryWriteSession("notification-other");
    const followerId = await stableUserId(follower.userId);
    const authorId = await stableUserId(author.userId);
    const endorserId = await stableUserId(endorser.userId);

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO relation_follows(user_id,course_id,teacher_id) VALUES(?,1,1)",
      ).bind(followerId),
      env.DB.prepare(
        "INSERT INTO relation_follows(user_id,course_id,teacher_id) VALUES(?,1,1)",
      ).bind(authorId),
    ]);
    const reviewId = await insertReview({
      authorUserId: authorId,
      comment: "通知测试评价",
    });
    await env.DB.prepare(
      "INSERT INTO review_endorsements(user_id,review_id) VALUES(?,?)",
    )
      .bind(endorserId, reviewId)
      .run();

    const followerInbox = await getJson<{
      items: Array<Record<string, unknown>>;
      total: number;
      page: number;
      pages: number;
    }>("/api/user/notifications", follower.auth);
    expect(followerInbox.response.status).toBe(200);
    expect(followerInbox.body).toMatchObject({ total: 1, page: 1, pages: 1 });
    expect(followerInbox.body.items).toEqual([
      expect.objectContaining({
        type: "followed_relation_review",
        message: "测试课程 · 测试教师有新任课评价",
        link: `/courses/1?teacher=1#review-${reviewId}`,
        read: false,
      }),
    ]);

    const authorInbox = await getJson<{
      items: Array<Record<string, unknown>>;
      total: number;
    }>("/api/user/notifications", author.auth);
    expect(authorInbox.response.status).toBe(200);
    expect(authorInbox.body.total).toBe(1);
    expect(authorInbox.body.items[0]).toMatchObject({
      type: "review_endorsed",
      message: "你对测试课程 · 测试教师的任课评价获得了认可",
      link: `/courses/1?teacher=1#review-${reviewId}`,
      read: false,
    });

    for (const inbox of [followerInbox.body, authorInbox.body]) {
      const raw = JSON.stringify(inbox);
      expect(raw).not.toContain(followerId);
      expect(raw).not.toContain(authorId);
      expect(raw).not.toContain(endorserId);
      expect(raw).not.toMatch(/user_id|author_user_id|event_key/);
    }

    const otherCount = await getJson<{ unreadCount: number }>(
      "/api/user/notifications/unread-count",
      other.auth,
    );
    expect(otherCount.body).toEqual({ unreadCount: 0 });
  });

  it("notifies on approval once and suppresses self-generated notifications", async () => {
    const user = await ordinaryWriteSession("notification-self");
    const userId = await stableUserId(user.userId);
    await env.DB.prepare(
      "INSERT INTO relation_follows(user_id,course_id,teacher_id) VALUES(?,1,1)",
    )
      .bind(userId)
      .run();
    const pendingReviewId = await insertReview({
      authorUserId: "different-private-author",
      status: "pending",
      comment: "待审核通知测试",
    });
    await env.DB.prepare(
      "UPDATE reviews SET status='approved',reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(pendingReviewId)
      .run();
    await env.DB.prepare(
      "UPDATE reviews SET status='approved' WHERE id=?",
    )
      .bind(pendingReviewId)
      .run();

    const ownReviewId = await insertReview({
      authorUserId: userId,
      comment: "自己的通知测试",
    });
    await env.DB.prepare(
      "INSERT INTO review_endorsements(user_id,review_id) VALUES(?,?)",
    )
      .bind(userId, ownReviewId)
      .run();
    const count = await getJson<{ unreadCount: number }>(
      "/api/user/notifications/unread-count",
      user.auth,
    );
    expect(count.body).toEqual({ unreadCount: 1 });
  });

  it("maps virtual PE follows and recognition links to the visible course", async () => {
    expect(
      (
        await env.DB.prepare(
          "SELECT virtual_course_id id,label,teacher_name FROM virtual_pe_notification_courses ORDER BY virtual_course_id",
        ).all()
      ).results,
    ).toEqual(
      VIRTUAL_PE_SPORTS.map((sport) => ({
        id: sport.id,
        label: sport.label,
        teacher_name: sport.teacherNames[0],
      })),
    );
    const follower = await ordinaryWriteSession("notification-pe-follower");
    const author = await ordinaryWriteSession("notification-pe-author");
    const endorser = await ordinaryWriteSession("notification-pe-endorser");
    const followerId = await stableUserId(follower.userId);
    const authorId = await stableUserId(author.userId);
    const endorserId = await stableUserId(endorser.userId);
    const teacher = await env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name) VALUES('通知瑜伽教师','黄丽萍')",
    ).run();
    const teacherId = Number(teacher.meta.last_row_id);
    const course = await env.DB.prepare(
      "INSERT INTO courses(code,name,category) VALUES('NOTIFY-PE-1','体育1','sports')",
    ).run();
    const courseId = Number(course.meta.last_row_id);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
      ).bind(courseId, teacherId),
      env.DB.prepare(
        "INSERT INTO relation_follows(user_id,course_id,teacher_id) VALUES(?,800001,?)",
      ).bind(followerId, teacherId),
    ]);
    const review = await env.DB.prepare(
      `INSERT INTO reviews(
         course_id,teacher_id,category,overall,comment,status,submitter_hash,
         author_user_id,reviewed_at
       ) VALUES(?,?,'sports',4,'虚拟体育通知测试','approved',?,?,CURRENT_TIMESTAMP)`,
    )
      .bind(courseId, teacherId, `notification-${crypto.randomUUID()}`, authorId)
      .run();
    const reviewId = Number(review.meta.last_row_id);
    await env.DB.prepare(
      "INSERT INTO review_endorsements(user_id,review_id) VALUES(?,?)",
    )
      .bind(endorserId, reviewId)
      .run();

    const followerInbox = await getJson<{
      items: Array<{ message: string; link: string }>;
    }>("/api/user/notifications", follower.auth);
    expect(followerInbox.body.items[0]).toMatchObject({
      message: "瑜伽 · 黄丽萍有新任课评价",
      link: `/courses/800001?teacher=${teacherId}#review-${reviewId}`,
    });
    const authorInbox = await getJson<{
      items: Array<{ message: string; link: string }>;
    }>("/api/user/notifications", author.auth);
    expect(authorInbox.body.items[0]).toMatchObject({
      message: "你对瑜伽 · 黄丽萍的任课评价获得了认可",
      link: `/courses/800001?teacher=${teacherId}#review-${reviewId}`,
    });
  });

  it("marks only the current user's notifications read and enforces auth and CSRF", async () => {
    const first = await ordinaryWriteSession("notification-read-first");
    const second = await ordinaryWriteSession("notification-read-second");
    const firstId = await stableUserId(first.userId);
    const secondId = await stableUserId(second.userId);
    await env.DB.prepare(
      `INSERT INTO user_notifications(
         user_id,type,message,link,event_key,source_review_id
       ) VALUES
         (?,'followed_relation_review','第一条','/courses/1','read-first-1',1),
         (?,'review_endorsed','第二条','/courses/1','read-first-2',1),
         (?,'followed_relation_review','另一用户','/courses/1','read-second-1',1)`,
    )
      .bind(firstId, firstId, secondId)
      .run();

    const anonymousList = await SELF.fetch(
      `${WRITE_ORIGIN}/api/user/notifications`,
    );
    expect(anonymousList.status).toBe(401);
    const anonymousRead = await SELF.fetch(
      `${WRITE_ORIGIN}/api/user/notifications/read`,
      { method: "POST" },
    );
    expect(anonymousRead.status).toBe(401);
    const missingCsrf = await SELF.fetch(
      `${WRITE_ORIGIN}/api/user/notifications/read`,
      { method: "POST", headers: first.auth },
    );
    expect(missingCsrf.status).toBe(403);

    const marked = await SELF.fetch(
      `${WRITE_ORIGIN}/api/user/notifications/read`,
      { method: "POST", headers: ordinaryWriteHeaders(first) },
    );
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual({
      ok: true,
      markedRead: 2,
      unreadCount: 0,
    });
    const repeated = await SELF.fetch(
      `${WRITE_ORIGIN}/api/user/notifications/read`,
      { method: "POST", headers: ordinaryWriteHeaders(first) },
    );
    expect(await repeated.json()).toMatchObject({ markedRead: 0, unreadCount: 0 });

    const secondCount = await getJson<{ unreadCount: number }>(
      "/api/user/notifications/unread-count",
      second.auth,
    );
    expect(secondCount.body).toEqual({ unreadCount: 1 });

    await setOrdinaryUserStatus(first.userId, "banned");
    const banned = await getJson<{ error: string }>(
      "/api/user/notifications",
      first.auth,
    );
    expect(banned.response.status).toBe(403);
  });
});
