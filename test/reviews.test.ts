import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  CURRENT_SCORES,
  CURRENT_SCORES_JSON,
  REQUIRED_HEADLINE,
  REQUIRED_NOTE,
  TIER3_QUESTIONS,
  V1_OFFLINE_SCORES,
  V3_OFFLINE_SCORES,
  V3_OFFLINE_SCORES_JSON,
  V3_QUESTIONS,
} from "./review-score-fixtures";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
  type OrdinaryWriteSession,
} from "./ordinary-write-session";

const origin = "https://example.com";
let ipSequence = 20;
let writeSession: OrdinaryWriteSession | undefined;

async function submit(body: Record<string, unknown>) {
  writeSession ??= await ordinaryWriteSession("review-scheme-writer");
  return SELF.fetch(`${origin}/api/reviews`, {
    method: "POST",
    headers: {
      ...ordinaryWriteHeaders(writeSession),
      "CF-Connecting-IP": `203.0.113.${ipSequence++}`,
    },
    body: JSON.stringify({
      comment: REQUIRED_NOTE,
      headline: REQUIRED_HEADLINE,
      ...body,
    }),
  });
}

async function createBoundCourse(
  category: string,
  code: string,
  extras: { schemeKey?: string; mooc?: boolean } = {},
) {
  const course = await env.DB.prepare(
    extras.schemeKey
      ? "INSERT INTO courses(code,name,category,department,scheme_key) VALUES(?,?,?,'测试学院',?)"
      : "INSERT INTO courses(code,name,category,department) VALUES(?,?,?,'测试学院')",
  )
    .bind(
      ...(extras.schemeKey
        ? [code, `${category} 测试课 ${code}`, category, extras.schemeKey]
        : [code, `${category} 测试课 ${code}`, category]),
    )
    .run();
  const courseId = Number(course.meta.last_row_id);
  await env.DB.prepare(
    "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
  )
    .bind(courseId)
    .run();
  if (extras.mooc) {
    await env.DB.prepare(
      "INSERT INTO course_tags(course_id,tag) VALUES(?,'mooc')",
    )
      .bind(courseId)
      .run();
  }
  return courseId;
}

async function insertedReview(courseId: number) {
  return env.DB.prepare(
    "SELECT scheme_key,scheme_version,scores,overall,comment,comment_format,headline,grade,status,author_user_id FROM reviews WHERE course_id=? ORDER BY id DESC LIMIT 1",
  )
    .bind(courseId)
    .first<{
      scheme_key: string | null;
      scheme_version: number | null;
      scores: string | null;
      overall: number;
      comment: string;
      comment_format: string | null;
      headline: string;
      grade: string | null;
      status: string;
      author_user_id: string | null;
    }>();
}

