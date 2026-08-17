import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";
const manifest = {
  contractVersion: "legacy-historical-production-freeze-v2",
  contentSha256: "1b4ca0728d9883c0d9267cc0ede033bbeebcb0fb3a3cdff333816c36e414a421",
  status: "package_ready",
  counts: { importable: 522, catalogRelationUnavailable: 419 },
  schemas: { "importable-legacy-reviews.jsonl": "legacy-approved-review-v1" },
  files: { "importable-legacy-reviews.jsonl": { rows: 522, sha256: "" } },
  lineage: {
    approvedPackageContract: "legacy-historical-approved-package-v1",
    approvedPackageManifestSha256:
      "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af",
    approvedCatalogContentSha256:
      "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588",
  },
} as const;

async function importPackage(records: Array<Record<string, unknown>>) {
  const artifact = `${records.map((value) => JSON.stringify(value)).join("\n")}\n`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(artifact)))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const packageManifest = {
    ...manifest,
    files: { "importable-legacy-reviews.jsonl": { rows: records.length, sha256 } },
  };
  return {
    manifest: JSON.stringify(packageManifest),
    artifact,
  };
}

async function adminHeaders() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `198.18.92.${Math.floor(Math.random() * 200) + 1}`,
    },
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
  it("imports 522 rows with atomic recovery, idempotency, projection, and pagination", async () => {
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
    const rows = Array.from({ length: 522 }, (_, index) =>
      record(`drill-${suffix}-${String(index + 1).padStart(4, "0")}`, courseCode, teacherLabel, index),
    );
    const headers = await adminHeaders();
    const approvedPackage = await importPackage(rows);
    const failed = [...rows];
    failed[267] = { ...failed[267], catalog_teacher_label: `不存在-${suffix}` };
    const failedPackage = await importPackage(failed);
    for (let offset = 0; offset < 250; offset += 50) {
      const response = await SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
        method: "POST", headers, body: JSON.stringify({ ...failedPackage, offset }),
      });
      expect(response.status).toBe(201);
    }
    const interrupted = await SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
      method: "POST", headers, body: JSON.stringify({ ...failedPackage, offset: 250 }),
    });
    expect(interrupted.status).toBe(422);
    const afterFailure = await env.DB.prepare("SELECT COUNT(*) count FROM public_historical_reviews WHERE course_id=?")
      .bind(courseId).first<{ count: number }>();
    expect(afterFailure?.count).toBe(250);

    let recoveredCreated = 0;
    let recoveredExisting = 0;
    for (let offset = 0; offset < rows.length; offset += 50) {
      const recovered = await SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
        method: "POST", headers, body: JSON.stringify({ ...approvedPackage, offset }),
      });
      const result = await recovered.json<{ created: number; existing: number }>();
      recoveredCreated += result.created;
      recoveredExisting += result.existing;
    }
    expect({ created: recoveredCreated, existing: recoveredExisting }).toEqual({
      created: 272,
      existing: 250,
    });
    const firstCount = await env.DB.prepare("SELECT COUNT(*) count FROM public_historical_reviews WHERE course_id=?")
      .bind(courseId).first<{ count: number }>();
    expect(firstCount?.count).toBe(522);

    let replayExisting = 0;
    for (let offset = 0; offset < rows.length; offset += 50) {
      const replay = await SELF.fetch(`${origin}/api/admin/historical-review-imports`, {
        method: "POST", headers, body: JSON.stringify({ ...approvedPackage, offset }),
      });
      expect(replay.status).toBe(200);
      replayExisting += (await replay.json<{ existing: number }>()).existing;
    }
    expect(replayExisting).toBe(522);
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
    expect(Number(after[3].results[0].count)).toBe(522);
    expect(Number(after[4].results[0].count)).toBe(522);

    const [courseResponse, courseReviewsResponse, teacherResponse] = await Promise.all([
      SELF.fetch(`${origin}/api/courses/${courseId}`),
      SELF.fetch(`${origin}/api/courses/${courseId}/reviews?teacherId=${teacherId}`),
      SELF.fetch(`${origin}/api/teachers/${teacherId}`),
    ]);
    const course = await courseResponse.json<{ reviewCount: number }>();
    const courseReviews = await courseReviewsResponse.json<{ items: Array<Record<string, unknown>> }>();
    const teacher = await teacherResponse.json<{ reviewCount: number; reviews: Array<Record<string, unknown>> }>();
    expect(course.reviewCount).toBe(522);
    expect(teacher.reviewCount).toBe(522);
    expect(courseReviews.items[0]).toEqual(teacher.reviews[0]);
    for (const value of [courseReviews.items[0], teacher.reviews[0]]) {
      const serialized = JSON.stringify(value);
      expect(serialized).not.toMatch(/source_|worksheet|status|ocr|moderator|created|imported/);
    }

    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ pageSize: "50", teacherId: String(teacherId) });
      if (cursor) query.set("cursor", cursor);
      const page = await SELF.fetch(`${origin}/api/courses/${courseId}/reviews?${query}`).then((response) =>
        response.json<{ items: Array<{ id: string }>; nextCursor: string | null }>(),
      );
      page.items.forEach((item) => seen.add(item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(522);
    expect(seen).toEqual(new Set(rows.map((row) => `historical:${row.review_id}`)));
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
