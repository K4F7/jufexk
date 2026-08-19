import { readFileSync } from "node:fs";
import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const origin = "https://example.com";
const seedSql = readFileSync("scripts/prototype-local-seed.sql", "utf8");

const PREVIEW_TEACHERS = [
  "林晓雯",
  "陈启明",
  "王若舟",
  "赵敏",
  "刘洋",
  "周慧",
  "黄志远",
  "吴桐",
] as const;

const PREVIEW_COURSE_CODES = [
  "ACC2101",
  "FIN1203",
  "ECO1101",
  "LAW1002",
  "MIS2205",
  "STA1301",
  "MGT2001",
  "GEN0108",
  "GEN0215",
  "PE0120",
  "PE0142",
  "ACC3108",
  "FIN2306",
  "ECO2104",
  "LAW2201",
  "MIS3102",
  "STA2204",
  "MGT3105",
  "GEN0302",
  "ACC1101",
  "FIN1101",
  "ECO1001",
  "LAW1105",
  "MIS1101",
  "PE0160",
] as const;

function seedStatements(sql: string) {
  return sql
    .replace(/^--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !/^PRAGMA\b/i.test(statement));
}

async function applyPrototypeSeed() {
  const statements = seedStatements(seedSql);
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

describe("prototype-local-seed.sql 对齐现行 schema", () => {
  it("不再使用已废除的 category 或缺少来源教师名的 INSERT", () => {
    expect(seedSql).toMatch(/source_teacher_label/);
    expect(seedSql).not.toMatch(/'major'/);
    expect(seedSql).not.toMatch(/'pe'/);
    expect(seedSql).toMatch(/'sports'/);
  });
});

describe("pnpm db:seed-preview 灌进公开目录", () => {
  beforeAll(async () => {
    await applyPrototypeSeed();
  });

  it("写入全部预览教师、课程、任课关系和评价", async () => {
    const teachers = await env.DB.prepare(
      `SELECT name FROM teachers WHERE source_teacher_label IN (${PREVIEW_TEACHERS.map(() => "?").join(",")}) ORDER BY name`,
    )
      .bind(...PREVIEW_TEACHERS)
      .all<{ name: string }>();
    expect(teachers.results.map((row) => row.name).sort()).toEqual(
      [...PREVIEW_TEACHERS].sort(),
    );

    const courses = await env.DB.prepare(
      `SELECT code,category FROM courses WHERE code IN (${PREVIEW_COURSE_CODES.map(() => "?").join(",")})`,
    )
      .bind(...PREVIEW_COURSE_CODES)
      .all<{ code: string; category: string }>();
    expect(courses.results).toHaveLength(PREVIEW_COURSE_CODES.length);
    expect(
      courses.results.every((row) => row.category === "general" || row.category === "sports"),
    ).toBe(true);
    expect(
      courses.results.filter((row) => row.category === "sports").map((row) => row.code).sort(),
    ).toEqual(["PE0120", "PE0142", "PE0160"]);

    const relations = await env.DB.prepare(
      `SELECT COUNT(*) n FROM course_teachers ct
       JOIN courses c ON c.id=ct.course_id
       WHERE c.code IN (${PREVIEW_COURSE_CODES.map(() => "?").join(",")})`,
    )
      .bind(...PREVIEW_COURSE_CODES)
      .first<{ n: number }>();
    expect(relations?.n).toBeGreaterThanOrEqual(PREVIEW_COURSE_CODES.length);

    const reviews = await env.DB.prepare(
      "SELECT COUNT(*) n FROM reviews WHERE submitter_hash LIKE 'proto-r-%'",
    ).first<{ n: number }>();
    expect(reviews?.n).toBe(36);
  });

  it("重复执行不会追加重复行", async () => {
    await applyPrototypeSeed();
    const teachers = await env.DB.prepare(
      `SELECT COUNT(*) n FROM teachers WHERE source_teacher_label IN (${PREVIEW_TEACHERS.map(() => "?").join(",")})`,
    )
      .bind(...PREVIEW_TEACHERS)
      .first<{ n: number }>();
    const courses = await env.DB.prepare(
      `SELECT COUNT(*) n FROM courses WHERE code IN (${PREVIEW_COURSE_CODES.map(() => "?").join(",")})`,
    )
      .bind(...PREVIEW_COURSE_CODES)
      .first<{ n: number }>();
    const reviews = await env.DB.prepare(
      "SELECT COUNT(*) n FROM reviews WHERE submitter_hash LIKE 'proto-r-%'",
    ).first<{ n: number }>();
    expect(teachers?.n).toBe(PREVIEW_TEACHERS.length);
    expect(courses?.n).toBe(PREVIEW_COURSE_CODES.length);
    expect(reviews?.n).toBe(36);
  });

  it("公开课程和教师接口能读到预览行", async () => {
    const courses = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent("中级财务会计")}`,
    ).then((response) =>
      response.json<{ items: Array<{ name: string; teachers?: string }> }>(),
    );
    const accounting = courses.items.find((item) => item.name === "中级财务会计");
    expect(accounting?.teachers).toContain("林晓雯");

    const teachers = await SELF.fetch(
      `${origin}/api/teachers?q=${encodeURIComponent("林晓雯")}`,
    ).then((response) => response.json<{ items: Array<{ name: string }> }>());
    expect(teachers.items.some((item) => item.name === "林晓雯")).toBe(true);

    const sports = await SELF.fetch(`${origin}/api/courses?category=sports&pageSize=50`).then(
      (response) => response.json<{ items: Array<{ name: string }> }>(),
    );
    expect(sports.items.map((item) => item.name)).toEqual(
      expect.arrayContaining(["羽毛球", "乒乓球", "游泳"]),
    );
  });
});
