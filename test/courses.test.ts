import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const origin = "https://example.com";
const humanities = "人文学院";
const paddedHumanities = ` ${humanities}`;
const exactCode = "DEPT-TRIM-EXACT";
const paddedCode = "DEPT-TRIM-PADDED";
const emptyCode = "DEPT-TRIM-EMPTY";
const whitespaceCode = "DEPT-TRIM-BLANK";

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    ).bind(exactCode, "院系去重课程甲", "general", humanities),
    env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    ).bind(paddedCode, "院系去重课程乙", "general", paddedHumanities),
    env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    ).bind(emptyCode, "空院系课程", "general", ""),
    env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    ).bind(whitespaceCode, "空白院系课程", "general", "   "),
  ]);
});

describe("public course catalog", () => {
  it("returns the full list when filter params are present but empty", async () => {
    const response = await SELF.fetch(
      `${origin}/api/courses?q=&category=&department=&teacherId=&page=1`,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ items: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("returns the same list with and without empty filter params", async () => {
    const bare = await SELF.fetch(`${origin}/api/courses`);
    const filtered = await SELF.fetch(
      `${origin}/api/courses?q=&category=&department=&teacherId=&page=1`,
    );
    const bareBody = await bare.json<{ total: number }>();
    const filteredBody = await filtered.json<{ total: number }>();
    expect(filteredBody.total).toBe(bareBody.total);
  });

  it("does not expose a list rating that is not rendered", async () => {
    const response = await SELF.fetch(`${origin}/api/courses?pageSize=1`);
    expect(response.status).toBe(200);
    const body = await response.json<{ items: Array<Record<string, unknown>> }>();
    expect(body.items[0]).not.toHaveProperty("rating");
  });
});

describe("course department options", () => {
  it("returns distinct trimmed departments and omits blank values", async () => {
    const response = await SELF.fetch(`${origin}/api/courses/departments`);
    expect(response.status).toBe(200);
    const body = await response.json<{ items: string[] }>();
    expect(body.items.filter((item) => item === humanities)).toHaveLength(1);
    expect(body.items).toContain("测试学院");
    expect(body.items).not.toContain("");
    expect(body.items).not.toContain(paddedHumanities);
    expect(body.items.every((item) => item.trim().length > 0 && item === item.trim())).toBe(
      true,
    );
  });

  it("filters public courses by trimmed department, including padded rows and query params", async () => {
    const response = await SELF.fetch(
      `${origin}/api/courses?department=${encodeURIComponent(humanities)}&pageSize=50`,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      items: Array<{ code: string; department: string }>;
    }>();
    const codes = body.items.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining([exactCode, paddedCode]));
    expect(codes).not.toContain(emptyCode);
    expect(codes).not.toContain(whitespaceCode);
    expect(body.items.every((item) => item.department.trim() === humanities)).toBe(true);

    const padded = await SELF.fetch(
      `${origin}/api/courses?department=${encodeURIComponent(` ${humanities} `)}&pageSize=50`,
    );
    expect(padded.status).toBe(200);
    const paddedBody = await padded.json<{ items: Array<{ code: string }> }>();
    expect(paddedBody.items.map((item) => item.code).sort()).toEqual([...codes].sort());
  });
});

describe("public course catalog sorting (Issue #203)", () => {
  it("defaults to review-count order and supports sort=name", async () => {
    const stamp = Date.now();
    const nameA = `排序甲课${stamp}`; // 2 reviews — first by 投稿数
    const nameB = `排序乙课${stamp}`; // 1 review — first by 课名 (乙 < 甲)
    const courseA = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(`SORT-A-${stamp}`, nameA, "general", "排序学院")
      .run();
    const courseB = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(`SORT-B-${stamp}`, nameB, "general", "排序学院")
      .run();
    const courseAId = Number(courseA.meta.last_row_id);
    const courseBId = Number(courseB.meta.last_row_id);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
      ).bind(courseAId),
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
      ).bind(courseBId),
    ]);
    const insertReview = (courseId: number, comment: string) =>
      env.DB.prepare(
        `INSERT INTO reviews(
          course_id,teacher_id,category,overall,comment,term,status,
          submitter_hash,moderator_note,created_at,reviewed_at
        ) VALUES(?,1,'general',4,?,'','approved',?,'private note','2026-08-11 02:00:00',NULL)`,
      )
        .bind(courseId, comment, `private-${comment}`)
        .run();
    await insertReview(courseAId, "排序甲课评价一");
    await insertReview(courseAId, "排序甲课评价二");
    await insertReview(courseBId, "排序乙课评价一");

    try {
      const query = encodeURIComponent(`排序`);
      const defaultResponse = await SELF.fetch(
        `${origin}/api/courses?q=${query}&page=1`,
      );
      expect(defaultResponse.status).toBe(200);
      const defaultBody = await defaultResponse.json<{
        items: Array<{ name: string; review_count: number }>;
      }>();
      const defaultNames = defaultBody.items.map((item) => item.name);
      expect(defaultNames.indexOf(nameA)).toBeGreaterThanOrEqual(0);
      expect(defaultNames.indexOf(nameB)).toBeGreaterThanOrEqual(0);
      expect(defaultNames.indexOf(nameA)).toBeLessThan(
        defaultNames.indexOf(nameB),
      );

      const nameResponse = await SELF.fetch(
        `${origin}/api/courses?q=${query}&sort=name&page=1`,
      );
      expect(nameResponse.status).toBe(200);
      const nameBody = await nameResponse.json<{
        items: Array<{ name: string; review_count: number }>;
      }>();
      const nameNames = nameBody.items.map((item) => item.name);
      expect(nameNames.indexOf(nameB)).toBeGreaterThanOrEqual(0);
      expect(nameNames.indexOf(nameA)).toBeGreaterThanOrEqual(0);
      expect(nameNames.indexOf(nameB)).toBeLessThan(nameNames.indexOf(nameA));

      // 非法 sort 值回退默认排序，不报错。
      const bogus = await SELF.fetch(
        `${origin}/api/courses?q=${query}&sort=bogus&page=1`,
      );
      expect(bogus.status).toBe(200);
      const bogusBody = await bogus.json<{
        items: Array<{ name: string }>;
      }>();
      expect(bogusBody.items.map((item) => item.name)).toEqual(defaultNames);
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM reviews WHERE course_id IN (?,?)").bind(
          courseAId,
          courseBId,
        ),
        env.DB.prepare(
          "DELETE FROM course_teachers WHERE course_id IN (?,?)",
        ).bind(courseAId, courseBId),
        env.DB.prepare("DELETE FROM courses WHERE id IN (?,?)").bind(
          courseAId,
          courseBId,
        ),
      ]);
    }
  });
});

describe("public course departments options (Issue #203)", () => {
  it("returns distinct non-empty departments of visible courses", async () => {
    const stamp = Date.now();
    const empty = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(`DEPT-EMPTY-${stamp}`, `空院系课${stamp}`, "general", "")
      .run();
    const spaced = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(`DEPT-SPACE-${stamp}`, `空白院系课${stamp}`, "general", "   ")
      .run();
    const extra = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(`DEPT-NEW-${stamp}`, `新院系课${stamp}`, "general", "排序学院")
      .run();
    const ids = [
      Number(empty.meta.last_row_id),
      Number(spaced.meta.last_row_id),
      Number(extra.meta.last_row_id),
    ];

    try {
      const response = await SELF.fetch(`${origin}/api/courses/departments`);
      expect(response.status).toBe(200);
      const body = await response.json<{ items: string[] }>();
      expect(body.items).toContain("测试学院");
      expect(body.items).toContain("排序学院");
      expect(body.items.every((item) => item.trim().length > 0)).toBe(true);
      expect(new Set(body.items).size).toBe(body.items.length);
    } finally {
      await env.DB.prepare("DELETE FROM courses WHERE id IN (?,?,?)")
        .bind(...ids)
        .run();
    }
  });
});
