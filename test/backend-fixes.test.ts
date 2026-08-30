import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { adminLogin as login, adminHeaders } from "./admin-session";
import {
  REQUIRED_HEADLINE,
  REQUIRED_NOTE,
  CURRENT_SCORES,
} from "./review-score-fixtures";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
  type OrdinaryWriteSession,
} from "./ordinary-write-session";

const origin = "https://example.com";
let ipSequence = 180;
let uniqueSequence = 1;

function unique(prefix: string) {
  return `${prefix}-${uniqueSequence++}`;
}


let writeSession: OrdinaryWriteSession | undefined;

async function submitReviewFromIp(body: Record<string, unknown>, ip: string) {
  writeSession ??= await ordinaryWriteSession("backend-fixes-writer");
  return SELF.fetch(`${origin}/api/reviews`, {
    method: "POST",
    headers: {
      ...ordinaryWriteHeaders(writeSession),
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify({
      comment: REQUIRED_NOTE,
      headline: REQUIRED_HEADLINE,
      ...body,
    }),
  });
}

function submitReview(body: Record<string, unknown>) {
  return submitReviewFromIp(body, `203.0.113.${ipSequence++}`);
}

async function insertCourse(
  code: string,
  category = "general",
  credits: number | null = null,
) {
  const result = await env.DB.prepare(
    "INSERT INTO courses(code,name,category,department,credits) VALUES(?,?,?,'测试学院',?)",
  )
    .bind(code, `${code} 测试课程`, category, credits)
    .run();
  return Number(result.meta.last_row_id);
}

async function insertTeacher(name: string) {
  const result = await env.DB.prepare(
    "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?, '测试学院')",
  )
    .bind(name, name)
    .run();
  return Number(result.meta.last_row_id);
}

describe("backend regression fixes: fields and catalog relations", () => {
  it("clears retired scores when editing review text", async () => {
    const inserted = await env.DB.prepare(
      `INSERT INTO reviews(
        course_id,teacher_id,category,overall,
        interest,practicality,workload_score,fairness,organization,
        status,submitter_hash
      ) VALUES(1,1,'general',4,3,4,2,5,1,'pending','backend-fix-1')`,
    ).run();
    const id = Number(inserted.meta.last_row_id);
    const auth = await login();
    const response = await SELF.fetch(
      `${origin}/api/admin/reviews/${id}/content`,
      {
        method: "PATCH",
        headers: adminHeaders(auth),
        body: JSON.stringify({ comment: "只修改文字", note: "回归测试" }),
      },
    );
    expect(response.status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT interest,practicality,workload_score,fairness,organization FROM reviews WHERE id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({
      interest: null,
      practicality: null,
      workload_score: 2,
      fairness: 5,
      organization: null,
    });
    await env.DB.prepare("DELETE FROM reviews WHERE id=?").bind(id).run();
  });

  it("preserves omitted course credits and rejects negative credits", async () => {
    const code = unique("CREDIT");
    const courseId = await insertCourse(code, "general", 3);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
    )
      .bind(courseId)
      .run();
    const auth = await login();
    const update = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        id: courseId,
        code,
        name: `${code} 测试课程`,
        category: "general",
        department: "测试学院",
        description: "编辑文字",
        teacherIds: [1],
      }),
    });
    expect(update.status).toBe(200);
    expect(
      await env.DB.prepare("SELECT credits FROM courses WHERE id=?")
        .bind(courseId)
        .first(),
    ).toEqual({ credits: 3 });

    const negative = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        id: courseId,
        code,
        name: `${code} 测试课程`,
        category: "general",
        credits: -1,
        teacherIds: [1],
      }),
    });
    expect(negative.status).toBe(400);
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
  });

  it("rejects an offering teacher who is not a course teacher", async () => {
    const auth = await login();
    const term = unique("非法学期");
    const section = unique("非法班");
    const response = await SELF.fetch(`${origin}/api/admin/offerings`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        courseId: 2,
        term,
        section,
        teacherIds: [1],
      }),
    });
    expect(response.status).toBe(400);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM offerings WHERE course_id=2 AND term=? AND section=?",
      )
        .bind(term, section)
        .first(),
    ).toEqual({ n: 0 });
  });

  it("does not remove an offering teacher referenced by a review", async () => {
    const code = unique("OFFERING");
    const courseId = await insertCourse(code);
    const teacherId = await insertTeacher(unique("第二教师"));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
      ).bind(courseId),
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
      ).bind(courseId, teacherId),
    ]);
    const auth = await login();
    const term = unique("2026春");
    const section = unique("评价班");
    const created = await SELF.fetch(`${origin}/api/admin/offerings`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        courseId,
        term,
        section,
        teacherIds: [1],
      }),
    });
    expect(created.status).toBe(200);
    const offeringId = (await created.json<{ id: number }>()).id;
    const submitted = await submitReview({
      courseId,
      offeringId,
      teacherId: 1,
      overall: 4,
      scores: CURRENT_SCORES,
      term: "伪造但应被覆盖",
    });
    expect(submitted.status).toBe(200);

    const update = await SELF.fetch(`${origin}/api/admin/offerings`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        id: offeringId,
        courseId,
        term,
        section,
        teacherIds: [teacherId],
      }),
    });
    expect(update.status).toBe(409);
    expect(
      await env.DB.prepare(
        "SELECT teacher_id FROM offering_teachers WHERE offering_id=?",
      )
        .bind(offeringId)
        .first(),
    ).toEqual({ teacher_id: 1 });
    await env.DB.prepare("DELETE FROM reviews WHERE offering_id=?")
      .bind(offeringId)
      .run();
    await env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(offeringId).run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
    await env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacherId).run();
  });

  it("protects a course-teacher relation referenced by a review", async () => {
    const code = unique("RELATION");
    const courseId = await insertCourse(code);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
    )
      .bind(courseId)
      .run();
    const submitted = await submitReview({
      courseId,
      teacherId: 1,
      overall: 5,
      scores: CURRENT_SCORES,
    });
    expect(submitted.status).toBe(200);
    const auth = await login();
    const put = await SELF.fetch(`${origin}/api/admin/courses/${courseId}/teachers`, {
      method: "PUT",
      headers: adminHeaders(auth),
      body: JSON.stringify({ teacherIds: [] }),
    });
    expect(put.status).toBe(409);
    expect(
      await env.DB.prepare(
        "SELECT teacher_id FROM course_teachers WHERE course_id=?",
      )
        .bind(courseId)
        .first(),
    ).toEqual({ teacher_id: 1 });

    const post = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        id: courseId,
        code,
        name: `${code} 测试课程`,
        category: "general",
        teacherIds: [],
      }),
    });
    expect(post.status).toBe(409);
    await env.DB.prepare("DELETE FROM reviews WHERE course_id=?").bind(courseId).run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
  });

  it("does not remove a course-teacher relation used by an offering", async () => {
    const code = unique("RELATION-OFFERING");
    const courseId = await insertCourse(code);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
    )
      .bind(courseId)
      .run();
    const offering = await env.DB.prepare(
      "INSERT INTO offerings(course_id,term,section,status) VALUES(?,?,?,'active')",
    )
      .bind(courseId, "2026 春", unique("关系班"))
      .run();
    await env.DB.prepare(
      "INSERT INTO offering_teachers(offering_id,teacher_id) VALUES(?,1)",
    )
      .bind(Number(offering.meta.last_row_id))
      .run();
    const auth = await login();
    const response = await SELF.fetch(`${origin}/api/admin/courses/${courseId}/teachers`, {
      method: "PUT",
      headers: adminHeaders(auth),
      body: JSON.stringify({ teacherIds: [] }),
    });
    expect(response.status).toBe(409);
    await env.DB.prepare("DELETE FROM offerings WHERE id=?")
      .bind(Number(offering.meta.last_row_id))
      .run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
  });
});

