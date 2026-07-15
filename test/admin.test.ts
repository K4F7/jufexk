import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
  it("edits and validates public-elective scores", async () => {
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
        body: JSON.stringify({ interest: 9, note: "invalid" }),
      },
    );
    expect(invalid.status).toBe(400);
    const saved = await SELF.fetch(
      `${origin}/api/admin/reviews/${id}/content`,
      {
        method: "PATCH",
        headers: adminHeaders(auth),
        body: JSON.stringify({
          interest: 5,
          practicality: 4,
          workloadScore: 2,
          fairness: 5,
          organization: 4,
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
      interest: 5,
      practicality: 4,
      workload_score: 2,
      fairness: 5,
      organization: 4,
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
      body: JSON.stringify({ name: "CSRF test", category: "major" }),
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
        code: "TEST101",
        name: "集成测试课程",
        category: "major",
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
        section: "不存在",
        teacherIds: [1],
      }),
    });
    expect(missing.status).toBe(404);
  });

  it("imports approved legacy text without a fabricated score and rolls back by batch", async () => {
    const auth = await login();
    const approved = {
      course_id: 1,
      teacher_id: 1,
      offering_id: "",
      category: "major",
      comment: "历史文字评价",
      term: "",
      source_type: "legacy_ocr",
      source_label: "腾讯表格历史资料",
      source_file: "主要课程_001.png",
      sheet_name: "主要课程",
      source_row: "T1R2C4",
      raw_ocr_text: "原始 OCR 历史文字评价",
      ocr_confidence: 0.98,
      ocr_tokens_json: "[]",
      inherited_from: "",
      ocr_course_name: "程序设计基础",
      ocr_teacher_name: "林老师",
      duplicate_group: "",
    };
    const preview = await SELF.fetch(`${origin}/api/admin/legacy-imports/preview`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ rows: [approved] }),
    });
    expect(await preview.json()).toMatchObject({ ok: true, total: 1, errors: [] });
    const imported = await SELF.fetch(`${origin}/api/admin/legacy-imports`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ rows: [approved], manifest: { approvedBy: "test" }, idempotencyKey: "a".repeat(64) }),
    });
    expect(imported.status).toBe(200);
    const result = await imported.json<{ batchId: string; reviewStatus: string; batchStatus: string }>();
    expect(result.reviewStatus).toBe("pending");
    expect(result.batchStatus).toBe("imported");
    const saved = await env.DB.prepare(
      "SELECT comment,status,source_type FROM legacy_reviews WHERE import_batch_id=?",
    ).bind(result.batchId).first();
    expect(saved).toEqual({ comment: "历史文字评价", status: "pending", source_type: "legacy_ocr" });
    const batches = await SELF.fetch(`${origin}/api/admin/legacy-imports?status=imported`, {
      headers: { Cookie: auth.cookie },
    });
    expect(batches.status).toBe(200);
    const listed = await batches.json<{ items: Array<Record<string, unknown>> }>();
    expect(listed.items).toContainEqual(expect.objectContaining({
      id: result.batchId, status: "imported", row_count: 1,
      pending_count: 1, approved_count: 0, rejected_count: 0,
    }));
    expect(JSON.stringify(listed)).not.toContain("manifest_json");
    expect(JSON.stringify(listed)).not.toContain("raw_ocr_text");
    expect((await SELF.fetch(`${origin}/api/admin/legacy-imports?status=invalid`, { headers: { Cookie: auth.cookie } })).status).toBe(400);
    const rollback = await SELF.fetch(`${origin}/api/admin/legacy-imports/${result.batchId}/rollback`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: "{}",
    });
    expect(rollback.status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM legacy_reviews WHERE import_batch_id=?").bind(result.batchId).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT status FROM legacy_import_batches WHERE id=?").bind(result.batchId).first()).toEqual({ status: "rolled_back" });
    const secondRollback = await SELF.fetch(`${origin}/api/admin/legacy-imports/${result.batchId}/rollback`, {
      method: "POST", headers: adminHeaders(auth), body: "{}",
    });
    expect(secondRollback.status).toBe(409);
  });

  it("rejects legacy rows with fabricated overall or an unrelated teacher", async () => {
    const auth = await login();
    const row = {
      course_id: 2, teacher_id: 1, category: "pe", comment: "文字",
      source_type: "legacy_ocr", source_label: "腾讯表格历史资料",
      source_file: "体育课_001.png", source_row: "2", raw_ocr_text: "文字",
      ocr_confidence: 0.99, ocr_tokens_json: "[]",
    };
    const response = await SELF.fetch(`${origin}/api/admin/legacy-imports/preview`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ rows: [{ ...row, overall: 5 }] }),
    });
    const body = await response.json<{ ok: boolean; errors: Array<{ field: string }> }>();
    expect(body.ok).toBe(false);
    expect(body.errors.map((error) => error.field)).toContain("overall");
    const unrelated = await SELF.fetch(`${origin}/api/admin/legacy-imports/preview`, {
      method: "POST", headers: adminHeaders(auth), body: JSON.stringify({ rows: [row] }),
    });
    const unrelatedBody = await unrelated.json<{ errors: Array<{ field: string; message: string }> }>();
    expect(unrelatedBody.errors).toContainEqual(expect.objectContaining({ field: "teacher_id", message: "教师不在课程已有任课关系中" }));
  });

  it("moderates legacy text separately and publishes it without changing ratings", async () => {
    const auth = await login();
    const row = {
      course_id: 1, teacher_id: 1, offering_id: "", category: "major",
      comment: "经审核的历史文字", term: "", source_type: "legacy_ocr",
      source_label: "腾讯表格历史资料", source_file: "主要课程_001.png",
      sheet_name: "主要课程", source_row: "T1R2C4", raw_ocr_text: "原始 OCR 文字",
      ocr_confidence: 0.98, ocr_tokens_json: "[]", inherited_from: "",
      ocr_course_name: "程序设计基础", ocr_teacher_name: "林老师", duplicate_group: "",
    };
    const beforeCatalog = await (await SELF.fetch(`${origin}/api/courses`)).json<{ items: Array<{ id: number; review_count: number; rating: number }> }>();
    const beforeCourse = beforeCatalog.items.find((item) => item.id === 1)!;
    const imported = await SELF.fetch(`${origin}/api/admin/legacy-imports`, {
      method: "POST", headers: adminHeaders(auth),
      body: JSON.stringify({ rows: [row], idempotencyKey: "b".repeat(64) }),
    });
    const batch = await imported.json<{ batchId: string }>();
    const pending = await (await SELF.fetch(`${origin}/api/admin/legacy-reviews?batchId=${batch.batchId}`, { headers: { Cookie: auth.cookie } })).json<{ items: Array<{ id: number }> }>();
    expect(pending.items).toHaveLength(1);
    const id = pending.items[0].id;
    const hidden = await (await SELF.fetch(`${origin}/api/courses/1`)).json<{ legacyReviews: unknown[] }>();
    expect(hidden.legacyReviews).toEqual([]);
    const decisions = await Promise.all(["核对截图", "并发重复"].map((note) => SELF.fetch(`${origin}/api/admin/legacy-reviews/${id}`, {
      method: "PATCH", headers: adminHeaders(auth), body: JSON.stringify({ status: "approved", note }),
    }).then((response) => response.status)));
    expect(decisions.sort()).toEqual([200, 409]);
    const detail = await (await SELF.fetch(`${origin}/api/courses/1`)).json<{ legacyReviews: Array<Record<string, unknown>> }>();
    expect(detail.legacyReviews).toContainEqual(expect.objectContaining({ comment: "经审核的历史文字", source_label: "腾讯表格历史资料" }));
    expect(JSON.stringify(detail.legacyReviews)).not.toContain("raw_ocr_text");
    expect(JSON.stringify(detail.legacyReviews)).not.toContain("ocr_tokens_json");
    expect(JSON.stringify(detail.legacyReviews)).not.toContain("moderator_note");
    expect(JSON.stringify(detail.legacyReviews)).not.toContain("overall");
    const teacherDetail = await (await SELF.fetch(`${origin}/api/teachers/1`)).json<{ legacyReviews: Array<Record<string, unknown>> }>();
    expect(teacherDetail.legacyReviews).toContainEqual(expect.objectContaining({ comment: "经审核的历史文字", course_name: "程序设计基础" }));
    const afterCatalog = await (await SELF.fetch(`${origin}/api/courses`)).json<{ items: Array<{ id: number; review_count: number; rating: number }> }>();
    expect(afterCatalog.items.find((item) => item.id === 1)).toMatchObject({ review_count: beforeCourse.review_count, rating: beforeCourse.rating });
    const events = await (await SELF.fetch(`${origin}/api/admin/legacy-reviews/${id}/events`, { headers: { Cookie: auth.cookie } })).json<Array<Record<string, unknown>>>();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({ action: "approved" }));
    expect(JSON.stringify(events)).not.toContain("actor_session_id");
    const protectedRollback = await SELF.fetch(`${origin}/api/admin/legacy-imports/${batch.batchId}/rollback`, { method: "POST", headers: adminHeaders(auth), body: "{}" });
    expect(protectedRollback.status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM legacy_review_moderation_events WHERE legacy_review_id=?").bind(id).first()).toEqual({ n: 1 });
    await env.DB.prepare("DELETE FROM legacy_reviews WHERE id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM legacy_import_batches WHERE id=?").bind(batch.batchId).run();
  });

  it("requires a reason when rejecting legacy text and never publishes it", async () => {
    const auth = await login();
    const result = await env.DB.prepare(
      `INSERT INTO legacy_import_batches(id,source_type,source_label,status,row_count,imported_at) VALUES('legacy_reject_test','legacy_ocr','腾讯表格历史资料','imported',1,CURRENT_TIMESTAMP)`,
    ).run();
    expect(result.success).toBe(true);
    const inserted = await env.DB.prepare(
      `INSERT INTO legacy_reviews(import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,course_id,teacher_id,category,comment) VALUES('legacy_reject_test','x.png','主要课程','1','原文',.99,1,1,'major','不公开的文字')`,
    ).run();
    const id = Number(inserted.meta.last_row_id);
    expect((await SELF.fetch(`${origin}/api/admin/legacy-reviews/${id}`, { method: "PATCH", headers: adminHeaders(auth), body: JSON.stringify({ status: "rejected" }) })).status).toBe(400);
    expect((await SELF.fetch(`${origin}/api/admin/legacy-reviews/${id}`, { method: "PATCH", headers: adminHeaders(auth), body: JSON.stringify({ status: "rejected", note: "无法确认来源" }) })).status).toBe(200);
    const detail = await (await SELF.fetch(`${origin}/api/courses/1`)).json<{ legacyReviews: Array<{ comment: string }> }>();
    expect(detail.legacyReviews.map((item) => item.comment)).not.toContain("不公开的文字");
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

  it("fails closed when Turnstile is configured but no valid token is supplied", async () => {
    const before = await env.DB.prepare(
      "SELECT COUNT(*) n FROM reviews",
    ).first<{ n: number }>();
    const response = await SELF.fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courseId: 1,
        offeringId: 1,
        teacherId: 1,
        overall: 5,
        term: "2026 春",
      }),
    });
    expect(response.status).toBe(403);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM reviews").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(before?.n);
  });
});

