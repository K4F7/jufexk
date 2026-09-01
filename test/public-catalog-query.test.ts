import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  queryPublicCourseRelations,
  queryPublicCourses,
  type PublicCatalogPage,
  type PublicCourseListItem,
  type PublicCourseListQuery,
  type PublicRelationListItem,
  type PublicRelationListQuery,
} from "../src/public-catalog-query";
import { CURRENT_SCORES } from "./review-score-fixtures";

const department = "目录查询学院";

async function insertTeacher(name: string, sourceLabel = name) {
  const result = await env.DB.prepare(
    "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
  )
    .bind(sourceLabel, name, department)
    .run();
  return Number(result.meta.last_row_id);
}

async function insertCourse(code: string, name: string) {
  const result = await env.DB.prepare(
    "INSERT INTO courses(code,name,category,department,scheme_key) VALUES(?,?,?,?,?)",
  )
    .bind(code, name, "general", department, "major")
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

async function insertApprovedReview(input: {
  courseId: number;
  teacherId: number;
  comment: string;
  overall: number;
  scores?: Record<string, number>;
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
      "general",
      input.overall,
      input.comment,
      "2026 春",
      "approved",
      `hash-${input.comment}-${Math.random()}`,
      "major",
      2,
      JSON.stringify(input.scores ?? CURRENT_SCORES),
      "2026-08-12 01:00:00",
    )
    .run();
}

function courseQuery(
  overrides: Partial<PublicCourseListQuery> = {},
): PublicCourseListQuery {
  return {
    page: 1,
    pageSize: 50,
    q: "",
    category: "",
    department: "",
    teacherId: null,
    sort: "reviews",
    ...overrides,
  };
}

function relationQuery(
  overrides: Partial<PublicRelationListQuery> = {},
): PublicRelationListQuery {
  return {
    page: 1,
    pageSize: 50,
    q: "",
    category: "",
    department: "",
    teacherId: null,
    sort: "reviews",
    ...overrides,
  };
}

describe("公开目录查询 module", () => {
  it("查询课程列表时，精确教师名仍返回该课全部教师", async () => {
    const stamp = `缝课程${Date.now()}`;
    const firstTeacher = `${stamp}甲师`;
    const secondTeacher = `${stamp}乙师`;
    const courseName = `${stamp}高数`;
    const firstId = await insertTeacher(firstTeacher);
    const secondId = await insertTeacher(secondTeacher);
    const courseId = await insertCourse(`PCQ-C-${stamp}`, courseName);
    await bindTeacher(courseId, firstId);
    await bindTeacher(courseId, secondId);

    const page: PublicCatalogPage<PublicCourseListItem> =
      await queryPublicCourses(
        env.DB,
        courseQuery({ q: secondTeacher, department }),
      );

    expect(page).toMatchObject({
      page: 1,
      pageSize: 50,
      total: 1,
      pages: 1,
    });
    const row = page.items.find((item) => item.name === courseName);
    expect(row?.id).toBe(courseId);
    expect(row?.public_id).toBe(`course:${courseId}`);
    expect(row?.teachers?.split(",")).toEqual(
      expect.arrayContaining([firstTeacher, secondTeacher]),
    );
    expect(row).not.toHaveProperty("rating");

    const byName = await queryPublicCourses(
      env.DB,
      courseQuery({ q: courseName, department, sort: "name" }),
    );
    expect(byName.items.map((item) => item.name)).toEqual([courseName]);

    const sportsOnly = await queryPublicCourses(
      env.DB,
      courseQuery({ q: courseName, department, category: "sports" }),
    );
    expect(sportsOnly.items).toEqual([]);
    expect(sportsOnly.total).toBe(0);
  });

  it("查询课程列表时，多词 AND 与通配符字面量保持原语义", async () => {
    const stamp = `缝搜${Date.now() % 1_000_000}`;
    const teacher = `${stamp}教师`;
    const math = `${stamp}高数`;
    const percent = `${stamp}百分号100%课`;
    const teacherId = await insertTeacher(teacher);
    const mathId = await insertCourse(`PCQ-AND-${stamp}`, math);
    const percentId = await insertCourse(`PCQ-PCT-${stamp}`, percent);
    await bindTeacher(mathId, teacherId);
    await bindTeacher(percentId, teacherId);

    const andPage = await queryPublicCourses(
      env.DB,
      courseQuery({ q: `${math} ${teacher}`, department }),
    );
    expect(andPage.items.map((item) => item.name)).toEqual([math]);
    expect(andPage.total).toBe(1);

    const wildcard = await queryPublicCourses(
      env.DB,
      courseQuery({ q: "%", department }),
    );
    expect(wildcard.items.map((item) => item.name)).toContain(percent);
    expect(wildcard.items.map((item) => item.name)).not.toContain(math);
  });

  it("虚拟体育课程按名称排序时遵守 pageSize 并跨页保留", async () => {
    const stamp = `缝体育${Date.now()}`;
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
    const courseId = await insertCourse(`PCQ-PE-${stamp}`, `瑜伽课程${stamp}`);
    await env.DB.prepare("UPDATE courses SET category='sports',scheme_key='pe' WHERE id=?")
      .bind(courseId)
      .run();
    if (teacher) await bindTeacher(courseId, Number(teacher.id));

    const first = await queryPublicCourses(
      env.DB,
      courseQuery({ q: "瑜伽", category: "sports", sort: "name", pageSize: 1 }),
    );
    expect(first.items).toHaveLength(1);
    expect(first.pages).toBeGreaterThanOrEqual(2);

    const pages = [first.items];
    for (let page = 2; page <= first.pages; page += 1) {
      const next = await queryPublicCourses(
        env.DB,
        courseQuery({
          q: "瑜伽",
          category: "sports",
          sort: "name",
          pageSize: 1,
          page,
        }),
      );
      expect(next.items.length).toBeLessThanOrEqual(1);
      pages.push(next.items);
    }
    expect(pages.flat().some((item) => item.id === 800001)).toBe(true);
    expect(pages.flat().some((item) => item.id === courseId)).toBe(true);
  });

  it("查询任课关系列表时返回完整公开投影，精确教师名只留下该教师", async () => {
    const stamp = `缝关系${Date.now()}`;
    const firstTeacher = `${stamp}甲师`;
    const secondTeacher = `${stamp}乙师`;
    const courseName = `${stamp}接口课`;
    const firstId = await insertTeacher(firstTeacher);
    const secondId = await insertTeacher(secondTeacher);
    const courseId = await insertCourse(`PCQ-R-${stamp}`, courseName);
    await bindTeacher(courseId, firstId);
    await bindTeacher(courseId, secondId);
    await insertApprovedReview({
      courseId,
      teacherId: firstId,
      comment: `${stamp}高分四维评价正文足够长`,
      overall: 5,
    });
    const viewerId = `pcq-viewer-${stamp}`;
    await env.DB.prepare(
      "INSERT INTO relation_follows(user_id,course_id,teacher_id) VALUES(?,?,?)",
    )
      .bind(viewerId, courseId, firstId)
      .run();
    await env.DB.prepare(
      "INSERT INTO relation_recommendations(user_id,course_id,teacher_id,stance) VALUES(?,?,?,?)",
    )
      .bind(viewerId, courseId, firstId, "recommend")
      .run();

    const byTeacher = await queryPublicCourseRelations(
      env.DB,
      relationQuery({ q: firstTeacher, department }),
      viewerId,
    );
    expect(byTeacher.total).toBe(1);
    const row: PublicRelationListItem | undefined = byTeacher.items[0];
    expect(row).toMatchObject({
      course_id: courseId,
      name: courseName,
      teacher_id: firstId,
      teacher_name: firstTeacher,
      rating: 5,
      review_count: 1,
      follow_count: 1,
      recommend_count: 1,
      not_recommend_count: 0,
      viewer_followed: true,
      viewer_recommended: true,
      viewer_not_recommended: false,
    });
    expect(row.dimensionLabels).toEqual([
      { id: "difficulty", label: "课程难度", option: "简单" },
      { id: "homework", label: "作业多少", option: "中等" },
      { id: "grading", label: "给分好坏", option: "杀手" },
      { id: "gain", label: "收获多少", option: "一般" },
    ]);

    const guest = await queryPublicCourseRelations(
      env.DB,
      relationQuery({ q: firstTeacher, department }),
      null,
    );
    expect(guest.items[0]).toMatchObject({
      follow_count: 1,
      recommend_count: 1,
      not_recommend_count: 0,
    });
    expect(guest.items[0]).not.toHaveProperty("viewer_followed");

    const byCourse = await queryPublicCourseRelations(
      env.DB,
      relationQuery({ q: courseName, department }),
      null,
    );
    expect(byCourse.items.map((item) => item.teacher_name).sort()).toEqual(
      [firstTeacher, secondTeacher].sort(),
    );
    expect(byCourse.total).toBe(2);
  });

  it("查询任课关系列表时，source_teacher_label 精确命中且 rating 排序保持原语义", async () => {
    const stamp = `缝来源${Date.now()}`;
    const sourceLabel = `${stamp}来源名1`;
    const displayName = `${stamp}来源显示名`;
    const otherTeacher = `${stamp}乙师`;
    const highCourse = `${stamp}高分课`;
    const lowCourse = `${stamp}低分课`;
    const sourceId = await insertTeacher(displayName, sourceLabel);
    const otherId = await insertTeacher(otherTeacher);
    const highId = await insertCourse(`PCQ-H-${stamp}`, highCourse);
    const lowId = await insertCourse(`PCQ-L-${stamp}`, lowCourse);
    await bindTeacher(highId, sourceId);
    await bindTeacher(highId, otherId);
    await bindTeacher(lowId, sourceId);
    await insertApprovedReview({
      courseId: highId,
      teacherId: sourceId,
      comment: `${stamp}高分评价正文足够长`,
      overall: 5,
    });
    await insertApprovedReview({
      courseId: lowId,
      teacherId: sourceId,
      comment: `${stamp}低分评价正文足够长`,
      overall: 2,
    });

    const exact = await queryPublicCourseRelations(
      env.DB,
      relationQuery({ q: sourceLabel, department }),
      null,
    );
    expect(exact.items.map((item) => item.teacher_name)).toEqual([
      displayName,
      displayName,
    ]);
    expect(exact.total).toBe(2);

    const rated = await queryPublicCourseRelations(
      env.DB,
      relationQuery({ q: sourceLabel, department, sort: "rating" }),
      null,
    );
    expect(rated.items.map((item) => item.course_id)).toEqual([highId, lowId]);
  });
});
