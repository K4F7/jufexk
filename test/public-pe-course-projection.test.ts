import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildPeSpecializationMapping } from "../src/lib/pe-specialization-mapping";
import { publicPeCourseIdentity } from "../src/lib/public-pe-course-projection";
import { CURRENT_SCORES } from "./review-score-fixtures";

const origin = "https://example.com";

type CourseListItem = {
  id: number | null;
  public_id?: string;
  code: string;
  name: string;
  category: string;
  department?: string;
  teachers?: string | null;
  review_count: number;
  rating?: number | null;
};

type CourseListBody = {
  items: CourseListItem[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
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
      5,
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

async function fetchCourses(query: string) {
  const response = await SELF.fetch(`${origin}/api/courses?${query}`);
  expect(response.status).toBe(200);
  return response.json<CourseListBody>();
}

describe.sequential("体育公共专项 Course 读取投影", () => {
  it("merges the same specialization, keeps display rules, and does not use Course ids", async () => {
    const stamp = `PE833A${Date.now()}`;
    const department = `${stamp}院`;
    const teacher = `${stamp}教师`;
    const teacherId = await insertTeacher(teacher, department);
    const basketId = await insertCourse(`${stamp}-B`, "篮球", department);
    const basketTwoId = await insertCourse(`${stamp}-B2`, "篮球2", department);
    const wushuId = await insertCourse(`${stamp}-W`, "武术", department);
    const umbrellaId = await insertCourse(`${stamp}-U`, "体育1", department);
    const unmappedUmbrellaId = await insertCourse(
      `${stamp}-U2`,
      "体育2",
      department,
    );
    await bindTeacher(basketId, teacherId);
    await bindTeacher(basketTwoId, teacherId);
    await bindTeacher(wushuId, teacherId);
    await bindTeacher(umbrellaId, teacherId);
    await bindTeacher(unmappedUmbrellaId, teacherId);
    await insertPeMapping({
      courseId: basketId,
      teacherId,
      sourceKind: "direct_skill",
      specialization: "篮球",
      courseCode: `${stamp}-B`,
      courseName: "篮球",
      sourceTeacherLabel: teacher,
    });
    await insertPeMapping({
      courseId: basketTwoId,
      teacherId,
      sourceKind: "direct_skill",
      specialization: "篮球",
      courseCode: `${stamp}-B2`,
      courseName: "篮球2",
      sourceTeacherLabel: teacher,
    });
    await insertPeMapping({
      courseId: wushuId,
      teacherId,
      sourceKind: "direct_skill",
      specialization: "武术",
      courseCode: `${stamp}-W`,
      courseName: "武术",
      sourceTeacherLabel: teacher,
    });
    await insertPeMapping({
      courseId: umbrellaId,
      teacherId,
      sourceKind: "umbrella",
      specialization: "武术",
      courseCode: `${stamp}-U`,
      courseName: "体育1",
      sourceTeacherLabel: teacher,
    });
    await insertApprovedReview({
      courseId: basketId,
      teacherId,
      comment: `${stamp}篮球评价正文足够长`,
    });
    await insertApprovedReview({
      courseId: basketTwoId,
      teacherId,
      comment: `${stamp}篮球2评价正文足够长`,
    });

    try {
      const listed = await fetchCourses(
        `department=${encodeURIComponent(department)}&pageSize=50`,
      );
      const names = listed.items.map((item) => item.name);
      expect(names.filter((name) => name === "篮球")).toHaveLength(1);
      expect(names).toContain("武术");
      expect(names).not.toContain("篮球2");
      expect(names).not.toContain("体育1-4 [武术]");
      expect(names).not.toContain("体育1");
      expect(names).not.toContain("体育2");

      const basketball = listed.items.find((item) => item.name === "篮球");
      expect(basketball).toMatchObject({
        id: null,
        public_id: publicPeCourseIdentity("篮球"),
        code: "",
        category: "sports",
        review_count: 2,
      });
      expect(basketball).not.toHaveProperty("rating");
      expect([basketId, basketTwoId, wushuId, umbrellaId]).not.toContain(
        basketball?.id,
      );
      expect(basketball?.teachers?.split(",")).toEqual(
        expect.arrayContaining([teacher]),
      );

      const wushu = listed.items.find((item) => item.name === "武术");
      expect(wushu).toMatchObject({
        id: null,
        public_id: publicPeCourseIdentity("武术"),
        review_count: 0,
      });

      const byTeacher = await fetchCourses(
        `q=${encodeURIComponent(teacher)}&pageSize=50`,
      );
      expect(byTeacher.items.map((item) => item.public_id)).toEqual(
        expect.arrayContaining([
          publicPeCourseIdentity("篮球"),
          publicPeCourseIdentity("武术"),
        ]),
      );

      const byName = await fetchCourses("q=篮球2&pageSize=50");
      expect(
        byName.items.find((item) => item.public_id === publicPeCourseIdentity("篮球"))
          ?.name,
      ).toBe("篮球");

      const byCode = await fetchCourses(`q=${stamp}-B2&pageSize=50`);
      expect(
        byCode.items.some((item) => item.public_id === publicPeCourseIdentity("篮球")),
      ).toBe(true);

      const unmapped = await fetchCourses(
        `q=${encodeURIComponent(stamp)}-U2&pageSize=50`,
      );
      expect(unmapped.items.map((item) => item.name)).not.toContain("体育2");
      expect(unmapped.total).toBe(0);
      expect(unmapped.pages).toBe(0);
    } finally {
      await env.DB.prepare(
        `DELETE FROM catalog_relation_pe_specializations
         WHERE course_id IN (?,?,?,?)`,
      )
        .bind(basketId, basketTwoId, wushuId, umbrellaId)
        .run();
    }
  });

  it("replaces hardcoded yoga/wushu virtual rows when mappings exist", async () => {
    const stamp = `PE833Y${Date.now()}`;
    const department = `${stamp}院`;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    )
      .bind("黄丽萍", "黄丽萍", department)
      .run();
    const teacher = await env.DB.prepare(
      "SELECT id FROM teachers WHERE name=? ORDER BY id LIMIT 1",
    )
      .bind("黄丽萍")
      .first<{ id: number }>();
    const teacherId = Number(teacher?.id);
    const umbrellaId = await insertCourse(`${stamp}-U`, "体育1", department);
    await bindTeacher(umbrellaId, teacherId);
    await insertPeMapping({
      courseId: umbrellaId,
      teacherId,
      sourceKind: "umbrella",
      specialization: "瑜伽",
      courseCode: `${stamp}-U`,
      courseName: "体育1",
      sourceTeacherLabel: "黄丽萍",
    });

    try {
      const listed = await fetchCourses(
        `q=${encodeURIComponent("瑜伽")}&category=sports&pageSize=50`,
      );
      const yoga = listed.items.filter(
        (item) =>
          item.public_id === publicPeCourseIdentity("瑜伽") ||
          item.name === "体育1-4 [瑜伽]" ||
          item.id === 800001,
      );
      expect(yoga).toHaveLength(1);
      expect(yoga[0]).toMatchObject({
        id: null,
        public_id: publicPeCourseIdentity("瑜伽"),
        name: "体育1-4 [瑜伽]",
      });
      expect(listed.items.some((item) => item.id === 800001)).toBe(false);
    } finally {
      await env.DB.prepare(
        "DELETE FROM catalog_relation_pe_specializations WHERE course_id=?",
      )
        .bind(umbrellaId)
        .run();
    }
  });

  it("sorts, paginates, and counts de-duplicated PE items once", async () => {
    const stamp = `PE833P${Date.now()}`;
    const department = `${stamp}院`;
    const teacher = `${stamp}教师`;
    const teacherId = await insertTeacher(teacher, department);
    const peId = await insertCourse(`${stamp}-PE`, "网球", department);
    const ordinaryId = await insertCourse(
      `${stamp}-ORD`,
      `${stamp}普通课`,
      department,
      "general",
    );
    await bindTeacher(peId, teacherId);
    await bindTeacher(ordinaryId, teacherId);
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
      comment: `${stamp}网球评价正文足够长`,
    });

    try {
      const first = await fetchCourses(
        `department=${encodeURIComponent(department)}&sort=name&page=1&pageSize=1`,
      );
      expect(first.total).toBe(2);
      expect(first.pages).toBe(2);
      expect(first.items).toHaveLength(1);
      const pages = [first.items[0]];
      const second = await fetchCourses(
        `department=${encodeURIComponent(department)}&sort=name&page=2&pageSize=1`,
      );
      expect(second.items).toHaveLength(1);
      pages.push(second.items[0]);
      expect(pages.map((item) => item.public_id).sort()).toEqual(
        [`course:${ordinaryId}`, publicPeCourseIdentity("网球")].sort(),
      );
      expect(
        pages.filter((item) => item.public_id === publicPeCourseIdentity("网球")),
      ).toHaveLength(1);

      const byReviews = await fetchCourses(
        `department=${encodeURIComponent(department)}&page=1&pageSize=1`,
      );
      expect(byReviews.items[0]).toMatchObject({
        public_id: publicPeCourseIdentity("网球"),
        review_count: 1,
      });
      expect(byReviews.items[0]).not.toHaveProperty("rating");

      const empty = await fetchCourses(
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

  it("keeps ordinary courses and English grouping on Course identity", async () => {
    const stamp = `PE833E${Date.now()}`;
    const department = `${stamp}院`;
    const teacher = `${stamp}教师`;
    const teacherId = await insertTeacher(teacher, department);
    const englishOne = await insertCourse(
      `${stamp}-E1`,
      "大学英语1",
      department,
      "general",
    );
    const englishTwo = await insertCourse(
      `${stamp}-E2`,
      "大学英语2",
      department,
      "general",
    );
    const mathId = await insertCourse(
      `${stamp}-M`,
      `${stamp}高数`,
      department,
      "general",
    );
    await bindTeacher(englishOne, teacherId);
    await bindTeacher(englishTwo, teacherId);
    await bindTeacher(mathId, teacherId);

    const listed = await fetchCourses(
      `department=${encodeURIComponent(department)}&pageSize=50`,
    );
    const english = listed.items.filter((item) =>
      item.name.startsWith("大学英语"),
    );
    expect(english.map((item) => item.name).sort()).toEqual([
      "大学英语1",
      "大学英语2",
    ]);
    expect(english.every((item) => item.id === englishOne || item.id === englishTwo)).toBe(
      true,
    );
    expect(english.map((item) => item.public_id).sort()).toEqual(
      [`course:${englishOne}`, `course:${englishTwo}`].sort(),
    );

    const math = listed.items.find((item) => item.id === mathId);
    expect(math).toMatchObject({
      id: mathId,
      public_id: `course:${mathId}`,
      name: `${stamp}高数`,
    });
    expect(math).not.toHaveProperty("rating");
  });
});
