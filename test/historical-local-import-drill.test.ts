import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";
const manifest = {
  contractVersion: "legacy-historical-production-freeze-v1",
  status: "package_ready",
  counts: { importable: 941 },
  schemas: { "importable-legacy-reviews.jsonl": "legacy-approved-review-v1" },
  lineage: {
    approvedPackageContract: "legacy-historical-approved-package-v1",
    approvedPackageManifestSha256:
      "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af",
    approvedCatalogContentSha256:
      "33efc25c965510f7e87aeefc8b14a3ab5ec7c0df81d3485688d4630a4179bf1f",
  },
} as const;

async function adminHeaders() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ password: "test-password" }),
  });
  expect(response.status).toBe(200);
  const { csrfToken } = await response.json<{ csrfToken: string }>();
  const cookie = (response.headers as Headers & { getSetCookie(): string[] })
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return { "Content-Type": "application/json", Cookie: cookie, Origin: origin, "X-CSRF-Token": csrfToken };
}

function record(id: string, courseCode: string, teacherLabel: string, index: number) {
  return {
    schema_version: "legacy-approved-review-v1",
    review_id: id,
    source_evaluation_id: `evaluation-${id}`,
    catalog_course_code: courseCode,
    catalog_teacher_label: teacherLabel,
    category: "general",
    comment: `本地冻结包演练评价 ${index}`,
    decision_basis: "existing_catalog_relation",
    duplicate_group: null,
    proposed_teacher_label: null,
    source_column: "F",
    source_row: index + 1,
    worksheet: "本地演练",
  };
}

describe("frozen historical package local D1 drill", () => {
  it("imports 941 rows with atomic recovery, idempotency, projection, and pagination", async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const courseCode = `DRILL-${suffix}`;
    const teacherLabel = `演练教师-${suffix}`;
    const courseResult = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department,credits) VALUES(?,?,?,?,?)",
    ).bind(courseCode, `冻结包演练课程-${suffix}`, "general", "演练学院", 3).run();
    const courseId = Number(courseResult.meta.last_row_id);
    const teacherResult = await env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    ).bind(teacherLabel, teacherLabel, "演练学院").run();
    const teacherId = Number(teacherResult.meta.last_row_id);
    await env.DB.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)")
      .bind(courseId, teacherId).run();
    try {
      const before = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) count FROM courses"),
      env.DB.prepare("SELECT COUNT(*) count FROM teachers"),
      env.DB.prepare("SELECT COUNT(*) count FROM course_teachers"),
    ]);
    const rows = Array.from({ length: 941 }, (_, index) =>
      record(`drill-${suffix}-${String(index + 1).padStart(4, "0")}`, courseCode, teacherLabel, index),
    );
    const headers = await adminHeaders();
    const batches = Array.from({ length: Math.ceil(rows.length / 50) }, (_, index) =>
      rows.slice(index * 50, index * 50 + 50),
    );
    for (let index = 0; index < 5; index += 1) {
      const response = await SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
        method: "POST", headers, body: JSON.stringify({ manifest, records: batches[index] }),
      });
      expect(response.status).toBe(201);
    }
    const failed = [...batches[5]];
    failed[17] = { ...failed[17], catalog_teacher_label: `不存在-${suffix}` };
    const interrupted = await SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
      method: "POST", headers, body: JSON.stringify({ manifest, records: failed }),
    });
    expect(interrupted.status).toBe(422);
    const afterFailure = await env.DB.prepare("SELECT COUNT(*) count FROM public_historical_reviews WHERE course_id=?")
      .bind(courseId).first<{ count: number }>();
    expect(afterFailure?.count).toBe(250);

    for (let index = 5; index < batches.length; index += 1) {
      const response = await SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
        method: "POST", headers, body: JSON.stringify({ manifest, records: batches[index] }),
      });
      expect(response.status).toBe(201);
      expect((await response.json<{ created: number }>()).created).toBe(batches[index].length);
    }
    const firstCount = await env.DB.prepare("SELECT COUNT(*) count FROM public_historical_reviews WHERE course_id=?")
      .bind(courseId).first<{ count: number }>();
    expect(firstCount?.count).toBe(941);

    for (const batch of batches) {
      const response = await SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
        method: "POST", headers, body: JSON.stringify({ manifest, records: batch }),
      });
      expect(response.status).toBe(200);
      const body = await response.json<{ created: number; existing: number }>();
      expect(body.created).toBe(0);
      expect(body.existing).toBe(batch.length);
    }
    const after = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) count FROM courses"),
      env.DB.prepare("SELECT COUNT(*) count FROM teachers"),
      env.DB.prepare("SELECT COUNT(*) count FROM course_teachers"),
      env.DB.prepare("SELECT COUNT(*) count FROM public_historical_reviews WHERE course_id=?").bind(courseId),
      env.DB.prepare("SELECT COUNT(*) count FROM public_historical_reviews WHERE course_id=? AND package_contract=?").bind(courseId, manifest.contractVersion),
    ]);
    expect(after.slice(0, 3).map((result) => Number(result.results[0].count))).toEqual(
      before.slice(0, 3).map((result) => Number(result.results[0].count)),
    );
    expect(Number(after[3].results[0].count)).toBe(941);
    expect(Number(after[4].results[0].count)).toBe(941);

    const [courseResponse, teacherResponse] = await Promise.all([
      SELF.fetch(`${origin}/api/courses/${courseId}`),
      SELF.fetch(`${origin}/api/teachers/${teacherId}`),
    ]);
    const course = await courseResponse.json<{ reviewCount: number; reviews: Array<Record<string, unknown>> }>();
    const teacher = await teacherResponse.json<{ reviewCount: number; reviews: Array<Record<string, unknown>> }>();
    expect(course.reviewCount).toBe(941);
    expect(teacher.reviewCount).toBe(941);
    expect(course.reviews[0]).toEqual(teacher.reviews[0]);
    for (const value of [course.reviews[0], teacher.reviews[0]]) {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toMatch(/source_|worksheet|status|ocr|moderator|created|imported/);
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ pageSize: "50" });
      if (cursor) query.set("cursor", cursor);
      const page = await SELF.fetch(`${origin}/api/courses/${courseId}/reviews?${query}`).then((response) =>
        response.json<{ items: Array<{ id: string }>; nextCursor: string | null }>(),
      );
      page.items.forEach((item) => seen.add(item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(941);
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM public_historical_reviews WHERE course_id=?").bind(courseId),
        env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?").bind(courseId),
        env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId),
        env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacherId),
      ]);
    }
  }, 30000);
});
