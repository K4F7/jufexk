import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { adminHeaders, adminLogin as login } from "./admin-session";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
} from "./ordinary-write-session";
import { HISTORICAL_WITHHOLD_REASON } from "../src/lib/pe-queue-closeout";
import { publicPeCourseIdentity } from "../src/lib/public-pe-course-projection";
import { CURRENT_SCORES } from "./review-score-fixtures";

const origin = "https://example.com";
let ipSequence = 80;

async function publicPost(path: string, body: Record<string, unknown>) {
  const session = await ordinaryWriteSession("pe-queue-catalog-writer");
  return SELF.fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      ...ordinaryWriteHeaders(session),
      "CF-Connecting-IP": `198.18.1.${ipSequence++}`,
    },
    body: JSON.stringify(body),
  });
}

async function insertUmbrella(input: {
  code: string;
  name: string;
  teacher: string;
  department?: string;
}) {
  const department = input.department ?? `${input.code}院`;
  const existingTeacher = await env.DB.prepare(
    "SELECT id FROM teachers WHERE source_teacher_label=?",
  )
    .bind(input.teacher)
    .first<{ id: number }>();
  const teacherId = existingTeacher
    ? Number(existingTeacher.id)
    : Number(
        (
          await env.DB.prepare(
            "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
          )
            .bind(input.teacher, input.teacher, department)
            .run()
        ).meta.last_row_id,
      );
  const course = await env.DB.prepare(
    "INSERT INTO courses(code,name,category,department,scheme_key) VALUES(?,?,?,?,?)",
  )
    .bind(input.code, input.name, "sports", department, "pe")
    .run();
  const courseId = Number(course.meta.last_row_id);
  await env.DB.prepare(
    "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
  )
    .bind(courseId, teacherId)
    .run();
  await env.DB.prepare(
    `INSERT INTO catalog_pe_specialization_review_queue(
       course_id,teacher_id,course_code,course_name,source_teacher_label,reason,evidence_json
     ) VALUES(?,?,?,?,?,'umbrella_unmapped',json_object(
       'sourceCourseCode',?,'sourceCourseName',?,'sourceTeacherLabel',?,'sourceKind','umbrella'
     ))`,
  )
    .bind(
      courseId,
      teacherId,
      input.code,
      input.name,
      input.teacher,
      input.code,
      input.name,
      input.teacher,
    )
    .run();
  return { courseId, teacherId };
}

