import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { categoryLabel } from "../src/lib/labels";
import { normalizeReviewTemplateKind } from "../src/lib/review-template-kind";

const origin = "https://example.com";

async function login() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": "198.18.30.1",
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

describe("review template kind API contract", () => {
  it("offers only the optional sports-only public filter", async () => {
    const response = await SELF.fetch(`${origin}/api/courses?category=sports`);
    const body = await response.json<{ items: Array<{ category: string }> }>();
    expect(response.status).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.category === "sports")).toBe(true);
    for (const obsolete of ["required", "elective", "general", "major", "pe"])
      expect((await SELF.fetch(`${origin}/api/courses?category=${obsolete}`)).status).toBe(400);
  });

  it("accepts all new values and rejects old or missing values on writes", async () => {
    const headers = await login();
    for (const [index, category] of ["general", "sports"].entries()) {
      const response = await SELF.fetch(`${origin}/api/admin/courses`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code: `CATEGORY-${index}`,
          name: `类别课程 ${index}`,
          category,
        }),
      });
      expect(response.status).toBe(200);
    }
    for (const category of ["", "required", "elective", "major", "pe"]) {
      const response = await SELF.fetch(`${origin}/api/admin/courses`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code: `WRITE-${category || "EMPTY"}`,
          name: "写入类别",
          category,
        }),
      });
      expect(response.status).toBe(400);
    }
  });

  it("maps leftover catalog values onto general or sports so labels never fall through to 其他", () => {
    expect(normalizeReviewTemplateKind("required")).toBe("general");
    expect(normalizeReviewTemplateKind("elective")).toBe("general");
    expect(normalizeReviewTemplateKind("major")).toBe("general");
    expect(normalizeReviewTemplateKind("general")).toBe("general");
    expect(normalizeReviewTemplateKind("unknown")).toBe("general");
    expect(normalizeReviewTemplateKind("pe")).toBe("sports");
    expect(normalizeReviewTemplateKind("sports")).toBe("sports");
    expect(normalizeReviewTemplateKind("")).toBe("");
    expect(normalizeReviewTemplateKind(null)).toBe("");
    expect(categoryLabel("required")).toBe("普通课程");
    expect(categoryLabel("major")).toBe("普通课程");
    expect(categoryLabel("general")).toBe("普通课程");
    expect(categoryLabel("pe")).toBe("体育课");
    expect(categoryLabel("")).toBe("未确定");
  });

  it("normalizes leftover categories on public teacher and course payloads", async () => {
    await env.DB.prepare("PRAGMA ignore_check_constraints=ON").run();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO teachers(id,source_teacher_label,name) VALUES(15101,'程序设计教师','程序设计教师')",
      ),
      env.DB.prepare(
        `INSERT INTO courses(id,code,name,category) VALUES
          (15101,'1005400514','Java程序设计','required'),
          (15102,'1005400724','Python程序设计基础','major'),
          (15103,'PE-151','大学体育','pe')`,
      ),
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(15101,15101),(15102,15101),(15103,15101)",
      ),
    ]);
    await env.DB.prepare("PRAGMA ignore_check_constraints=OFF").run();

    const teacherResponse = await SELF.fetch(`${origin}/api/teachers/15101`);
    const teacherBody = await teacherResponse.json<{
      courses: Array<{ name: string; category: string }>;
    }>();
    expect(teacherResponse.status).toBe(200);
    expect(
      Object.fromEntries(
        teacherBody.courses.map((course) => [course.name, course.category]),
      ),
    ).toEqual({
      Java程序设计: "general",
      Python程序设计基础: "general",
      大学体育: "sports",
    });
    for (const course of teacherBody.courses)
      expect(categoryLabel(course.category)).not.toBe("其他");

    const courseResponse = await SELF.fetch(`${origin}/api/courses/15101`);
    const courseBody = await courseResponse.json<{
      course: { name: string; category: string };
    }>();
    expect(courseResponse.status).toBe(200);
    expect(courseBody.course).toMatchObject({
      name: "Java程序设计",
      category: "general",
    });
    expect(categoryLabel(courseBody.course.category)).toBe("普通课程");
  });
});
