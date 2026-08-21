import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";

async function adminHeaders() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `198.18.64.${Math.floor(Math.random() * 200) + 1}`,
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

const issue111Manifest = {
  contractVersion: "legacy-issue111-historical-freeze-v1",
  status: "package_ready",
  counts: { importable: 164 },
  schemas: {
    "importable-legacy-reviews.jsonl": "legacy-approved-review-v1",
  },
  files: {
    "importable-legacy-reviews.jsonl": { rows: 164, sha256: "" },
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
  const sha256 = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(artifact)),
    ),
  ]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return {
    manifest: JSON.stringify({
      ...issue111Manifest,
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

describe("issue111 historical batch import", () => {
  it("imports 164 reviews on the new path, rejects the #108 contract, and stays idempotent", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const courseCode = `ISSUE111-${suffix}`;
    const teacherLabel = `追加教师-${suffix}`;
    const reviewId = `issue111-review-${suffix}`;
    const courseResult = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(courseCode, `追加课程-${suffix}`, "general", "测试学院")
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
      const records = Array.from({ length: 164 }, (_, index) =>
        record(index ? `${reviewId}-${index}` : reviewId, courseCode, teacherLabel),
      );
      const approvedPackage = await importPackage(records);
      const headers = await adminHeaders();

      const oldPath = await SELF.fetch(
        `${origin}/api/admin/historical-review-imports`,
        { method: "POST", headers, body: JSON.stringify(approvedPackage) },
      );
      expect(oldPath.status).toBe(422);

      const v2Contract = await SELF.fetch(
        `${origin}/api/admin/historical-review-batch-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(
            await importPackage(records, {
              contractVersion: "legacy-historical-production-freeze-v2",
            }),
          ),
        },
      );
      expect(v2Contract.status).toBe(422);

      const missingRelation = await SELF.fetch(
        `${origin}/api/admin/historical-review-batch-imports`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(
            await importPackage([
              record(`${reviewId}-missing`, courseCode, `不存在-${suffix}`),
              ...records.slice(1),
            ]),
          ),
        },
      );
      expect(missingRelation.status).toBe(422);
      expect(
        (
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM public_historical_reviews WHERE id=?",
          )
            .bind(`${reviewId}-missing`)
            .first<{ count: number }>()
        )?.count,
      ).toBe(0);

      let created = 0;
      for (let offset = 0; offset < 164; offset += 50) {
        const response = await SELF.fetch(
          `${origin}/api/admin/historical-review-batch-imports`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ ...approvedPackage, offset }),
          },
        );
        expect([200, 201]).toContain(response.status);
        created += (await response.json<{ created: number }>()).created;
      }
      expect(created).toBe(164);

      let existing = 0;
      for (let offset = 0; offset < 164; offset += 50) {
        const response = await SELF.fetch(
          `${origin}/api/admin/historical-review-batch-imports`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ ...approvedPackage, offset }),
          },
        );
        expect(response.status).toBe(200);
        existing += (await response.json<{ existing: number }>()).existing;
      }
      expect(existing).toBe(164);
      expect(
        (
          await env.DB.prepare(
            "SELECT COUNT(*) count FROM public_historical_reviews WHERE course_id=?",
          )
            .bind(courseId)
            .first<{ count: number }>()
        )?.count,
      ).toBe(164);
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

const v5Manifest = {
  contractVersion: "legacy-v5-historical-freeze-v1",
  status: "package_ready",
  counts: { importable: 357 },
  schemas: {
    "importable-legacy-reviews.jsonl": "legacy-approved-review-v1",
  },
  files: {
    "importable-legacy-reviews.jsonl": { rows: 357, sha256: "" },
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

describe("v5 historical batch import", () => {
  it("imports 357 reviews on the v5 path and stays idempotent", async () => {
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
      const records = Array.from({ length: 357 }, (_, index) =>
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
      for (let offset = 0; offset < 357; offset += 50) {
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
      expect(created).toBe(357);

      let existing = 0;
      for (let offset = 0; offset < 357; offset += 50) {
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
      expect(existing).toBe(357);
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