describe("review submission required scheme scores", () => {
  it("rejects overall-only submissions that omit applicable dimensions", async () => {
    const courseId = await createBoundCourse("general", "REQ001");
    const response = await submit({ courseId, teacherId: 1, overall: 4 });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "请答完本次适用的评分题" });
  });

  it("accepts the five three-tier scores plus overall and snapshots scheme fields", async () => {
    const courseId = await createBoundCourse("general", "REQ002");
    const response = await submit({
      courseId,
      teacherId: 1,
      overall: 5,
      scores: V3_OFFLINE_SCORES,
      schemeKey: "pe",
      schemeVersion: 99,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(await insertedReview(courseId)).toMatchObject({
      scheme_key: "major",
      scheme_version: 3,
      scores: V3_OFFLINE_SCORES_JSON,
      overall: 5,
      comment: REQUIRED_NOTE,
      headline: REQUIRED_HEADLINE,
      grade: null,
      status: "approved",
      author_user_id: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("requires attendance for offline v3 courses and rejects out-of-option scores", async () => {
    const courseId = await createBoundCourse("general", "REQ003");
    const missing = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: { difficulty: 1, homework: 2, grading: 3 },
    });
    expect(missing.status).toBe(400);
    // 旧四维提交缺 attendance：v3 线下课必答考勤。
    const noAttendance = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: CURRENT_SCORES,
    });
    expect(noAttendance.status).toBe(400);
    expect(await noAttendance.json()).toMatchObject({
      error: "请答完本次适用的评分题",
    });
    const range = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: { ...V3_OFFLINE_SCORES, grading: 5 },
    });
    expect(range.status).toBe(400);
    expect(await range.json()).toMatchObject({
      error: "评分必须是题目给出的选项",
    });
  });

  it("accepts a mooc course without attendance and rejects an attendance key for it", async () => {
    const courseId = await createBoundCourse("general", "REQ-MOOC", {
      mooc: true,
    });
    const accepted = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: CURRENT_SCORES,
    });
    expect(accepted.status).toBe(200);
    expect(await insertedReview(courseId)).toMatchObject({
      scheme_key: "major",
      scheme_version: 3,
      scores: CURRENT_SCORES_JSON,
    });
    const leftover = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: { ...CURRENT_SCORES, attendance: 3 },
      term: "2026 秋",
    });
    expect(leftover.status).toBe(400);
    expect(await leftover.json()).toMatchObject({
      error: "提交了不适用的评分维度",
    });
    const oldKeys = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V1_OFFLINE_SCORES,
      term: "2026 冬",
    });
    expect(oldKeys.status).toBe(400);
  });

  it("rejects a trimmed review note shorter than 10 characters", async () => {
    const courseId = await createBoundCourse("general", "REQ004");
    const empty = await submit({
      courseId,
      teacherId: 1,
      overall: 3,
      scores: V3_OFFLINE_SCORES,
      comment: "",
    });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({
      error: "请填写至少 10 字补充说明",
    });
    const short = await submit({
      courseId,
      teacherId: 1,
      overall: 3,
      scores: V3_OFFLINE_SCORES,
      comment: "  123456789  ",
    });
    expect(short.status).toBe(400);
  });

  it("stores sanitized rich-text notes with the html format marker", async () => {
    const courseId = await createBoundCourse("general", "REQ-HTML");
    const response = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      comment:
        '<p>这门课的<strong>给分</strong>很宽松</p><ul><li>作业少</li></ul><script>alert(1)</script><p onclick="x">结尾</p>',
    });
    expect(response.status).toBe(200);
    const stored = await insertedReview(courseId);
    expect(stored).toMatchObject({
      comment:
        "<p>这门课的<strong>给分</strong>很宽松</p><ul><li>作业少</li></ul><p>结尾</p>",
      comment_format: "html",
    });
    const feed = await SELF.fetch(
      `${origin}/api/courses/${courseId}/reviews?teacherId=1`,
    );
    const items = (
      (await feed.json()) as {
        items: Array<{ comment: string; comment_format: string | null }>;
      }
    ).items;
    expect(items[0]?.comment).toBe(stored?.comment);
    expect(items[0]?.comment_format).toBe("html");
    expect(items[0]?.comment).not.toContain("script");
    expect(items[0]?.comment).not.toContain("onclick");
  });

  it("keeps script-bypassed plain text plain and rejects markup-only notes", async () => {
    const courseId = await createBoundCourse("general", "REQ-PLAIN");
    const plain = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      comment: "绕过前端直接提交的纯文本，数学 < 语文",
    });
    expect(plain.status).toBe(200);
    expect(await insertedReview(courseId)).toMatchObject({
      comment: "绕过前端直接提交的纯文本，数学 < 语文",
      comment_format: null,
    });

    const markupOnly = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      comment: "<script>alert(1)</script>",
      term: "2026 春",
    });
    expect(markupOnly.status).toBe(400);
    expect(await markupOnly.json()).toMatchObject({
      error: "请填写至少 10 字补充说明",
    });

    const padded = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      comment: `<p><strong>一二三四五六七八九</strong></p>`,
      term: "2026 夏",
    });
    expect(padded.status).toBe(400);
  });

  it("puts a submitted note into the public course-teacher text feed immediately", async () => {
    const courseId = await createBoundCourse("general", "REQ-LIVE");
    const comment = "提交后立刻出现在评价流";
    const response = await submit({
      courseId,
      teacherId: 1,
      overall: 5,
      scores: V3_OFFLINE_SCORES,
      comment,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      message: "评价已发布",
    });
    const feed = await SELF.fetch(
      `${origin}/api/courses/${courseId}/reviews?teacherId=1`,
    );
    expect(feed.status).toBe(200);
    expect(
      ((await feed.json()) as { items: Array<{ comment: string }> }).items.map(
        (item) => item.comment,
      ),
    ).toContain(comment);
  });

  it("uses pe for unclassified sports courses and the stored key when classified", async () => {
    const sportsId = await createBoundCourse("sports", "REQ-PE");
    const sports = await submit({
      courseId: sportsId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
    });
    expect(sports.status).toBe(200);
    expect(await insertedReview(sportsId)).toMatchObject({
      scheme_key: "pe",
      scheme_version: 3,
    });

    const ideologyId = await createBoundCourse("general", "REQ-IDEO", {
      schemeKey: "ideology",
    });
    const ideology = await submit({
      courseId: ideologyId,
      teacherId: 1,
      overall: 5,
      scores: V3_OFFLINE_SCORES,
    });
    expect(ideology.status).toBe(200);
    expect(await insertedReview(ideologyId)).toMatchObject({
      scheme_key: "ideology",
      scheme_version: 3,
    });
  });

  it("does not backfill scheme fields on existing review rows", async () => {
    const inserted = await env.DB.prepare(
      "INSERT INTO reviews(course_id,teacher_id,category,overall,comment,submitter_hash) VALUES(1,1,'general',4,'旧评价','old-row')",
    ).run();
    const row = await env.DB.prepare(
      "SELECT scheme_key,scheme_version,scores FROM reviews WHERE id=?",
    )
      .bind(Number(inserted.meta.last_row_id))
      .first();
    expect(row).toEqual({
      scheme_key: null,
      scheme_version: null,
      scores: null,
    });
  });

  it("rejects a submission without an overall rating", async () => {
    const courseId = await createBoundCourse("general", "REQ005");
    const response = await submit({
      courseId,
      teacherId: 1,
      scores: V3_OFFLINE_SCORES,
    });
    expect(response.status).toBe(400);
  });

  it("rejects a course-teacher pair that is not in the catalog", async () => {
    const course = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES('REQ006','未绑定课','general','测试学院')",
    ).run();
    const response = await submit({
      courseId: Number(course.meta.last_row_id),
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
    });
    expect(response.status).toBe(400);
  });

  it("rejects an invalid optional offering id", async () => {
    const response = await submit({
      courseId: 1,
      teacherId: 1,
      offeringId: 0,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
    });
    expect(response.status).toBe(400);
  });

  it("requires a matching course when an offering is selected", async () => {
    const missingCourse = await submit({
      teacherId: 1,
      offeringId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
    });
    expect(missingCourse.status).toBe(400);

    const mismatchedCourse = await submit({
      courseId: 2,
      teacherId: 1,
      offeringId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
    });
    expect(mismatchedCourse.status).toBe(400);
  });

  it("requires the offering course-teacher relation as well", async () => {
    const course = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES('REQ007','开课关系缺失','general','测试学院')",
    ).run();
    const courseId = Number(course.meta.last_row_id);
    const offering = await env.DB.prepare(
      "INSERT INTO offerings(course_id,term,section,status) VALUES(?,?,?,'active')",
    )
      .bind(courseId, "2026 秋", "A")
      .run();
    const offeringId = Number(offering.meta.last_row_id);
    await env.DB.prepare(
      "INSERT INTO offering_teachers(offering_id,teacher_id) VALUES(?,1)",
    )
      .bind(offeringId)
      .run();
    try {
      const response = await submit({
        courseId,
        offeringId,
        teacherId: 1,
        overall: 4,
        scores: V3_OFFLINE_SCORES,
      });
      expect(response.status).toBe(400);
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM offering_teachers WHERE offering_id=?").bind(
          offeringId,
        ),
        env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(offeringId),
        env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId),
      ]);
    }
  });
});

