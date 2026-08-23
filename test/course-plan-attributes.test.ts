import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";

async function adminHeaders() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `198.18.62.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({ password: "test-password" }),
  });
  expect(response.status).toBe(200);
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

describe("course plan attributes", () => {
  it("fills official JXUF fields on existing courses and leaves missing codes", async () => {
    const stamp = String(Date.now());
    const code = `${stamp}0004504882`;
    await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(code, "管理学基础", "general", "")
      .run();
    const auth = await adminHeaders();
    const apply = await SELF.fetch(
      `${origin}/api/admin/import/course-plan-attributes`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          items: [
            {
              courseCode: code,
              credits: 2,
              department: "[045]工商管理学院",
              enrollmentCategory: "专业内选修课",
              teachingType: "",
              courseLevel: "专业方向课",
            },
            {
              courseCode: `${stamp}-missing`,
              credits: 1,
              department: "[001]不存在",
              enrollmentCategory: "公共必修",
              courseLevel: "体育",
            },
          ],
        }),
      },
    );
    expect(apply.status).toBe(200);
    expect(await apply.json()).toEqual({
      received: 2,
      updated: 1,
      missing: [`${stamp}-missing`],
    });

    const stored = await env.DB.prepare(
      "SELECT department,credits,enrollment_category,teaching_type,course_level,category FROM courses WHERE code=?",
    )
      .bind(code)
      .first();
    expect(stored).toEqual({
      department: "[045]工商管理学院",
      credits: 2,
      enrollment_category: "专业内选修课",
      teaching_type: "",
      course_level: "专业方向课",
      category: "general",
    });

    const courseId = (
      await env.DB.prepare("SELECT id FROM courses WHERE code=?")
        .bind(code)
        .first<{ id: number }>()
    )?.id;
    const detail = await SELF.fetch(`${origin}/api/courses/${courseId}`);
    expect(detail.status).toBe(200);
    const body = await detail.json<{
      course: {
        enrollment_category: string;
        teaching_type: string;
        course_level: string;
        department: string;
        credits: number;
      };
    }>();
    expect(body.course).toMatchObject({
      enrollment_category: "专业内选修课",
      teaching_type: "",
      course_level: "专业方向课",
      department: "[045]工商管理学院",
      credits: 2,
    });
  });

  it("rejects empty payloads and does not create courses", async () => {
    const auth = await adminHeaders();
    const empty = await SELF.fetch(
      `${origin}/api/admin/import/course-plan-attributes`,
      {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ items: [] }),
      },
    );
    expect(empty.status).toBe(400);
    const before = await env.DB.prepare("SELECT COUNT(*) n FROM courses").first<{
      n: number;
    }>();
    await SELF.fetch(`${origin}/api/admin/import/course-plan-attributes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        items: [
          {
            courseCode: "NO-SUCH-COURSE",
            credits: 3,
            department: "[000]测试",
          },
        ],
      }),
    });
    const after = await env.DB.prepare("SELECT COUNT(*) n FROM courses").first<{
      n: number;
    }>();
    expect(after?.n).toBe(before?.n);
  });
});
