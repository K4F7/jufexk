import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { shouldRefreshPublicListPrecomputes } from "../src/public-list-precompute";

describe("public list precompute invalidation", () => {
  it.each([
    ["POST", "/api/admin/catalog-relation-additions"],
    ["POST", "/api/admin/import/relations"],
    ["POST", "/api/admin/historical-review-v5-imports"],
    ["POST", "/api/admin/offerings"],
    ["DELETE", "/api/admin/offerings/42"],
    ["POST", "/api/admin/courses"],
    ["DELETE", "/api/admin/courses/42"],
    ["POST", "/api/admin/teachers"],
    ["DELETE", "/api/admin/teachers/42"],
    ["PUT", "/api/admin/courses/42/teachers"],
    ["POST", "/api/admin/catalog-baseline/uploads/batch-42/publish"],
  ])("refreshes after %s %s", (method, path) => {
    expect(shouldRefreshPublicListPrecomputes(method, path)).toBe(true);
  });

  it.each([
    ["POST", "/api/admin/login"],
    ["POST", "/api/admin/logout"],
    ["POST", "/api/admin/sessions/revoke-others"],
    ["PUT", "/api/reviews/42/endorsement"],
    ["DELETE", "/api/reviews/42/endorsement"],
    ["POST", "/api/catalog-requests"],
    ["POST", "/api/admin/catalog-relation-additions/preview"],
    ["POST", "/api/reviews"],
    ["PATCH", "/api/admin/catalog-requests/42"],
    ["PATCH", "/api/admin/reviews/42"],
    ["PATCH", "/api/admin/reviews/42/content"],
    ["PATCH", "/api/admin/legacy-reviews/42"],
    ["POST", "/api/admin/catalog-baseline/uploads"],
    ["PUT", "/api/admin/catalog-baseline/uploads/batch-42/chunks/0"],
    ["POST", "/api/admin/catalog-baseline/uploads/batch-42/finalize"],
    ["GET", "/api/courses"],
  ])("does not refresh after %s %s", (method, path) => {
    expect(shouldRefreshPublicListPrecomputes(method, path)).toBe(false);
  });
});