describe("review headline and optional grade (issue #444)", () => {
  it("rejects a missing, blank, or non-string headline with 400", async () => {
    const courseId = await createBoundCourse("general", "HL001");
    const missing = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      headline: undefined,
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: "请填写一句话总结本课",
    });

    const blank = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      headline: "   ",
    });
    expect(blank.status).toBe(400);

    const nonString = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      headline: 42,
    });
    expect(nonString.status).toBe(400);
  });

  it("rejects a headline longer than 80 characters", async () => {
    const courseId = await createBoundCourse("general", "HL002");
    const response = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      headline: "长".repeat(81),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "一句话总结不能超过 80 字",
    });
    const exact = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      headline: "准".repeat(80),
    });
    expect(exact.status).toBe(200);
  });

  it("trims and stores the headline; grade stays null when omitted or blank", async () => {
    const courseId = await createBoundCourse("general", "HL003");
    const omitted = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      headline: "  划重点多的课  ",
    });
    expect(omitted.status).toBe(200);
    expect(await insertedReview(courseId)).toMatchObject({
      headline: "划重点多的课",
      grade: null,
    });

    const blank = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      grade: "   ",
    });
    expect(blank.status).toBe(200);
    expect(await insertedReview(courseId)).toMatchObject({ grade: null });
  });

  it("stores a trimmed grade and rejects grades longer than 20 characters", async () => {
    const courseId = await createBoundCourse("general", "HL004");
    const oversize = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      grade: "9".repeat(21),
    });
    expect(oversize.status).toBe(400);
    expect(await oversize.json()).toMatchObject({
      error: "成绩不能超过 20 字",
    });

    const accepted = await submit({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: V3_OFFLINE_SCORES,
      grade: "  A-  ",
    });
    expect(accepted.status).toBe(200);
    expect(await insertedReview(courseId)).toMatchObject({ grade: "A-" });
  });

  it("projects headline and grade into the public feed and the latest stream", async () => {
    const courseId = await createBoundCourse("general", "HL005");
    const response = await submit({
      courseId,
      teacherId: 1,
      overall: 5,
      scores: V3_OFFLINE_SCORES,
      headline: "HL005 一句话",
      grade: "95",
    });
    expect(response.status).toBe(200);

    const feed = await SELF.fetch(
      `${origin}/api/courses/${courseId}/reviews?teacherId=1`,
    );
    expect(feed.status).toBe(200);
    const feedItems = (
      (await feed.json()) as {
        items: Array<{ headline?: string; grade?: string | null }>;
      }
    ).items;
    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]).toMatchObject({ headline: "HL005 一句话", grade: "95" });

    const latest = await SELF.fetch(`${origin}/api/reviews/latest?pageSize=50`);
    expect(latest.status).toBe(200);
    const latestItems = (
      (await latest.json()) as {
        items: Array<{ id: string; headline?: string; grade?: string | null }>;
      }
    ).items;
    const own = latestItems.find((item) => item.headline === "HL005 一句话");
    expect(own).toBeTruthy();
    expect(own).toMatchObject({ grade: "95" });
  });

  it("keeps old rows without headline or grade additive-safe in public payloads", async () => {
    const courseId = await createBoundCourse("general", "HL006");
    await env.DB.prepare(
      "INSERT INTO reviews(course_id,teacher_id,category,overall,comment,status,submitter_hash) VALUES(?,1,'general',4,'旧行没有一句话总结','approved','hl006-old')",
    )
      .bind(courseId)
      .run();

    const feed = await SELF.fetch(
      `${origin}/api/courses/${courseId}/reviews?teacherId=1`,
    );
    const items = (
      (await feed.json()) as {
        items: Array<{ headline?: string; grade?: string | null }>;
      }
    ).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.headline).toBe("");
    expect(items[0]).not.toHaveProperty("grade");

    const latest = await SELF.fetch(`${origin}/api/reviews/latest?pageSize=50`);
    const latestItems = (
      (await latest.json()) as {
        items: Array<{ comment: string; headline?: string }>;
      }
    ).items;
    const own = latestItems.find(
      (item) => item.comment === "旧行没有一句话总结",
    );
    expect(own?.headline).toBe("");
    expect(own).not.toHaveProperty("grade");
  });
});

