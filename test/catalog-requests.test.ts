import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";
let ipSequence = 60;
let loginSequence = 60;

function publicPost(path: string, body: Record<string, unknown>) {
  return SELF.fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `198.18.0.${ipSequence++}`,
    },
    body: JSON.stringify(body),
  });
}

async function login() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `198.18.1.${loginSequence++}`,
    },
    body: JSON.stringify({ password: "test-password" }),
  });
  const body = await response.json<{ csrfToken: string }>();
  const cookie = (response.headers as Headers & { getSetCookie(): string[] })
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return {
    "Content-Type": "application/json",
    Cookie: cookie,
    Origin: origin,
    "X-CSRF-Token": body.csrfToken,
  };
}

describe("catalog addition requests", () => {
  it("accepts a course request and keeps it out of the public catalog", async () => {
    const response = await publicPost("/api/catalog-requests", {
      kind: "course",
      courseCode: "REQ900",
      courseName: "申请中的课程",
      category: "major",
      department: "测试学院",
      teacherName: "申请中的教师",
    });
    expect(response.status).toBe(200);

    const catalog = await SELF.fetch(`${origin}/api/courses?q=申请中的课程`);
    const body = await catalog.json<{ total: number }>();
    expect(body.total).toBe(0);
  });

  it("rejects a request that names neither a course nor a teacher", async () => {
    const response = await publicPost("/api/catalog-requests", {
      kind: "course",
      courseName: "",
      teacherName: "",
    });
    expect(response.status).toBe(400);
  });

  it("rejects an attached review when only a teacher is requested", async () => {
    const response = await publicPost("/api/catalog-requests", {
      kind: "teacher",
      teacherName: "缺少课程的评价教师",
      department: "测试学院",
      review: { overall: 5, comment: "无法绑定课程" },
    });
    expect(response.status).toBe(400);
  });

  it("never lets a teacher request create a course or relation", async () => {
    const publicResponse = await publicPost("/api/catalog-requests", {
      kind: "teacher",
      teacherName: "越界申请教师",
      department: "测试学院",
      courseCode: "SHOULD-NOT-EXIST",
      courseName: "不应创建的课程",
      category: "major",
    });
    expect(publicResponse.status).toBe(400);

    const malformed = await env.DB.prepare(
      `INSERT INTO catalog_requests(
        kind,teacher_name,department,course_code,course_name,category,
        pending_review_json,status,submitter_hash
      ) VALUES('teacher','防御性审批教师','测试学院','MALFORMED','恶意课程','major',
        '{"overall":5,"comment":"恶意附带评价","term":""}','pending','test')`,
    ).run();
    const id = Number(malformed.meta.last_row_id);
    const headers = await login();
    const approval = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(approval.status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT created_course_id,created_review_id FROM catalog_requests WHERE id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({ created_course_id: null, created_review_id: null });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM courses WHERE code='MALFORMED' OR name='恶意课程'",
      ).first(),
    ).toEqual({ n: 0 });
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM reviews WHERE comment='恶意附带评价'")
        .first(),
    ).toEqual({ n: 0 });
  });

  it("does not approve a malformed attached review into a partial catalog", async () => {
    const malformed = await env.DB.prepare(
      `INSERT INTO catalog_requests(
        kind,course_code,course_name,category,teacher_name,department,
        pending_review_json,status,submitter_hash
      ) VALUES('course','MALFORMED-REVIEW','缺少教师的课程','major','',
        '测试学院','{"overall":5,"comment":"不能半完成"}','pending','test')`,
    ).run();
    const id = Number(malformed.meta.last_row_id);
    const headers = await login();
    const approval = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(approval.status).toBe(409);
    expect(
      await env.DB.prepare(
        "SELECT status,created_course_id,created_review_id FROM catalog_requests WHERE id=?",
      )
        .bind(id)
        .first(),
    ).toMatchObject({
      status: "pending",
      created_course_id: null,
      created_review_id: null,
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM courses WHERE code='MALFORMED-REVIEW'",
      ).first(),
    ).toEqual({ n: 0 });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM reviews WHERE comment='不能半完成'",
      ).first(),
    ).toEqual({ n: 0 });
  });

  it("rejects an attached review when the course request has no teacher", async () => {
    const response = await publicPost("/api/catalog-requests", {
      kind: "course",
      courseCode: "REQ-NO-TEACHER",
      courseName: "缺少教师的评价课程",
      category: "major",
      department: "测试学院",
      review: { overall: 5, comment: "无法绑定任课关系" },
    });
    expect(response.status).toBe(400);
  });

  it("lists pending requests for the admin", async () => {
    await publicPost("/api/catalog-requests", {
      kind: "teacher",
      teacherName: "待审教师",
      department: "测试学院",
    });
    const headers = await login();
    const response = await SELF.fetch(
      `${origin}/api/admin/catalog-requests?status=pending`,
      { headers },
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      items: Array<{ teacher_name: string }>;
    }>();
    expect(body.items.some((row) => row.teacher_name === "待审教师")).toBe(
      true,
    );
  });

  it("requires an admin session to list requests", async () => {
    const response = await SELF.fetch(`${origin}/api/admin/catalog-requests`);
    expect(response.status).toBe(401);
  });

  it("creates the catalog objects and queues the stashed review on approval", async () => {
    const submitted = await publicPost("/api/catalog-requests", {
      kind: "course",
      courseCode: "REQ901",
      courseName: "批准后的课程",
      category: "general",
      department: "测试学院",
      teacherName: "批准后的教师",
      review: {
        overall: 5,
        comment: "随申请一起提交的评价",
        term: "2025 秋",
        interest: 5,
        practicality: 4,
        workloadScore: 3,
        fairness: 5,
        organization: 4,
      },
    });
    const { id } = await submitted.json<{ id: number }>();

    const headers = await login();
    const approval = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(approval.status).toBe(200);

    const catalog = await SELF.fetch(`${origin}/api/courses?q=批准后的课程`);
    const catalogBody = await catalog.json<{
      items: Array<{ id: number; teachers: string }>;
      total: number;
    }>();
    expect(catalogBody.total).toBe(1);
    expect(catalogBody.items[0].teachers).toContain("批准后的教师");

    const review = await env.DB.prepare(
      `SELECT status,comment,term,course_id,interest,practicality,workload_score,
         fairness,organization FROM reviews WHERE comment=? LIMIT 1`,
    )
      .bind("随申请一起提交的评价")
      .first<{
        status: string;
        comment: string;
        term: string;
        course_id: number;
        interest: number;
        practicality: number;
        workload_score: number;
        fairness: number;
        organization: number;
      }>();
    expect(review).toMatchObject({
      status: "pending",
      course_id: catalogBody.items[0].id,
      term: "2025 秋",
      interest: 5,
      practicality: 4,
      workload_score: 3,
      fairness: 5,
      organization: 4,
    });
  });

  it("does not create catalog objects when a request is rejected", async () => {
    const submitted = await publicPost("/api/catalog-requests", {
      kind: "course",
      courseCode: "REQ902",
      courseName: "被驳回的课程",
      category: "major",
      department: "测试学院",
      teacherName: "被驳回的教师",
    });
    const { id } = await submitted.json<{ id: number }>();

    const headers = await login();
    const rejection = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "rejected", note: "资料不足" }),
      },
    );
    expect(rejection.status).toBe(200);

    const catalog = await SELF.fetch(`${origin}/api/courses?q=被驳回的课程`);
    expect((await catalog.json<{ total: number }>()).total).toBe(0);
    const teacher = await env.DB.prepare("SELECT id FROM teachers WHERE name=?")
      .bind("被驳回的教师")
      .first();
    expect(teacher).toBe(null);
  });

  it("records an audit event for catalog request rejection", async () => {
    const submitted = await publicPost("/api/catalog-requests", {
      kind: "teacher",
      teacherName: "有审核事件的教师",
      department: "测试学院",
    });
    const { id } = await submitted.json<{ id: number }>();
    const headers = await login();
    const note = "无法确认目录归属";
    const rejection = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "rejected", note }),
      },
    );
    expect(rejection.status).toBe(200);

    const eventsResponse = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}/events`,
      { headers: { Cookie: headers.Cookie } },
    );
    expect(eventsResponse.status).toBe(200);
    expect(await eventsResponse.json()).toEqual([
      expect.objectContaining({ action: "rejected", note }),
    ]);
  });

  it("records an audit event when a catalog request is approved", async () => {
    const submitted = await publicPost("/api/catalog-requests", {
      kind: "course",
      courseCode: "REQ-AUDIT",
      courseName: "有批准事件的课程",
      category: "major",
      department: "测试学院",
      teacherName: "有批准事件的教师",
    });
    const { id } = await submitted.json<{ id: number }>();
    const headers = await login();
    const note = "目录信息已核对";
    const approval = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "approved", note }),
      },
    );
    expect(approval.status).toBe(200);

    const eventsResponse = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}/events`,
      { headers: { Cookie: headers.Cookie } },
    );
    expect(eventsResponse.status).toBe(200);
    expect(await eventsResponse.json()).toEqual([
      expect.objectContaining({ action: "approved", note }),
    ]);
  });

  it("reuses an existing teacher instead of creating a duplicate", async () => {
    await env.DB.prepare(
      "INSERT INTO teachers(name,department) VALUES('复用教师','测试学院')",
    ).run();
    const submitted = await publicPost("/api/catalog-requests", {
      kind: "course",
      courseCode: "REQ903",
      courseName: "复用教师的课程",
      category: "major",
      department: "测试学院",
      teacherName: "复用教师",
    });
    const { id } = await submitted.json<{ id: number }>();

    const headers = await login();
    await SELF.fetch(`${origin}/api/admin/catalog-requests/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "approved" }),
    });

    const teachers = await env.DB.prepare(
      "SELECT COUNT(*) n FROM teachers WHERE name=? AND department=?",
    )
      .bind("复用教师", "测试学院")
      .first<{ n: number }>();
    expect(teachers?.n).toBe(1);
  });

  it("refuses to approve a request twice", async () => {
    const submitted = await publicPost("/api/catalog-requests", {
      kind: "teacher",
      teacherName: "只能批准一次",
      department: "测试学院",
    });
    const { id } = await submitted.json<{ id: number }>();
    const headers = await login();
    const first = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(first.status).toBe(200);
    const second = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(second.status).toBe(409);
  });
});
