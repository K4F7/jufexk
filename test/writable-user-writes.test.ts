import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_HEADLINE,
  REQUIRED_NOTE,
  CURRENT_SCORES,
} from "./review-score-fixtures";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
  setOrdinaryUserStatus,
} from "./ordinary-write-session";

const origin = "https://example.com";

const reviewPayload = {
  courseId: 1,
  teacherId: 1,
  overall: 5,
  scores: CURRENT_SCORES,
  comment: REQUIRED_NOTE,
  headline: REQUIRED_HEADLINE,
};

const catalogPayload = {
  kind: "teacher" as const,
  teacherSourceLabel: "可写会话教师",
  department: "测试学院",
};

async function countRows(table: "reviews" | "catalog_requests") {
  const row = await env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first<{
    n: number;
  }>();
  return row?.n || 0;
}

describe("writable ordinary-user writes", () => {
  it("rejects guest review and catalog-request posts, including honeypot, without writing", async () => {
    const reviewsBefore = await countRows("reviews");
    const requestsBefore = await countRows("catalog_requests");

    for (const [path, body, error] of [
      ["/api/reviews", reviewPayload, "请先登录后再投稿"],
      ["/api/catalog-requests", catalogPayload, "请先登录后再申请补充"],
      ["/api/reviews", { ...reviewPayload, website: "https://spam.test" }, "请先登录后再投稿"],
      [
        "/api/catalog-requests",
        { ...catalogPayload, website: "https://spam.test" },
        "请先登录后再申请补充",
      ],
    ] as const) {
      const response = await SELF.fetch(`${origin}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error });
    }

    expect(await countRows("reviews")).toBe(reviewsBefore);
    expect(await countRows("catalog_requests")).toBe(requestsBefore);
  });

  it("lets HMAC+CSRF write reviews and catalog requests, and keeps honeypot silent", async () => {
    const session = await ordinaryWriteSession("hmac-write-ok");
    const reviewsBefore = await countRows("reviews");
    const requestsBefore = await countRows("catalog_requests");

    const review = await SELF.fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: ordinaryWriteHeaders(session, {
        "CF-Connecting-IP": "203.0.113.81",
      }),
      body: JSON.stringify({
        ...reviewPayload,
        comment: "HMAC 回归投稿成功",
      }),
    });
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({ ok: true });

    const request = await SELF.fetch(`${origin}/api/catalog-requests`, {
      method: "POST",
      headers: ordinaryWriteHeaders(session, {
        "CF-Connecting-IP": "203.0.113.82",
      }),
      body: JSON.stringify({
        ...catalogPayload,
        teacherSourceLabel: "HMAC 回归教师",
      }),
    });
    expect(request.status).toBe(200);
    expect(await request.json()).toMatchObject({ ok: true });

    const trapped = await SELF.fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: ordinaryWriteHeaders(session, {
        "CF-Connecting-IP": "203.0.113.83",
      }),
      body: JSON.stringify({
        ...reviewPayload,
        website: "https://bot.test",
        comment: "蜜罐不应入库",
      }),
    });
    expect(trapped.status).toBe(200);
    expect(await trapped.json()).toEqual({ ok: true });

    expect(await countRows("reviews")).toBe(reviewsBefore + 1);
    expect(await countRows("catalog_requests")).toBe(requestsBefore + 1);
    const honeypot = await env.DB.prepare(
      "SELECT COUNT(*) n FROM reviews WHERE comment=?",
    )
      .bind("蜜罐不应入库")
      .first<{ n: number }>();
    expect(honeypot?.n).toBe(0);
  });

  it("rejects banned and pending_deletion writers with 403 and does not insert", async () => {
    for (const [status, path, body, error] of [
      ["banned", "/api/reviews", reviewPayload, "当前账号无法投稿"],
      [
        "pending_deletion",
        "/api/reviews",
        { ...reviewPayload, comment: "待删除投稿" },
        "当前账号无法投稿",
      ],
      [
        "banned",
        "/api/catalog-requests",
        catalogPayload,
        "当前账号无法申请补充",
      ],
      [
        "pending_deletion",
        "/api/catalog-requests",
        { ...catalogPayload, teacherSourceLabel: "待删除教师" },
        "当前账号无法申请补充",
      ],
    ] as const) {
      const userId = `unwritable-${status}-${path.split("/").pop()}`;
      const session = await ordinaryWriteSession(userId);
      await setOrdinaryUserStatus(userId, status);
      const beforeReviews = await countRows("reviews");
      const beforeRequests = await countRows("catalog_requests");
      const response = await SELF.fetch(`${origin}${path}`, {
        method: "POST",
        headers: ordinaryWriteHeaders(session),
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error });
      expect(await countRows("reviews")).toBe(beforeReviews);
      expect(await countRows("catalog_requests")).toBe(beforeRequests);
    }
  });

  it("keeps public catalog and review reads anonymous", async () => {
    for (const path of [
      "/api/courses",
      "/api/teachers",
      "/api/courses/1",
      "/api/courses/1/reviews",
    ]) {
      const response = await SELF.fetch(`${origin}${path}`);
      expect(response.status).toBe(200);
    }
  });
});
