import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hmacHex } from "../src/ordinary-user-session";
import {
  ORDINARY_TEST_AUTH_SECRET,
  ordinaryWriteHeaders,
  ordinaryWriteSession,
  setOrdinaryUserStatus,
  WRITE_ORIGIN,
} from "./ordinary-write-session";

async function stableUserId(userId: string) {
  return hmacHex(`ordinary-test-user:${userId}`, ORDINARY_TEST_AUTH_SECRET);
}

async function profile(userId: string) {
  const session = await ordinaryWriteSession(userId);
  return SELF.fetch(`${WRITE_ORIGIN}/api/user/profile`, {
    headers: session.auth,
  });
}

describe("ordinary-user profile", () => {
  it("requires an active ordinary-user session", async () => {
    const guest = await SELF.fetch(`${WRITE_ORIGIN}/api/user/profile`);
    expect(guest.status).toBe(401);
    expect(await guest.json()).toEqual({ error: "请先登录" });

    const userId = "profile-banned-user";
    const session = await ordinaryWriteSession(userId);
    await setOrdinaryUserStatus(userId, "banned");
    const banned = await SELF.fetch(`${WRITE_ORIGIN}/api/user/profile`, {
      headers: session.auth,
    });
    expect(banned.status).toBe(403);
    expect(await banned.json()).toEqual({ error: "当前账号无法访问个人主页" });
  });

  it("returns only the viewer reviews and follows without exposing identity", async () => {
    const viewer = "profile-viewer-a";
    const other = "profile-viewer-b";
    await ordinaryWriteSession(viewer);
    await ordinaryWriteSession(other);
    const viewerId = await stableUserId(viewer);
    const otherId = await stableUserId(other);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO reviews(
           course_id,teacher_id,category,overall,comment,comment_format,headline,
           term,status,submitter_hash,author_user_id,created_at
         ) VALUES(1,1,'general',4,?,'html','我的总结','2026 春','pending','private-a',?,'2026-08-24 10:00:00')`,
      ).bind(`<p>${"富文本摘要".repeat(50)} &amp; 尾部</p>`, viewerId),
      env.DB.prepare(
        `INSERT INTO reviews(
           course_id,teacher_id,category,overall,comment,headline,term,status,
           submitter_hash,author_user_id,created_at
         ) VALUES(1,1,'general',5,'别人的点评','其他总结','2026 春','approved','private-b',?,'2026-08-24 11:00:00')`,
      ).bind(otherId),
      env.DB.prepare(
        "INSERT INTO relation_follows(user_id,course_id,teacher_id,created_at) VALUES(?,1,1,'2026-08-24 12:00:00')",
      ).bind(viewerId),
      env.DB.prepare(
        "INSERT INTO relation_follows(user_id,course_id,teacher_id,created_at) VALUES(?,3,1,'2026-08-24 13:00:00')",
      ).bind(otherId),
    ]);

    const response = await profile(viewer);
    expect(response.status).toBe(200);
    const body = await response.json<{
      review_count: number;
      follow_count: number;
      reviews: Array<Record<string, unknown>>;
      follows: Array<Record<string, unknown>>;
    }>();
    expect(body).toMatchObject({ review_count: 1, follow_count: 1 });
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({
      course_id: 1,
      course_name: "测试课程",
      teacher_id: 1,
      teacher_name: "测试教师",
      term: "2026 春",
      headline: "我的总结",
      status: "pending",
      created_at: "2026-08-24 10:00:00",
    });
    expect(String(body.reviews[0]?.comment)).not.toContain("<p>");
    expect(String(body.reviews[0]?.comment)).toHaveLength(181);
    expect(String(body.reviews[0]?.comment).endsWith("…")).toBe(true);
    expect(body.follows).toEqual([
      {
        course_id: 1,
        course_name: "测试课程",
        teacher_id: 1,
        teacher_name: "测试教师",
        created_at: "2026-08-24 12:00:00",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(viewerId);
    expect(JSON.stringify(body)).not.toContain(otherId);
  });

  it("links new review submissions to the authenticated user", async () => {
    const userId = "profile-review-writer";
    const session = await ordinaryWriteSession(userId);
    const response = await SELF.fetch(`${WRITE_ORIGIN}/api/reviews`, {
      method: "POST",
      headers: ordinaryWriteHeaders(session, {
        "CF-Connecting-IP": "203.0.113.159",
      }),
      body: JSON.stringify({
        courseId: 1,
        teacherId: 1,
        overall: 5,
        scores: { difficulty: 1, homework: 2, grading: 1, gain: 1, attendance: 1 },
        comment: "这是一条用于验证个人主页归属的新点评",
        headline: "归属正确",
      }),
    });
    expect(response.status).toBe(200);

    const listed = await profile(userId);
    expect(listed.status).toBe(200);
    const body = await listed.json<{ reviews: Array<{ headline: string }> }>();
    expect(body.reviews).toContainEqual(
      expect.objectContaining({ headline: "归属正确" }),
    );
  });
});
