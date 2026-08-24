import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { adminLogin as login, adminHeaders } from "./admin-session";
import {
  CURRENT_SCORES,
  CURRENT_SCORES_JSON,
  REQUIRED_HEADLINE,
  REQUIRED_NOTE,
  V1_OFFLINE_SCORES,
  V3_OFFLINE_SCORES,
  V3_OFFLINE_SCORES_JSON,
} from "./review-score-fixtures";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
  type OrdinaryWriteSession,
} from "./ordinary-write-session";

const origin = "https://example.com";
let ipSequence = 80;


let writeSession: OrdinaryWriteSession | undefined;

async function submit(body: Record<string, unknown>) {
  writeSession ??= await ordinaryWriteSession("admin-scheme-writer");
  return SELF.fetch(`${origin}/api/reviews`, {
    method: "POST",
    headers: {
      ...ordinaryWriteHeaders(writeSession),
      "CF-Connecting-IP": `203.0.113.${ipSequence++}`,
    },
    body: JSON.stringify({ headline: REQUIRED_HEADLINE, ...body }),
  });
}

async function readCourse(id: number) {
  const auth = await login();
  const response = await SELF.fetch(`${origin}/api/admin/courses`, {
    headers: { Cookie: auth.cookie },
  });
  expect(response.status).toBe(200);
  const courses = await response.json<
    Array<{ id: number; scheme_key: string | null; tags: string[] }>
  >();
  return courses.find((course) => course.id === id);
}

describe("admin review scheme and mooc tag maintenance", () => {
  it("writes one of six scheme keys and reads it back", async () => {
    const auth = await login();
    const created = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        code: "ADM-SCHEME-1",
        name: "管理规则课",
        category: "general",
        schemeKey: "ideology",
      }),
    });
    expect(created.status).toBe(200);
    const { id } = await created.json<{ id: number }>();
    expect(await readCourse(id)).toMatchObject({
      scheme_key: "ideology",
      tags: [],
    });

    const updated = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        id,
        code: "ADM-SCHEME-1",
        name: "管理规则课",
        category: "general",
        schemeKey: "english",
      }),
    });
    expect(updated.status).toBe(200);
    expect(await readCourse(id)).toMatchObject({
      scheme_key: "english",
      tags: [],
    });
  });

  it("adds and removes the mooc tag with a consistent readback", async () => {
    const auth = await login();
    const created = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        code: "ADM-MOOC-1",
        name: "管理网课",
        category: "general",
        schemeKey: "math",
        tags: ["mooc"],
      }),
    });
    expect(created.status).toBe(200);
    const { id } = await created.json<{ id: number }>();
    expect(await readCourse(id)).toMatchObject({
      scheme_key: "math",
      tags: ["mooc"],
    });

    const cleared = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        id,
        code: "ADM-MOOC-1",
        name: "管理网课",
        category: "general",
        tags: [],
      }),
    });
    expect(cleared.status).toBe(200);
    expect(await readCourse(id)).toMatchObject({
      scheme_key: "math",
      tags: [],
    });
  });

  it("rejects invalid scheme keys and unknown tags", async () => {
    const auth = await login();
    const badScheme = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        code: "ADM-BAD-SCHEME",
        name: "非法规则",
        category: "general",
        schemeKey: "mooc",
      }),
    });
    expect(badScheme.status).toBe(400);
    expect(await badScheme.json()).toMatchObject({ error: "评价规则无效" });

    const badTag = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        code: "ADM-BAD-TAG",
        name: "非法标签",
        category: "general",
        tags: ["online"],
      }),
    });
    expect(badTag.status).toBe(400);
    expect(await badTag.json()).toMatchObject({ error: "未知课程标签" });
  });

  it("uses the updated applicable set for new submits and leaves old snapshots alone", async () => {
    const auth = await login();
    const created = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        code: "ADM-SNAP-1",
        name: "快照课",
        category: "general",
        schemeKey: "major",
        teacherIds: [1],
      }),
    });
    expect(created.status).toBe(200);
    const { id } = await created.json<{ id: number }>();

    const first = await submit({
      courseId: id,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      comment: REQUIRED_NOTE,
    });
    expect(first.status).toBe(200);
    const before = await env.DB.prepare(
      "SELECT id,scheme_key,scheme_version,scores FROM reviews WHERE course_id=? ORDER BY id DESC LIMIT 1",
    )
      .bind(id)
      .first<{
        id: number;
        scheme_key: string;
        scheme_version: number;
        scores: string;
      }>();
    expect(before).toMatchObject({
      scheme_key: "major",
      scheme_version: 3,
      scores: V3_OFFLINE_SCORES_JSON,
    });

    const updated = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        id,
        code: "ADM-SNAP-1",
        name: "快照课",
        category: "general",
        schemeKey: "ideology",
        tags: ["mooc"],
      }),
    });
    expect(updated.status).toBe(200);

    const leftoverV1 = await submit({
      courseId: id,
      teacherId: 1,
      overall: 5,
      scores: V1_OFFLINE_SCORES,
      comment: REQUIRED_NOTE,
    });
    expect(leftoverV1.status).toBe(400);

    const latestOk = await submit({
      courseId: id,
      teacherId: 1,
      overall: 5,
      scores: CURRENT_SCORES,
      comment: REQUIRED_NOTE,
    });
    expect(latestOk.status).toBe(200);

    const afterOld = await env.DB.prepare(
      "SELECT scheme_key,scheme_version,scores FROM reviews WHERE id=?",
    )
      .bind(before!.id)
      .first();
    expect(afterOld).toEqual({
      scheme_key: before!.scheme_key,
      scheme_version: before!.scheme_version,
      scores: before!.scores,
    });

    const newest = await env.DB.prepare(
      "SELECT scheme_key,scheme_version,scores FROM reviews WHERE course_id=? ORDER BY id DESC LIMIT 1",
    )
      .bind(id)
      .first();
    expect(newest).toMatchObject({
      scheme_key: "ideology",
      scheme_version: 3,
      scores: CURRENT_SCORES_JSON,
    });
  });

  it("shows scheme key and version on the admin review list", async () => {
    const inserted = await env.DB.prepare(
      `INSERT INTO reviews(
        course_id,teacher_id,category,overall,status,submitter_hash,comment,
        headline,grade,scheme_key,scheme_version
      ) VALUES(1,1,'general',4,'pending','admin-scheme-list','规则审核条目','审核一句话','W','pe',1)`,
    ).run();
    const auth = await login();
    const response = await SELF.fetch(
      `${origin}/api/admin/reviews?status=pending&q=${encodeURIComponent("规则审核条目")}`,
      { headers: { Cookie: auth.cookie } },
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      items: Array<{
        scheme_key: string;
        scheme_version: number;
        comment: string;
        headline: string;
        grade: string | null;
      }>;
    }>();
    expect(body.items[0]).toMatchObject({
      comment: "规则审核条目",
      headline: "审核一句话",
      grade: "W",
      scheme_key: "pe",
      scheme_version: 1,
    });
    await env.DB.prepare("DELETE FROM reviews WHERE id=?")
      .bind(Number(inserted.meta.last_row_id))
      .run();
  });
});
