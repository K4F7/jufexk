import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
} from "./ordinary-write-session";

const origin = "https://example.com";

async function adminHeaders() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `198.18.61.${Math.floor(Math.random() * 200) + 1}`,
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

async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function officialPackage(
  pairs: Array<{ courseCode: string; teacherLabel: string }>,
) {
  const artifact = `${pairs
    .map((pair) =>
      JSON.stringify({
        schema_version: "legacy-catalog-addition-request-v1",
        request_kind: "relation",
        catalog_course_code: pair.courseCode,
        catalog_teacher_label: pair.teacherLabel,
        reason: "approved_catalog_relation_missing",
        terminal_status: "owner_review_required",
      }),
    )
    .join("\n")}\n`;
  const files = {
    "catalog-addition-requests.jsonl": {
      rows: pairs.length,
      sha256: await digest(artifact),
    },
  };
  const manifest = JSON.stringify({
    contract_version: "legacy-issue111-relation-addition-v1",
    status: "package_ready_for_owner_review",
    counts: { relations: 61, reviews: 164 },
    files,
  });
  return { manifest, artifact };
}

async function seedPairs(prefix: string, count = 61) {
  const pairs: Array<{ courseCode: string; teacherLabel: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const courseCode = `${prefix}-C${String(index).padStart(3, "0")}`;
    const teacherLabel = `${prefix}-T${String(index).padStart(3, "0")}`;
    await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,?)",
    )
      .bind(courseCode, `关系课${index}`, "general", "测试学院")
      .run();
    await env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    )
      .bind(teacherLabel, teacherLabel, "测试学院")
      .run();
    pairs.push({ courseCode, teacherLabel });
  }
  return pairs;
}