describe("course scheme reads for submit", () => {
  it("returns five questions for offline major/pe and four without attendance for mooc", async () => {
    type Question = (typeof V3_QUESTIONS)[number];

    const majorId = await createBoundCourse("general", "OPT-MAJOR");
    const peId = await createBoundCourse("sports", "OPT-PE");
    const moocId = await createBoundCourse("general", "OPT-MOOC", {
      mooc: true,
    });

    const [major, pe, mooc] = await Promise.all(
      [majorId, peId, moocId].map((id) =>
        SELF.fetch(`${origin}/api/courses/${id}`).then((response) =>
          response.json<{
            course: {
              schemeKey: string;
              schemeVersion: number;
              tags: string[];
              applicableQuestions: Question[];
            };
          }>(),
        ),
      ),
    );

    expect(major.course).toMatchObject({
      schemeKey: "major",
      schemeVersion: 3,
      tags: [],
    });
    expect(pe.course).toMatchObject({
      schemeKey: "pe",
      schemeVersion: 3,
      tags: [],
    });
    expect(mooc.course).toMatchObject({
      schemeKey: "major",
      schemeVersion: 3,
      tags: ["mooc"],
    });
    expect(major.course.applicableQuestions).toEqual(V3_QUESTIONS);
    expect(pe.course.applicableQuestions).toEqual(V3_QUESTIONS);
    expect(mooc.course.applicableQuestions).toEqual(TIER3_QUESTIONS);

    const options = await SELF.fetch(
      `${origin}/api/courses/options?q=${encodeURIComponent("OPT-MOOC")}`,
    );
    const optionsBody = await options.json<{
      items: Array<{
        schemeKey: string;
        tags: string[];
        applicableQuestions: Question[];
      }>;
    }>();
    expect(optionsBody.items[0]).toMatchObject({
      schemeKey: "major",
      tags: ["mooc"],
    });
    expect(optionsBody.items[0].applicableQuestions).toEqual(TIER3_QUESTIONS);
  });
});
