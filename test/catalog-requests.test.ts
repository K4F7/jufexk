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
    const body = await response.json<{ items: Array<{ teacher_name: string }> }>();
    expect(body.items.some((row) => row.teacher_name === "待审教师")).toBe(true);
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
      review: { overall: 5, comment: "随申请一起提交的评价" },
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
      "SELECT status,comment,course_id FROM reviews WHERE comment=? LIMIT 1",
    )
      .bind("随申请一起提交的评价")
      .first<{ status: string; comment: string; course_id: number }>();
    expect(review?.status).toBe("pending");
    expect(review?.course_id).toBe(catalogBody.items[0].id);
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
    const teacher = await env.DB.prepare(
      "SELECT id FROM teachers WHERE name=?",
    )
      .bind("被驳回的教师")
      .first();
    expect(teacher).toBe(null);
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
