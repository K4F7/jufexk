import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";
let ipSequence = 20;

function submit(body: Record<string, unknown>) {
  return SELF.fetch(`${origin}/api/reviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `203.0.113.${ipSequence++}`,
    },
    body: JSON.stringify(body),
  });
}

async function createBoundCourse(category: string, code: string) {
  const course = await env.DB.prepare(
    "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,'测试学院')",
  )
    .bind(code, `${category} 测试课 ${code}`, category)
    .run();
  const courseId = Number(course.meta.last_row_id);
  await env.DB.prepare(
    "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
  )
    .bind(courseId)
    .run();
  return courseId;
}

describe("review submission minimal required fields", () => {
  it("accepts course + teacher + overall with nothing else", async () => {
    const courseId = await createBoundCourse("major", "REQ001");
    const response = await submit({ courseId, teacherId: 1, overall: 4 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("accepts a public-elective review without the five dimension scores", async () => {
    const courseId = await createBoundCourse("general", "REQ002");
    const response = await submit({ courseId, teacherId: 1, overall: 5 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("accepts a submission without a term", async () => {
    const courseId = await createBoundCourse("major", "REQ003");
    const response = await submit({
      courseId,
      teacherId: 1,
      overall: 3,
      comment: "没有学期也可以投稿",
    });
    expect(response.status).toBe(200);
  });

  it("rejects a submission without an overall rating", async () => {
    const courseId = await createBoundCourse("major", "REQ004");
    const response = await submit({ courseId, teacherId: 1 });
    expect(response.status).toBe(400);
  });

  it("rejects a course-teacher pair that is not in the catalog", async () => {
    const course = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES('REQ005','未绑定课','major','测试学院')",
    ).run();
    const response = await submit({
      courseId: Number(course.meta.last_row_id),
      teacherId: 1,
      overall: 4,
    });
    expect(response.status).toBe(400);
  });

  it("rejects an invalid optional offering id", async () => {
    const response = await submit({
      courseId: 1,
      teacherId: 1,
      offeringId: 0,
      overall: 4,
    });
    expect(response.status).toBe(400);
  });

  it("requires a matching course when an offering is selected", async () => {
    const missingCourse = await submit({
      teacherId: 1,
      offeringId: 1,
      overall: 4,
    });
    expect(missingCourse.status).toBe(400);

    const mismatchedCourse = await submit({
      courseId: 2,
      teacherId: 1,
      offeringId: 1,
      overall: 4,
    });
    expect(mismatchedCourse.status).toBe(400);
  });

  it("requires the offering course-teacher relation as well", async () => {
    const course = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES('REQ007','开课关系缺失','major','测试学院')",
    ).run();
    const courseId = Number(course.meta.last_row_id);
    const offering = await env.DB.prepare(
      "INSERT INTO offerings(course_id,term,section,status) VALUES(?,?,?,'active')",
    )
      .bind(courseId, "2026 秋", "A")
      .run();
    const offeringId = Number(offering.meta.last_row_id);
    await env.DB.prepare(
      "INSERT INTO offering_teachers(offering_id,teacher_id) VALUES(?,1)",
    )
      .bind(offeringId)
      .run();
    try {
      const response = await submit({
        courseId,
        offeringId,
        teacherId: 1,
        overall: 4,
      });
      expect(response.status).toBe(400);
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM offering_teachers WHERE offering_id=?").bind(
          offeringId,
        ),
        env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(offeringId),
        env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId),
      ]);
    }
  });

  it("still validates dimension ranges when provided", async () => {
    const courseId = await createBoundCourse("general", "REQ006");
    const response = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      interest: 9,
    });
    expect(response.status).toBe(400);
  });
});