describe("two-stage imports", () => {
  it("imports a course-teacher relation without inventing an offering", async () => {
    const auth = await login();
    const course = await env.DB.prepare("INSERT INTO courses(code,name,category,department) VALUES('REL101','关系测试课','major','测试学院')").run();
    const teacher = await env.DB.prepare("INSERT INTO teachers(name,department) VALUES('关系教师','测试学院')").run();
    const payload = { type: "relations", rows: [{ course_code: "REL101", course_name: "关系测试课", teacher_name: "关系教师", teacher_department: "测试学院" }] };
    const response = await SELF.fetch(`${origin}/api/admin/import`, {
      method: "POST", headers: adminHeaders(auth), body: JSON.stringify(payload),
    });
    expect(response.status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM course_teachers WHERE course_id=? AND teacher_id=?").bind(course.meta.last_row_id, teacher.meta.last_row_id).first()).toEqual({ n: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM offerings WHERE course_id=?").bind(course.meta.last_row_id).first()).toEqual({ n: 0 });
  });

  it("previews row errors without writing and rejects the same invalid commit", async () => {
    const auth = await login();
    const before = await env.DB.prepare(
      "SELECT COUNT(*) n FROM courses",
    ).first<{
      n: number;
    }>();
    const payload = {
      type: "courses",
      rows: [{ code: "BAD", name: "", category: "unknown", credits: "x" }],
    };
    const preview = await SELF.fetch(`${origin}/api/admin/import/preview`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify(payload),
    });
    expect(preview.status).toBe(200);
    const result = await preview.json<{ ok: boolean; errors: unknown[] }>();
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) n FROM courses").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(before?.n);

    const commit = await SELF.fetch(`${origin}/api/admin/import`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify(payload),
    });
    expect(commit.status).toBe(422);
  });

  it("imports an offering and links its teacher after a clean preview", async () => {
    const auth = await login();
    const payload = {
      type: "offerings",
      rows: [
        {
          course_code: "CS101",
          course_name: "程序设计基础",
          teacher_name: "林老师",
          teacher_department: "计算机学院",
          term: "2026 春",
          section: "导入测试班",
          campus: "蛟桥园",
          status: "active",
        },
      ],
    };
    const preview = await SELF.fetch(`${origin}/api/admin/import/preview`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify(payload),
    });
    expect((await preview.json<{ ok: boolean }>()).ok).toBe(true);
    const commit = await SELF.fetch(`${origin}/api/admin/import`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify(payload),
    });
    expect(commit.status).toBe(200);
    const linked = await env.DB.prepare(
      `SELECT ot.teacher_id FROM offerings o JOIN offering_teachers ot ON ot.offering_id=o.id WHERE o.term='2026 春' AND o.section='导入测试班'`,
    ).first<{ teacher_id: number }>();
    expect(linked?.teacher_id).toBe(1);
  });
});
