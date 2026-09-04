import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildPeSpecializationMapping } from "../src/lib/pe-specialization-mapping";
import {
  publicPeCourseIdentity,
  publicPeRelationIdentity,
} from "../src/lib/public-pe-course-projection";
import { publicCatalogListScope } from "../src/lib/public-catalog-list";
import {
  loadGroupedRelationDimensionLabels,
  loadRelationDimensionLabels,
} from "../src/lib/relation-projections";
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

const origin = "https://example.com";

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

  it("两个读取入口对搜索、专项、分页与英语真实 Course 保持同一外部行为", async () => {
    const stamp = `缝双口${Date.now()}`;
    const localDepartment = `${stamp}院`;
    const teacher = `${stamp}教师`;
    const teacherId = await insertTeacher(teacher);
    const peId = await insertCourse(`${stamp}-PE`, "网球");
    const ordinaryId = await insertCourse(`${stamp}-ORD`, `${stamp}普通课`);
    const englishOne = await insertCourse(`${stamp}-E1`, "大学英语1");
    const englishTwo = await insertCourse(`${stamp}-E2`, "大学英语2");
    await env.DB.prepare("UPDATE teachers SET department=? WHERE id=?")
      .bind(localDepartment, teacherId)
      .run();
    await env.DB.prepare(
      "UPDATE courses SET department=? WHERE id IN (?,?,?,?)",
    )
      .bind(localDepartment, peId, ordinaryId, englishOne, englishTwo)
      .run();
    await env.DB.prepare(
      "UPDATE courses SET category='sports',scheme_key='pe' WHERE id=?",
    )
      .bind(peId)
      .run();
    await bindTeacher(peId, teacherId);
    await bindTeacher(ordinaryId, teacherId);
    await bindTeacher(englishOne, teacherId);
    await bindTeacher(englishTwo, teacherId);
    const mapping = buildPeSpecializationMapping({
      sourceKind: "direct_skill",
      normalizedSpecialization: "网球",
      evidenceKind: "catalog_course_name",
      sourceCourseCode: `${stamp}-PE`,
      sourceCourseName: "网球",
      sourceTeacherLabel: teacher,
      rawSpecializationName: "网球",
    });
    await env.DB.prepare(
      `INSERT INTO catalog_relation_pe_specializations(
        course_id,teacher_id,source_kind,normalized_specialization,display_semantics,evidence_json
      ) VALUES(?,?,?,?,?,?)`,
    )
      .bind(
        peId,
        teacherId,
        mapping.sourceKind,
        mapping.normalizedSpecialization,
        mapping.displaySemantics,
        JSON.stringify(mapping.evidence),
      )
      .run();

    try {
      const query = `department=${encodeURIComponent(localDepartment)}&pageSize=50`;
      const coursesResponse = await SELF.fetch(`${origin}/api/courses?${query}`);
      const relationsResponse = await SELF.fetch(
        `${origin}/api/courses?view=relations&${query}`,
      );
      expect(coursesResponse.status).toBe(200);
      expect(relationsResponse.status).toBe(200);
      const courses = await coursesResponse.json<{
        items: Array<{
          id: number | null;
          public_id: string;
          name: string;
        }>;
        total: number;
        pages: number;
      }>();
      const relations = await relationsResponse.json<{
        items: Array<{
          course_id: number | null;
          public_id: string;
          name: string;
          teacher_id: number | null;
        }>;
        total: number;
        pages: number;
      }>();

      expect(courses.total).toBe(4);
      expect(relations.total).toBe(4);
      expect(courses.pages).toBe(1);
      expect(relations.pages).toBe(1);

      const peCourse = courses.items.find(
        (item) => item.public_id === publicPeCourseIdentity("网球"),
      );
      const peRelation = relations.items.find(
        (item) => item.public_id === publicPeRelationIdentity("网球", teacherId),
      );
      expect(peCourse).toMatchObject({
        id: null,
        name: "网球",
      });
      expect(peRelation).toMatchObject({
        course_id: null,
        name: "网球",
        teacher_id: teacherId,
      });
      expect(courses.items.some((item) => item.id === peId)).toBe(false);
      expect(relations.items.some((item) => item.course_id === peId)).toBe(false);

      const englishCourses = courses.items.filter((item) =>
        item.name.startsWith("大学英语"),
      );
      const englishRelations = relations.items.filter((item) =>
        item.name.startsWith("大学英语"),
      );
      expect(englishCourses.map((item) => item.name).sort()).toEqual([
        "大学英语1",
        "大学英语2",
      ]);
      expect(englishRelations.map((item) => item.name).sort()).toEqual([
        "大学英语1",
        "大学英语2",
      ]);
      expect(englishCourses.map((item) => item.id).sort()).toEqual(
        [englishOne, englishTwo].sort((left, right) => left - right),
      );
      expect(englishRelations.map((item) => item.course_id).sort()).toEqual(
        [englishOne, englishTwo].sort((left, right) => left - right),
      );
      expect(englishCourses.map((item) => item.public_id).sort()).toEqual(
        [`course:${englishOne}`, `course:${englishTwo}`].sort(),
      );
      expect(englishRelations.map((item) => item.public_id).sort()).toEqual(
        [
          `relation:${englishOne}:${teacherId}`,
          `relation:${englishTwo}:${teacherId}`,
        ].sort(),
      );

      const pagedQuery = `department=${encodeURIComponent(localDepartment)}&sort=name&page=1&pageSize=1`;
      const byNameCourses = await SELF.fetch(
        `${origin}/api/courses?${pagedQuery}`,
      ).then((response) =>
        response.json<{ items: Array<{ public_id: string }>; pages: number }>(),
      );
      const byNameRelations = await SELF.fetch(
        `${origin}/api/courses?view=relations&${pagedQuery}`,
      ).then((response) =>
        response.json<{ items: Array<{ public_id: string }>; pages: number }>(),
      );
      expect(byNameCourses.pages).toBe(4);
      expect(byNameRelations.pages).toBe(4);
      expect(byNameCourses.items).toHaveLength(1);
      expect(byNameRelations.items).toHaveLength(1);

      const searchQuery = `q=${encodeURIComponent("网球")}&pageSize=50`;
      const searchedCourses = await SELF.fetch(
        `${origin}/api/courses?${searchQuery}`,
      ).then((response) =>
        response.json<{ items: Array<{ public_id: string }> }>(),
      );
      const searchedRelations = await SELF.fetch(
        `${origin}/api/courses?view=relations&${searchQuery}`,
      ).then((response) =>
        response.json<{ items: Array<{ public_id: string }> }>(),
      );
      expect(
        searchedCourses.items.some(
          (item) => item.public_id === publicPeCourseIdentity("网球"),
        ),
      ).toBe(true);
      expect(
        searchedRelations.items.some(
          (item) =>
            item.public_id === publicPeRelationIdentity("网球", teacherId),
        ),
      ).toBe(true);
    } finally {
      await env.DB.prepare(
        "DELETE FROM catalog_relation_pe_specializations WHERE course_id=?",
      )
        .bind(peId)
        .run();
    }
  });

  it("omits the empty-department tautology from the list scope", () => {
    const empty = publicCatalogListScope({
      category: "",
      department: "",
      teacherId: null,
    });
    expect(empty.sql).not.toContain("?=''");
    expect(empty.args).toEqual([]);

    const scoped = publicCatalogListScope({
      category: "math",
      department: "数学学院",
      teacherId: 4,
    });
    expect(scoped.sql).toContain("trim(c.department)=trim(?)");
    expect(scoped.args).toEqual(["math", "数学学院", 4]);
  });

  it("unfiltered browse ranks by review_count and uses precomputed totals", async () => {
    const page = await queryPublicCourseRelations(
      env.DB,
      relationQuery({ pageSize: 20 }),
      null,
    );
    expect(page.items.length).toBeGreaterThan(0);
    for (let index = 1; index < page.items.length; index += 1) {
      expect(page.items[index - 1].review_count).toBeGreaterThanOrEqual(
        page.items[index].review_count,
      );
    }
    const stored = await env.DB.prepare(
      "SELECT n FROM public_relation_list_totals WHERE category='all'",
    ).first<{ n: number }>();
    expect(Number(stored?.n) || 0).toBeGreaterThan(0);
    expect(page.total).toBeGreaterThanOrEqual(Number(stored?.n) || 0);

    const math = await queryPublicCourseRelations(
      env.DB,
      relationQuery({ category: "math", pageSize: 5 }),
      null,
    );
    const mathTotal = await env.DB.prepare(
      "SELECT n FROM public_relation_list_totals WHERE category='math'",
    ).first<{ n: number }>();
    expect(math.total).toBe(Number(mathTotal?.n) || math.total);

    const rated = await queryPublicCourseRelations(
      env.DB,
      relationQuery({ sort: "rating", pageSize: 20 }),
      null,
    );
    let seenUnrated = false;
    let previousRating = Number.POSITIVE_INFINITY;
    for (const item of rated.items) {
      if (item.rating == null) {
        seenUnrated = true;
        continue;
      }
      expect(seenUnrated).toBe(false);
      expect(item.rating).toBeLessThanOrEqual(previousRating);
      previousRating = item.rating;
    }
  });

  it("rating browse later pages keep item counts aligned with total/pages", async () => {
    const stamp = `缝评分页${Date.now()}`;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
    )
      .bind("黄丽萍", "黄丽萍", department)
      .run();
    const teacherId = await insertTeacher(`${stamp}教师`);
    const ratedId = await insertCourse(`PCQ-RT-${stamp}`, `${stamp}已评分`);
    await bindTeacher(ratedId, teacherId);
    await insertApprovedReview({
      courseId: ratedId,
      teacherId,
      comment: `${stamp}评分页评价正文足够长`,
      overall: 4,
    });
    for (let index = 0; index < 24; index += 1) {
      const courseId = await insertCourse(
        `PCQ-UR-${stamp}-${index}`,
        `${stamp}未评分${index}`,
      );
      await bindTeacher(courseId, teacherId);
    }

    const pageSize = 5;
    const first = await queryPublicCourseRelations(
      env.DB,
      relationQuery({ sort: "rating", pageSize }),
      null,
    );
    expect(first.total).toBeGreaterThan(pageSize);
    expect(first.pages).toBeGreaterThan(1);
    expect(first.items).toHaveLength(pageSize);

    const laterPage = first.pages;
    const later = await queryPublicCourseRelations(
      env.DB,
      relationQuery({ sort: "rating", pageSize, page: laterPage }),
      null,
    );
    expect(later.total).toBe(first.total);
    expect(later.pages).toBe(first.pages);
    expect(later.items).toHaveLength(first.total - (laterPage - 1) * pageSize);
  });

  it("chunks dimension-label pair binds under the D1 parameter limit", async () => {
    const pairs = Array.from({ length: 60 }, (_, index) => ({
      courseId: 1,
      teacherId: index + 1,
    }));
    await expect(
      loadRelationDimensionLabels(env.DB, pairs),
    ).resolves.toBeInstanceOf(Map);
    await expect(
      loadGroupedRelationDimensionLabels(env.DB, [
        { key: "pe-over-cap", sources: pairs },
      ]),
    ).resolves.toBeInstanceOf(Map);
  });
});
