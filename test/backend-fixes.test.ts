import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";
let loginSequence = 180;
let ipSequence = 180;
let uniqueSequence = 1;

function unique(prefix: string) {
  return `${prefix}-${uniqueSequence++}`;
}

async function login() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `198.51.100.${loginSequence++}`,
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

function submitReviewFromIp(body: Record<string, unknown>, ip: string) {
  return SELF.fetch(`${origin}/api/reviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
}

function submitReview(body: Record<string, unknown>) {
  return submitReviewFromIp(body, `203.0.113.${ipSequence++}`);
}

async function insertCourse(
  code: string,
  category = "major",
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
    "INSERT INTO teachers(name,department) VALUES(?, '测试学院')",
  )
    .bind(name)
    .run();
  return Number(result.meta.last_row_id);
}

describe("backend regression fixes: fields and catalog relations", () => {
  it("preserves public-elective scores when editing only review text", async () => {
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
        headers: auth,
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
      interest: 3,
      practicality: 4,
      workload_score: 2,
      fairness: 5,
      organization: 1,
    });
    await env.DB.prepare("DELETE FROM reviews WHERE id=?").bind(id).run();
  });

  it("preserves omitted course credits and rejects negative credits", async () => {
    const code = unique("CREDIT");
    const courseId = await insertCourse(code, "major", 3);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
    )
      .bind(courseId)
      .run();
    const auth = await login();
    const update = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        id: courseId,
        code,
        name: `${code} 测试课程`,
        category: "major",
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
      headers: auth,
      body: JSON.stringify({
        id: courseId,
        code,
        name: `${code} 测试课程`,
        category: "major",
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
      headers: auth,
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
      headers: auth,
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
      term: "伪造但应被覆盖",
    });
    expect(submitted.status).toBe(200);

    const update = await SELF.fetch(`${origin}/api/admin/offerings`, {
      method: "POST",
      headers: auth,
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
    const submitted = await submitReview({ courseId, teacherId: 1, overall: 5 });
    expect(submitted.status).toBe(200);
    const auth = await login();
    const put = await SELF.fetch(`${origin}/api/admin/courses/${courseId}/teachers`, {
      method: "PUT",
      headers: auth,
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
      headers: auth,
      body: JSON.stringify({
        id: courseId,
        code,
        name: `${code} 测试课程`,
        category: "major",
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
      headers: auth,
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
  it("atomically approves a catalog request and creates one attached review", async () => {
    const code = unique("CONCURRENT");
    const submitted = await SELF.fetch(`${origin}/api/catalog-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "CF-Connecting-IP": `198.18.0.${ipSequence++}`,
      },
      body: JSON.stringify({
        kind: "course",
        courseCode: code,
        courseName: `${code} 申请课程`,
        category: "major",
        department: "测试学院",
        teacherName: `${code} 申请教师`,
        review: { overall: 5, comment: `${code} 附带评价` },
      }),
    });
    expect(submitted.status).toBe(200);
    const { id } = await submitted.json<{ id: number }>();
    const auth = await login();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        SELF.fetch(`${origin}/api/admin/catalog-requests/${id}`, {
          method: "PATCH",
          headers: auth,
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

  it("protects courses and teachers referenced by approved legacy reviews", async () => {
    const code = unique("LEGACY-GUARD");
    const teacherName = unique("历史教师");
    const courseId = await insertCourse(code);
    const teacherId = await insertTeacher(teacherName);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
    )
      .bind(courseId, teacherId)
      .run();
    const batchId = `legacy_guard_${uniqueSequence++}`;
    await env.DB.prepare(
      `INSERT INTO legacy_import_batches(id,source_type,source_label,status,row_count,imported_at)
       VALUES(?,'legacy_ocr','腾讯表格历史资料','imported',1,CURRENT_TIMESTAMP)`,
    )
      .bind(batchId)
      .run();
    const review = await env.DB.prepare(
      `INSERT INTO legacy_reviews(
        import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,
        course_id,teacher_id,category,comment,status
      ) VALUES(?,?,?,?,?,?,?,?,?,?, 'approved')`,
    )
      .bind(
        batchId,
        "guard.png",
        "测试",
        "1",
        "历史原文",
        0.99,
        courseId,
        teacherId,
        "major",
        "已审核历史文字",
      )
      .run();
    const auth = await login();
    const deleteCourse = await SELF.fetch(`${origin}/api/admin/courses/${courseId}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(deleteCourse.status).toBe(409);
    const deleteTeacher = await SELF.fetch(`${origin}/api/admin/teachers/${teacherId}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(deleteTeacher.status).toBe(409);
    expect(
      await env.DB.prepare(
        "SELECT course_id,teacher_id FROM legacy_reviews WHERE id=?",
      )
        .bind(Number(review.meta.last_row_id))
        .first(),
    ).toEqual({ course_id: courseId, teacher_id: teacherId });
    await env.DB.prepare("DELETE FROM legacy_reviews WHERE id=?")
      .bind(Number(review.meta.last_row_id))
      .run();
    await env.DB.prepare("DELETE FROM legacy_import_batches WHERE id=?").bind(batchId).run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
    await env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacherId).run();
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
      ) VALUES('course',?,?, 'major',?, '测试学院','approved',?,?)`,
    )
      .bind(code, `${code} 测试课程`, teacherName, courseId, teacherId)
      .run();
    const auth = await login();
    const deleteCourse = await SELF.fetch(`${origin}/api/admin/courses/${courseId}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(deleteCourse.status).toBe(409);
    const deleteTeacher = await SELF.fetch(`${origin}/api/admin/teachers/${teacherId}`, {
      method: "DELETE",
      headers: auth,
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
      headers: auth,
    });
    expect(response.status).toBe(409);
    expect(
      await env.DB.prepare("SELECT id FROM teachers WHERE id=?").bind(teacherId).first(),
    ).toEqual({ id: teacherId });
    await env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(offering?.id).run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
    await env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacherId).run();
  });

  it("uses the offering term for review dedupe and persistence", async () => {
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
      { courseId, offeringId, teacherId: 1, overall: 4, term: "伪造学期 A" },
      ip,
    );
    const second = await submitReviewFromIp(
      { courseId, offeringId, teacherId: 1, overall: 5, term: "伪造学期 B" },
      ip,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(
      await env.DB.prepare("SELECT term FROM reviews WHERE offering_id=?")
        .bind(offeringId)
        .first(),
    ).toEqual({ term: "2026 秋" });
    await env.DB.prepare("DELETE FROM reviews WHERE offering_id=?").bind(offeringId).run();
    await env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(offeringId).run();
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
      interest: 0,
    });
    expect(response.status).toBe(400);
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
  });
});

