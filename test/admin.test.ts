import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
} from "./ordinary-write-session";

const origin = "https://example.com";
let loginSequence = 10;

async function login() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `198.51.100.${loginSequence++}`,
    },
    body: JSON.stringify({ password: "test-password" }),
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ csrfToken: string }>();
  const setCookies = (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie();
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
  return { cookie, csrf: body.csrfToken };
}

function adminHeaders(auth: { cookie: string; csrf: string }) {
  return {
    "Content-Type": "application/json",
    Cookie: auth.cookie,
    Origin: origin,
    "X-CSRF-Token": auth.csrf,
  };
}

describe("admin sessions and catalog", () => {
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

  it("atomically caps concurrent login attempts", async () => {
    const statuses = await Promise.all(
      Array.from({ length: 12 }, () =>
        SELF.fetch(`${origin}/api/admin/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            "CF-Connecting-IP": "198.51.100.99",
          },
          body: JSON.stringify({ password: "wrong-password" }),
        }).then((response) => response.status),
      ),
    );
    expect(statuses.filter((status) => status === 401)).toHaveLength(8);
    expect(statuses.filter((status) => status === 429)).toHaveLength(4);
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

  it("moderates legacy text separately and publishes it without changing ratings", async () => {
    const auth = await login();
    const batchId = "legacy_moderate_test";
    await env.DB.prepare(
      `INSERT INTO legacy_import_batches(id,source_type,source_label,status,row_count,imported_at)
       VALUES(?,'legacy_ocr','腾讯表格历史资料','imported',1,CURRENT_TIMESTAMP)`,
    )
      .bind(batchId)
      .run();
    const inserted = await env.DB.prepare(
      `INSERT INTO legacy_reviews(
         import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,
         course_id,teacher_id,category,comment,source_type,source_label,status
       ) VALUES(?,'主要课程_001.png','主要课程','T1R2C4','原始 OCR 文字',0.98,1,1,'general','经审核的历史文字','legacy_ocr','腾讯表格历史资料','pending')`,
    )
      .bind(batchId)
      .run();
    const id = Number(inserted.meta.last_row_id);
    const beforeCatalog = await (await SELF.fetch(`${origin}/api/courses`)).json<{ items: Array<{ id: number; review_count: number; rating?: number }> }>();
    const beforeCourse = beforeCatalog.items.find((item) => item.id === 1)!;
    const pending = await (await SELF.fetch(`${origin}/api/admin/legacy-reviews?batchId=${batchId}`, { headers: { Cookie: auth.cookie } })).json<{ items: Array<{ id: number }> }>();
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0].id).toBe(id);
    const hidden = await (await SELF.fetch(`${origin}/api/courses/1/reviews?teacherId=1`)).json<{ items: Array<{ comment: string }> }>();
    expect(hidden.items.map((item) => item.comment)).not.toContain("经审核的历史文字");
    const decisions = await Promise.all(["核对截图", "并发重复"].map((note) => SELF.fetch(`${origin}/api/admin/legacy-reviews/${id}`, {
      method: "PATCH", headers: adminHeaders(auth), body: JSON.stringify({ status: "approved", note }),
    }).then((response) => response.status)));
    expect(decisions.sort()).toEqual([200, 409]);
    const detail = await (await SELF.fetch(`${origin}/api/courses/1/reviews?teacherId=1`)).json<{ items: Array<Record<string, unknown>> }>();
    expect(detail.items).toContainEqual(expect.objectContaining({ comment: "经审核的历史文字", teacher_name: "测试教师" }));
    expect(JSON.stringify(detail.items)).not.toContain("source_label");
    expect(JSON.stringify(detail.items)).not.toContain("raw_ocr_text");
    expect(JSON.stringify(detail.items)).not.toContain("ocr_tokens_json");
    expect(JSON.stringify(detail.items)).not.toContain("moderator_note");
    expect(JSON.stringify(detail.items)).not.toContain("overall");
    const teacherDetail = await (await SELF.fetch(`${origin}/api/teachers/1`)).json<{ reviews: Array<Record<string, unknown>> }>();
    expect(teacherDetail.reviews).toContainEqual(expect.objectContaining({ comment: "经审核的历史文字", course_name: "测试课程" }));
    const afterCatalog = await (await SELF.fetch(`${origin}/api/courses`)).json<{ items: Array<{ id: number; review_count: number; rating?: number }> }>();
    const afterCourse = afterCatalog.items.find((item) => item.id === 1);
    expect(afterCourse).toMatchObject({ review_count: beforeCourse.review_count + 1 });
    expect(afterCourse).not.toHaveProperty("rating");
    const events = await (await SELF.fetch(`${origin}/api/admin/legacy-reviews/${id}/events`, { headers: { Cookie: auth.cookie } })).json<Array<Record<string, unknown>>>();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({ action: "approved" }));
    expect(JSON.stringify(events)).not.toContain("actor_session_id");
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM legacy_review_moderation_events WHERE legacy_review_id=?").bind(id).first()).toEqual({ n: 1 });
    await env.DB.prepare("DELETE FROM legacy_reviews WHERE id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM legacy_import_batches WHERE id=?").bind(batchId).run();
  });

  it("requires a reason when rejecting legacy text and never publishes it", async () => {
    const auth = await login();
    const result = await env.DB.prepare(
      `INSERT INTO legacy_import_batches(id,source_type,source_label,status,row_count,imported_at) VALUES('legacy_reject_test','legacy_ocr','腾讯表格历史资料','imported',1,CURRENT_TIMESTAMP)`,
    ).run();
    expect(result.success).toBe(true);
    const inserted = await env.DB.prepare(
      `INSERT INTO legacy_reviews(import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,course_id,teacher_id,category,comment) VALUES('legacy_reject_test','x.png','主要课程','1','原文',.99,1,1,'general','不公开的文字')`,
    ).run();
    const id = Number(inserted.meta.last_row_id);
    expect((await SELF.fetch(`${origin}/api/admin/legacy-reviews/${id}`, { method: "PATCH", headers: adminHeaders(auth), body: JSON.stringify({ status: "rejected" }) })).status).toBe(400);
    expect((await SELF.fetch(`${origin}/api/admin/legacy-reviews/${id}`, { method: "PATCH", headers: adminHeaders(auth), body: JSON.stringify({ status: "rejected", note: "无法确认来源" }) })).status).toBe(200);
    const detail = await (await SELF.fetch(`${origin}/api/courses/1/reviews?teacherId=1`)).json<{ items: Array<{ comment: string }> }>();
    expect(detail.items.map((item) => item.comment)).not.toContain("不公开的文字");
    await env.DB.prepare("DELETE FROM legacy_reviews WHERE id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM legacy_import_batches WHERE id='legacy_reject_test'").run();
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
      expect((await submit("203.0.113.243", "turnstile-secret-only")).status).toBe(503);

      mutableEnv.TURNSTILE_SITE_KEY = "test-site-key";
      mutableEnv.TURNSTILE_SECRET = "test-secret";
      expect((await submit("203.0.113.244", "turnstile-enabled")).status).toBe(403);
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
        "DELETE FROM reviews WHERE comment IN('turnstile-disabled','turnstile-site-only')",
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
  const legacyPercentComment = "管理搜索历史百分号评价";
  const legacyDecoyComment = "管理搜索历史诱饵评价";
  const legacyUnderscoreComment = "管理搜索历史A_下划线评价";

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

    const [percentReview, underscoreReview, decoyReview] = await env.DB.batch([
      insertReview(percentCourseId, firstTeacherId, percentComment),
      insertReview(underscoreCourseId, firstTeacherId, underscoreComment),
      insertReview(decoyCourseId, secondTeacherId, decoyComment),
      insertReview(decoyCourseId, secondTeacherId, commentPercent),
      env.DB.prepare(
        `INSERT INTO legacy_import_batches(id,source_type,source_label,status,row_count)
         VALUES('admin-search-escape','legacy_ocr','腾讯表格历史资料','imported',3)`,
      ),
    ]);
    underscoreReviewId = Number(underscoreReview.meta.last_row_id);
    decoyReviewId = Number(decoyReview.meta.last_row_id);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO legacy_reviews(import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,course_id,teacher_id,category,comment)
         VALUES('admin-search-escape','pct.png','主要课程','1','原文',.99,?,?,'general',?)`,
      ).bind(percentCourseId, firstTeacherId, legacyPercentComment),
      env.DB.prepare(
        `INSERT INTO legacy_reviews(import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,course_id,teacher_id,category,comment)
         VALUES('admin-search-escape','decoy.png','主要课程','2','原文',.99,?,?,'general',?)`,
      ).bind(decoyCourseId, secondTeacherId, legacyDecoyComment),
      env.DB.prepare(
        `INSERT INTO legacy_reviews(import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,course_id,teacher_id,category,comment)
         VALUES('admin-search-escape','underscore.png','主要课程','3','原文',.99,?,?,'general',?)`,
      ).bind(underscoreCourseId, firstTeacherId, legacyUnderscoreComment),
    ]);
  });

  it("未登录仍 401", async () => {
    const reviews = await SELF.fetch(`${origin}/api/admin/reviews?q=%`);
    const legacy = await SELF.fetch(`${origin}/api/admin/legacy-reviews?q=%`);
    expect(reviews.status).toBe(401);
    expect(legacy.status).toBe(401);
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

  it("历史评价搜索同样不把 % 当通配符", async () => {
    const auth = await login();
    const response = await SELF.fetch(
      `${origin}/api/admin/legacy-reviews?status=all&batchId=admin-search-escape&q=%25&pageSize=50`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ items: Array<{ comment: string }> }>();
    expect(reviewComments(body)).toEqual([legacyPercentComment]);
  });

  it("历史评价搜索同样不把 _ 当通配符", async () => {
    const auth = await login();
    const response = await SELF.fetch(
      `${origin}/api/admin/legacy-reviews?status=all&batchId=admin-search-escape&q=A_&pageSize=50`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(response.status).toBe(200);
    expect(
      reviewComments(
        await response.json<{ items: Array<{ comment: string }> }>(),
      ),
    ).toEqual([legacyUnderscoreComment]);
  });

  it("历史评价空查询仍只按批次筛选", async () => {
    const auth = await login();
    const response = await SELF.fetch(
      `${origin}/api/admin/legacy-reviews?status=all&batchId=admin-search-escape&pageSize=50`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(response.status).toBe(200);
    expect(
      reviewComments(
        await response.json<{ items: Array<{ comment: string }> }>(),
      ).sort(),
    ).toEqual(
      [legacyDecoyComment, legacyPercentComment, legacyUnderscoreComment].sort(),
    );
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
