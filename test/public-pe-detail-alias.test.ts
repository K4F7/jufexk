import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildPeSpecializationMapping } from "../src/lib/pe-specialization-mapping";
import {
  publicPeCourseIdentity,
  publicPeRelationIdentity,
} from "../src/lib/public-pe-course-projection";
import { CURRENT_SCORES } from "./review-score-fixtures";
import { hmacHex } from "../src/ordinary-user-authentication";
import {
  ORDINARY_TEST_AUTH_SECRET,
  ordinaryWriteHeaders,
  ordinaryWriteSession,
} from "./ordinary-write-session";

const origin = "https://example.com";

type CourseDetailBody = {
  course: {
    id: number | null;
    public_id?: string;
    name: string;
    category: string;
    code: string;
    enrollment_category: string;
    teaching_type: string;
    course_level: string;
    teachers: Array<{
      id: number;
      name: string;
      review_count?: number;
      rating?: number | null;
    }>;
  };
  reviewCount: number;
};

type ReviewPage = {
  items: Array<{ comment: string; teacher_id: number; course_id: number }>;
  nextCursor: string | null;
  total?: number;
};

async function insertTeacher(name: string, department: string, sourceLabel = name) {
  const result = await env.DB.prepare(
    "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
  )
    .bind(sourceLabel, name, department)
    .run();
  return Number(result.meta.last_row_id);
}

async function insertCourse(
  code: string,
  name: string,
  department: string,
  category = "sports",
) {
  const result = await env.DB.prepare(
    "INSERT INTO courses(code,name,category,department,scheme_key) VALUES(?,?,?,?,?)",
  )
    .bind(code, name, category, department, category === "sports" ? "pe" : "major")
    .run();
  return Number(result.meta.last_row_id);
}

async function bindTeacher(courseId: number, teacherId: number) {
  await env.DB.prepare(
    "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
  )
    .bind(courseId, teacherId)
    .run();
}

async function insertPeMapping(input: {
  courseId: number;
  teacherId: number;
  sourceKind: "umbrella" | "direct_skill";
  specialization: string;
  courseCode: string;
  courseName: string;
  sourceTeacherLabel: string;
}) {
  const mapping = buildPeSpecializationMapping({
    sourceKind: input.sourceKind,
    normalizedSpecialization: input.specialization,
    evidenceKind:
      input.sourceKind === "umbrella" ? "human_decision" : "catalog_course_name",
    sourceCourseCode: input.courseCode,
    sourceCourseName: input.courseName,
    sourceTeacherLabel: input.sourceTeacherLabel,
    rawSpecializationName: input.specialization,
  });
  await env.DB.prepare(
    `INSERT INTO catalog_relation_pe_specializations(
      course_id,teacher_id,source_kind,normalized_specialization,display_semantics,evidence_json
    ) VALUES(?,?,?,?,?,?)`,
  )
    .bind(
      input.courseId,
      input.teacherId,
      mapping.sourceKind,
      mapping.normalizedSpecialization,
      mapping.displaySemantics,
      JSON.stringify(mapping.evidence),
    )
    .run();
}