describe("backend regression fixes: atomic course saves and imports", () => {
  it("rejects an offering import whose teacher is not related to the course", async () => {
    const auth = await login();
    const term = unique("导入非法学期");
    const section = unique("导入非法班");
    const payload = {
      type: "offerings",
      rows: [
        {
          course_code: "TEST102",
          course_name: "测试体育课",
          teacher_name: "测试教师",
          teacher_department: "测试学院",
          term,
          section,
          status: "active",
        },
      ],
    };
    const preview = await SELF.fetch(`${origin}/api/admin/import/preview`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(payload),
    });
    const previewBody = await preview.json<{
      ok: boolean;
      errors: Array<{ code: string }>;
    }>();
    expect(previewBody.ok).toBe(false);
    expect(previewBody.errors.map((error) => error.code)).toContain(
      "teacher_not_related",
    );
    const commit = await SELF.fetch(`${origin}/api/admin/import`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(payload),
    });
    expect(commit.status).toBe(422);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM offerings WHERE course_id=2 AND term=? AND section=?",
      )
        .bind(term, section)
        .first(),
    ).toEqual({ n: 0 });
  });

  it("validates teacher ids before either creating or editing a course", async () => {
    const auth = await login();
    const newCode = unique("ATOMIC-NEW");
    const created = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        code: newCode,
        name: `${newCode} 课程`,
        category: "major",
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
    const courseId = await insertCourse(editCode, "major", 3);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
    )
      .bind(courseId)
      .run();
    const edited = await SELF.fetch(`${origin}/api/admin/courses`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        id: courseId,
        code: editCode,
        name: `${editCode} 测试课程`,
        category: "major",
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

  it("keeps zero credits when importing a new course", async () => {
    const auth = await login();
    const code = unique("ZERO-CREDIT");
    const payload = {
      type: "courses",
      rows: [
        {
          code,
          name: `${code} 零学分课`,
          category: "general",
          department: "测试学院",
          credits: 0,
        },
      ],
    };
    const preview = await SELF.fetch(`${origin}/api/admin/import/preview`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(payload),
    });
    expect(await preview.json()).toMatchObject({ ok: true, newCount: 1 });
    const commit = await SELF.fetch(`${origin}/api/admin/import`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(payload),
    });
    expect(commit.status).toBe(200);
    expect(
      await env.DB.prepare("SELECT credits FROM courses WHERE code=?")
        .bind(code)
        .first(),
    ).toEqual({ credits: 0 });
    await env.DB.prepare("DELETE FROM courses WHERE code=?").bind(code).run();
  });

  it("accumulates teachers for one new offering across duplicate CSV rows", async () => {
    const auth = await login();
    const code = unique("MULTI-OFFERING");
    const courseId = await insertCourse(code);
    const teacherName = unique("多教师");
    const teacherId = await insertTeacher(teacherName);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
      ).bind(courseId),
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
      ).bind(courseId, teacherId),
    ]);
    const term = unique("2026秋");
    const section = unique("多教师班");
    const payload = {
      type: "offerings",
      rows: [
        {
          course_code: code,
          course_name: `${code} 测试课程`,
          teacher_name: "测试教师",
          teacher_department: "测试学院",
          term,
          section,
          status: "active",
        },
        {
          course_code: code,
          course_name: `${code} 测试课程`,
          teacher_name: teacherName,
          teacher_department: "测试学院",
          term,
          section,
          status: "active",
        },
      ],
    };
    const preview = await SELF.fetch(`${origin}/api/admin/import/preview`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(payload),
    });
    expect(await preview.json()).toMatchObject({ ok: true, newCount: 1 });
    const commit = await SELF.fetch(`${origin}/api/admin/import`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(payload),
    });
    expect(commit.status).toBe(200);
    const offering = await env.DB.prepare(
      "SELECT id FROM offerings WHERE course_id=? AND term=? AND section=?",
    )
      .bind(courseId, term, section)
      .first<{ id: number }>();
    expect(offering).toBeTruthy();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM offering_teachers WHERE offering_id=?",
      )
        .bind(offering?.id)
        .first(),
    ).toEqual({ n: 2 });
    await env.DB.prepare("DELETE FROM offerings WHERE id=?").bind(offering?.id).run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
    await env.DB.prepare("DELETE FROM teachers WHERE id=?").bind(teacherId).run();
  });

  it("returns 404 without creating an event when moderating a missing review", async () => {
    const auth = await login();
    const id = 900000 + uniqueSequence++;
    const response = await SELF.fetch(`${origin}/api/admin/reviews/${id}`, {
      method: "PATCH",
      headers: auth,
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

  it("does not count invalid existing rows as skipped in import preview", async () => {
    const auth = await login();
    const response = await SELF.fetch(`${origin}/api/admin/import/preview`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        type: "courses",
        rows: [
          {
            code: "TEST101",
            name: "测试课程",
            category: "not-a-category",
            credits: -1,
          },
        ],
      }),
    });
    expect(await response.json()).toMatchObject({
      ok: false,
      validCount: 0,
      skipCount: 0,
      newCount: 0,
    });
  });
});
