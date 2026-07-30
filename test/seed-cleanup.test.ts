import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("seed sample cleanup", () => {
  it("removes the seeded sample courses", async () => {
    const courses = await env.DB.prepare(
      "SELECT COUNT(*) n FROM courses WHERE (code='CS101' AND name='程序设计基础') OR (code='PE012' AND name='羽毛球')",
    ).first<{ n: number }>();
    expect(courses?.n).toBe(0);
  });

  it("removes the seeded sample teacher", async () => {
    const teacher = await env.DB.prepare(
      "SELECT COUNT(*) n FROM teachers WHERE name='林老师' AND department='计算机学院'",
    ).first<{ n: number }>();
    expect(teacher?.n).toBe(0);
  });

  it("leaves real catalog data untouched", async () => {
    await env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department) VALUES('真实教师','真实教师','会计学院')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES('REAL01','真实课程','general','会计学院')",
    ).run();
    const survivors = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM courses WHERE code='REAL01') c, (SELECT COUNT(*) FROM teachers WHERE name='真实教师') t",
    ).first<{ c: number; t: number }>();
    expect(survivors?.c).toBe(1);
    expect(survivors?.t).toBe(1);
  });
});
