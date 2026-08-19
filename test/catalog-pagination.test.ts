import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const origin = "https://example.com";
const teacherSearch = "分页契约教师";
const courseSearch = "分页契约课程";

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department,title) VALUES(?,?,?,?)",
    ).bind(`${teacherSearch}甲`, `${teacherSearch}甲`, "分页学院", "讲师"),
    env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department,title) VALUES(?,?,?,?)",
    ).bind(`${teacherSearch}乙`, `${teacherSearch}乙`, "分页学院", "副教授"),
    env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department,title) VALUES(?,?,?,?)",
    ).bind(`${teacherSearch}丙`, `${teacherSearch}丙`, "分页学院", "教授"),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    ).bind("PAGE001", `${courseSearch}甲`, "general", "分页学院"),
    env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    ).bind("PAGE002", `${courseSearch}乙`, "general", "分页学院"),
    env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    ).bind("PAGE003", "不匹配课程", "general", "分页学院"),
  ]);
});

describe("public teacher catalog pagination", () => {
  it("uses the bounded default page when page size is omitted", async () => {
    const response = await SELF.fetch(`${origin}/api/teachers?page=1`);
    expect(response.status).toBe(200);
    const body = await response.json<{
      items: unknown[];
      page: number;
      pageSize: number;
      total: number;
      pages: number;
    }>();

    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(body.items.length).toBeLessThanOrEqual(20);
    expect(body.pages).toBe(Math.ceil(body.total / body.pageSize));
  });

  it("returns a paginated envelope with a complete count", async () => {
    const response = await SELF.fetch(`${origin}/api/teachers?page=1&pageSize=2`);
    expect(response.status).toBe(200);
    const body = await response.json<{
      items: Array<{ id: number }>;
      page: number;
      pageSize: number;
      total: number;
      pages: number;
    }>();

    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    expect(body.total).toBeGreaterThanOrEqual(4);
    expect(body.pages).toBe(Math.ceil(body.total / body.pageSize));
    expect(body.items).toHaveLength(2);
  });

  it("searches teachers and returns an empty page when it is out of range", async () => {
    const first = await SELF.fetch(
      `${origin}/api/teachers?q=${encodeURIComponent(teacherSearch)}&page=1&pageSize=2`,
    );
    const firstBody = await first.json<{
      items: Array<{ id: number; name: string }>;
      page: number;
      pageSize: number;
      total: number;
      pages: number;
    }>();
    expect(firstBody.total).toBe(3);
    expect(firstBody.pages).toBe(2);
    expect(firstBody.items).toHaveLength(2);

    const second = await SELF.fetch(
      `${origin}/api/teachers?q=${encodeURIComponent(teacherSearch)}&page=2&pageSize=2`,
    );
    const secondBody = await second.json<typeof firstBody>();
    expect(secondBody.items).toHaveLength(1);
    expect(
      secondBody.items.map((item) => item.id),
    ).not.toEqual(expect.arrayContaining(firstBody.items.map((item) => item.id)));

    const outOfRange = await SELF.fetch(
      `${origin}/api/teachers?q=${encodeURIComponent(teacherSearch)}&page=9&pageSize=2`,
    );
    const outOfRangeBody = await outOfRange.json<typeof firstBody>();
    expect(outOfRangeBody.page).toBe(9);
    expect(outOfRangeBody.items).toEqual([]);
    expect(outOfRangeBody.total).toBe(3);

    const departmentSearch = await SELF.fetch(
      `${origin}/api/teachers?q=${encodeURIComponent("分页学院")}&page=1&pageSize=10`,
    );
    const departmentBody = await departmentSearch.json<{
      items: Array<{ name: string }>;
      total: number;
    }>();
    expect(departmentBody.total).toBe(3);
    expect(departmentBody.items.every((item) => item.name.includes(teacherSearch))).toBe(
      true,
    );
  });
});

describe("public course option pagination", () => {
  it("searches and paginates options without a fixed 2000-row cap", async () => {
    const response = await SELF.fetch(
      `${origin}/api/courses/options?q=${encodeURIComponent(courseSearch)}&page=1&pageSize=1`,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      items: Array<{ id: number; name: string }>;
      page: number;
      pageSize: number;
      total: number;
      pages: number;
    }>();

    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(1);
    expect(body.total).toBe(2);
    expect(body.pages).toBe(2);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toContain(courseSearch);

    const second = await SELF.fetch(
      `${origin}/api/courses/options?q=${encodeURIComponent(courseSearch)}&page=2&pageSize=1`,
    );
    const secondBody = await second.json<typeof body>();
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0].id).not.toBe(body.items[0].id);
    expect(secondBody.total).toBe(body.total);
    expect(secondBody.items[0]).not.toHaveProperty("window_total");
  });
});

describe("window count stays off the public payload", () => {
  it("does not leak window_total on course or teacher pages", async () => {
    const courses = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent(courseSearch)}&page=1&pageSize=1`,
    );
    const teachers = await SELF.fetch(
      `${origin}/api/teachers?q=${encodeURIComponent(teacherSearch)}&page=1&pageSize=1`,
    );
    const options = await SELF.fetch(
      `${origin}/api/courses/options?q=${encodeURIComponent(courseSearch)}&page=1&pageSize=1`,
    );
    expect(courses.status).toBe(200);
    expect(teachers.status).toBe(200);
    expect(options.status).toBe(200);
    const courseBody = await courses.json<{
      items: Array<Record<string, unknown>>;
      total: number;
    }>();
    const teacherBody = await teachers.json<{
      items: Array<Record<string, unknown>>;
      total: number;
    }>();
    const optionBody = await options.json<{
      items: Array<Record<string, unknown>>;
      total: number;
    }>();
    expect(courseBody.total).toBe(2);
    expect(teacherBody.total).toBe(3);
    expect(optionBody.total).toBe(2);
    expect(courseBody.items[0]).not.toHaveProperty("window_total");
    expect(teacherBody.items[0]).not.toHaveProperty("window_total");
    expect(optionBody.items[0]).not.toHaveProperty("window_total");
    expect(courseBody).not.toHaveProperty("window_total");
  });

  it("keeps course total on an out-of-range page", async () => {
    const response = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent(courseSearch)}&page=9&pageSize=1`,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ items: unknown[]; total: number }>();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(2);
  });
});
