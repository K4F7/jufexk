import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { adminLogin as login, adminHeaders } from "./admin-session";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
  setOrdinaryUserStatus,
} from "./ordinary-write-session";
import {
  CURRENT_SCORES,
  REQUIRED_HEADLINE,
  REQUIRED_NOTE,
} from "./review-score-fixtures";

const origin = "https://example.com";


describe("ordinary-user blocking", () => {
  it("validates admin authentication, duration, user existence, and account status", async () => {
    const unauthenticated = await SELF.fetch(
      `${origin}/api/admin/users/missing/block`,
      { method: "POST", body: JSON.stringify({ days: 1 }) },
    );
    expect(unauthenticated.status).toBe(401);

    const auth = await login();
    const invalid = await SELF.fetch(`${origin}/api/admin/users/missing/block`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ days: 0 }),
    });
    expect(invalid.status).toBe(400);

    const missing = await SELF.fetch(`${origin}/api/admin/users/missing/block`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ days: 1 }),
    });
    expect(missing.status).toBe(404);

    const session = await ordinaryWriteSession("block-inactive-user");
    const stableId = await setOrdinaryUserStatus("block-inactive-user", "banned");
    const inactive = await SELF.fetch(
      `${origin}/api/admin/users/${stableId}/block`,
      {
        method: "POST",
        headers: adminHeaders(auth),
        body: JSON.stringify({ days: 1 }),
      },
    );
    expect(session.authenticated).toBe(true);
    expect(inactive.status).toBe(409);

    const missingStatus = await SELF.fetch(
      `${origin}/api/admin/users/missing`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(missingStatus.status).toBe(404);
  });

  it("returns mute status without extra identity fields", async () => {
    const auth = await login();
    const userKey = "block-status-reader";
    await ordinaryWriteSession(userKey);
    const stableId = await setOrdinaryUserStatus(userKey, "active");

    const anonymous = await SELF.fetch(`${origin}/api/admin/users/${stableId}`);
    expect(anonymous.status).toBe(401);

    const before = await SELF.fetch(`${origin}/api/admin/users/${stableId}`, {
      headers: { Cookie: auth.cookie },
    });
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({
      userRef: stableId,
      blocked: false,
      blockedUntil: null,
    });

    await SELF.fetch(`${origin}/api/admin/users/${stableId}/block`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ days: 3 }),
    });
    const blocked = await SELF.fetch(`${origin}/api/admin/users/${stableId}`, {
      headers: { Cookie: auth.cookie },
    });
    const body = await blocked.json<Record<string, unknown>>();
    expect(body).toEqual({
      userRef: stableId,
      blocked: true,
      blockedUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(JSON.stringify(body)).not.toContain("email");
    expect(JSON.stringify(body)).not.toContain("muted_until");
  });

  it("blocks writes, keeps the session authenticated, unblocks immediately, and expires automatically", async () => {
    const userKey = "temporarily-muted-writer";
    const session = await ordinaryWriteSession(userKey);
    const stableId = await setOrdinaryUserStatus(userKey, "active");
    const auth = await login();

    const blocked = await SELF.fetch(`${origin}/api/admin/users/${stableId}/block`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ days: 2 }),
    });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({
      ok: true,
      blockedUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });

    const viewer = await SELF.fetch(`${origin}/api/user/session`, {
      headers: session.auth,
    });
    expect(await viewer.json()).toMatchObject({ authenticated: true });

    const visibleReview = await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,category,overall,status,comment)
       VALUES(1,1,'general',5,'approved','禁言用户认可读取测试')`,
    ).run();
    await env.DB.prepare(
      "INSERT INTO review_endorsements(user_id,review_id) VALUES(?,?)",
    )
      .bind(stableId, Number(visibleReview.meta.last_row_id))
      .run();
    const publicReviews = await SELF.fetch(
      `${origin}/api/courses/1/reviews?teacherId=1`,
      { headers: session.auth },
    );
    expect(
      (await publicReviews.json<{ items: Array<{ viewer_endorsed?: boolean }> }>())
        .items,
    ).toContainEqual(expect.objectContaining({ viewer_endorsed: true }));

    for (const [path, method, body, error] of [
      [
        "/api/reviews",
        "POST",
        {
          courseId: 1,
          teacherId: 1,
          overall: 5,
          scores: CURRENT_SCORES,
          comment: REQUIRED_NOTE,
          headline: REQUIRED_HEADLINE,
        },
        "当前账号无法投稿",
      ],
      [
        "/api/catalog-requests",
        "POST",
        {
          kind: "teacher",
          teacherSourceLabel: "禁言测试教师",
          department: "测试学院",
        },
        "当前账号无法申请补充",
      ],
      [
        "/api/reviews/1/endorsement",
        "PUT",
        undefined,
        "当前账号无法认可评价",
      ],
    ] as const) {
      const response = await SELF.fetch(`${origin}${path}`, {
        method,
        headers: ordinaryWriteHeaders(session),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error });
    }

    const unblocked = await SELF.fetch(
      `${origin}/api/admin/users/${stableId}/unblock`,
      { method: "POST", headers: adminHeaders(auth), body: "{}" },
    );
    expect(unblocked.status).toBe(200);
    expect(await unblocked.json()).toEqual({ ok: true, blockedUntil: null });
    expect(
      await env.DB.prepare("SELECT muted_until FROM users WHERE id=?")
        .bind(stableId)
        .first(),
    ).toEqual({ muted_until: null });

    await env.DB.prepare("UPDATE users SET muted_until=unixepoch()-1 WHERE id=?")
      .bind(stableId)
      .run();
    const expiredSession = await ordinaryWriteSession(userKey);
    expect(expiredSession.authenticated).toBe(true);
    expect(
      await env.DB.prepare("SELECT muted_until FROM users WHERE id=?")
        .bind(stableId)
        .first(),
    ).toEqual({ muted_until: null });

    const request = await SELF.fetch(`${origin}/api/catalog-requests`, {
      method: "POST",
      headers: ordinaryWriteHeaders(expiredSession),
      body: JSON.stringify({
        kind: "teacher",
        teacherSourceLabel: "到期自动解除教师",
        department: "测试学院",
      }),
    });
    expect(request.status).toBe(200);
  });
});
