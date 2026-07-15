import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";

async function login() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": "198.51.100.10",
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
