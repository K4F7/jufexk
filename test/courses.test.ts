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
