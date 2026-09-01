import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildPeSpecializationMapping } from "../src/lib/pe-specialization-mapping";
import {
  publicPeCourseIdentity,
  publicPeRelationIdentity,
} from "../src/lib/public-pe-course-projection";
import { CURRENT_SCORES } from "./review-score-fixtures";

const origin = "https://example.com";

type RelationListItem = {
  course_id: number | null;
  public_id?: string;
  code: string;
  name: string;
  category: string;
  teacher_id: number | null;
  teacher_name: string | null;
  rating: number | null;
  review_count: number;
};

type RelationListBody = {
  items: RelationListItem[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

type CourseListItem = {
  id: number | null;
  public_id?: string;
  name: string;
  review_count: number;
  rating?: number | null;
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
  overall: number;
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
      input.overall,
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

async function fetchRelations(query: string) {
  const response = await SELF.fetch(
    `${origin}/api/courses?view=relations&${query}`,
  );
  expect(response.status).toBe(200);
  return response.json<RelationListBody>();
}

async function fetchCourses(query: string) {
  const response = await SELF.fetch(`${origin}/api/courses?${query}`);
  expect(response.status).toBe(200);
  return response.json<{ items: CourseListItem[]; total: number; pages: number }>();
}

describe.sequential("体育公共专项 Relation 读取投影", () => {
  it("merges the same specialization×teacher and recomputes rating from raw reviews", async () => {
    const stamp = `PE834A${Date.now()}`;
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
      comment: `${stamp}篮球高分一评价正文足够长`,
      overall: 5,
    });
    await insertApprovedReview({
      courseId: basketId,
      teacherId: firstId,
      comment: `${stamp}篮球高分二评价正文足够长`,
      overall: 5,
    });
    await insertApprovedReview({
      courseId: basketTwoId,
      teacherId: firstId,
      comment: `${stamp}篮球2低分一评价正文足够长`,
      overall: 1,
    });
    await insertApprovedReview({
      courseId: basketTwoId,
      teacherId: firstId,
      comment: `${stamp}篮球2低分二评价正文足够长`,
      overall: 1,
    });
    await insertApprovedReview({
      courseId: basketTwoId,
      teacherId: firstId,
      comment: `${stamp}篮球2低分三评价正文足够长`,
      overall: 1,
    });

    try {
      const listed = await fetchRelations(
        `department=${encodeURIComponent(department)}&pageSize=50`,
      );
      const peRows = listed.items.filter((item) => item.name === "篮球");
      expect(peRows).toHaveLength(2);
      expect(peRows.map((item) => item.teacher_name).sort()).toEqual(
        [firstTeacher, secondTeacher].sort(),
      );
      expect(new Set(peRows.map((item) => item.public_id)).size).toBe(2);

      const merged = peRows.find((item) => item.teacher_id === firstId);
      expect(merged).toMatchObject({
        course_id: null,
        public_id: publicPeRelationIdentity("篮球", firstId),
        code: "",
        category: "sports",
        teacher_id: firstId,
        teacher_name: firstTeacher,
        review_count: 5,
        rating: 2.6,
      });
      expect(merged).not.toHaveProperty("source_course_ids");
      expect(merged?.rating).not.toBe(3);
      expect([basketId, basketTwoId]).not.toContain(merged?.course_id);

      const otherTeacher = peRows.find((item) => item.teacher_id === secondId);
      expect(otherTeacher).toMatchObject({
        course_id: null,
        public_id: publicPeRelationIdentity("篮球", secondId),
        review_count: 0,
        rating: null,
      });

      const ordinary = listed.items.find((item) => item.course_id === ordinaryId);
      expect(ordinary).toMatchObject({
        course_id: ordinaryId,
        public_id: `relation:${ordinaryId}:${firstId}`,
        name: `${stamp}普通课`,
        teacher_id: firstId,
      });
      expect(listed.items.some((item) => item.course_id === basketId)).toBe(false);
      expect(listed.items.some((item) => item.course_id === basketTwoId)).toBe(
        false,
      );

      const courses = await fetchCourses(
        `department=${encodeURIComponent(department)}&pageSize=50`,
      );
      const basketballCourse = courses.items.find(
        (item) => item.public_id === publicPeCourseIdentity("篮球"),
      );
      expect(basketballCourse).toMatchObject({
        id: null,
        review_count: 5,
      });
      expect(basketballCourse).not.toHaveProperty("rating");

      const byTeacher = await fetchRelations(
        `q=${encodeURIComponent(firstTeacher)}&pageSize=50`,
      );
      expect(byTeacher.items.map((item) => item.public_id)).toEqual(
        expect.arrayContaining([publicPeRelationIdentity("篮球", firstId)]),
      );
      expect(
        byTeacher.items.some(
          (item) => item.public_id === publicPeRelationIdentity("篮球", secondId),
        ),
      ).toBe(false);

      const byName = await fetchRelations("q=篮球2&pageSize=50");
      expect(
        byName.items.find(
          (item) => item.public_id === publicPeRelationIdentity("篮球", firstId),
        )?.name,
      ).toBe("篮球");

      const byCode = await fetchRelations(`q=${stamp}-B2&pageSize=50`);
      expect(
        byCode.items.some(
          (item) => item.public_id === publicPeRelationIdentity("篮球", firstId),
        ),
      ).toBe(true);
    } finally {
      await env.DB.prepare(
        `DELETE FROM catalog_relation_pe_specializations
         WHERE course_id IN (?,?)`,
      )
        .bind(basketId, basketTwoId)
        .run();
    }
  });

  it("does not list unmapped umbrella Relations and ignores no-teacher rows in total", async () => {
    const stamp = `PE834U${Date.now()}`;
    const department = `${stamp}院`;
    const teacher = `${stamp}教师`;
    const teacherId = await insertTeacher(teacher, department);
    const umbrellaId = await insertCourse(`${stamp}-U`, "体育1", department);
    const noTeacherA = await insertCourse(
      `${stamp}-NA`,
      `${stamp}无师甲`,
      department,
      "general",
    );
    const noTeacherB = await insertCourse(
      `${stamp}-NB`,
      `${stamp}无师乙`,
      department,
      "general",
    );
    const ordinaryId = await insertCourse(
      `${stamp}-ORD`,
      `${stamp}普通课`,
      department,
      "general",
    );
    const peId = await insertCourse(`${stamp}-PE`, "网球", department);
    await bindTeacher(umbrellaId, teacherId);
    await bindTeacher(ordinaryId, teacherId);
    await bindTeacher(peId, teacherId);
    await insertPeMapping({
      courseId: peId,
      teacherId,
      sourceKind: "direct_skill",
      specialization: "网球",
      courseCode: `${stamp}-PE`,
      courseName: "网球",
      sourceTeacherLabel: teacher,
    });

    try {
      const listed = await fetchRelations(
        `department=${encodeURIComponent(department)}&pageSize=50`,
      );
      expect(listed.total).toBe(2);
      expect(listed.pages).toBe(1);
      expect(listed.items.map((item) => item.public_id).sort()).toEqual(
        [
          `relation:${ordinaryId}:${teacherId}`,
          publicPeRelationIdentity("网球", teacherId),
        ].sort(),
      );
      expect(listed.items.map((item) => item.name)).not.toContain("体育1");
      expect(listed.items.some((item) => item.course_id === umbrellaId)).toBe(
        false,
      );
      expect(listed.items.some((item) => item.course_id === noTeacherA)).toBe(
        false,
      );
      expect(listed.items.some((item) => item.course_id === noTeacherB)).toBe(
        false,
      );
      expect(listed.items.some((item) => item.teacher_id == null)).toBe(false);

      const unmapped = await fetchRelations(
        `q=${encodeURIComponent(`${stamp}-U`)}&pageSize=20`,
      );
      expect(unmapped.items.map((item) => item.name)).not.toContain("体育1");
      expect(unmapped.total).toBe(0);
      expect(unmapped.pages).toBe(0);
    } finally {
      await env.DB.prepare(
        "DELETE FROM catalog_relation_pe_specializations WHERE course_id=?",
      )
        .bind(peId)
        .run();
    }
  });

  it("sorts, paginates, and returns pages=0 for empty Relation results", async () => {
    const stamp = `PE834P${Date.now()}`;
    const department = `${stamp}院`;
    const teacher = `${stamp}教师`;
    const teacherId = await insertTeacher(teacher, department);
    const peId = await insertCourse(`${stamp}-PE`, "网球", department);
    const highId = await insertCourse(
      `${stamp}-H`,
      `${stamp}高分课`,
      department,
      "general",
    );
    const lowId = await insertCourse(
      `${stamp}-L`,
      `${stamp}低分课`,
      department,
      "general",
    );
    await bindTeacher(peId, teacherId);
    await bindTeacher(highId, teacherId);
    await bindTeacher(lowId, teacherId);
    await insertPeMapping({
      courseId: peId,
      teacherId,
      sourceKind: "direct_skill",
      specialization: "网球",
      courseCode: `${stamp}-PE`,
      courseName: "网球",
      sourceTeacherLabel: teacher,
    });
    await insertApprovedReview({
      courseId: peId,
      teacherId,
      comment: `${stamp}网球评价一正文足够长`,
      overall: 4,
    });
    await insertApprovedReview({
      courseId: peId,
      teacherId,
      comment: `${stamp}网球评价二正文足够长`,
      overall: 4,
    });
    await insertApprovedReview({
      courseId: highId,
      teacherId,
      comment: `${stamp}高分评价正文足够长`,
      overall: 5,
    });

    try {
      const first = await fetchRelations(
        `department=${encodeURIComponent(department)}&sort=name&page=1&pageSize=1`,
      );
      expect(first.total).toBe(3);
      expect(first.pages).toBe(3);
      expect(first.items).toHaveLength(1);
      const pages = [first.items[0]];
      for (let page = 2; page <= first.pages; page += 1) {
        const next = await fetchRelations(
          `department=${encodeURIComponent(department)}&sort=name&page=${page}&pageSize=1`,
        );
        expect(next.items).toHaveLength(1);
        pages.push(next.items[0]);
      }
      expect(pages.map((item) => item.public_id).sort()).toEqual(
        [
          `relation:${highId}:${teacherId}`,
          `relation:${lowId}:${teacherId}`,
          publicPeRelationIdentity("网球", teacherId),
        ].sort(),
      );
      expect(
        pages.filter(
          (item) => item.public_id === publicPeRelationIdentity("网球", teacherId),
        ),
      ).toHaveLength(1);

      const byRating = await fetchRelations(
        `department=${encodeURIComponent(department)}&sort=rating&pageSize=50`,
      );
      expect(byRating.items.map((item) => item.public_id)).toEqual([
        `relation:${highId}:${teacherId}`,
        publicPeRelationIdentity("网球", teacherId),
        `relation:${lowId}:${teacherId}`,
      ]);

      const byReviews = await fetchRelations(
        `department=${encodeURIComponent(department)}&page=1&pageSize=1`,
      );
      expect(byReviews.items[0]).toMatchObject({
        public_id: publicPeRelationIdentity("网球", teacherId),
        review_count: 2,
        rating: 4,
      });

      const empty = await fetchRelations(
        `q=${encodeURIComponent(`${stamp}不存在的课`)}&pageSize=20`,
      );
      expect(empty).toMatchObject({ items: [], total: 0, pages: 0 });
    } finally {
      await env.DB.prepare(
        "DELETE FROM catalog_relation_pe_specializations WHERE course_id=?",
      )
        .bind(peId)
        .run();
    }
  });
});
