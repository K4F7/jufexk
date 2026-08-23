import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ORDINARY_USER_CSRF_COOKIE,
  ORDINARY_USER_ID_HEADER,
  ORDINARY_USER_MAC_HEADER,
  ordinaryUserTestHeaders,
} from "../src/ordinary-user-session";
import { CURRENT_SCORES, V1_OFFLINE_SCORES } from "./review-score-fixtures";

const origin = "https://example.com";
const testAuthSecret = "test-ordinary-user-auth";

type RelationRow = {
  course_id: number;
  teacher_id: number | null;
  teacher_name: string | null;
  rating: number | null;
  review_count: number;
  dimensionLabels: Array<{ id: string; option: string }> | null;
  follow_count: number;
  recommend_count: number;
  not_recommend_count: number;
  viewer_followed?: boolean;
};

async function viewerSession(userId: string) {
  const auth = await ordinaryUserTestHeaders(userId, testAuthSecret);
  const response = await SELF.fetch(`${origin}/api/user/session`, {
    headers: auth,
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ csrfToken?: string }>();
  return {
    auth,
    cookie: `${ORDINARY_USER_CSRF_COOKIE}=${body.csrfToken}`,
    csrf: body.csrfToken || "",
  };
}

function writeHeaders(
  session: Awaited<ReturnType<typeof viewerSession>>,
  key: string,
) {
  return {
    [ORDINARY_USER_ID_HEADER]: session.auth[ORDINARY_USER_ID_HEADER],
    [ORDINARY_USER_MAC_HEADER]: session.auth[ORDINARY_USER_MAC_HEADER],
    Cookie: session.cookie,
    Origin: origin,
    "X-CSRF-Token": session.csrf,
    "Idempotency-Key": key,
  };
}

async function insertCourseTeacher(stamp: string) {
  const teacher = await env.DB.prepare(
    "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,?)",
  )
    .bind(`教师${stamp}`, `教师${stamp}`, "测试学院")
    .run();
  const teacherId = Number(teacher.meta.last_row_id);
  const course = await env.DB.prepare(
    "INSERT INTO courses(code,name,category,department,scheme_key) VALUES(?,?,?,?,?)",
  )
    .bind(`U410-${stamp}`, `接口课${stamp}`, "general", "测试学院", "major")
    .run();
  const courseId = Number(course.meta.last_row_id);
  await env.DB.prepare(
    "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)",
  )
    .bind(courseId, teacherId)
    .run();
  return { courseId, teacherId };
}

async function insertReview(input: {
  courseId: number;
  teacherId: number;
  comment: string;
  overall?: number;
  term?: string;
  createdAt?: string;
  schemeKey?: string;
  schemeVersion?: number;
  scores?: Record<string, number>;
}) {
  const result = await env.DB.prepare(
    `INSERT INTO reviews(
      course_id,teacher_id,category,overall,comment,term,status,
      submitter_hash,scheme_key,scheme_version,scores,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      input.courseId,
      input.teacherId,
      "general",
      input.overall ?? 4,
      input.comment,
      input.term ?? "2026 春",
      "approved",
      `hash-${input.comment}-${Math.random()}`,
      input.schemeKey ?? "major",
      input.schemeVersion ?? 2,
      input.scores ? JSON.stringify(input.scores) : JSON.stringify(CURRENT_SCORES),
      input.createdAt ?? "2026-08-11 02:00:00",
    )
    .run();
  return Number(result.meta.last_row_id);
}

describe("USTC backend APIs (issue #410)", () => {
  it("lists course×teacher rows with rating, four-dims, and sort=rating", async () => {
    const stamp = String(Date.now());
    const high = await insertCourseTeacher(`${stamp}-high`);
    const low = await insertCourseTeacher(`${stamp}-low`);
    const empty = await insertCourseTeacher(`${stamp}-empty`);
    await insertReview({
      ...high,
      comment: "高分四维评价正文足够长",
      overall: 5,
      scores: CURRENT_SCORES,
      createdAt: "2026-08-12 01:00:00",
    });
    await insertReview({
      ...low,
      comment: "低分旧快照评价正文足够长",
      overall: 2,
      schemeVersion: 1,
      scores: V1_OFFLINE_SCORES,
      createdAt: "2026-08-10 01:00:00",
    });

    const listed = await SELF.fetch(
      `${origin}/api/courses?view=relations&q=${encodeURIComponent(`接口课${stamp}`)}&pageSize=20`,
    );
    expect(listed.status).toBe(200);
    const body = await listed.json<{ items: RelationRow[]; total: number }>();
    expect(body.total).toBeGreaterThanOrEqual(3);
    const highRow = body.items.find((item) => item.course_id === high.courseId);
    const lowRow = body.items.find((item) => item.course_id === low.courseId);
    const emptyRow = body.items.find((item) => item.course_id === empty.courseId);
    expect(highRow).toMatchObject({
      teacher_id: high.teacherId,
      rating: 5,
      review_count: 1,
    });
    expect(highRow?.dimensionLabels).toEqual([
      { id: "difficulty", label: "课程难度", option: "简单" },
      { id: "homework", label: "作业多少", option: "中等" },
      { id: "grading", label: "给分好坏", option: "杀手" },
      { id: "gain", label: "收获多少", option: "一般" },
    ]);
    expect(lowRow).toMatchObject({ rating: 2, review_count: 1 });
    expect(lowRow?.dimensionLabels).toBeNull();
    expect(emptyRow).toMatchObject({
      rating: null,
      review_count: 0,
      dimensionLabels: null,
    });

    const rated = await SELF.fetch(
      `${origin}/api/courses?view=relations&q=${encodeURIComponent(`接口课${stamp}`)}&sort=rating&pageSize=20`,
    );
    const ratedBody = await rated.json<{ items: RelationRow[] }>();
    const names = ratedBody.items.map((item) => item.course_id);
    expect(names.indexOf(high.courseId)).toBeLessThan(names.indexOf(low.courseId));
    expect(names.indexOf(low.courseId)).toBeLessThan(names.indexOf(empty.courseId));
  });

  it("adds relation four-dims, terms, metadata, and extra review fields", async () => {
    const stamp = String(Date.now());
    const { courseId, teacherId } = await insertCourseTeacher(`${stamp}-detail`);
    await insertReview({
      courseId,
      teacherId,
      comment: "详情四维评价正文足够长",
      overall: 4,
      term: "2026 春",
      scores: CURRENT_SCORES,
    });
    await env.DB.prepare(
      "INSERT INTO offerings(course_id,term,section,status) VALUES(?,?,?,?)",
    )
      .bind(courseId, "2025 秋", "01", "active")
      .run();
    const offering = await env.DB.prepare(
      "SELECT id FROM offerings WHERE course_id=? AND term=?",
    )
      .bind(courseId, "2025 秋")
      .first<{ id: number }>();
    await env.DB.prepare(
      "INSERT INTO offering_teachers(offering_id,teacher_id) VALUES(?,?)",
    )
      .bind(offering?.id, teacherId)
      .run();

    const detail = await SELF.fetch(`${origin}/api/courses/${courseId}`);
    expect(detail.status).toBe(200);
    const body = await detail.json<{
      course: {
        enrollment_category: string;
        teaching_type: string;
        course_level: string;
        teachers: Array<{
          id: number;
          dimensionLabels: Array<{ option: string }>;
          terms: string[];
          follow_count: number;
        }>;
      };
    }>();
    expect(body.course.enrollment_category).toBe("专业课");
    expect(body.course.teaching_type).toBe("讲授");
    expect(body.course.course_level).toBe("本科");
    expect(body.course.teachers[0]?.dimensionLabels?.[0]?.option).toBe("简单");
    expect(body.course.teachers[0]?.terms).toEqual(
      expect.arrayContaining(["2026 春", "2025 秋"]),
    );

    const reviews = await SELF.fetch(
      `${origin}/api/courses/${courseId}/reviews?teacherId=${teacherId}`,
    );
    const reviewBody = await reviews.json<{
      items: Array<{ overall: number | null; term: string | null; created_at: string | null }>;
    }>();
    expect(reviewBody.items[0]).toMatchObject({
      overall: 4,
      term: "2026 春",
    });
    expect(reviewBody.items[0]?.created_at).toBeTruthy();
  });

  it("sorts and filters a complete course review feed", async () => {
    const stamp = String(Date.now());
    const relation = await insertCourseTeacher(`${stamp}-review-filters`);
    await insertReview({
      ...relation,
      comment: `低分旧点评${stamp}`,
      overall: 2,
      term: "2025 秋",
      createdAt: "2025-09-01 00:00:00",
    });
    await insertReview({
      ...relation,
      comment: `高分新点评${stamp}`,
      overall: 5,
      term: "2026 春",
      createdAt: "2026-03-01 00:00:00",
    });

    const query = async (params: string) => {
      const response = await SELF.fetch(
        `${origin}/api/courses/${relation.courseId}/reviews?teacherId=${relation.teacherId}&${params}`,
      );
      expect(response.status).toBe(200);
      return response.json<{
        items: Array<{ comment: string; overall: number; term: string }>;
        total: number;
        nextCursor: string | null;
      }>();
    };

    const oldest = await query("sort=oldest");
    expect(oldest.total).toBe(2);
    expect(oldest.items.map((item) => item.overall)).toEqual([2, 5]);

    const rating = await query("sort=rating_desc");
    expect(rating.items.map((item) => item.overall)).toEqual([5, 2]);

    const filtered = await query(
      `sort=latest&term=${encodeURIComponent("2026 春")}&rating=5`,
    );
    expect(filtered.total).toBe(1);
    expect(filtered.items).toEqual([
      expect.objectContaining({ overall: 5, term: "2026 春" }),
    ]);

    const firstPage = await query("sort=rating_desc&pageSize=1");
    expect(firstPage.items.map((item) => item.overall)).toEqual([5]);
    expect(firstPage.total).toBe(2);
    const secondPage = await query(
      `sort=rating_desc&pageSize=1&cursor=${encodeURIComponent(firstPage.nextCursor || "")}`,
    );
    expect(secondPage.items.map((item) => item.overall)).toEqual([2]);
    expect(secondPage.total).toBe(2);
  });

  it("returns site-wide latest public reviews with cursor pagination", async () => {
    const stamp = String(Date.now());
    const first = await insertCourseTeacher(`${stamp}-latest-a`);
    const second = await insertCourseTeacher(`${stamp}-latest-b`);
    await insertReview({
      ...first,
      comment: `较旧最新流${stamp}`,
      createdAt: "2099-01-01 00:00:00",
    });
    await insertReview({
      ...second,
      comment: `较新最新流${stamp}`,
      createdAt: "2099-01-02 00:00:00",
    });

    const firstPage = await SELF.fetch(`${origin}/api/reviews/latest?pageSize=1`);
    expect(firstPage.status).toBe(200);
    const page = await firstPage.json<{
      items: Array<{
        id: string;
        comment: string;
        course_name: string;
        teacher_name: string;
        created_at: string;
      }>;
      nextCursor: string | null;
    }>();
    expect(page.items[0]?.comment).toBe(`较新最新流${stamp}`);
    expect(page.items[0]?.id).toMatch(/^review:/);
    expect(page.items[0]?.course_name).toContain("接口课");
    expect(page.items[0]).not.toHaveProperty("dimensionLabels");
    expect(page.items[0]).not.toHaveProperty("endorsement_count");
    expect(page.nextCursor).toBeTruthy();

    const secondPage = await SELF.fetch(
      `${origin}/api/reviews/latest?pageSize=1&cursor=${encodeURIComponent(page.nextCursor || "")}`,
    );
    const more = await secondPage.json<{ items: Array<{ comment: string }> }>();
    expect(more.items[0]?.comment).toBe(`较旧最新流${stamp}`);
  });

  it("supports follow/recommend PUT DELETE with counts and 401 for guests", async () => {
    const stamp = String(Date.now());
    const { courseId, teacherId } = await insertCourseTeacher(`${stamp}-signal`);
    const guest = await SELF.fetch(
      `${origin}/api/courses/${courseId}/teachers/${teacherId}/follow`,
      { method: "PUT", headers: { "Idempotency-Key": "guest-key-01" } },
    );
    expect(guest.status).toBe(401);

    const session = await viewerSession(`signal-user-${stamp}`);
    const follow = await SELF.fetch(
      `${origin}/api/courses/${courseId}/teachers/${teacherId}/follow`,
      { method: "PUT", headers: writeHeaders(session, `follow-${stamp}`) },
    );
    expect(follow.status).toBe(200);
    expect(await follow.json()).toMatchObject({
      followCount: 1,
      viewerFollowed: true,
      viewerRecommended: false,
    });

    const recommend = await SELF.fetch(
      `${origin}/api/courses/${courseId}/teachers/${teacherId}/recommend`,
      { method: "PUT", headers: writeHeaders(session, `rec-${stamp}`) },
    );
    expect(recommend.status).toBe(200);
    const down = await SELF.fetch(
      `${origin}/api/courses/${courseId}/teachers/${teacherId}/not-recommend`,
      { method: "PUT", headers: writeHeaders(session, `down-${stamp}`) },
    );
    const downBody = await down.json<{
      recommendCount: number;
      notRecommendCount: number;
      viewerRecommended: boolean;
      viewerNotRecommended: boolean;
    }>();
    expect(downBody).toMatchObject({
      recommendCount: 0,
      notRecommendCount: 1,
      viewerRecommended: false,
      viewerNotRecommended: true,
    });

    const detail = await SELF.fetch(`${origin}/api/courses/${courseId}`, {
      headers: session.auth,
    });
    const detailBody = await detail.json<{
      course: { teachers: Array<{ follow_count: number; viewer_followed?: boolean }> };
    }>();
    expect(detailBody.course.teachers[0]?.follow_count).toBe(1);
    expect(detailBody.course.teachers[0]?.viewer_followed).toBe(true);

    const withdraw = await SELF.fetch(
      `${origin}/api/courses/${courseId}/teachers/${teacherId}/follow`,
      { method: "DELETE", headers: writeHeaders(session, `unf-${stamp}`) },
    );
    expect(await withdraw.json()).toMatchObject({
      followCount: 0,
      viewerFollowed: false,
    });
  });
});