describe("backend regression fixes: moderation, deletion and submission", () => {
  it("uses a keyed pseudonym instead of a reversible plain IP digest", async () => {
    const ip = "203.0.113.250";
    const comment = unique("IP-HMAC");
    const response = await submitReviewFromIp(
      { courseId: 1, teacherId: 1, overall: 4, scores: CURRENT_SCORES, comment },
      ip,
    );
    expect(response.status).toBe(200);
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(ip),
    );
    const plainDigest = [...new Uint8Array(bytes)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const row = await env.DB.prepare(
      "SELECT submitter_hash FROM reviews WHERE comment=?",
    )
      .bind(comment)
      .first<{ submitter_hash: string }>();
    expect(row?.submitter_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row?.submitter_hash).not.toBe(plainDigest);
    await env.DB.prepare("DELETE FROM reviews WHERE comment=?").bind(comment).run();
  });

  it("atomically approves a catalog request and creates one attached review", async () => {
    const code = unique("CONCURRENT");
    writeSession ??= await ordinaryWriteSession("backend-fixes-writer");
    const submitted = await SELF.fetch(`${origin}/api/catalog-requests`, {
      method: "POST",
      headers: {
        ...ordinaryWriteHeaders(writeSession),
        "CF-Connecting-IP": `198.18.0.${ipSequence++}`,
      },
      body: JSON.stringify({
        kind: "course",
        courseCode: code,
        courseName: `${code} 申请课程`,
        category: "general",
        department: "测试学院",
        teacherSourceLabel: `${code} 申请教师`,
        review: {
          overall: 5,
          comment: `${code} 附带评价`,
          scores: CURRENT_SCORES,
        },
      }),
    });
    expect(submitted.status).toBe(200);
    const { id } = await submitted.json<{ id: number }>();
    const auth = await login();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        SELF.fetch(`${origin}/api/admin/catalog-requests/${id}`, {
          method: "PATCH",
          headers: adminHeaders(auth),
          body: JSON.stringify({ status: "approved" }),
        }).then(async (response) => ({
          status: response.status,
          body: await response.json<Record<string, unknown>>(),
        })),
      ),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(7);
    const requestRow = await env.DB.prepare(
      "SELECT status,created_course_id,created_teacher_id,created_review_id FROM catalog_requests WHERE id=?",
    )
      .bind(id)
      .first<{
        status: string;
        created_course_id: number;
        created_teacher_id: number;
        created_review_id: number;
      }>();
    expect(requestRow).toMatchObject({ status: "approved" });
    const reviewRow = await env.DB.prepare(
      "SELECT id,course_id,teacher_id FROM reviews WHERE comment=?",
    )
      .bind(`${code} 附带评价`)
      .first<{ id: number; course_id: number; teacher_id: number }>();
    expect(requestRow?.created_review_id).toBe(reviewRow?.id);
    expect(requestRow?.created_course_id).toBe(reviewRow?.course_id);
    expect(requestRow?.created_teacher_id).toBe(reviewRow?.teacher_id);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM reviews WHERE comment=?")
        .bind(`${code} 附带评价`)
        .first(),
    ).toEqual({ n: 1 });
    await env.DB.prepare("DELETE FROM catalog_requests WHERE id=?").bind(id).run();
    await env.DB.prepare("DELETE FROM reviews WHERE comment=?")
      .bind(`${code} 附带评价`)
      .run();
    await env.DB.prepare("DELETE FROM courses WHERE code=?").bind(code).run();
    await env.DB.prepare("DELETE FROM teachers WHERE name=?").bind(`${code} 申请教师`).run();
  });

  it("returns a conflict instead of a server error for catalog audit references", async () => {
    const code = unique("CATALOG-REF");
    const courseId = await insertCourse(code);
    const teacherName = unique("申请引用教师");
    const teacherId = await insertTeacher(teacherName);
    const request = await env.DB.prepare(
      `INSERT INTO catalog_requests(
        kind,course_code,course_name,category,teacher_name,department,status,
        created_course_id,created_teacher_id
      ) VALUES('course',?,?, 'general',?, '测试学院','approved',?,?)`,
    )
      .bind(code, `${code} 测试课程`, teacherName, courseId, teacherId)
      .run();
    const auth = await login();
    const deleteCourse = await SELF.fetch(`${origin}/api/admin/courses/${courseId}`, {
      method: "DELETE",
      headers: adminHeaders(auth),
    });
    expect(deleteCourse.status).toBe(409);
    const deleteTeacher = await SELF.fetch(`${origin}/api/admin/teachers/${teacherId}`, {
      method: "DELETE",
      headers: adminHeaders(auth),
    });
    expect(deleteTeacher.status).toBe(409);
    await env.DB.prepare("DELETE FROM catalog_requests WHERE id=?")
      .bind(Number(request.meta.last_row_id))
      .run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
    await env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacherId).run();
  });

  it("does not delete a teacher who is the sole teacher of an active offering", async () => {
    const code = unique("SOLE-OFFERING");
    const courseId = await insertCourse(code);
    const teacherId = await insertTeacher(unique("唯一教师"));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
      ).bind(courseId, teacherId),
      env.DB.prepare(
        "INSERT INTO offerings(course_id,term,section,status) VALUES(?,?,?,'active')",
      ).bind(courseId, "2026 春", unique("唯一班")),
    ]);
    const offering = await env.DB.prepare(
      "SELECT id FROM offerings WHERE course_id=?",
    )
      .bind(courseId)
      .first<{ id: number }>();
    await env.DB.prepare(
      "INSERT INTO offering_teachers(offering_id,teacher_id) VALUES(?,?)",
    )
      .bind(offering?.id, teacherId)
      .run();
    const auth = await login();
    const response = await SELF.fetch(`${origin}/api/admin/teachers/${teacherId}`, {
      method: "DELETE",
      headers: adminHeaders(auth),
    });
    expect(response.status).toBe(409);
    expect(
      await env.DB.prepare("SELECT id FROM teachers WHERE id=?").bind(teacherId).first(),
    ).toEqual({ id: teacherId });
    await env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(offering?.id).run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
    await env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacherId).run();
  });

  it("ignores submitted review term and still dedupes by offering", async () => {
    const code = unique("TERM");
    const courseId = await insertCourse(code);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
    )
      .bind(courseId)
      .run();
    const offering = await env.DB.prepare(
      "INSERT INTO offerings(course_id,term,section,status) VALUES(?,?,?,'active')",
    )
      .bind(courseId, "2026 秋", unique("学期班"))
      .run();
    const offeringId = Number(offering.meta.last_row_id);
    await env.DB.prepare(
      "INSERT INTO offering_teachers(offering_id,teacher_id) VALUES(?,1)",
    )
      .bind(offeringId)
      .run();
    const ip = `203.0.113.${ipSequence++}`;
    const first = await submitReviewFromIp(
      {
        courseId,
        offeringId,
        teacherId: 1,
        overall: 4,
        scores: CURRENT_SCORES,
        term: "伪造学期 A",
      },
      ip,
    );
    const second = await submitReviewFromIp(
      {
        courseId,
        offeringId,
        teacherId: 1,
        overall: 5,
        scores: CURRENT_SCORES,
        term: "伪造学期 B",
      },
      ip,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(
      await env.DB.prepare("SELECT term FROM reviews WHERE offering_id=?")
        .bind(offeringId)
        .first(),
    ).toEqual({ term: "" });
    await env.DB.prepare("DELETE FROM reviews WHERE offering_id=?").bind(offeringId).run();
    await env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(offeringId).run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
  });

  it("allows the same review again after the 30-day dedupe window", async () => {
    const code = unique("DEDUPE-EXPIRY");
    const courseId = await insertCourse(code);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
    )
      .bind(courseId)
      .run();
    const ip = `203.0.113.${ipSequence++}`;
    const payload = {
      courseId,
      teacherId: 1,
      overall: 4,
      scores: CURRENT_SCORES,
      term: "2026 秋",
      comment: unique("30天后再次投稿补充说明"),
    };
    expect((await submitReviewFromIp(payload, ip)).status).toBe(200);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE review_dedupe SET created_at=datetime('now','-31 days')",
      ),
      env.DB.prepare(
        "UPDATE rate_limit_counters SET window_start=unixepoch()-7200 WHERE key LIKE 'review-submit:%'",
      ),
    ]);
    expect((await submitReviewFromIp(payload, ip)).status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM reviews WHERE course_id=? AND comment=?",
      )
        .bind(courseId, payload.comment)
        .first(),
    ).toEqual({ n: 2 });
    await env.DB.prepare("DELETE FROM reviews WHERE course_id=?").bind(courseId).run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
  });

  it("rejects a numeric zero optional rating", async () => {
    const code = unique("RATING-ZERO");
    const courseId = await insertCourse(code, "general");
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
    )
      .bind(courseId)
      .run();
    const response = await submitReview({
      courseId,
      teacherId: 1,
      overall: 4,
      scores: { ...CURRENT_SCORES, difficulty: 0 },
    });
    expect(response.status).toBe(400);
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
  });

  it("rejects non-scalar JSON values for integer ratings", async () => {
    const values: unknown[] = [true, [4], { value: 4 }, "1.5", "   "];
    const statuses = await Promise.all(
      values.map((overall) =>
        submitReview({ courseId: 1, teacherId: 1, overall }).then(
          (response) => response.status,
        ),
      ),
    );
    expect(statuses).toEqual([400, 400, 400, 400, 400]);
    const validString = await submitReview({
      courseId: 1,
      teacherId: 1,
      overall: "4",
      scores: CURRENT_SCORES,
      comment: unique("字符串评分补充说明"),
    });
    expect(validString.status).toBe(200);
  });
});

