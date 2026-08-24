import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { adminAuth, adminHeaders as sessionHeaders } from "./admin-session";
import { V5_IMPORTABLE_COUNT } from "../src/historical-batch-imports";

const origin = "https://example.com";

async function adminHeaders() {
  return sessionHeaders(await adminAuth(), origin);
}

const v5Manifest = {
  contractVersion: "legacy-v5-historical-freeze-v1",
  status: "package_ready",
  counts: { importable: V5_IMPORTABLE_COUNT },
  schemas: {
    "importable-legacy-reviews.jsonl": "legacy-approved-review-v1",
  },
  files: {
    "importable-legacy-reviews.jsonl": { rows: V5_IMPORTABLE_COUNT, sha256: "" },
  },
  lineage: {
    approvedPackageContract: "legacy-review-approved-package-v1",
    approvedPackageManifestSha256:
      "81566854cb1b4a0d13507364552ae3152fc30929ca01065523f97ad1b8f18034",
    approvedCatalogContentSha256:
      "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588",
  },
};

async function importV5Package(
  records: Array<Record<string, unknown>>,
  manifestOverride: Record<string, unknown> = {},
) {
  const artifact = `${records.map((value) => JSON.stringify(value)).join("\n")}\n`;
  const sha256 = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(artifact)),
    ),
  ]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return {
    manifest: JSON.stringify({
      ...v5Manifest,
      ...manifestOverride,
      files: { "importable-legacy-reviews.jsonl": { rows: records.length, sha256 } },
    }),
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
    comment: "追加批次匿名文字评价。",
    decision_basis: "preserve_via_catalog_addition_request",
    duplicate_group: null,
    proposed_teacher_label: null,
    source_column: "F",
    source_row: 12,
    worksheet: "主要课程",
  };
}

describe("v5 historical batch import", () => {
  it("imports the authorized v10 package size and stays idempotent", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const courseCode = `V5IMP-${suffix}`;
    const teacherLabel = `v5教师-${suffix}`;
    const reviewId = `v5-review-${suffix}`;
    const courseResult = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(courseCode, `v5课程-${suffix}`, "general", "测试学院")
      .run();
    const courseId = Number(courseResult.meta.last_row_id);
    const teacherResult = await env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    )
      .bind(teacherLabel, teacherLabel, "测试学院")
      .run();
    const teacherId = Number(teacherResult.meta.last_row_id);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
    )
      .bind(courseId, teacherId)
      .run();

    try {
      const records = Array.from({ length: V5_IMPORTABLE_COUNT }, (_, index) =>
        record(index ? `${reviewId}-${index}` : reviewId, courseCode, teacherLabel),
      );
      const approvedPackage = await importV5Package(records);
      const headers = await adminHeaders();

      const wrongContract = await SELF.fetch(
        `${origin}/api/admin/historical-review-v5-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(
            await importV5Package(records, {
              contractVersion: "legacy-issue111-historical-freeze-v1",
            }),
          ),
        },
      );
      expect(wrongContract.status).toBe(422);

      let created = 0;
      for (let offset = 0; offset < V5_IMPORTABLE_COUNT; offset += 50) {
        const response = await SELF.fetch(
          `${origin}/api/admin/historical-review-v5-imports`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ ...approvedPackage, offset }),
          },
        );
        expect([200, 201]).toContain(response.status);
        created += (await response.json<{ created: number }>()).created;
      }
      expect(created).toBe(V5_IMPORTABLE_COUNT);

      let existing = 0;
      for (let offset = 0; offset < V5_IMPORTABLE_COUNT; offset += 50) {
        const response = await SELF.fetch(
          `${origin}/api/admin/historical-review-v5-imports`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ ...approvedPackage, offset }),
          },
        );
        expect(response.status).toBe(200);
        existing += (await response.json<{ existing: number }>()).existing;
      }
      expect(existing).toBe(V5_IMPORTABLE_COUNT);
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM public_historical_reviews WHERE course_id=?").bind(
          courseId,
        ),
        env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(courseId),
        env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId),
        env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacherId),
      ]);
    }
  }, 30000);
});
