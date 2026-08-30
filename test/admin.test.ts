import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { adminLogin as login, adminHeaders } from "./admin-session";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
} from "./ordinary-write-session";

const origin = "https://example.com";


describe("admin sessions and catalog", () => {
  it("rejects creating or renaming a course to 班会", async () => {
    const auth = await login();
    const create = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ code: "ADMIN-HOMEROOM", name: "班会", category: "general" }),
    });
    expect(create.status).toBe(400);

    const rename = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ id: 1, code: "TEST101", name: "\u200B班会\u2060", category: "general" }),
    });
    expect(rename.status).toBe(400);
    expect(await env.DB.prepare("SELECT name FROM courses WHERE id=1").first()).toEqual({ name: "测试课程" });
  });

  it("enforces the excluded course at the database boundary", async () => {
    await expect(env.DB.prepare(
      "INSERT INTO courses(code,name,category) VALUES('DIRECT-HOMEROOM',' 班会 ','general')",
    ).run()).rejects.toThrow(/excluded course name/i);
  });

  it("does not expose submitter hashes in the admin review list", async () => {
    const inserted = await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,category,overall,status,submitter_hash,comment)
       VALUES(1,1,'general',4,'pending','stable-private-hash','hash privacy review')`,
    ).run();
    const auth = await login();
    const response = await SELF.fetch(`${origin}/api/admin/reviews?q=hash%20privacy`, {
      headers: { Cookie: auth.cookie },
    });
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).toContain("hash privacy review");
    expect(raw).not.toContain("stable-private-hash");
    expect(raw).not.toContain("submitter_hash");
    await env.DB.prepare("DELETE FROM reviews WHERE id=?")
      .bind(Number(inserted.meta.last_row_id))
      .run();
  });

  it("edits and validates general-template scores while clearing retired fields", async () => {
    const auth = await login();
    const review = await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,category,overall,status,submitter_hash)
       VALUES(1,1,'general',4,'pending','test')`,
    ).run();
    const id = Number(review.meta.last_row_id);
    const invalid = await SELF.fetch(
      `${origin}/api/admin/reviews/${id}/content`,
      {
        method: "PATCH",
        headers: adminHeaders(auth),
        body: JSON.stringify({ workloadScore: 9, note: "invalid" }),
      },
    );
    expect(invalid.status).toBe(400);
    const halfStar = await SELF.fetch(
      `${origin}/api/admin/reviews/${id}/content`,
      {
        method: "PATCH",
        headers: adminHeaders(auth),
        body: JSON.stringify({ clarity: 0.5, note: "half" }),
      },
    );
    expect(halfStar.status).toBe(400);
    expect(await halfStar.json()).toEqual({ error: "评分必须在 1 到 5 之间" });
    const saved = await SELF.fetch(
      `${origin}/api/admin/reviews/${id}/content`,
      {
        method: "PATCH",
        headers: adminHeaders(auth),
        body: JSON.stringify({
          workloadScore: 2,
          fairness: 5,
          note: "normalized",
        }),
      },
    );
    expect(saved.status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT interest,practicality,workload_score,fairness,organization FROM reviews WHERE id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({
      interest: null,
      practicality: null,
      workload_score: 2,
      fairness: 5,
      organization: null,
    });
    await env.DB.prepare("DELETE FROM reviews WHERE id=?").bind(id).run();
  });

  it("lists safe session metadata and revokes other sessions", async () => {
    const first = await login();
    const current = await login();
    const response = await SELF.fetch(`${origin}/api/admin/sessions`, {
      headers: { Cookie: current.cookie },
    });
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain("token_hash");
    expect(raw).not.toContain("csrf_token");
    expect(raw).not.toContain("ip_hash");
    const parsed = JSON.parse(raw) as {
      sessions: Array<{ current: boolean; session_id: string }>;
    };
    expect(parsed.sessions.length).toBeGreaterThanOrEqual(2);
    expect(parsed.sessions.filter((session) => session.current)).toHaveLength(
      1,
    );

    const revoke = await SELF.fetch(
      `${origin}/api/admin/sessions/revoke-others`,
      {
        method: "POST",
        headers: adminHeaders(current),
        body: "{}",
      },
    );
    expect(revoke.status).toBe(200);
    expect(
      (
        await SELF.fetch(`${origin}/api/admin/session`, {
          headers: { Cookie: first.cookie },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await SELF.fetch(`${origin}/api/admin/session`, {
          headers: { Cookie: current.cookie },
        })
      ).status,
    ).toBe(200);
  });

  it("binds CSRF to the persisted session and revokes on logout", async () => {
    const auth = await login();
    const session = await SELF.fetch(`${origin}/api/admin/session`, {
      headers: { Cookie: auth.cookie },
    });
    expect(session.status).toBe(200);
    expect((await session.json<{ csrfToken: string }>()).csrfToken).toBe(
      auth.csrf,
    );

    const rejected = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: auth.cookie },
      body: JSON.stringify({ name: "CSRF test", category: "general" }),
    });
    expect(rejected.status).toBe(403);

    const logout = await SELF.fetch(`${origin}/api/admin/logout`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: "{}",
    });
    expect(logout.status).toBe(200);
    expect(
      (
        await SELF.fetch(`${origin}/api/admin/session`, {
          headers: { Cookie: auth.cookie },
        })
      ).status,
    ).toBe(401);
  });

  it("saves a new course and teacher relationship together", async () => {
    const auth = await login();
    const response = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        code: "ADMIN101",
        name: "集成测试课程",
        category: "general",
        department: "测试学院",
        teacherIds: [1, 1],
      }),
    });
    expect(response.status).toBe(200);
    const { id } = await response.json<{ id: number }>();
    const relation = await env.DB.prepare(
      "SELECT teacher_id FROM course_teachers WHERE course_id=?",
    )
      .bind(id)
      .all();
    expect(relation.results).toEqual([{ teacher_id: 1 }]);
  });

  it("creates an offering with teachers and rejects a missing update id", async () => {
    const auth = await login();
    const create = await SELF.fetch(`${origin}/api/admin/offerings`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        courseId: 1,
        term: "2026 春",
        section: "测试班",
        teacherIds: [1],
      }),
    });
    expect(create.status).toBe(200);
    const { id } = await create.json<{ id: number }>();
    expect(
      await env.DB.prepare(
        "SELECT teacher_id FROM offering_teachers WHERE offering_id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({ teacher_id: 1 });

    const missing = await SELF.fetch(`${origin}/api/admin/offerings`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        id: 999999,
        courseId: 1,
        term: "2026 春",
        section: "不存在",
        teacherIds: [1],
      }),
    });
    expect(missing.status).toBe(404);
  });

  it("removes retired /api/admin/legacy-reviews routes", async () => {
    const auth = await login();
    const listed = await SELF.fetch(`${origin}/api/admin/legacy-reviews`, {
      headers: { Cookie: auth.cookie },
    });
    const patched = await SELF.fetch(`${origin}/api/admin/legacy-reviews/1`, {
      method: "PATCH",
      headers: adminHeaders(auth),
      body: JSON.stringify({ status: "approved", note: "已退役" }),
    });
    const events = await SELF.fetch(
      `${origin}/api/admin/legacy-reviews/1/events`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(listed.status).toBe(404);
    expect(patched.status).toBe(404);
    expect(events.status).toBe(404);
  });
});
describe("review protection", () => {
  it("returns 400 for malformed JSON instead of exposing a server error", async () => {
    const response = await SELF.fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    });
    expect(response.status).toBe(400);
  });

  it("handles all four Turnstile configuration states explicitly", async () => {
    const mutableEnv = env as Record<string, unknown>;
    const writer = await ordinaryWriteSession("admin-turnstile-writer");
    const submit = (ip: string, comment: string) =>
      SELF.fetch(`${origin}/api/reviews`, {
        method: "POST",
        headers: {
          ...ordinaryWriteHeaders(writer),
          "CF-Connecting-IP": ip,
        },
        body: JSON.stringify({
          courseId: 1,
          teacherId: 1,
          overall: 5,
          scores: {
            difficulty: 1,
            homework: 2,
            grading: 3,
            gain: 2,
          },
          comment,
          headline: "一句话总结",
        }),
      });
    try {
      mutableEnv.TURNSTILE_SITE_KEY = "";
      mutableEnv.TURNSTILE_SECRET = "";
      expect((await submit("203.0.113.241", "turnstile-disabled")).status).toBe(200);

      mutableEnv.TURNSTILE_SITE_KEY = "test-site-key";
      mutableEnv.TURNSTILE_SECRET = "";
      expect((await submit("203.0.113.242", "turnstile-site-only")).status).toBe(200);
      expect(
        (await (await SELF.fetch(`${origin}/api/config`)).json<{ turnstileSiteKey: string }>())
          .turnstileSiteKey,
      ).toBe("");

      mutableEnv.TURNSTILE_SITE_KEY = "";
      mutableEnv.TURNSTILE_SECRET = "test-secret";
      expect((await submit("203.0.113.243", "turnstile-secret-only")).status).toBe(200);

      mutableEnv.TURNSTILE_SITE_KEY = "test-site-key";
      mutableEnv.TURNSTILE_SECRET = "test-secret";
      expect((await submit("203.0.113.244", "turnstile-enabled")).status).toBe(200);
      const crossSite = await SELF.fetch(`${origin}/api/reviews`, {
        method: "POST",
        headers: {
          ...ordinaryWriteHeaders(writer, { Origin: "https://attacker.example" }),
          "CF-Connecting-IP": "203.0.113.245",
        },
        body: JSON.stringify({
          courseId: 1,
          teacherId: 1,
          overall: 5,
          turnstileToken: "attacker-token",
        }),
      });
      expect(crossSite.status).toBe(403);
      expect(await crossSite.json()).toEqual({
        error: "安全校验失败，请刷新后重试",
      });
    } finally {
      mutableEnv.TURNSTILE_SITE_KEY = "";
      mutableEnv.TURNSTILE_SECRET = "";
      await env.DB.prepare(
        "DELETE FROM reviews WHERE comment IN('turnstile-disabled','turnstile-site-only','turnstile-secret-only','turnstile-enabled')",
      ).run();
    }
  });

  it("blocks anonymous and cross-site browser writes when Turnstile is degraded", async () => {
    const headers = {
      "Content-Type": "text/plain",
      Origin: "https://attacker.example",
      "CF-Connecting-IP": "203.0.113.240",
    };
    const review = await SELF.fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers,
      body: JSON.stringify({ courseId: 1, teacherId: 1, overall: 5 }),
    });
    expect(review.status).toBe(401);
    const request = await SELF.fetch(`${origin}/api/catalog-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "teacher",
        teacherName: "跨站恶意教师",
        department: "测试学院",
      }),
    });
    expect(request.status).toBe(401);

    const writer = await ordinaryWriteSession("admin-cross-site-writer");
    const authedReview = await SELF.fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: ordinaryWriteHeaders(writer, {
        Origin: "https://attacker.example",
        "Content-Type": "text/plain",
        "CF-Connecting-IP": "203.0.113.240",
      }),
      body: JSON.stringify({ courseId: 1, teacherId: 1, overall: 5 }),
    });
    expect(authedReview.status).toBe(403);
    expect(await authedReview.json()).toEqual({
      error: "安全校验失败，请刷新后重试",
    });
  });
});

describe("管理后台评价搜索把通配符当字面量", () => {
  const department = "管理搜索学院";
  const firstTeacher = "管理搜索甲师";
  const secondTeacher = "管理搜索乙师";
  const percentCourse = "管理搜索百分号100%课";
  const underscoreCourse = "管理搜索A_下划线课";
  const underscoreDecoy = "管理搜索AB下划线课";
  const percentComment = "管理搜索百分号评价";
  const underscoreComment = "管理搜索下划线评价";
  const decoyComment = "管理搜索诱饵评价";
  const commentPercent = "正文含100%字面量";

  let firstTeacherId = 0;
  let underscoreReviewId = 0;
  let decoyReviewId = 0;

  const reviewComments = (body: { items: Array<{ comment: string }> }) =>
    body.items.map((item) => item.comment);

  beforeAll(async () => {
    const insertTeacher = (name: string) =>
      env.DB.prepare(
        "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
      ).bind(name, name, department);
    const insertCourse = (code: string, name: string) =>
      env.DB.prepare(
        "INSERT INTO courses(code,name,category,department) VALUES(?,?,'general',?)",
      ).bind(code, name, department);

    const [first, second, percent, underscore, decoy] = await env.DB.batch([
      insertTeacher(firstTeacher),
      insertTeacher(secondTeacher),
      insertCourse("ADMIN-SEARCH-PCT", percentCourse),
      insertCourse("ADMIN-SEARCH-UNDERSCORE", underscoreCourse),
      insertCourse("ADMIN-SEARCH-DECOY", underscoreDecoy),
    ]);
    firstTeacherId = Number(first.meta.last_row_id);
    const secondTeacherId = Number(second.meta.last_row_id);
    const percentCourseId = Number(percent.meta.last_row_id);
    const underscoreCourseId = Number(underscore.meta.last_row_id);
    const decoyCourseId = Number(decoy.meta.last_row_id);

    const insertReview = (
      courseId: number,
      teacherId: number,
      comment: string,
    ) =>
      env.DB.prepare(
        `INSERT INTO reviews(course_id,teacher_id,category,overall,status,comment)
         VALUES(?,?,'general',4,'pending',?)`,
      ).bind(courseId, teacherId, comment);

    const [, underscoreReview, decoyReview] = await env.DB.batch([
      insertReview(percentCourseId, firstTeacherId, percentComment),
      insertReview(underscoreCourseId, firstTeacherId, underscoreComment),
      insertReview(decoyCourseId, secondTeacherId, decoyComment),
      insertReview(decoyCourseId, secondTeacherId, commentPercent),
    ]);
    underscoreReviewId = Number(underscoreReview.meta.last_row_id);
    decoyReviewId = Number(decoyReview.meta.last_row_id);
  });

  it("未登录仍 401", async () => {
    const reviews = await SELF.fetch(`${origin}/api/admin/reviews?q=%`);
    expect(reviews.status).toBe(401);
  });

  it("% 只匹配课名或正文里真的有 % 的评价", async () => {
    const auth = await login();
    const response = await SELF.fetch(
      `${origin}/api/admin/reviews?status=pending&q=%25&pageSize=50`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ items: Array<{ id: number; comment: string }> }>();
    expect(reviewComments(body)).toEqual(
      expect.arrayContaining([percentComment, commentPercent]),
    );
    expect(reviewComments(body)).not.toContain(underscoreComment);
    expect(reviewComments(body)).not.toContain(decoyComment);
  });

  it("_ 不再当单字符通配符", async () => {
    const auth = await login();
    const response = await SELF.fetch(
      `${origin}/api/admin/reviews?status=pending&q=A_&pageSize=50`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ items: Array<{ id: number }> }>();
    const ids = body.items.map((item) => item.id);
    expect(ids).toContain(underscoreReviewId);
    expect(ids).not.toContain(decoyReviewId);
  });

  it("课名 + 教师只返回同时命中的评价", async () => {
    const auth = await login();
    const matched = await SELF.fetch(
      `${origin}/api/admin/reviews?status=pending&q=${encodeURIComponent(`${percentCourse} ${firstTeacher}`)}&pageSize=50`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(matched.status).toBe(200);
    expect(
      reviewComments(await matched.json<{ items: Array<{ comment: string }> }>()),
    ).toEqual([percentComment]);

    const mismatched = await SELF.fetch(
      `${origin}/api/admin/reviews?status=pending&q=${encodeURIComponent(`${percentCourse} ${secondTeacher}`)}&pageSize=50`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(mismatched.status).toBe(200);
    expect(
      reviewComments(await mismatched.json<{ items: Array<{ comment: string }> }>()),
    ).toEqual([]);
  });

  it("空查询仍只按状态筛选", async () => {
    const auth = await login();
    const empty = await SELF.fetch(
      `${origin}/api/admin/reviews?status=pending&pageSize=50`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(empty.status).toBe(200);
    const emptyBody = await empty.json<{ total: number }>();
    expect(emptyBody.total).toBeGreaterThanOrEqual(3);

    const filtered = await SELF.fetch(
      `${origin}/api/admin/reviews?status=pending&q=${encodeURIComponent(decoyComment)}&pageSize=50`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(filtered.status).toBe(200);
    expect(
      reviewComments(await filtered.json<{ items: Array<{ comment: string }> }>()),
    ).toEqual([decoyComment]);
  });
});
