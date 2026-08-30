import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const origin = "https://example.com";
const marker = `可见评价排序-${Date.now()}`;
const departmentMarker = `独立排序院系-${Date.now()}`;

let exactCourseId: number;
let popularCourseId: number;
let zeroCourseId: number;
let exactTeacherId: number;
let popularTeacherId: number;
let zeroTeacherId: number;
let tiedTeacherId: number;

async function insertLiveReview(courseId: number, teacherId: number, comment: string, status = "approved") {
  await env.DB.prepare(
    `INSERT INTO reviews(course_id,teacher_id,category,overall,comment,status,submitter_hash)
     VALUES(?,?,'general',4,?,?,?)`,
  )
    .bind(courseId, teacherId, comment, status, `${marker}-${courseId}-${teacherId}-${comment}-${status}`)
    .run();
}

beforeAll(async () => {
  const teachers = [];
  for (const [name, department] of [
    [marker, `${marker}-精确院系`],
    [`${marker}-高量教师`, marker],
    [`${marker}-零量教师`, `${marker}-零量院系`],
  ]) {
    const result = await env.DB.prepare(
      "INSERT INTO teachers(source_teacher_label,name,department,title) VALUES(?,?,?,'讲师')",
    )
      .bind(name, name, department)
      .run();
    teachers.push(Number(result.meta.last_row_id));
  }
  [exactTeacherId, popularTeacherId, zeroTeacherId] = teachers;
  const tiedTeacher = await env.DB.prepare(
    "INSERT INTO teachers(source_teacher_label,name,department,title) VALUES(?,?,?,'讲师')",
  )
    .bind(`${marker}-同名来源`, `${marker}-零量教师`, `${marker}-零量院系`)
    .run();
  tiedTeacherId = Number(tiedTeacher.meta.last_row_id);

  const courses = [];
  for (const [code, name] of [
    [`${marker}-EXACT`, marker],
    [`${marker}-POPULAR`, `${marker}-高量课程`],
    [`${marker}-ZERO`, `${marker}-零量课程`],
  ]) {
    const result = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,?,'general',?)",
    )
      .bind(code, name, departmentMarker)
      .run();
    courses.push(Number(result.meta.last_row_id));
  }
  [exactCourseId, popularCourseId, zeroCourseId] = courses;

  await env.DB.batch([
    env.DB.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)").bind(
      exactCourseId,
      exactTeacherId,
    ),
    env.DB.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)").bind(
      popularCourseId,
      popularTeacherId,
    ),
    env.DB.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)").bind(
      popularCourseId,
      exactTeacherId,
    ),
    env.DB.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)").bind(
      popularCourseId,
      zeroTeacherId,
    ),
    env.DB.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)").bind(
      popularCourseId,
      tiedTeacherId,
    ),
    env.DB.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)").bind(
      zeroCourseId,
      zeroTeacherId,
    ),
  ]);

  await insertLiveReview(exactCourseId, exactTeacherId, "精确匹配的一条公开评价");
  await insertLiveReview(popularCourseId, popularTeacherId, "高量课程的公开评价");
  await insertLiveReview(popularCourseId, popularTeacherId, "   ");
  await insertLiveReview(popularCourseId, popularTeacherId, "待审核评价", "pending");

  await env.DB.prepare(
    `INSERT INTO public_historical_reviews(
       id,course_id,teacher_id,comment,package_contract,
       approved_package_manifest_sha256,approved_catalog_content_sha256
     ) VALUES(?,?,?,'冻结公开文字','legacy-historical-production-freeze-v1',?,?)`,
  )
    .bind(`${marker}-historical`, popularCourseId, popularTeacherId, "c".repeat(64), "d".repeat(64))
    .run();
});

describe("visible text review catalog ordering", () => {
  it("sorts course browsing by unified visible text count and exposes zero counts", async () => {
    const response = await SELF.fetch(
      `${origin}/api/courses?department=${encodeURIComponent(departmentMarker)}&pageSize=10`,
    );
    const body = await response.json<{ items: Array<{ id: number; review_count: number }> }>();

    expect(body.items.map(({ id, review_count }) => [id, review_count])).toEqual([
      [popularCourseId, 2],
      [exactCourseId, 1],
      [zeroCourseId, 0],
    ]);
  });

  it("keeps direct course matches ahead of review count and paginates deterministically", async () => {
    const response = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent(marker)}&department=${encodeURIComponent(departmentMarker)}&pageSize=1`,
    );
    const first = await response.json<{ items: Array<{ id: number }>; total: number }>();
    const second = await (
      await SELF.fetch(
        `${origin}/api/courses?q=${encodeURIComponent(marker)}&department=${encodeURIComponent(departmentMarker)}&page=2&pageSize=1`,
      )
    ).json<{ items: Array<{ id: number }> }>();

    expect(first.total).toBe(3);
    expect(first.items[0].id).toBe(exactCourseId);
    expect(second.items[0].id).toBe(popularCourseId);

    const department = await (
      await SELF.fetch(`${origin}/api/courses?q=${encodeURIComponent(departmentMarker)}&pageSize=10`)
    ).json<{ items: Array<{ id: number }> }>();
    expect(department.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([exactCourseId, popularCourseId, zeroCourseId]),
    );
  });

  it("sorts teacher browsing by count while preserving name relevance in searches", async () => {
    const browse = await (
      await SELF.fetch(`${origin}/api/teachers?pageSize=50`)
    ).json<{ items: Array<Record<string, unknown> & { id: number; review_count: number }> }>();
    const ids = browse.items.map((item) => item.id);
    expect(ids.indexOf(popularTeacherId)).toBeLessThan(ids.indexOf(exactTeacherId));
    expect(ids.indexOf(exactTeacherId)).toBeLessThan(ids.indexOf(zeroTeacherId));
    expect(browse.items.find((item) => item.id === popularTeacherId)?.review_count).toBe(2);
    expect(browse.items.find((item) => item.id === zeroTeacherId)?.review_count).toBe(0);
    expect(browse.items.every((item) => !("rating" in item))).toBe(true);

    const search = await (
      await SELF.fetch(`${origin}/api/teachers?q=${encodeURIComponent(marker)}&pageSize=10`)
    ).json<{ items: Array<{ id: number }> }>();
    expect(search.items[0].id).toBe(exactTeacherId);
  });

  it("sorts both detail relation lists by relation-specific visible counts", async () => {
    const course = await (
      await SELF.fetch(`${origin}/api/courses/${popularCourseId}`)
    ).json<{ course: { teachers: Array<{ id: number; review_count: number }> } }>();
    expect(course.course.teachers.map(({ id, review_count }) => [id, review_count])).toEqual([
      [popularTeacherId, 2],
      [exactTeacherId, 0],
      [zeroTeacherId, 0],
      [tiedTeacherId, 0],
    ]);

    const teacher = await (
      await SELF.fetch(`${origin}/api/teachers/${exactTeacherId}`)
    ).json<{ courses: Array<{ id: number; review_count: number }> }>();
    expect(teacher.courses.map(({ id, review_count }) => [id, review_count])).toEqual([
      [exactCourseId, 1],
      [popularCourseId, 0],
    ]);
  });

  it("keeps internal ranking and review-source state out of browse responses", async () => {
    const response = await SELF.fetch(
      `${origin}/api/courses?q=${encodeURIComponent(marker)}&department=${encodeURIComponent(departmentMarker)}`,
    );
    const payload = JSON.stringify(await response.json());
    expect(payload).not.toContain("search_rank");
    expect(payload).not.toContain("source_order");
    expect(payload).not.toContain("legacy:");
    expect(payload).not.toContain("historical:");
  });
});
