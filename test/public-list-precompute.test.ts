import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  refreshPublicListPrecomputes,
  shouldRefreshPublicListPrecomputes,
} from "../src/public-list-precompute";

const databaseWithBatch = (
  batch: (
    statements: D1PreparedStatement[],
  ) => Promise<D1Result<unknown>[]>,
) =>
  new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch") return batch;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as D1Database;

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

  it("publishes clean projections only after the source generation stays stable", async () => {
    await SELF.fetch("https://example.com/api/courses?q=TEST101");
    const before = await env.DB.prepare(
      "SELECT generation FROM public_precompute_state WHERE id=1",
    ).first<{ generation: number }>();
    await env.DB.prepare(`
      CREATE TRIGGER issue355_write_during_pinyin
      AFTER UPDATE OF pinyin_text ON public_course_canonicals
      WHEN NEW.course_id=1
       AND (SELECT dirty FROM public_precompute_state WHERE id=1)=1
       AND NOT EXISTS(
         SELECT 1 FROM course_name_variants
         WHERE course_id=1 AND name='并发刷新别名'
       )
      BEGIN
        INSERT INTO course_name_variants(course_id,name)
        VALUES(1,'并发刷新别名');
      END;
    `).run();
    await env.DB.prepare(
      "UPDATE public_precompute_state SET dirty=1 WHERE id=1",
    ).run();

    try {
      await refreshPublicListPrecomputes(env.DB);
      const state = await env.DB.prepare(
        "SELECT dirty,generation FROM public_precompute_state WHERE id=1",
      ).first<{
        dirty: number;
        generation: number;
      }>();
      const projection = await env.DB.prepare(
        "SELECT match_text FROM public_course_canonicals WHERE course_id=1",
      ).first<{ match_text: string }>();

      expect(state?.dirty).toBe(0);
      expect(state?.generation).toBeGreaterThan(before?.generation ?? -1);
      expect(projection?.match_text).toContain("并发刷新别名");
    } finally {
      await env.DB.exec("DROP TRIGGER IF EXISTS issue355_write_during_pinyin;");
      await env.DB.prepare(
        "DELETE FROM course_name_variants WHERE course_id=1 AND name='并发刷新别名'",
      ).run();
      await env.DB.prepare(
        "UPDATE public_precompute_state SET dirty=1 WHERE id=1",
      ).run();
      await refreshPublicListPrecomputes(env.DB);
    }
  });

  it("serializes independent refresh coordinators with a database lease", async () => {
    await SELF.fetch("https://example.com/api/courses?q=TEST101");
    await env.DB.prepare(
      `UPDATE public_precompute_state
       SET dirty=1,refresh_token=NULL,refresh_lease_until=NULL
       WHERE id=1`,
    ).run();

    let openFirstBatch!: () => void;
    let firstBatchReached!: () => void;
    const firstBatchGate = new Promise<void>((resolve) => {
      openFirstBatch = resolve;
    });
    const firstBatchStarted = new Promise<void>((resolve) => {
      firstBatchReached = resolve;
    });
    let gateFirstBatch = true;
    let secondBatchCalls = 0;
    const databaseA = databaseWithBatch(async (statements) => {
      if (gateFirstBatch) {
        gateFirstBatch = false;
        firstBatchReached();
        await firstBatchGate;
      }
      return env.DB.batch(statements);
    });
    const databaseB = databaseWithBatch(async (statements) => {
      secondBatchCalls += 1;
      return env.DB.batch(statements);
    });

    const firstRefresh = refreshPublicListPrecomputes(databaseA);
    await firstBatchStarted;
    const secondRefresh = refreshPublicListPrecomputes(databaseB);
    try {
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(secondBatchCalls).toBe(0);
    } finally {
      openFirstBatch();
      await Promise.allSettled([firstRefresh, secondRefresh]);
    }
    await expect(Promise.all([firstRefresh, secondRefresh])).resolves.toEqual([
      undefined,
      undefined,
    ]);

    const state = await env.DB.prepare(
      `SELECT dirty,refresh_token,refresh_lease_until
       FROM public_precompute_state WHERE id=1`,
    ).first<{
      dirty: number;
      refresh_token: string | null;
      refresh_lease_until: number | null;
    }>();
    const missingPinyin = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM public_course_canonicals WHERE pinyin_text IS NULL) +
         (SELECT COUNT(*) FROM public_teacher_search WHERE pinyin_text IS NULL) count`,
    ).first<{ count: number }>();
    expect(state).toEqual({
      dirty: 0,
      refresh_token: null,
      refresh_lease_until: null,
    });
    expect(missingPinyin?.count).toBe(0);
  });

  it("keeps the original refresh error when dirty-state cleanup also fails", async () => {
    await SELF.fetch("https://example.com/api/courses?q=TEST101");
    await env.DB.prepare(
      "UPDATE public_precompute_state SET dirty=1 WHERE id=1",
    ).run();
    await env.DB.prepare(`
      CREATE TRIGGER issue355_fail_pinyin_refresh
      BEFORE UPDATE OF pinyin_text ON public_course_canonicals
      WHEN NEW.course_id=1
      BEGIN
        SELECT RAISE(ABORT,'issue355 pinyin refresh failure');
      END;
    `).run();
    await env.DB.prepare(`
      CREATE TRIGGER issue355_fail_dirty_cleanup
      BEFORE UPDATE ON public_precompute_state
      WHEN NEW.dirty=1
       AND OLD.refresh_token IS NOT NULL
       AND NEW.refresh_token IS NULL
      BEGIN
        SELECT RAISE(ABORT,'issue355 dirty cleanup failure');
      END;
    `).run();

    try {
      await expect(refreshPublicListPrecomputes(env.DB)).rejects.toThrow(
        /issue355 pinyin refresh failure/,
      );
    } finally {
      await env.DB.exec(`
        DROP TRIGGER IF EXISTS issue355_fail_dirty_cleanup;
        DROP TRIGGER IF EXISTS issue355_fail_pinyin_refresh;
      `);
      await env.DB.prepare(
        `UPDATE public_precompute_state
         SET dirty=1,refresh_token=NULL,refresh_lease_until=NULL
         WHERE id=1`,
      ).run();
      await refreshPublicListPrecomputes(env.DB);
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
