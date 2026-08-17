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
  contractVersion: "legacy-historical-production-freeze-v2",
  contentSha256: "1b4ca0728d9883c0d9267cc0ede033bbeebcb0fb3a3cdff333816c36e414a421",
  status: "package_ready",
  counts: { importable: 522, catalogRelationUnavailable: 419 },
  schemas: {
    "importable-legacy-reviews.jsonl": "legacy-approved-review-v1",
  },
  files: {
    "importable-legacy-reviews.jsonl": { rows: 522, sha256: "" },
  },
  lineage: {
    approvedPackageContract: "legacy-historical-approved-package-v1",
    approvedPackageManifestSha256:
      "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af",
    approvedCatalogContentSha256:
      "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588",
  },
};

async function importPackage(
  records: Array<Record<string, unknown>>,
  manifestOverride: Record<string, unknown> = {},
) {
  const artifact = `${records.map((value) => JSON.stringify(value)).join("\n")}\n`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(artifact)))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const packageManifest = {
    ...manifest,
    ...manifestOverride,
    files: { "importable-legacy-reviews.jsonl": { rows: records.length, sha256 } },
  };
  return {
    manifest: JSON.stringify(packageManifest),
    artifact,
    offset: 0,
  };
}

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
      const records = Array.from({ length: 522 }, (_, index) =>
        record(index ? `${reviewId}-${index}` : reviewId, courseCode, teacherLabel),
      );
      const approvedPackage = await importPackage(records);
      const unauthorized = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify(approvedPackage),
        },
      );
      expect(unauthorized.status).toBe(401);

      const headers = await adminHeaders();
      const legacyContract = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(
            await importPackage(records, {
              contractVersion: "legacy-historical-production-freeze-v1",
            }),
          ),
        },
      );
      expect(legacyContract.status).toBe(422);

      const badManifest = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(
            await importPackage(records, {
              lineage: {
                ...manifest.lineage,
                approvedPackageManifestSha256: "0".repeat(64),
              },
            }),
          ),
        },
      );
      expect(badManifest.status).toBe(422);

      const missingLineage = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(await importPackage(records, { lineage: undefined })),
        },
      );
      expect(missingLineage.status).toBe(422);

      const tamperedArtifact = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...approvedPackage,
            artifact: approvedPackage.artifact.replace(
              "这是一条贯通课程与教师详情页的匿名评价。",
              "被篡改的评价。",
            ),
          }),
        },
      );
      expect(tamperedArtifact.status).toBe(422);

      const wrongRelationPackage = await importPackage([
        record(reviewId, courseCode, unrelatedLabel),
        ...records.slice(1),
      ]);
      const wrongRelation = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(wrongRelationPackage),
        },
      );
      expect(wrongRelation.status).toBe(422);

      const rejectedBatchId = `${reviewId}-rejected-batch`;
      const rejectedRows = [...records];
      rejectedRows[0] = record(rejectedBatchId, courseCode, teacherLabel);
      rejectedRows[1] = record(`${rejectedBatchId}-unknown`, courseCode, unrelatedLabel);
      const rejectedPackage = await importPackage(rejectedRows);
      const rejectedBatch = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(rejectedPackage),
        },
      );
      expect(rejectedBatch.status).toBe(422);
      const rejectedBatchStored = await env.DB.prepare(
        "SELECT COUNT(*) count FROM public_historical_reviews WHERE id IN (?,?)",
      )
        .bind(rejectedBatchId, `${rejectedBatchId}-unknown`)
        .first<{ count: number }>();
      expect(rejectedBatchStored?.count).toBe(0);

      const concurrent = await Promise.all([
        SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
          method: "POST",
          headers,
          body: JSON.stringify(approvedPackage),
        }),
        SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
          method: "POST",
          headers,
          body: JSON.stringify(approvedPackage),
        }),
      ]);
      expect(concurrent.map((response) => response.status).sort()).toEqual([200, 201]);
      const concurrentBodies = await Promise.all(
        concurrent.map((response) =>
          response.json<{ created: number; existing: number }>(),
        ),
      );
      expect(
        concurrentBodies.reduce(
          (totals, body) => ({
            created: totals.created + body.created,
            existing: totals.existing + body.existing,
          }),
          { created: 0, existing: 0 },
        ),
      ).toEqual({ created: 50, existing: 50 });

      const repeated = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(approvedPackage),
        },
      );
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toEqual({
        offset: 0,
        total: 50,
        created: 0,
        existing: 50,
      });

      const excludedRows = [...records];
      excludedRows[0] = {
        ...record(`${reviewId}-excluded`, courseCode, teacherLabel),
        exclusion_reason: "blank",
      };
      const excludedPartition = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(await importPackage(excludedRows)),
        },
      );
      expect(excludedPartition.status).toBe(422);

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
        course_name: `历史课程-${suffix}`,
        course_code: courseCode,
        teacher_name: teacherLabel,
        endorsement_count: 0,
        endorsable: false,
      });
      expect(teacherReview).toEqual({
        id: `historical:${reviewId}`,
        course_id: courseId,
        teacher_id: teacherId,
        comment: "这是一条贯通课程与教师详情页的匿名评价。",
        course_name: `历史课程-${suffix}`,
        course_code: courseCode,
        teacher_name: teacherLabel,
        endorsement_count: 0,
        endorsable: false,
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
        env.DB.prepare("DELETE FROM public_historical_reviews WHERE course_id=?").bind(courseId),
        env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(courseId),
        env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId),
        env.DB.prepare("DELETE FROM teachers WHERE id IN (?,?)").bind(teacherId, unrelatedId),
      ]);
    }
  }, 30000);
});