describe("admin PE queue dispositions", () => {
  it("requires an admin session", async () => {
    const response = await SELF.fetch(
      `${origin}/api/admin/pe-specialization-queue`,
    );
    expect(response.status).toBe(401);
  });

  it("maps, withholds, and reports without leaking review bodies or credentials", async () => {
    const stamp = `PEQ${Date.now()}`;
    const mapped = await insertUmbrella({
      code: `${stamp}-M`,
      name: "体育1",
      teacher: `${stamp}黄丽萍`,
    });
    const withheld = await insertUmbrella({
      code: `${stamp}-W`,
      name: "体育2",
      teacher: `${stamp}未知`,
    });
    const headers = adminHeaders(await login());
    const listed = await SELF.fetch(
      `${origin}/api/admin/pe-specialization-queue?status=open`,
      { headers },
    );
    expect(listed.status).toBe(200);
    const listBody = await listed.json<{
      items: Array<{ courseCode: string; courseId: number }>;
      liveEnqueueEnabled: boolean;
    }>();
    expect(listBody.liveEnqueueEnabled).toBe(false);
    expect(listBody.items.some((row) => row.courseCode === `${stamp}-M`)).toBe(true);

    const mapResponse = await SELF.fetch(
      `${origin}/api/admin/pe-specialization-queue/dispositions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: [
            {
              courseId: mapped.courseId,
              teacherId: mapped.teacherId,
              disposition: "mapped",
              specialization: "瑜伽",
              reason: "virtual_pe_sports:瑜伽",
            },
          ],
        }),
      },
    );
    expect(mapResponse.status).toBe(200);

    const withholdResponse = await SELF.fetch(
      `${origin}/api/admin/pe-specialization-queue/dispositions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: [
            {
              courseId: withheld.courseId,
              teacherId: withheld.teacherId,
              disposition: "withheld_permanent_exception",
              reason: HISTORICAL_WITHHOLD_REASON,
            },
          ],
        }),
      },
    );
    expect(withholdResponse.status).toBe(200);

    const again = await SELF.fetch(
      `${origin}/api/admin/pe-specialization-queue/dispositions`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          items: [
            {
              courseId: withheld.courseId,
              teacherId: withheld.teacherId,
              disposition: "mapped",
              specialization: "乒乓球",
              reason: "admin remap withheld row",
            },
          ],
        }),
      },
    );
    expect(again.status).toBe(200);
    expect(
      await env.DB.prepare(
        "SELECT normalized_specialization FROM catalog_relation_pe_specializations WHERE course_id=? AND teacher_id=?",
      )
        .bind(withheld.courseId, withheld.teacherId)
        .first(),
    ).toEqual({ normalized_specialization: "乒乓球" });

    const mappedLocked = await SELF.fetch(
      `${origin}/api/admin/pe-specialization-queue/dispositions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: [
            {
              courseId: mapped.courseId,
              teacherId: mapped.teacherId,
              disposition: "withheld_permanent_exception",
              reason: "should not rewrite mapped",
            },
          ],
        }),
      },
    );
    expect(mappedLocked.status).toBe(409);

    const mapping = await env.DB.prepare(
      "SELECT normalized_specialization,source_kind FROM catalog_relation_pe_specializations WHERE course_id=? AND teacher_id=?",
    )
      .bind(mapped.courseId, mapped.teacherId)
      .first();
    expect(mapping).toEqual({
      normalized_specialization: "瑜伽",
      source_kind: "umbrella",
    });

    const report = await SELF.fetch(
      `${origin}/api/admin/pe-specialization-queue/report`,
      { headers },
    );
    expect(report.status).toBe(200);
    const reportText = await report.text();
    expect(reportText).toContain(`${stamp}-M`);
    expect(reportText).not.toMatch(/CASTGC=|JSESSIONID=|submitter_hash|pending_review_json/i);

    const courses = await SELF.fetch(
      `${origin}/api/courses?department=${encodeURIComponent(`${stamp}-W院`)}&pageSize=50`,
    );
    const courseBody = await courses.json<{
      items: Array<{ name: string; public_id?: string }>;
    }>();
    expect(courseBody.items.map((item) => item.name)).not.toContain("体育2");
    expect(courseBody.items.map((item) => item.name)).not.toContain("体育1");

    const yogaCourses = await SELF.fetch(
      `${origin}/api/courses?department=${encodeURIComponent(`${stamp}-M院`)}&pageSize=50`,
    );
    const yogaBody = await yogaCourses.json<{
      items: Array<{ name: string; public_id?: string; id: number | null }>;
    }>();
    expect(
      yogaBody.items.some(
        (item) =>
          item.public_id === publicPeCourseIdentity("瑜伽") &&
          item.name === "体育1-4 [瑜伽]",
      ),
    ).toBe(true);

    const relations = await SELF.fetch(
      `${origin}/api/courses?view=relations&department=${encodeURIComponent(`${stamp}-W院`)}&pageSize=50`,
    );
    const relationBody = await relations.json<{
      items: Array<{ name: string }>;
    }>();
    expect(relationBody.items.map((item) => item.name)).not.toContain("体育2");
  });

  it("applies evidence-based historical closeout and dirties public precompute", async () => {
    const stamp = `PEQC${Date.now()}`;
    const yoga = await insertUmbrella({
      code: `${stamp}-Y`,
      name: "体育1",
      teacher: "黄丽萍",
    });
    const unknown = await insertUmbrella({
      code: `${stamp}-U`,
      name: "体育3",
      teacher: `${stamp}路人`,
    });
    await env.DB.prepare(
      `UPDATE public_precompute_state
       SET dirty=0,refresh_token='stale-pe-closeout',refresh_lease_until=unixepoch()+60
       WHERE id=1`,
    ).run();
    const headers = adminHeaders(await login());
    const response = await SELF.fetch(
      `${origin}/api/admin/pe-specialization-queue/closeout`,
      { method: "POST", headers },
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      liveEnqueueEnabled: boolean;
    }>();
    expect(body.liveEnqueueEnabled).toBe(false);
    expect(
      await env.DB.prepare(
        "SELECT normalized_specialization FROM catalog_relation_pe_specializations WHERE course_id=? AND teacher_id=?",
      )
        .bind(yoga.courseId, yoga.teacherId)
        .first(),
    ).toEqual({ normalized_specialization: "瑜伽" });
    expect(
      await env.DB.prepare(
        "SELECT disposition,disposition_reason FROM catalog_pe_specialization_review_queue WHERE course_id=? AND teacher_id=?",
      )
        .bind(unknown.courseId, unknown.teacherId)
        .first(),
    ).toEqual({
      disposition: "withheld_permanent_exception",
      disposition_reason: HISTORICAL_WITHHOLD_REASON,
    });
    const state = await env.DB.prepare(
      "SELECT dirty,refresh_token FROM public_precompute_state WHERE id=1",
    ).first<{ dirty: number; refresh_token: string | null }>();
    expect(state?.dirty).toBe(1);
    expect(state?.refresh_token).toBeNull();
  });

  it("re-disposes withheld/conflict from sibling skills and hides withheld umbrellas", async () => {
    const stamp = `PE860${Date.now()}`;
    const department = `${stamp}院`;
    const taekwondo = await insertUmbrella({
      code: `${stamp}-T`,
      name: "体育1",
      teacher: `${stamp}肖舒鹏`,
      department,
    });
    const mixed = await insertUmbrella({
      code: `${stamp}-X`,
      name: "体育2",
      teacher: `${stamp}谢辉`,
      department,
    });
    const zhang1 = await insertUmbrella({
      code: `${stamp}-Z1`,
      name: "体育1",
      teacher: "张晓英",
      department,
    });
    const zhang2 = await insertUmbrella({
      code: `${stamp}-Z2`,
      name: "体育2",
      teacher: "张晓英",
      department,
    });
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE catalog_pe_specialization_review_queue
         SET disposition='withheld_permanent_exception', disposition_reason=?
         WHERE course_id=? AND teacher_id=?`,
      ).bind(HISTORICAL_WITHHOLD_REASON, taekwondo.courseId, taekwondo.teacherId),
      env.DB.prepare(
        `UPDATE catalog_pe_specialization_review_queue
         SET disposition='withheld_permanent_exception', disposition_reason=?
         WHERE course_id=? AND teacher_id=?`,
      ).bind(HISTORICAL_WITHHOLD_REASON, mixed.courseId, mixed.teacherId),
      env.DB.prepare(
        `UPDATE catalog_pe_specialization_review_queue
         SET disposition='conflict_recapture',
             disposition_reason='conflicting specialization evidence: 篮球、排球'
         WHERE course_id=? AND teacher_id=?`,
      ).bind(zhang1.courseId, zhang1.teacherId),
      env.DB.prepare(
        `UPDATE catalog_pe_specialization_review_queue
         SET disposition='conflict_recapture',
             disposition_reason='conflicting specialization evidence: 篮球、排球'
         WHERE course_id=? AND teacher_id=?`,
      ).bind(zhang2.courseId, zhang2.teacherId),
    ]);

    const insertSkill = async (
      code: string,
      name: string,
      teacherId: number,
      teacherLabel: string,
    ) => {
      const course = await env.DB.prepare(
        "INSERT INTO courses(code,name,category,department,scheme_key) VALUES(?,?,?,?,?)",
      )
        .bind(code, name, "sports", department, "pe")
        .run();
      const courseId = Number(course.meta.last_row_id);
      await env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
      )
        .bind(courseId, teacherId)
        .run();
      return { courseId, teacherId, teacherLabel, name };
    };
    await insertSkill(`${stamp}-TKD2`, "跆拳道2", taekwondo.teacherId, `${stamp}肖舒鹏`);
    await insertSkill(`${stamp}-SWIM`, "游泳", mixed.teacherId, `${stamp}谢辉`);
    await insertSkill(`${stamp}-TKD`, "跆拳道", mixed.teacherId, `${stamp}谢辉`);
    const basketball = await insertSkill(
      `${stamp}-BASKET`,
      "篮球",
      zhang1.teacherId,
      "张晓英",
    );
    const volleyball = await insertSkill(
      `${stamp}-VOLLEY`,
      "排球",
      zhang1.teacherId,
      "张晓英",
    );

    const headers = adminHeaders(await login());
    const response = await SELF.fetch(
      `${origin}/api/admin/pe-specialization-queue/closeout`,
      { method: "POST", headers },
    );
    expect(response.status).toBe(200);

    expect(
      await env.DB.prepare(
        "SELECT normalized_specialization,source_kind FROM catalog_relation_pe_specializations WHERE course_id=? AND teacher_id=?",
      )
        .bind(taekwondo.courseId, taekwondo.teacherId)
        .first(),
    ).toEqual({ normalized_specialization: "跆拳道", source_kind: "umbrella" });
    expect(
      await env.DB.prepare(
        "SELECT disposition FROM catalog_pe_specialization_review_queue WHERE course_id=? AND teacher_id=?",
      )
        .bind(mixed.courseId, mixed.teacherId)
        .first(),
    ).toEqual({ disposition: "conflict_recapture" });
    expect(
      await env.DB.prepare(
        "SELECT disposition FROM catalog_pe_specialization_review_queue WHERE course_id=? AND teacher_id=?",
      )
        .bind(zhang1.courseId, zhang1.teacherId)
        .first(),
    ).toEqual({ disposition: "withheld_permanent_exception" });
    expect(
      await env.DB.prepare(
        "SELECT disposition FROM catalog_pe_specialization_review_queue WHERE course_id=? AND teacher_id=?",
      )
        .bind(zhang2.courseId, zhang2.teacherId)
        .first(),
    ).toEqual({ disposition: "withheld_permanent_exception" });
    expect(
      await env.DB.prepare(
        "SELECT 1 ok FROM catalog_relation_pe_specializations WHERE course_id=? AND teacher_id=?",
      )
        .bind(zhang1.courseId, zhang1.teacherId)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT normalized_specialization,display_semantics FROM catalog_relation_pe_specializations WHERE course_id=? AND teacher_id=?",
      )
        .bind(basketball.courseId, basketball.teacherId)
        .first(),
    ).toEqual({
      normalized_specialization: "篮球",
      display_semantics: "keep_source_name",
    });

    const courses = await SELF.fetch(
      `${origin}/api/courses?department=${encodeURIComponent(department)}&pageSize=50`,
    );
    const courseBody = await courses.json<{
      items: Array<{ name: string; public_id?: string }>;
    }>();
    const names = courseBody.items.map((item) => item.name);
    expect(names).not.toContain("体育1");
    expect(names).not.toContain("体育2");
    expect(names).toEqual(expect.arrayContaining(["篮球", "排球", "跆拳道", "游泳"]));

    const patch = await SELF.fetch(
      `${origin}/api/admin/pe-specialization-queue/dispositions`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          items: [
            {
              courseId: mixed.courseId,
              teacherId: mixed.teacherId,
              disposition: "conflict_recapture",
              reason: "admin confirmed swimming and taekwondo conflict",
            },
          ],
        }),
      },
    );
    expect(patch.status).toBe(200);
    expect(volleyball.name).toBe("排球");
  });
});