async function catalogCounts() {
  return env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM courses) courses,
       (SELECT COUNT(*) FROM teachers) teachers,
       (SELECT COUNT(*) FROM course_teachers) relations`,
  ).first<{ courses: number; teachers: number; relations: number }>();
}

async function cleanupPairs(pairs: Array<{ courseCode: string; teacherLabel: string }>) {
  for (const pair of pairs) {
    const course = await env.DB.prepare("SELECT id FROM courses WHERE code=?")
      .bind(pair.courseCode)
      .first<{ id: number }>();
    const teacher = await env.DB.prepare(
      "SELECT id FROM teachers WHERE source_teacher_label=?",
    )
      .bind(pair.teacherLabel)
      .first<{ id: number }>();
    if (course)
      await env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?")
        .bind(course.id)
        .run();
    if (course)
      await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(course.id).run();
    if (teacher)
      await env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacher.id).run();
  }
}

describe("official relation-only catalog additions", () => {
  it("previews and appends 61 relations without touching identities, then stays idempotent", async () => {
    const prefix = `REL${Date.now()}`;
    const pairs = await seedPairs(prefix);
    const headers = await adminHeaders();
    const before = await catalogCounts();
    const body = await officialPackage(pairs);
    try {
      const preview = await SELF.fetch(
        `${origin}/api/admin/catalog-relation-additions/preview`,
        { method: "POST", headers, body: JSON.stringify(body) },
      );
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({
        mode: "preview",
        pairs: 61,
        created: 0,
        coursesPresent: 61,
        teachersPresent: 61,
        relationsAbsent: 61,
        relationsPresent: 0,
        failures: [],
      });

      const created = await SELF.fetch(
        `${origin}/api/admin/catalog-relation-additions`,
        { method: "POST", headers, body: JSON.stringify(body) },
      );
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({
        mode: "apply",
        created: 61,
        existing: 0,
      });

      const after = await catalogCounts();
      expect(after?.courses).toBe(before?.courses);
      expect(after?.teachers).toBe(before?.teachers);
      expect(after?.relations).toBe((before?.relations || 0) + 61);

      const replay = await SELF.fetch(
        `${origin}/api/admin/catalog-relation-additions`,
        { method: "POST", headers, body: JSON.stringify(body) },
      );
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({
        created: 0,
        existing: 61,
      });
      expect((await catalogCounts())?.relations).toBe(after?.relations);
    } finally {
      await cleanupPairs(pairs);
    }
  }, 20000);

  it("stops the whole official batch when any identity is missing or mixed", async () => {
    const prefix = `MIX${Date.now()}`;
    const pairs = await seedPairs(prefix);
    const headers = await adminHeaders();
    const before = await catalogCounts();
    try {
      const missingTeacher = await officialPackage([
        ...pairs.slice(0, 60),
        { courseCode: pairs[60].courseCode, teacherLabel: "不存在的教师" },
      ]);
      const missing = await SELF.fetch(
        `${origin}/api/admin/catalog-relation-additions`,
        { method: "POST", headers, body: JSON.stringify(missingTeacher) },
      );
      expect(missing.status).toBe(422);
      expect((await catalogCounts())?.relations).toBe(before?.relations);

      const course = await env.DB.prepare("SELECT id FROM courses WHERE code=?")
        .bind(pairs[0].courseCode)
        .first<{ id: number }>();
      const teacher = await env.DB.prepare(
        "SELECT id FROM teachers WHERE source_teacher_label=?",
      )
        .bind(pairs[0].teacherLabel)
        .first<{ id: number }>();
      await env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
      )
        .bind(course!.id, teacher!.id)
        .run();
      const mixed = await SELF.fetch(
        `${origin}/api/admin/catalog-relation-additions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(await officialPackage(pairs)),
        },
      );
      expect(mixed.status).toBe(422);
      expect((await catalogCounts())?.relations).toBe((before?.relations || 0) + 1);
    } finally {
      await cleanupPairs(pairs);
    }
  }, 20000);

  it("keeps the redundant pairs import and refuses the old merge/skip CSV", async () => {
    const prefix = `RED${Date.now()}`;
    const [pair] = await seedPairs(prefix, 1);
    const headers = await adminHeaders();
    const before = await catalogCounts();
    try {
      const payload = {
        pairs: [
          {
            courseCode: pair.courseCode,
            sourceTeacherLabel: pair.teacherLabel,
          },
        ],
      };
      const preview = await SELF.fetch(
        `${origin}/api/admin/import/relations/preview`,
        { method: "POST", headers, body: JSON.stringify(payload) },
      );
      expect(preview.status).toBe(200);
      const created = await SELF.fetch(`${origin}/api/admin/import/relations`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ created: 1, existing: 0 });
      expect((await catalogCounts())?.courses).toBe(before?.courses);
      expect((await catalogCounts())?.teachers).toBe(before?.teachers);
      expect((await catalogCounts())?.relations).toBe((before?.relations || 0) + 1);

      for (const path of ["/api/admin/import/preview", "/api/admin/import"]) {
        const blocked = await SELF.fetch(`${origin}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            type: "courses",
            rows: [{ code: "BYPASS", name: "绕过", category: "general" }],
          }),
        });
        expect(blocked.status).toBe(409);
      }
    } finally {
      await cleanupPairs([pair]);
    }
  });

  it("rejects pairs on the official route and does not change the baseline marker", async () => {
    const hash = "e".repeat(64);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO catalog_baseline_marker(
        singleton,batch_id,approved_schema_version,approved_manifest_content_sha256,artifact_sha256,
        source_capture_manifest_content_sha256,derivation_content_sha256,quality_manifest_content_sha256,
        decisions_sha256,boundary_fixture_content_sha256,courses,teachers,relations
      ) VALUES(1,'relation-marker-test','catalog-baseline-approved-manifest/v1',?,?,?,?,?,?,?,3740,1951,11482)`,
    )
      .bind(hash, "f".repeat(64), "1".repeat(64), "2".repeat(64), "3".repeat(64), "4".repeat(64), "5".repeat(64))
      .run();
    const prefix = `PIN${Date.now()}`;
    const pairs = await seedPairs(prefix);
    const headers = await adminHeaders();
    const beforeMarker = await env.DB.prepare(
      "SELECT approved_manifest_content_sha256,artifact_sha256,courses,teachers,relations FROM catalog_baseline_marker WHERE singleton=1",
    ).first();
    try {
      const pairsOnly = await SELF.fetch(
        `${origin}/api/admin/catalog-relation-additions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            pairs: [{ courseCode: pairs[0].courseCode, sourceTeacherLabel: pairs[0].teacherLabel }],
          }),
        },
      );
      expect(pairsOnly.status).toBe(422);

      const writer = await ordinaryWriteSession("relation-addition-writer");
      const relationRequest = await SELF.fetch(`${origin}/api/catalog-requests`, {
        method: "POST",
        headers: {
          ...ordinaryWriteHeaders(writer),
          "CF-Connecting-IP": "198.18.61.250",
        },
        body: JSON.stringify({
          kind: "relation",
          courseCode: pairs[0].courseCode,
          teacherSourceLabel: pairs[0].teacherLabel,
        }),
      });
      expect(relationRequest.status).toBe(400);

      const created = await SELF.fetch(
        `${origin}/api/admin/catalog-relation-additions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(await officialPackage(pairs)),
        },
      );
      expect(created.status).toBe(201);
      const afterMarker = await env.DB.prepare(
        "SELECT approved_manifest_content_sha256,artifact_sha256,courses,teachers,relations FROM catalog_baseline_marker WHERE singleton=1",
      ).first();
      expect(afterMarker).toEqual(beforeMarker);
    } finally {
      await cleanupPairs(pairs);
    }
  }, 20000);

  it("still works after the catalog baseline marker is published", async () => {
    const hash = "c".repeat(64);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO catalog_baseline_marker(
        singleton,batch_id,approved_schema_version,approved_manifest_content_sha256,artifact_sha256,
        source_capture_manifest_content_sha256,derivation_content_sha256,quality_manifest_content_sha256,
        decisions_sha256,boundary_fixture_content_sha256,courses,teachers,relations
      ) VALUES(1,'relation-append-test','catalog-baseline-approved-manifest/v1',?,?,?,?,?,?,?,1,1,1)`,
    )
      .bind(hash, "d".repeat(64), "e".repeat(64), "f".repeat(64), "1".repeat(64), "2".repeat(64), "3".repeat(64))
      .run();
    const prefix = `BASE${Date.now()}`;
    const [pair] = await seedPairs(prefix, 1);
    const headers = await adminHeaders();
    try {
      expect(
        (
          await SELF.fetch(`${origin}/api/admin/courses/1/teachers`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ teacherIds: [1] }),
          })
        ).status,
      ).toBe(409);
      const created = await SELF.fetch(`${origin}/api/admin/import/relations`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          pairs: [
            { courseCode: pair.courseCode, sourceTeacherLabel: pair.teacherLabel },
          ],
        }),
      });
      expect(created.status).toBe(201);
    } finally {
      await cleanupPairs([pair]);
    }
  });
});
