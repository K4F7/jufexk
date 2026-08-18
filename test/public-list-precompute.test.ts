import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { shouldRefreshPublicListPrecomputes } from "../src/public-list-precompute";

describe("public list precompute invalidation", () => {
  it.each([
    ["POST", "/api/admin/catalog-relation-additions"],
    ["POST", "/api/admin/import/relations"],
    ["POST", "/api/admin/historical-review-batch-imports"],
    ["POST", "/api/admin/historical-review-imports"],
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
    ["POST", "/api/admin/legacy-imports"],
    ["POST", "/api/admin/catalog-baseline/uploads"],
    ["PUT", "/api/admin/catalog-baseline/uploads/batch-42/chunks/0"],
    ["POST", "/api/admin/catalog-baseline/uploads/batch-42/finalize"],
    ["GET", "/api/courses"],
  ])("does not refresh after %s %s", (method, path) => {
    expect(shouldRefreshPublicListPrecomputes(method, path)).toBe(false);
  });
});

describe("public list query shape", () => {
  it("reads course and teacher review counts from the precomputed projection", async () => {
    await SELF.fetch("https://example.com/api/courses?q=TEST101");
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

      expect(courseList.items.find((item) => item.id === 1)?.review_count).toBe(777);
      expect(teacherList.items.find((item) => item.id === 1)?.review_count).toBe(777);
      expect(teacherList.items.find((item) => item.id === 1)?.course_count).toBe(888);
    } finally {
      await env.DB.prepare("UPDATE public_precompute_state SET dirty=1 WHERE id=1").run();
      await SELF.fetch("https://example.com/api/courses?q=TEST101");
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
});
