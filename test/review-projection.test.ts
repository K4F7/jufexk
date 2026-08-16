import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";

describe("public course-teacher review projection", () => {
  it("shares rating and written-note semantics across course and teacher details", async () => {
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
        ratingCount: number;
        noteCount: number;
        reviews: Array<Record<string, unknown>>;
      }>();
      const teacherBody = await teacherResponse.json<{
        ratingCount: number;
        noteCount: number;
        reviews: Array<Record<string, unknown>>;
      }>();

      expect(courseBody.ratingCount).toBe(4);
      expect(courseBody.noteCount).toBe(2);
      expect(teacherBody.ratingCount).toBe(courseBody.ratingCount);
      expect(teacherBody.noteCount).toBe(courseBody.noteCount);
      expect(courseBody.reviews).toHaveLength(2);
      expect(teacherBody.reviews).toHaveLength(2);
      expect(courseBody.reviews.map((review) => review.comment)).toEqual([
        "较旧的补充说明",
        "较新的补充说明",
      ]);
      expect(courseBody.reviews[0]).toMatchObject({
        teacher_id: teacherId,
        teacher_name: teacherName,
      });
      expect(teacherBody.reviews[0]).toMatchObject({
        course_id: courseId,
        course_name: `投影课程-${code}`,
        course_code: code,
      });
      const publicJson = JSON.stringify({ courseBody, teacherBody });
      expect(publicJson).not.toContain("private-");
      expect(publicJson).not.toContain("private moderation note");
      expect(publicJson).not.toContain("private OCR");
      expect(publicJson).not.toContain("待审核补充说明");
      expect(publicJson).not.toContain("被驳回补充说明");
    } finally {
      await env.DB.batch([
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
});
