import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PROGRAM_PLAN_RECORD_SCHEMA } from "../src/lib/program-plan";
import { adminAuth, adminHeaders as sessionHeaders } from "./admin-session";

const origin = "https://example.com";

async function adminHeaders() {
  return sessionHeaders(await adminAuth(), origin);
}

describe("program plan api", () => {
  it("imports derived records without touching enrollment_category and lists by grade and major", async () => {
    const stamp = String(Date.now());
    const code = `${stamp}1005406493`;
    await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(code, "C语言程序设计", "general", "")
      .run();
    const beforeCategory = await env.DB
      .prepare("SELECT enrollment_category FROM courses WHERE code=?")
      .bind(code)
      .first<{ enrollment_category: string }>();

    const unauthorized = await SELF.fetch(`${origin}/api/admin/import/program-plan`, {
      method: "POST",
      body: JSON.stringify({ records: [] }),
    });
    expect(unauthorized.status).toBe(401);

    const missing = await SELF.fetch(`${origin}/api/program-plan`);
    expect(missing.status).toBe(400);

    const empty = await SELF.fetch(
      `${origin}/api/program-plan?grade=2025&major=${encodeURIComponent("软件工程")}`,
    );
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ items: [] });

    const apply = await SELF.fetch(`${origin}/api/admin/import/program-plan`, {
      method: "POST",
      headers: await adminHeaders(),
      body: JSON.stringify({
        records: [
          {
            schemaVersion: PROGRAM_PLAN_RECORD_SCHEMA,
            grade: "2025",
            departmentCode: "054",
            departmentName: "软件与物联网工程学院",
            majorCode: "0809021",
            majorName: "软件工程",
            studyKind: "主修",
            courseCode: code,
            courseName: "C语言程序设计 (软件)",
            credits: 3,
            categoryPath: "2024专业教育课/专业必修课/必修课",
            courseStanding: "主干课程",
            assessment: "考试",
            suggestedTerm: "2025-2026学年第一学期",
            totalHours: 48,
            lectureHours: 32,
            labHours: 16,
            practiceHours: 0,
            otherHours: 0,
            weeklyHours: 3,
            catalogCourseId: null,
          },
        ],
      }),
    });
    expect(apply.status).toBe(200);
    expect(await apply.json()).toMatchObject({
      received: 1,
      upserted: 1,
      matchedCatalog: 1,
    });

    const listed = await SELF.fetch(
      `${origin}/api/program-plan?grade=2025&major=${encodeURIComponent("软件工程")}`,
    );
    expect(listed.status).toBe(200);
    const body = await listed.json<{
      items: Array<{ courseCode: string; catalogCourseId: number | null }>;
    }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.courseCode).toBe(code);
    expect(body.items[0]?.catalogCourseId).toBeGreaterThan(0);

    const afterCategory = await env.DB
      .prepare("SELECT enrollment_category FROM courses WHERE code=?")
      .bind(code)
      .first<{ enrollment_category: string }>();
    expect(afterCategory?.enrollment_category).toBe(beforeCategory?.enrollment_category);
  });
});
