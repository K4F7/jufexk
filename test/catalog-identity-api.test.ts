import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { adminAuth, adminHeaders } from "./admin-session";

const origin = "https://example.com";

async function login() {
  return adminHeaders(await adminAuth(), origin);
}

function adminPost(path: string, headers: Record<string, string>, body: unknown) {
  return SELF.fetch(`${origin}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("catalog source identity APIs", () => {
  it("renames a course without changing its ID and retains both names", async () => {
    const headers = await login();
    const created = await adminPost("/api/admin/courses", headers, {
      code: "IDENT-COURSE",
      name: "身份课程旧名",
      category: "general",
    });
    const { id } = await created.json<{ id: number }>();

    const renamed = await adminPost("/api/admin/courses", headers, {
      id,
      code: "IDENT-COURSE",
      name: "身份课程新名",
      category: "general",
    });

    expect(renamed.status).toBe(200);
    expect((await renamed.json<{ id: number }>()).id).toBe(id);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n,MIN(id) id,MAX(name) name FROM courses WHERE code='IDENT-COURSE'",
      ).first(),
    ).toEqual({ n: 1, id, name: "身份课程新名" });
    expect(
      (
        await env.DB.prepare(
          "SELECT name FROM course_name_variants WHERE course_id=? ORDER BY name",
        )
          .bind(id)
          .all()
      ).results,
    ).toEqual([{ name: "身份课程新名" }, { name: "身份课程旧名" }]);
  });

  it("keeps exact suffixed teacher identities separate and department edits relation-safe", async () => {
    const headers = await login();
    const unsuffixed = await adminPost("/api/admin/teachers", headers, {
      sourceTeacherLabel: "张三",
      name: "张三",
      department: null,
    });
    const first = await adminPost("/api/admin/teachers", headers, {
      sourceTeacherLabel: "张三1",
      name: "张三1",
      department: null,
    });
    const second = await adminPost("/api/admin/teachers", headers, {
      sourceTeacherLabel: "张三2",
      name: "张三2",
      department: null,
    });
    const unsuffixedId = (await unsuffixed.json<{ id: number }>()).id;
    const firstId = (await first.json<{ id: number }>()).id;
    const secondId = (await second.json<{ id: number }>()).id;
    const course = await adminPost("/api/admin/courses", headers, {
      code: "IDENT-REL",
      name: "身份关系课程",
      category: "general",
      teacherIds: [firstId],
    });
    const courseId = (await course.json<{ id: number }>()).id;

    const edited = await adminPost("/api/admin/teachers", headers, {
      id: firstId,
      name: "张三1",
      department: "信息管理学院",
    });

    expect(edited.status).toBe(200);
    expect((await edited.json<{ id: number }>()).id).toBe(firstId);
    expect(new Set([unsuffixedId, firstId, secondId]).size).toBe(3);
    expect(secondId).not.toBe(firstId);
    expect(
      await env.DB.prepare(
        "SELECT id,source_teacher_label,department FROM teachers WHERE id=?",
      )
        .bind(firstId)
        .first(),
    ).toEqual({
      id: firstId,
      source_teacher_label: "张三1",
      department: "信息管理学院",
    });
    expect(
      await env.DB.prepare(
        "SELECT course_id,teacher_id FROM course_teachers WHERE course_id=? AND teacher_id=?",
      )
        .bind(courseId, firstId)
        .first(),
    ).toEqual({ course_id: courseId, teacher_id: firstId });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM teachers WHERE source_teacher_label IN ('张三','张三1','张三2')",
      ).first(),
    ).toEqual({ n: 3 });
  });

});
