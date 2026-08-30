import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ORDINARY_USER_ID_HEADER,
  ORDINARY_USER_MAC_HEADER,
  ordinaryUserTestHeaders,
} from "../src/ordinary-user-authentication";
import { ORDINARY_USER_CSRF_COOKIE } from "../src/ordinary-user-write-authorization";
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

async function insertReviewChallenges(
  reviewId: number,
  count: number,
  stamp: string,
) {
  for (let i = 0; i < count; i += 1) {
    await env.DB.prepare(
      "INSERT INTO review_challenges(user_id, review_id) VALUES(?, ?)",
    )
      .bind(`guest:latest-fold-${stamp}-${i}`, reviewId)
      .run();
  }
}

async function insertReviewEndorsements(
  reviewId: number,
  count: number,
  stamp: string,
) {
  for (let i = 0; i < count; i += 1) {
    await env.DB.prepare(
      "INSERT INTO review_endorsements(user_id, review_id) VALUES(?, ?)",
    )
      .bind(`guest:latest-endorse-${stamp}-${i}`, reviewId)
      .run();
  }
}

async function latestComments(pageSize = 50, cursor?: string) {
  const query = new URLSearchParams({ pageSize: String(pageSize) });
  if (cursor) query.set("cursor", cursor);
  const response = await SELF.fetch(
    `${origin}/api/reviews/latest?${query.toString()}`,
  );
  expect(response.status).toBe(200);
  return response.json<{
    items: Array<{ comment: string; headline?: string }>;
    nextCursor: string | null;
  }>();
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

  it("adds relation four-dims, metadata, and extra review fields", async () => {
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
          follow_count: number;
        }>;
      };
    }>();
    expect(body.course.enrollment_category).toBe("");
    expect(body.course.teaching_type).toBe("");
    expect(body.course.course_level).toBe("");
    expect(body.course.teachers[0]?.dimensionLabels?.[0]?.option).toBe("简单");
    expect(body.course.teachers[0]).not.toHaveProperty("terms");

    const reviews = await SELF.fetch(
      `${origin}/api/courses/${courseId}/reviews?teacherId=${teacherId}`,
    );
    const reviewBody = await reviews.json<{
      items: Array<{ overall: number | null; created_at: string | null }>;
    }>();
    expect(reviewBody.items[0]).toMatchObject({
      overall: 4,
    });
    expect(reviewBody.items[0]).not.toHaveProperty("term");
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
      comment: `半星点评${stamp}`,
      overall: 4.5,
      term: "2025 冬",
      createdAt: "2025-12-01 00:00:00",
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
        items: Array<{ comment: string; overall: number }>;
        total: number;
        nextCursor: string | null;
      }>();
    };

    const oldest = await query("sort=oldest");
    expect(oldest.total).toBe(3);
    expect(oldest.items.map((item) => item.overall)).toEqual([2, 4.5, 5]);

    const rejected = await SELF.fetch(
      `${origin}/api/courses/${relation.courseId}/reviews?teacherId=${relation.teacherId}&sort=rating_desc`,
    );
    expect(rejected.status).toBe(400);

    const fourStar = await query("sort=latest&rating=4");
    expect(fourStar.total).toBe(1);
    expect(fourStar.items).toEqual([
      expect.objectContaining({ overall: 4.5 }),
    ]);

    const filtered = await query("sort=latest&rating=4,5");
    expect(filtered.total).toBe(2);
    expect(filtered.items.map((item) => item.overall)).toEqual([5, 4.5]);
    expect(filtered.items[0]).not.toHaveProperty("term");

    const firstPage = await query("sort=latest&pageSize=1");
    expect(firstPage.items.map((item) => item.overall)).toEqual([5]);
    expect(firstPage.total).toBe(3);
    const secondPage = await query(
      `sort=latest&pageSize=1&cursor=${encodeURIComponent(firstPage.nextCursor || "")}`,
    );
    expect(secondPage.items.map((item) => item.overall)).toEqual([4.5]);
    expect(secondPage.total).toBe(3);
  });

  it("paginates reviews with a Chinese comment cursor", async () => {
    const stamp = String(Date.now());
    const relation = await insertCourseTeacher(`${stamp}-zh-cursor`);
    await insertReview({
      ...relation,
      comment: `中文点评甲${stamp}`,
      createdAt: "2026-03-01 00:00:00",
    });
    await insertReview({
      ...relation,
      comment: `中文点评乙${stamp}`,
      createdAt: "2026-03-02 00:00:00",
    });
    const first = await SELF.fetch(
      `${origin}/api/courses/${relation.courseId}/reviews?teacherId=${relation.teacherId}&sort=latest&pageSize=1`,
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json<{
      items: Array<{ id: string; comment: string }>;
      nextCursor: string | null;
      total: number;
    }>();
    expect(firstBody.total).toBe(2);
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.items[0]).not.toHaveProperty("term");
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await SELF.fetch(
      `${origin}/api/courses/${relation.courseId}/reviews?teacherId=${relation.teacherId}&sort=latest&pageSize=1&cursor=${encodeURIComponent(firstBody.nextCursor || "")}`,
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json<typeof firstBody>();
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0]?.id).not.toBe(firstBody.items[0]?.id);
    expect(secondBody.items[0]).not.toHaveProperty("term");

    const asciiCursor = btoa(JSON.stringify({ source: 0, key: "0" }));
    const ascii = await SELF.fetch(
      `${origin}/api/courses/${relation.courseId}/reviews?teacherId=${relation.teacherId}&cursor=${encodeURIComponent(asciiCursor)}`,
    );
    expect(ascii.status).toBe(200);
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

  it("omits public-fold reviews from the latest stream but keeps them on the course list", async () => {
    const stamp = String(Date.now());
    const visible = await insertCourseTeacher(`${stamp}-latest-fold-ok`);
    const folded = await insertCourseTeacher(`${stamp}-latest-fold-hide`);
    const tied = await insertCourseTeacher(`${stamp}-latest-fold-tie`);
    const minority = await insertCourseTeacher(`${stamp}-latest-fold-min`);
    await insertReview({
      ...visible,
      comment: `课评流可见${stamp}`,
      createdAt: "2099-12-28 00:00:00",
    });
    const foldedId = await insertReview({
      ...folded,
      comment: `折叠演示：不受欢迎${stamp}`,
      createdAt: "2099-12-27 00:00:00",
    });
    const tiedId = await insertReview({
      ...tied,
      comment: `平票仍出现${stamp}`,
      createdAt: "2099-12-26 12:00:00",
    });
    const minorityId = await insertReview({
      ...minority,
      comment: `未达阈值仍出现${stamp}`,
      createdAt: "2099-12-26 00:00:00",
    });
    await insertReviewChallenges(foldedId, 3, `${stamp}-fold`);
    await insertReviewEndorsements(tiedId, 3, `${stamp}-tie`);
    await insertReviewChallenges(tiedId, 3, `${stamp}-tie`);
    await insertReviewChallenges(minorityId, 2, `${stamp}-min`);

    const historicalId = `latest-fold-hist-${stamp}`;
    await env.DB.prepare(
      `INSERT INTO public_historical_reviews(
         id,course_id,teacher_id,comment,package_contract,
         approved_package_manifest_sha256,approved_catalog_content_sha256,imported_at
       ) VALUES(?,?,?,?,?,?,?,?)`,
    )
      .bind(
        historicalId,
        folded.courseId,
        folded.teacherId,
        `历史折叠${stamp}`,
        "legacy-historical-production-freeze-v1",
        "a".repeat(64),
        "b".repeat(64),
        "2099-12-27 12:00:00",
      )
      .run();
    for (let i = 0; i < 3; i += 1) {
      await env.DB.prepare(
        "INSERT INTO historical_review_challenges(user_id, historical_review_id) VALUES(?, ?)",
      )
        .bind(`guest:latest-hist-fold-${stamp}-${i}`, historicalId)
        .run();
    }

    const firstPage = await latestComments(1);
    expect(firstPage.items.map((item) => item.comment)).toEqual([
      `课评流可见${stamp}`,
    ]);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await latestComments(2, firstPage.nextCursor || "");
    expect(secondPage.items.map((item) => item.comment)).toEqual([
      `平票仍出现${stamp}`,
      `未达阈值仍出现${stamp}`,
    ]);
    expect(
      [...firstPage.items, ...secondPage.items].some((item) =>
        item.comment.includes("折叠演示：不受欢迎"),
      ),
    ).toBe(false);

    const wide = await latestComments(50);
    expect(wide.items.some((item) => item.comment === `课评流可见${stamp}`)).toBe(
      true,
    );
    expect(
      wide.items.some((item) => item.comment === `折叠演示：不受欢迎${stamp}`),
    ).toBe(false);
    expect(wide.items.some((item) => item.comment === `历史折叠${stamp}`)).toBe(
      false,
    );

    const course = await SELF.fetch(
      `${origin}/api/courses/${folded.courseId}/reviews?teacherId=${folded.teacherId}`,
    );
    expect(course.status).toBe(200);
    const courseBody = await course.json<{
      items: Array<{ comment: string; challenge_count?: number }>;
    }>();
    const foldedRow = courseBody.items.find(
      (item) => item.comment === `折叠演示：不受欢迎${stamp}`,
    );
    expect(foldedRow).toBeTruthy();
    expect(foldedRow?.challenge_count).toBeGreaterThanOrEqual(3);
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
