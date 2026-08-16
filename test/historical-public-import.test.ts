import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";

async function adminHeaders() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `198.18.89.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({ password: "test-password" }),
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ csrfToken: string }>();
  const cookie = (response.headers as Headers & { getSetCookie(): string[] })
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return {
    "Content-Type": "application/json",
    Cookie: cookie,
    Origin: origin,
    "X-CSRF-Token": body.csrfToken,
  };
}

const manifest = {
  contractVersion: "legacy-historical-production-freeze-v1",
  status: "package_ready",
  counts: { importable: 941 },
  schemas: {
    "importable-legacy-reviews.jsonl": "legacy-approved-review-v1",
  },
  lineage: {
    approvedPackageContract: "legacy-historical-approved-package-v1",
    approvedPackageManifestSha256:
      "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af",
    approvedCatalogContentSha256:
      "33efc25c965510f7e87aeefc8b14a3ab5ec7c0df81d3485688d4630a4179bf1f",
  },
};

function record(reviewId: string, courseCode: string, teacherLabel: string) {
  return {
    schema_version: "legacy-approved-review-v1",
    review_id: reviewId,
    source_evaluation_id: `evaluation-${reviewId}`,
    catalog_course_code: courseCode,
    catalog_teacher_label: teacherLabel,
    category: "general",
    comment: "这是一条贯通课程与教师详情页的匿名评价。",
    decision_basis: "existing_catalog_relation",
    duplicate_group: null,
    proposed_teacher_label: null,
    source_column: "F",
    source_row: 89,
    worksheet: "批准包",
  };
}

describe("approved historical review tracer import", () => {
  it("enforces authority and identity gates, stays idempotent, and projects anonymously", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const courseCode = `HIST-${suffix}`;
    const teacherLabel = `历史教师-${suffix}`;
    const unrelatedLabel = `非任课教师-${suffix}`;
    const reviewId = `approved-review-${suffix}`;
    const courseResult = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(courseCode, `历史课程-${suffix}`, "general", "测试学院")
      .run();
    const courseId = Number(courseResult.meta.last_row_id);
    const teacherResult = await env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    )
      .bind(teacherLabel, teacherLabel, "测试学院")
      .run();
    const teacherId = Number(teacherResult.meta.last_row_id);
    const unrelatedResult = await env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    )
      .bind(unrelatedLabel, unrelatedLabel, "测试学院")
      .run();
    const unrelatedId = Number(unrelatedResult.meta.last_row_id);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
    )
      .bind(courseId, teacherId)
      .run();

    try {
      const unauthorized = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify({ manifest, record: record(reviewId, courseCode, teacherLabel) }),
        },
      );
      expect(unauthorized.status).toBe(401);

      const headers = await adminHeaders();
      const badManifest = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            manifest: {
              ...manifest,
              lineage: { ...manifest.lineage, approvedPackageManifestSha256: "0".repeat(64) },
            },
            record: record(reviewId, courseCode, teacherLabel),
          }),
        },
      );
      expect(badManifest.status).toBe(422);

      const aiReadyOnly = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            manifest,
            record: {
              ...record(reviewId, courseCode, teacherLabel),
              qualification: "ai_ready",
            },
          }),
        },
      );
      expect(aiReadyOnly.status).toBe(422);

      const wrongRelation = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            manifest,
            record: record(reviewId, courseCode, unrelatedLabel),
          }),
        },
      );
      expect(wrongRelation.status).toBe(422);

      const first = await SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
        method: "POST",
        headers,
        body: JSON.stringify({ manifest, record: record(reviewId, courseCode, teacherLabel) }),
      });
      expect(first.status).toBe(201);
      expect(await first.json()).toEqual({ id: `historical:${reviewId}`, created: true });

      const repeated = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ manifest, record: record(reviewId, courseCode, teacherLabel) }),
        },
      );
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toEqual({
        id: `historical:${reviewId}`,
        created: false,
      });

      const stored = await env.DB.prepare(
        "SELECT COUNT(*) count FROM public_historical_reviews WHERE id=?",
      )
        .bind(reviewId)
        .first<{ count: number }>();
      expect(stored?.count).toBe(1);

      const [courseResponse, teacherResponse] = await Promise.all([
        SELF.fetch(`${origin}/api/courses/${courseId}`),
        SELF.fetch(`${origin}/api/teachers/${teacherId}`),
      ]);
      const courseBody = await courseResponse.json<{ reviews: Array<Record<string, unknown>> }>();
      const teacherBody = await teacherResponse.json<{ reviews: Array<Record<string, unknown>> }>();
      const courseReview = courseBody.reviews.find((item) => item.id === `historical:${reviewId}`);
      const teacherReview = teacherBody.reviews.find((item) => item.id === `historical:${reviewId}`);
      expect(courseReview).toEqual({
        id: `historical:${reviewId}`,
        course_id: courseId,
        teacher_id: teacherId,
        comment: "这是一条贯通课程与教师详情页的匿名评价。",
        teacher_name: teacherLabel,
      });
      expect(teacherReview).toEqual({
        id: `historical:${reviewId}`,
        course_id: courseId,
        teacher_id: teacherId,
        comment: "这是一条贯通课程与教师详情页的匿名评价。",
        course_name: `历史课程-${suffix}`,
        course_code: courseCode,
      });
      for (const projected of [courseReview, teacherReview]) {
        const json = JSON.stringify(projected);
        for (const forbidden of [
          "source_",
          "worksheet",
          "status",
          "reviewed",
          "created",
          "imported",
          "author",
          "moderator",
          "ocr",
        ])
          expect(json).not.toContain(forbidden);
      }
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM public_historical_reviews WHERE id=?").bind(reviewId),
        env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(courseId),
        env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId),
        env.DB.prepare("DELETE FROM teachers WHERE id IN (?,?)").bind(teacherId, unrelatedId),
      ]);
    }
  });
});