async function insertApprovedReview(input: {
  courseId: number;
  teacherId: number;
  comment: string;
  overall?: number;
}) {
  await env.DB.prepare(
    `INSERT INTO reviews(
      course_id,teacher_id,category,overall,comment,term,status,
      submitter_hash,scheme_key,scheme_version,scores,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      input.courseId,
      input.teacherId,
      "sports",
      input.overall ?? 5,
      input.comment,
      "2026 春",
      "approved",
      `hash-${input.comment}-${Math.random()}`,
      "pe",
      2,
      JSON.stringify(CURRENT_SCORES),
      "2026-08-12 01:00:00",
    )
    .run();
}

async function fetchCourse(path: string) {
  return SELF.fetch(`${origin}${path}`);
}

describe.sequential("体育公共专项详情、评价流与旧虚拟 ID alias", () => {
  it("reads mapped PE detail by public identity with spec×teacher relations", async () => {
    const stamp = `PE835A${Date.now()}`;
    const department = `${stamp}院`;
    const firstTeacher = `${stamp}甲师`;
    const secondTeacher = `${stamp}乙师`;
    const firstId = await insertTeacher(firstTeacher, department);
    const secondId = await insertTeacher(secondTeacher, department);
    const basketId = await insertCourse(`${stamp}-B`, "篮球", department);
    const basketTwoId = await insertCourse(`${stamp}-B2`, "篮球2", department);
    const ordinaryId = await insertCourse(
      `${stamp}-ORD`,
      `${stamp}普通课`,
      department,
      "general",
    );
    await bindTeacher(basketId, firstId);
    await bindTeacher(basketTwoId, firstId);
    await bindTeacher(basketId, secondId);
    await bindTeacher(ordinaryId, firstId);
    await insertPeMapping({
      courseId: basketId,
      teacherId: firstId,
      sourceKind: "direct_skill",
      specialization: "篮球",
      courseCode: `${stamp}-B`,
      courseName: "篮球",
      sourceTeacherLabel: firstTeacher,
    });
    await insertPeMapping({
      courseId: basketTwoId,
      teacherId: firstId,
      sourceKind: "direct_skill",
      specialization: "篮球",
      courseCode: `${stamp}-B2`,
      courseName: "篮球2",
      sourceTeacherLabel: firstTeacher,
    });
    await insertPeMapping({
      courseId: basketId,
      teacherId: secondId,
      sourceKind: "direct_skill",
      specialization: "篮球",
      courseCode: `${stamp}-B`,
      courseName: "篮球",
      sourceTeacherLabel: secondTeacher,
    });
    await insertApprovedReview({
      courseId: basketId,
      teacherId: firstId,
      comment: `${stamp}篮球甲评价正文足够长`,
      overall: 5,
    });
    await insertApprovedReview({
      courseId: basketTwoId,
      teacherId: firstId,
      comment: `${stamp}篮球2甲评价正文足够长`,
      overall: 1,
    });
    await insertApprovedReview({
      courseId: ordinaryId,
      teacherId: firstId,
      comment: `${stamp}普通课泄漏评价正文足够长`,
      overall: 5,
    });
    await insertApprovedReview({
      courseId: basketId,
      teacherId: secondId,
      comment: `${stamp}篮球乙评价正文足够长`,
      overall: 4,
    });

    try {
      const encoded = encodeURIComponent(publicPeCourseIdentity("篮球"));
      const detail = await fetchCourse(`/api/courses/${encoded}`);
      expect(detail.status).toBe(200);
      const body = await detail.json<CourseDetailBody>();
      expect(body.course).toMatchObject({
        id: null,
        public_id: publicPeCourseIdentity("篮球"),
        name: "篮球",
        category: "sports",
        code: "",
        enrollment_category: "",
        teaching_type: "",
        course_level: "",
      });
      expect(body.reviewCount).toBe(3);
      expect(body.course.teachers.map((teacher) => teacher.name).sort()).toEqual(
        [firstTeacher, secondTeacher].sort(),
      );
      const first = body.course.teachers.find((teacher) => teacher.id === firstId);
      expect(first).toMatchObject({
        id: firstId,
        review_count: 2,
        rating: 3,
      });
      const second = body.course.teachers.find((teacher) => teacher.id === secondId);
      expect(second).toMatchObject({
        id: secondId,
        review_count: 1,
        rating: 4,
      });

      const scoped = await fetchCourse(
        `/api/courses/${encoded}/reviews?teacherId=${firstId}`,
      );
      expect(scoped.status).toBe(200);
      const scopedBody = await scoped.json<ReviewPage>();
      const comments = scopedBody.items.map((item) => item.comment).sort();
      expect(comments).toEqual(
        [`${stamp}篮球2甲评价正文足够长`, `${stamp}篮球甲评价正文足够长`].sort(),
      );
      expect(comments).not.toContain(`${stamp}普通课泄漏评价正文足够长`);
      expect(comments).not.toContain(`${stamp}篮球乙评价正文足够长`);

      const allSpec = await fetchCourse(`/api/courses/${encoded}/reviews`);
      expect(allSpec.status).toBe(200);
      const allBody = await allSpec.json<ReviewPage>();
      expect(allBody.items.map((item) => item.comment).sort()).toEqual(
        [
          `${stamp}篮球2甲评价正文足够长`,
          `${stamp}篮球甲评价正文足够长`,
          `${stamp}篮球乙评价正文足够长`,
        ].sort(),
      );
      expect(allBody.items.some((item) => item.comment.includes("普通课泄漏"))).toBe(
        false,
      );

      const ordinary = await fetchCourse(`/api/courses/${ordinaryId}`);
      expect(ordinary.status).toBe(200);
      const ordinaryBody = await ordinary.json<CourseDetailBody>();
      expect(ordinaryBody.course.id).toBe(ordinaryId);
      expect(ordinaryBody.course.name).toBe(`${stamp}普通课`);
      expect(ordinaryBody.course.teachers.map((teacher) => teacher.id)).toEqual([
        firstId,
      ]);

      const ordinaryReviews = await fetchCourse(
        `/api/courses/${ordinaryId}/reviews?teacherId=${firstId}`,
      );
      expect(ordinaryReviews.status).toBe(200);
      const ordinaryReviewBody = await ordinaryReviews.json<ReviewPage>();
      expect(ordinaryReviewBody.items.map((item) => item.comment)).toEqual([
        `${stamp}普通课泄漏评价正文足够长`,
      ]);

      const teacherDetail = await fetchCourse(`/api/teachers/${firstId}`);
      expect(teacherDetail.status).toBe(200);
      const teacherBody = await teacherDetail.json<{
        courses: Array<{
          id: number | null;
          public_id?: string;
          name: string;
        }>;
      }>();
      expect(
        teacherBody.courses.some(
          (course) => course.public_id === publicPeCourseIdentity("篮球"),
        ),
      ).toBe(true);
      expect(
        teacherBody.courses.some(
          (course) => course.id === basketId || course.id === basketTwoId,
        ),
      ).toBe(false);
      expect(
        teacherBody.courses.some((course) => course.id === ordinaryId),
      ).toBe(true);
    } finally {
      await env.DB.prepare(
        `DELETE FROM catalog_relation_pe_specializations
         WHERE course_id IN (?,?,?)`,
      )
        .bind(basketId, basketTwoId, ordinaryId)
        .run();
    }
  });

  it("resolves 800001/800002 aliases to mapped 瑜伽/武术 and does not write virtual ids", async () => {
    const stamp = `PE835Y${Date.now()}`;
    const department = `${stamp}院`;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO teachers(source_teacher_label,name,department) VALUES(?,?,?),(?,?,?)",
    )
      .bind("黄丽萍", "黄丽萍", department, "刘春来", "刘春来", department)
      .run();
    const yogaTeacher = await env.DB.prepare(
      "SELECT id FROM teachers WHERE name=? ORDER BY id LIMIT 1",
    )
      .bind("黄丽萍")
      .first<{ id: number }>();
    const wushuTeacher = await env.DB.prepare(
      "SELECT id FROM teachers WHERE name=? ORDER BY id LIMIT 1",
    )
      .bind("刘春来")
      .first<{ id: number }>();
    const yogaTeacherId = Number(yogaTeacher?.id);
    const wushuTeacherId = Number(wushuTeacher?.id);
    const yogaSourceId = await insertCourse(`${stamp}-YU`, "体育1", department);
    const wushuSourceId = await insertCourse(`${stamp}-WU`, "武术", department);
    const psychologyId = await insertCourse(
      `${stamp}-PSY`,
      "体育心理学",
      department,
      "general",
    );
    await bindTeacher(yogaSourceId, yogaTeacherId);
    await bindTeacher(wushuSourceId, wushuTeacherId);
    await bindTeacher(psychologyId, yogaTeacherId);
    await insertPeMapping({
      courseId: yogaSourceId,
      teacherId: yogaTeacherId,
      sourceKind: "umbrella",
      specialization: "瑜伽",
      courseCode: `${stamp}-YU`,
      courseName: "体育1",
      sourceTeacherLabel: "黄丽萍",
    });
    await insertPeMapping({
      courseId: wushuSourceId,
      teacherId: wushuTeacherId,
      sourceKind: "direct_skill",
      specialization: "武术",
      courseCode: `${stamp}-WU`,
      courseName: "武术",
      sourceTeacherLabel: "刘春来",
    });
    await insertApprovedReview({
      courseId: yogaSourceId,
      teacherId: yogaTeacherId,
      comment: `${stamp}瑜伽来源评价正文足够长`,
    });
    await insertApprovedReview({
      courseId: psychologyId,
      teacherId: yogaTeacherId,
      comment: `${stamp}心理学泄漏评价正文足够长`,
    });
    await insertApprovedReview({
      courseId: wushuSourceId,
      teacherId: wushuTeacherId,
      comment: `${stamp}武术来源评价正文足够长`,
    });

    const virtualCoursesBefore = await env.DB.prepare(
      "SELECT COUNT(*) n FROM courses WHERE id IN (800001,800002)",
    ).first<{ n: number }>();
    const virtualTableBefore = await env.DB.prepare(
      "SELECT COUNT(*) n FROM virtual_pe_notification_courses",
    ).first<{ n: number }>();

    try {
      const encodedYoga = encodeURIComponent(publicPeCourseIdentity("瑜伽"));
      const [aliasYoga, publicYoga] = await Promise.all([
        fetchCourse("/api/courses/800001"),
        fetchCourse(`/api/courses/${encodedYoga}`),
      ]);
      expect(aliasYoga.status).toBe(200);
      expect(publicYoga.status).toBe(200);
      const aliasBody = await aliasYoga.json<CourseDetailBody>();
      const publicBody = await publicYoga.json<CourseDetailBody>();
      expect(aliasBody).toEqual(publicBody);
      expect(aliasBody.course).toMatchObject({
        id: null,
        public_id: publicPeCourseIdentity("瑜伽"),
        name: "体育1-4 [瑜伽]",
        category: "sports",
      });
      expect(aliasBody.course.teachers.map((teacher) => teacher.id)).toContain(
        yogaTeacherId,
      );
      expect(aliasBody.reviewCount).toBeGreaterThanOrEqual(1);

      const aliasReviews = await fetchCourse(
        `/api/courses/800001/reviews?teacherId=${yogaTeacherId}`,
      );
      expect(aliasReviews.status).toBe(200);
      const aliasReviewBody = await aliasReviews.json<ReviewPage>();
      expect(aliasReviewBody.items.map((item) => item.comment)).toContain(
        `${stamp}瑜伽来源评价正文足够长`,
      );
      expect(
        aliasReviewBody.items.some((item) => item.comment.includes("心理学泄漏")),
      ).toBe(false);

      const encodedWushu = encodeURIComponent(publicPeCourseIdentity("武术"));
      const [aliasWushu, publicWushu] = await Promise.all([
        fetchCourse("/api/courses/800002"),
        fetchCourse(`/api/courses/${encodedWushu}`),
      ]);
      expect(aliasWushu.status).toBe(200);
      expect(publicWushu.status).toBe(200);
      expect(await aliasWushu.json()).toEqual(await publicWushu.json());

      const session = await ordinaryWriteSession(`pe-alias-write-${stamp}`);
      const stableUserId = await hmacHex(
        `ordinary-test-user:${session.userId}`,
        ORDINARY_TEST_AUTH_SECRET,
      );
      const followAlias = await SELF.fetch(
        `${origin}/api/courses/800001/teachers/${yogaTeacherId}/follow`,
        {
          method: "PUT",
          headers: ordinaryWriteHeaders(session, {
            "Idempotency-Key": `follow-alias-${stamp}`,
          }),
        },
      );
      expect(followAlias.status).toBe(200);

      const followPublic = await SELF.fetch(
        `${origin}/api/courses/${encodedYoga}/teachers/${yogaTeacherId}/recommend`,
        {
          method: "PUT",
          headers: ordinaryWriteHeaders(session, {
            "Idempotency-Key": `rec-public-${stamp}`,
          }),
        },
      );
      expect(followPublic.status).toBe(200);

      const written = await env.DB.prepare(
        `SELECT course_id,teacher_id FROM relation_follows
         WHERE user_id=? ORDER BY course_id`,
      )
        .bind(stableUserId)
        .all<{ course_id: number; teacher_id: number }>();
      expect(written.results).toHaveLength(1);
      expect(written.results?.[0]?.teacher_id).toBe(yogaTeacherId);
      expect([800001, 800002]).not.toContain(written.results?.[0]?.course_id);
      const followSource = await env.DB.prepare(
        `SELECT 1 ok FROM catalog_relation_pe_specializations
         WHERE course_id=? AND teacher_id=? AND normalized_specialization=?`,
      )
        .bind(written.results?.[0]?.course_id, yogaTeacherId, "瑜伽")
        .first<{ ok: number }>();
      expect(followSource).toBeTruthy();

      const recommended = await env.DB.prepare(
        `SELECT course_id FROM relation_recommendations
         WHERE user_id=? AND stance='recommend'`,
      )
        .bind(stableUserId)
        .first<{ course_id: number }>();
      expect([800001, 800002]).not.toContain(recommended?.course_id);
      const recommendSource = await env.DB.prepare(
        `SELECT 1 ok FROM catalog_relation_pe_specializations
         WHERE course_id=? AND teacher_id=? AND normalized_specialization=?`,
      )
        .bind(recommended?.course_id, yogaTeacherId, "瑜伽")
        .first<{ ok: number }>();
      expect(recommendSource).toBeTruthy();

      expect(
        Number(
          (
            await env.DB.prepare(
              "SELECT COUNT(*) n FROM courses WHERE id IN (800001,800002)",
            ).first<{ n: number }>()
          )?.n,
        ),
      ).toBe(Number(virtualCoursesBefore?.n) || 0);
      expect(
        Number(
          (
            await env.DB.prepare(
              "SELECT COUNT(*) n FROM virtual_pe_notification_courses",
            ).first<{ n: number }>()
          )?.n,
        ),
      ).toBe(Number(virtualTableBefore?.n) || 0);
    } finally {
      await env.DB.prepare(
        `DELETE FROM catalog_relation_pe_specializations
         WHERE course_id IN (?,?)`,
      )
        .bind(yogaSourceId, wushuSourceId)
        .run();
    }
  });

  it("keeps relation list public_id usable as a detail identity", async () => {
    const stamp = `PE835R${Date.now()}`;
    const department = `${stamp}院`;
    const teacher = `${stamp}教师`;
    const teacherId = await insertTeacher(teacher, department);
    const tennisId = await insertCourse(`${stamp}-T`, "网球", department);
    await bindTeacher(tennisId, teacherId);
    await insertPeMapping({
      courseId: tennisId,
      teacherId,
      sourceKind: "direct_skill",
      specialization: "网球",
      courseCode: `${stamp}-T`,
      courseName: "网球",
      sourceTeacherLabel: teacher,
    });
    try {
      const listed = await SELF.fetch(
        `${origin}/api/courses?view=relations&q=${encodeURIComponent("网球")}&pageSize=50`,
      );
      expect(listed.status).toBe(200);
      const listBody = await listed.json<{
        items: Array<{
          public_id?: string;
          course_id: number | null;
          teacher_id: number | null;
        }>;
      }>();
      const row = listBody.items.find(
        (item) => item.public_id === publicPeRelationIdentity("网球", teacherId),
      );
      expect(row).toMatchObject({
        course_id: null,
        teacher_id: teacherId,
      });
      const relationPath = encodeURIComponent(row!.public_id!);
      const fromRelation = await fetchCourse(`/api/courses/${relationPath}`);
      expect(fromRelation.status).toBe(200);
      const detail = await fromRelation.json<CourseDetailBody>();
      expect(detail.course.public_id).toBe(publicPeCourseIdentity("网球"));
      expect(detail.course.teachers.map((item) => item.id)).toEqual([teacherId]);
    } finally {
      await env.DB.prepare(
        "DELETE FROM catalog_relation_pe_specializations WHERE course_id=?",
      )
        .bind(tennisId)
        .run();
    }
  });
});
