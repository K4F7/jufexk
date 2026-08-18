import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MOOC_SCORES, OFFLINE_SCORES } from "./review-score-fixtures";

const origin = "https://example.com";

describe("public course-teacher review projection", () => {
  it("shares a stable, bounded anonymous text feed across course and teacher details", async () => {
    const code = `PROJECTION-${Date.now()}`;
    const teacherName = `投影教师-${Date.now()}`;
    const teacher = await env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    )
      .bind(teacherName, teacherName, "测试学院")
      .run();
    const teacherId = Number(teacher.meta.last_row_id);
    const course = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(code, `投影课程-${code}`, "general", "测试学院")
      .run();
    const courseId = Number(course.meta.last_row_id);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
    )
      .bind(courseId, teacherId)
      .run();

    const timestamp = "2026-08-11 02:00:00";
    const insertReview = async (
      status: string,
      comment: string,
      term: string,
      createdAt = timestamp,
    ) => {
      const result = await env.DB.prepare(
        `INSERT INTO reviews(
          course_id,teacher_id,category,overall,comment,term,status,
          submitter_hash,moderator_note,created_at,reviewed_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          courseId,
          teacherId,
          "general",
          4,
          comment,
          term,
          status,
          `private-${comment || "rating-only"}`,
          "private moderation note",
          createdAt,
          null,
        )
        .run();
      return Number(result.meta.last_row_id);
    };

    await insertReview("approved", "较新的补充说明", "2026 春");
    await insertReview("approved", "较旧的补充说明", "", timestamp);
    await insertReview("approved", "   ", "2026 春");
    await insertReview("approved", "", "2026 春");
    await insertReview("pending", "待审核补充说明", "2026 春");
    await insertReview("rejected", "被驳回补充说明", "2026 春");

    const batchId = `projection-${Date.now()}`;
    await env.DB.prepare(
      `INSERT INTO legacy_import_batches(
        id,source_type,source_label,status,row_count,imported_at
      ) VALUES(?, 'legacy_ocr', '投影测试历史资料', 'imported', 2, CURRENT_TIMESTAMP)`,
    )
      .bind(batchId)
      .run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO legacy_reviews(
          import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,
          ocr_confidence,course_id,teacher_id,category,comment,status,term
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        batchId,
        "projection.png",
        "测试表",
        "1",
        "private OCR",
        0.99,
        courseId,
        teacherId,
        "general",
        "已审核历史资料",
        "approved",
        "2024 秋",
      ),
      env.DB.prepare(
        `INSERT INTO legacy_reviews(
          import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,
          ocr_confidence,course_id,teacher_id,category,comment,status
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        batchId,
        "projection-pending.png",
        "测试表",
        "2",
        "private pending OCR",
        0.99,
        courseId,
        teacherId,
        "general",
        "待审核历史资料",
        "pending",
      ),
    ]);
    const historicalIds = Array.from({ length: 23 }, (_, index) =>
      `${code}-historical-${String(index + 1).padStart(2, "0")}`,
    );
    await env.DB.batch(
      historicalIds.map((reviewId, index) =>
        env.DB.prepare(
          `INSERT INTO public_historical_reviews(
             id,course_id,teacher_id,comment,package_contract,
             approved_package_manifest_sha256,approved_catalog_content_sha256
           ) VALUES(?,?,?,?,?,?,?)`,
        ).bind(
          reviewId,
          courseId,
          teacherId,
          `冻结匿名评价 ${index + 1}`,
          "legacy-historical-production-freeze-v1",
          "a".repeat(64),
          "b".repeat(64),
        ),
      ),
    );

    try {
      const courseResponse = await SELF.fetch(
        `${origin}/api/courses/${courseId}`,
      );
      const teacherResponse = await SELF.fetch(
        `${origin}/api/teachers/${teacherId}`,
      );
      expect(courseResponse.status).toBe(200);
      expect(teacherResponse.status).toBe(200);
      const courseBody = await courseResponse.json<{
        reviewCount: number;
      }>();
      const teacherBody = await teacherResponse.json<{
        reviewCount: number;
        nextReviewCursor: string | null;
        reviews: Array<Record<string, unknown>>;
      }>();

      // 课程详情只返回评价总数；评价流经 /reviews 获取，可按 课程×教师
      // 作用域过滤，未指定 teacherId 时返回该课全部公开评价（Issue #201）。
      expect(courseBody.reviewCount).toBe(26);
      expect(courseBody).not.toHaveProperty("reviews");
      expect(courseBody).not.toHaveProperty("nextReviewCursor");

      const courseReviewsResponse = await SELF.fetch(
        `${origin}/api/courses/${courseId}/reviews?teacherId=${teacherId}`,
      );
      expect(courseReviewsResponse.status).toBe(200);
      const courseReviews = await courseReviewsResponse.json<{
        items: Array<Record<string, unknown>>;
        nextCursor: string | null;
      }>();

      const unscoped = await SELF.fetch(
        `${origin}/api/courses/${courseId}/reviews`,
      );
      expect(unscoped.status).toBe(200);
      const unscopedReviews = await unscoped.json<{
        items: Array<Record<string, unknown>>;
        nextCursor: string | null;
      }>();
      // 该课只有一位任课教师：未过滤的全部评价与 scoped 首页一致。
      expect(unscopedReviews.items).toEqual(courseReviews.items);
      expect(unscopedReviews.nextCursor).toBe(courseReviews.nextCursor);

      expect(teacherBody.reviewCount).toBe(courseBody.reviewCount);
      expect(courseReviews.items).toHaveLength(20);
      expect(teacherBody.reviews).toEqual(courseReviews.items);
      expect(courseReviews.nextCursor).toBeTruthy();
      expect(teacherBody.nextReviewCursor).toBe(courseReviews.nextCursor);
      expect(courseReviews.items[0]).toMatchObject({
        teacher_id: teacherId,
        teacher_name: teacherName,
      });
      expect(teacherBody.reviews[0]).toMatchObject({
        course_id: courseId,
        course_name: `投影课程-${code}`,
        course_code: code,
      });
      const [courseNext, teacherNext, courseRefresh] = await Promise.all([
        SELF.fetch(
          `${origin}/api/courses/${courseId}/reviews?teacherId=${teacherId}&cursor=${encodeURIComponent(courseReviews.nextCursor!)}`,
        ).then((response) => response.json<{ items: Array<Record<string, unknown>> }>()),
        SELF.fetch(
          `${origin}/api/teachers/${teacherId}/reviews?cursor=${encodeURIComponent(teacherBody.nextReviewCursor!)}`,
        ).then((response) => response.json<{ items: Array<Record<string, unknown>> }>()),
        SELF.fetch(
          `${origin}/api/courses/${courseId}/reviews?teacherId=${teacherId}`,
        ).then((response) =>
          response.json<{ items: Array<Record<string, unknown>> }>(),
        ),
      ]);
      expect(courseNext.items).toHaveLength(6);
      expect(teacherNext.items).toEqual(courseNext.items);
      expect(courseRefresh.items).toEqual(courseReviews.items);
      const allIds = [...courseReviews.items, ...courseNext.items].map((review) => review.id);
      expect(new Set(allIds).size).toBe(26);
      expect(allIds).toEqual([
        ...historicalIds.map((reviewId) => `historical:${reviewId}`),
        expect.stringMatching(/^legacy:/),
        expect.stringMatching(/^review:/),
        expect.stringMatching(/^review:/),
      ]);
      const publicJson = JSON.stringify({
        courseReviews: courseReviews.items,
        teacherReviews: teacherBody.reviews,
        courseNext,
        teacherNext,
      });
      expect(publicJson).not.toContain("private-");
      expect(publicJson).not.toContain("private moderation note");
      expect(publicJson).not.toContain("private OCR");
      expect(publicJson).not.toContain("投影测试历史资料");
      expect(publicJson).not.toContain("2026 春");
      expect(publicJson).not.toContain("created_at");
      expect(publicJson).not.toContain("publishedAt");
      expect(publicJson).not.toContain("overall");
      expect(publicJson).not.toContain("待审核补充说明");
      expect(publicJson).not.toContain("被驳回补充说明");
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM public_historical_reviews WHERE course_id=?").bind(
          courseId,
        ),
        env.DB.prepare("DELETE FROM legacy_reviews WHERE import_batch_id=?").bind(
          batchId,
        ),
        env.DB.prepare("DELETE FROM legacy_import_batches WHERE id=?").bind(
          batchId,
        ),
        env.DB.prepare("DELETE FROM reviews WHERE course_id=?").bind(courseId),
        env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(
          courseId,
        ),
        env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId),
        env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacherId),
      ]);
    }
  });

  it("returns a one-decimal dimension average only for scheme-snapshot text reviews", async () => {
    const code = `AVG-${Date.now()}`;
    const teacherName = `均分教师-${Date.now()}`;
    const teacher = await env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    )
      .bind(teacherName, teacherName, "测试学院")
      .run();
    const teacherId = Number(teacher.meta.last_row_id);
    const course = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(code, `均分课程-${code}`, "general", "测试学院")
      .run();
    const courseId = Number(course.meta.last_row_id);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
    )
      .bind(courseId, teacherId)
      .run();

    const insertTextReview = async (
      comment: string,
      extras: {
        schemeKey?: string;
        schemeVersion?: number;
        scores?: Record<string, number>;
        overall?: number;
      } = {},
    ) => {
      await env.DB.prepare(
        `INSERT INTO reviews(
          course_id,teacher_id,category,overall,comment,term,status,submitter_hash,
          scheme_key,scheme_version,scores
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          courseId,
          teacherId,
          "general",
          extras.overall ?? 5,
          comment,
          "2026 春",
          "approved",
          `hash-${comment || "rating-only"}`,
          extras.schemeKey ?? null,
          extras.schemeVersion ?? null,
          extras.scores ? JSON.stringify(extras.scores) : null,
        )
        .run();
    };

    await insertTextReview("线下课补充说明", {
      schemeKey: "major",
      schemeVersion: 1,
      scores: OFFLINE_SCORES,
    });
    await insertTextReview("网课补充说明", {
      schemeKey: "ideology",
      schemeVersion: 1,
      scores: MOOC_SCORES,
    });
    await insertTextReview("没有规则快照的旧评价");
    await insertTextReview("", {
      schemeKey: "major",
      schemeVersion: 1,
      scores: OFFLINE_SCORES,
      overall: 1,
    });

    const historicalId = `${code}-historical`;
    await env.DB.prepare(
      `INSERT INTO public_historical_reviews(
         id,course_id,teacher_id,comment,package_contract,
         approved_package_manifest_sha256,approved_catalog_content_sha256
       ) VALUES(?,?,?,?,?,?,?)`,
    )
      .bind(
        historicalId,
        courseId,
        teacherId,
        "冻结历史评价",
        "legacy-historical-production-freeze-v1",
        "a".repeat(64),
        "b".repeat(64),
      )
      .run();

    try {
      const response = await SELF.fetch(
        `${origin}/api/courses/${courseId}/reviews?teacherId=${teacherId}`,
      );
      expect(response.status).toBe(200);
      const body = await response.json<{
        items: Array<Record<string, unknown>>;
      }>();
      expect(body.items.map((item) => item.comment)).toEqual([
        "冻结历史评价",
        "线下课补充说明",
        "网课补充说明",
        "没有规则快照的旧评价",
      ]);
      expect(body.items[0]).not.toHaveProperty("dimensionAverage");
      expect(body.items[1]).toMatchObject({
        comment: "线下课补充说明",
        dimensionAverage: 3.5,
      });
      expect(body.items[2]).toMatchObject({
        comment: "网课补充说明",
        dimensionAverage: 3.7,
      });
      expect(body.items[3]).not.toHaveProperty("dimensionAverage");
      const publicJson = JSON.stringify(body.items);
      expect(publicJson).not.toContain("teaching");
      expect(publicJson).not.toContain("attendance");
      expect(publicJson).not.toContain("scheme_key");
      expect(publicJson).not.toContain("scores");

      const courseDetail = await SELF.fetch(`${origin}/api/courses/${courseId}`);
      expect(courseDetail.status).toBe(200);
      const courseBody = await courseDetail.json<{
        reviewCount: number;
        course: { rating: number; teachers: Array<{ rating: number }> };
      }>();
      expect(courseBody.reviewCount).toBe(4);
      expect(courseBody.course.rating).toBe(4);
      expect(courseBody.course.teachers[0]?.rating).toBe(4);
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM public_historical_reviews WHERE course_id=?").bind(
          courseId,
        ),
        env.DB.prepare("DELETE FROM reviews WHERE course_id=?").bind(courseId),
        env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(
          courseId,
        ),
        env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId),
        env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacherId),
      ]);
    }
  });
});