describe("public list query shape", () => {
  it("reads list and detail counts from a hot precomputed projection", async () => {
    await SELF.fetch("https://example.com/api/courses?q=TEST101");
    const originalState = await env.DB.prepare(
      "SELECT fingerprint FROM public_precompute_state WHERE id=1",
    ).first<{ fingerprint: string }>();
    await env.DB.prepare(
      `INSERT INTO public_review_counts(course_id,teacher_id,review_count)
       VALUES(1,1,777)
       ON CONFLICT(course_id,teacher_id) DO UPDATE SET review_count=excluded.review_count`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO public_teacher_course_counts(teacher_id,course_count)
       VALUES(1,888)
       ON CONFLICT(teacher_id) DO UPDATE SET course_count=excluded.course_count`,
    ).run();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE public_course_canonicals
         SET match_text=match_text || ' issue355projection'
         WHERE course_id=1`,
      ),
      env.DB.prepare(
        `UPDATE public_precompute_state
         SET dirty=0,fingerprint='issue-355-stale' WHERE id=1`,
      ),
    ]);

    try {
      const courseList = await SELF.fetch(
        "https://example.com/api/courses?q=TEST101",
      ).then((response) =>
        response.json<{ items: Array<{ id: number; review_count: number }> }>(),
      );
      const teacherList = await SELF.fetch(
        `https://example.com/api/teachers?q=${encodeURIComponent("测试教师")}`,
      ).then((response) =>
        response.json<{
          items: Array<{ id: number; review_count: number; course_count: number }>;
        }>(),
      );
      const courseDetail = await SELF.fetch(
        "https://example.com/api/courses/1",
      ).then((response) =>
        response.json<{
          reviewCount: number;
          course: { teachers: Array<{ id: number; review_count: number }> };
        }>(),
      );
      const teacherDetail = await SELF.fetch(
        "https://example.com/api/teachers/1",
      ).then((response) =>
        response.json<{
          reviewCount: number;
          teacher: { review_count: number; course_count: number };
          courses: Array<{ id: number; review_count: number }>;
        }>(),
      );
      const options = await SELF.fetch(
        "https://example.com/api/courses/options?q=issue355projection",
      ).then((response) =>
        response.json<{ items: Array<{ id: number }> }>(),
      );
      const state = await env.DB.prepare(
        "SELECT dirty,fingerprint FROM public_precompute_state WHERE id=1",
      ).first<{ dirty: number; fingerprint: string }>();

      expect(courseList.items.find((item) => item.id === 1)?.review_count).toBe(777);
      expect(teacherList.items.find((item) => item.id === 1)?.review_count).toBe(777);
      expect(teacherList.items.find((item) => item.id === 1)?.course_count).toBe(888);
      expect(courseDetail.reviewCount).toBe(777);
      expect(
        courseDetail.course.teachers.find((teacher) => teacher.id === 1)
          ?.review_count,
      ).toBe(777);
      expect(teacherDetail.reviewCount).toBe(777);
      expect(teacherDetail.teacher).toMatchObject({
        review_count: 777,
        course_count: 888,
      });
      expect(
        teacherDetail.courses.find((course) => course.id === 1)?.review_count,
      ).toBe(777);
      expect(options.items.some((item) => item.id === 1)).toBe(true);
      expect(state).toEqual({ dirty: 0, fingerprint: "issue-355-stale" });
    } finally {
      await env.DB.prepare("UPDATE public_precompute_state SET dirty=1 WHERE id=1").run();
      await SELF.fetch("https://example.com/api/courses?q=TEST101");
      await env.DB.prepare(
        "UPDATE public_precompute_state SET fingerprint=? WHERE id=1",
      )
        .bind(originalState?.fingerprint || "")
        .run();
    }
  });

  it("reads course-row visibility from the precomputed canonical mapping", async () => {
    await SELF.fetch("https://example.com/api/courses?q=TEST101");
    await env.DB.prepare(
      "UPDATE public_course_canonicals SET canonical_course_id=2 WHERE course_id=1",
    ).run();

    try {
      const list = await SELF.fetch(
        "https://example.com/api/courses?q=TEST101",
      ).then((response) => response.json<{ items: Array<{ id: number }> }>());
      expect(list.items.some((item) => item.id === 1)).toBe(false);
    } finally {
      await env.DB.prepare("UPDATE public_precompute_state SET dirty=1 WHERE id=1").run();
      await SELF.fetch("https://example.com/api/courses?q=TEST101");
    }
  });

  it("uses the canonical projection for course options and departments", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO courses(id,code,name,category,department)
         VALUES(355101,'CANON355A','映射前课程','general','映射前院系')`,
      ),
      env.DB.prepare(
        `INSERT INTO courses(id,code,name,category,department)
         VALUES(355102,'CANON355B','映射后课程','general','映射后院系')`,
      ),
    ]);
    await SELF.fetch("https://example.com/api/courses?q=CANON355A");
    await env.DB.prepare(
      `UPDATE public_course_canonicals
       SET canonical_course_id=355102 WHERE course_id=355101`,
    ).run();

    try {
      const options = await SELF.fetch(
        "https://example.com/api/courses/options?q=CANON355A",
      ).then((response) =>
        response.json<{ items: Array<{ id: number }> }>(),
      );
      const departments = await SELF.fetch(
        "https://example.com/api/courses/departments",
      ).then((response) => response.json<{ items: string[] }>());

      expect(options.items.some((item) => item.id === 355101)).toBe(false);
      expect(departments.items).not.toContain("映射前院系");
      expect(departments.items).toContain("映射后院系");
    } finally {
      await env.DB.prepare(
        "DELETE FROM courses WHERE id IN (355101,355102)",
      ).run();
      await SELF.fetch("https://example.com/api/courses?q=CANON355A");
    }
  });
});