describe("backend regression fixes: atomic course saves and imports", () => {
  it("permanently disables the legacy merge/skip import endpoints", async () => {
    const auth = await login();
    const code = unique("NO-IMPORT-TYPE");
    const payload = {
      rows: [{ code, name: `${code} 课程`, category: "general" }],
    };
    expect(
      (
        await SELF.fetch(`${origin}/api/admin/import/preview`, {
          method: "POST",
          headers: adminHeaders(auth),
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await SELF.fetch(`${origin}/api/admin/import`, {
          method: "POST",
          headers: adminHeaders(auth),
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(409);
    expect(
      await env.DB.prepare("SELECT COUNT(*) n FROM courses WHERE code=?")
        .bind(code)
        .first(),
    ).toEqual({ n: 0 });
  });

  it("rejects blank terms for new offerings", async () => {
    const auth = await login();
    const direct = await SELF.fetch(`${origin}/api/admin/offerings`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        courseId: 1,
        term: "   ",
        section: unique("空学期班"),
        teacherIds: [1],
      }),
    });
    expect(direct.status).toBe(400);
  });


  it("validates teacher ids before either creating or editing a course", async () => {
    const auth = await login();
    const newCode = unique("ATOMIC-NEW");
    const created = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        code: newCode,
        name: `${newCode} 课程`,
        category: "general",
        teacherIds: [999999],
      }),
    });
    expect(created.status).toBe(400);
    expect(
      await env.DB.prepare("SELECT id FROM courses WHERE code=?")
        .bind(newCode)
        .first(),
    ).toBeNull();

    const editCode = unique("ATOMIC-EDIT");
    const courseId = await insertCourse(editCode, "general", 3);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
    )
      .bind(courseId)
      .run();
    const edited = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        id: courseId,
        code: editCode,
        name: `${editCode} 测试课程`,
        category: "general",
        description: "不应保存的半成功编辑",
        teacherIds: [999999],
      }),
    });
    expect(edited.status).toBe(400);
    expect(
      await env.DB.prepare("SELECT description FROM courses WHERE id=?")
        .bind(courseId)
        .first(),
    ).toEqual({ description: "" });
    expect(
      await env.DB.prepare(
        "SELECT teacher_id FROM course_teachers WHERE course_id=?",
      )
        .bind(courseId)
        .first(),
    ).toEqual({ teacher_id: 1 });
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
  });



  it("returns 404 without creating an event when moderating a missing review", async () => {
    const auth = await login();
    const id = 900000 + uniqueSequence++;
    const response = await SELF.fetch(`${origin}/api/admin/reviews/${id}`, {
      method: "PATCH",
      headers: adminHeaders(auth),
      body: JSON.stringify({ status: "approved" }),
    });
    expect(response.status).toBe(404);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM review_moderation_events WHERE review_id=?",
      )
        .bind(id)
        .first(),
    ).toEqual({ n: 0 });
  });

  it("accepts only the first moderation decision for a review", async () => {
    const inserted = await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,category,overall,status,submitter_hash)
       VALUES(1,1,'general',4,'pending','moderation-cas')`,
    ).run();
    const id = Number(inserted.meta.last_row_id);
    const auth = await login();
    const statuses = await Promise.all(
      ["approved", "rejected", "approved"].map((status) =>
        SELF.fetch(`${origin}/api/admin/reviews/${id}`, {
          method: "PATCH",
          headers: adminHeaders(auth),
          body: JSON.stringify({
            status,
            note: status === "rejected" ? "并发驳回" : "并发通过",
          }),
        }).then((response) => response.status),
      ),
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(2);
    const review = await env.DB.prepare("SELECT status FROM reviews WHERE id=?")
      .bind(id)
      .first<{ status: string }>();
    const events = await env.DB.prepare(
      "SELECT action FROM review_moderation_events WHERE review_id=? AND action IN ('approved','rejected')",
    )
      .bind(id)
      .all<{ action: string }>();
    expect(events.results).toEqual([{ action: review?.status }]);
    await env.DB.prepare("DELETE FROM reviews WHERE id=?").bind(id).run();
  });

  it("updates course and teacher list counts immediately after approving and rejecting text reviews", async () => {
    const approvedComment = unique("批准计数");
    const rejectedComment = unique("驳回计数");
    const inserted = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO reviews(course_id,teacher_id,category,overall,comment,status,submitter_hash)
         VALUES(1,1,'general',4,?,'pending',?)`,
      ).bind(approvedComment, unique("approve-hash")),
      env.DB.prepare(
        `INSERT INTO reviews(course_id,teacher_id,category,overall,comment,status,submitter_hash)
         VALUES(1,1,'general',4,?,'pending',?)`,
      ).bind(rejectedComment, unique("reject-hash")),
    ]);
    const approvedId = Number(inserted[0].meta.last_row_id);
    const rejectedId = Number(inserted[1].meta.last_row_id);
    const listCounts = async () => {
      const [courses, teachers] = await Promise.all([
        SELF.fetch(`${origin}/api/courses?q=TEST101`).then((response) =>
          response.json<{ items: Array<{ id: number; review_count: number }> }>(),
        ),
        SELF.fetch(`${origin}/api/teachers?q=${encodeURIComponent("测试教师")}`).then(
          (response) =>
            response.json<{ items: Array<{ id: number; review_count: number }> }>(),
        ),
      ]);
      return {
        course: courses.items.find((item) => item.id === 1)?.review_count,
        teacher: teachers.items.find((item) => item.id === 1)?.review_count,
      };
    };

    try {
      const before = await listCounts();
      const auth = await login();
      const approved = await SELF.fetch(`${origin}/api/admin/reviews/${approvedId}`, {
        method: "PATCH",
        headers: adminHeaders(auth),
        body: JSON.stringify({ status: "approved", note: "公开" }),
      });
      const rejected = await SELF.fetch(`${origin}/api/admin/reviews/${rejectedId}`, {
        method: "PATCH",
        headers: adminHeaders(auth),
        body: JSON.stringify({ status: "rejected", note: "不公开" }),
      });
      expect([approved.status, rejected.status]).toEqual([200, 200]);

      const after = await listCounts();
      expect(after.course).toBe((before.course ?? 0) + 1);
      expect(after.teacher).toBe((before.teacher ?? 0) + 1);
    } finally {
      await env.DB.prepare("DELETE FROM reviews WHERE id IN (?,?)")
        .bind(approvedId, rejectedId)
        .run();
    }
  });

});