describe("catalog-addition PE specialization on approve", () => {
  it("requires a specialization for umbrella PE and writes the mapping", async () => {
    const stamp = `PECR${Date.now()}`;
    const submitted = await publicPost("/api/catalog-requests", {
      kind: "course",
      courseCode: `${stamp}-1`,
      courseName: "体育1",
      category: "sports",
      department: "体育学院",
      teacherSourceLabel: `${stamp}教师`,
      review: {
        overall: 5,
        comment: `${stamp}随附评价正文足够长`,
        scores: CURRENT_SCORES,
      },
    });
    expect(submitted.status).toBe(200);
    const { id } = await submitted.json<{ id: number }>();
    const headers = adminHeaders(await login());
    const missing = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(missing.status).toBe(400);

    const listed = await SELF.fetch(
      `${origin}/api/admin/catalog-requests?status=pending`,
      { headers },
    );
    const listBody = await listed.json<{
      items: Array<{
        id: number;
        peSourceKind?: string;
        course_name?: string;
      }>;
    }>();
    const pending = listBody.items.find((row) => row.id === id);
    expect(pending?.peSourceKind).toBe("umbrella");
    expect(JSON.stringify(listBody)).not.toContain("随附评价正文");

    const approved = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "approved", peSpecialization: "瑜伽" }),
      },
    );
    expect(approved.status).toBe(200);
    const mapping = await env.DB.prepare(
      `SELECT m.normalized_specialization,m.source_kind
       FROM catalog_relation_pe_specializations m
       JOIN courses c ON c.id=m.course_id
       JOIN teachers t ON t.id=m.teacher_id
       WHERE c.code=? AND t.source_teacher_label=?`,
    )
      .bind(`${stamp}-1`, `${stamp}教师`)
      .first();
    expect(mapping).toEqual({
      normalized_specialization: "瑜伽",
      source_kind: "umbrella",
    });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) n FROM catalog_pe_specialization_review_queue q JOIN courses c ON c.id=q.course_id WHERE c.code=?",
      )
        .bind(`${stamp}-1`)
        .first(),
    ).toEqual({ n: 0 });
  });

  it("auto-maps a direct skill catalog addition", async () => {
    const stamp = `PEDS${Date.now()}`;
    const submitted = await publicPost("/api/catalog-requests", {
      kind: "course",
      courseCode: `${stamp}-B`,
      courseName: "篮球2",
      category: "sports",
      department: "体育学院",
      teacherSourceLabel: `${stamp}篮球教师`,
    });
    expect(submitted.status).toBe(200);
    const { id } = await submitted.json<{ id: number }>();
    const headers = adminHeaders(await login());
    const approved = await SELF.fetch(
      `${origin}/api/admin/catalog-requests/${id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(approved.status).toBe(200);
    expect(
      await env.DB.prepare(
        `SELECT m.normalized_specialization,m.display_semantics
         FROM catalog_relation_pe_specializations m
         JOIN courses c ON c.id=m.course_id
         WHERE c.code=?`,
      )
        .bind(`${stamp}-B`)
        .first(),
    ).toEqual({
      normalized_specialization: "篮球",
      display_semantics: "keep_source_name",
    });
  });
});
