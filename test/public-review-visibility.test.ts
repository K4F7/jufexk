import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  guestReviewBindingSql,
  publicReviewBindingSql,
  reviewNotDeletedBindingSql,
} from "../src/public-review-visibility";
import * as reviewSummary from "../src/review-summary";

let courseSequence = 5700;

async function createBoundCourse() {
  const code = `VIS${courseSequence++}`;
  const inserted = await env.DB.prepare(
    "INSERT INTO courses(code,name,category,department) VALUES(?,?,'general','测试学院')",
  )
    .bind(code, `公开可见性测试课 ${code}`)
    .run();
  const courseId = Number(inserted.meta.last_row_id);
  await env.DB.prepare(
    "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
  )
    .bind(courseId)
    .run();
  return courseId;
}

async function seedReview(
  courseId: number,
  comment: string,
  extras: {
    status?: "approved" | "pending" | "rejected";
    blocked?: boolean;
    deleted?: boolean;
    loginOnly?: boolean;
    teacherId?: number;
    offeringId?: number | null;
  } = {},
) {
  const inserted = await env.DB.prepare(
    `INSERT INTO reviews(
       course_id,teacher_id,offering_id,category,overall,comment,status,
       blocked_at,deleted_at,login_only,reviewed_at
     ) VALUES(?,?,?,'general',4,?,?,?,?,?,CURRENT_TIMESTAMP)`,
  )
    .bind(
      courseId,
      extras.teacherId ?? 1,
      extras.offeringId === undefined ? null : extras.offeringId,
      comment,
      extras.status ?? "approved",
      extras.blocked ? "2026-01-01 00:00:00" : null,
      extras.deleted ? "2026-01-01 00:00:00" : null,
      extras.loginOnly ? 1 : 0,
    )
    .run();
  return Number(inserted.meta.last_row_id);
}

async function matchingIds(bindingSql: string, courseId: number) {
  const { results } = await env.DB.prepare(
    `SELECT r.id FROM reviews r
     WHERE r.course_id=? AND r.status='approved'${bindingSql}
     ORDER BY r.id`,
  )
    .bind(courseId)
    .all<{ id: number }>();
  return results.map((row) => row.id);
}

describe("public review visibility", () => {
  it("does not keep a compatibility re-export on the AI summary module", () => {
    expect(reviewSummary).not.toHaveProperty("reviewNotDeletedBindingSql");
    expect(reviewSummary).not.toHaveProperty("publicReviewBindingSql");
    expect(reviewSummary).not.toHaveProperty("guestReviewBindingSql");
    expect(reviewSummary).not.toHaveProperty("collectRelationReviewTexts");
    expect(reviewSummary).not.toHaveProperty("recomputeRelationSummary");
    expect(reviewSummary).not.toHaveProperty("isSummaryRecomputeDue");
    expect(reviewSummary).not.toHaveProperty("drainPersistedSummaryJobs");
  });

  it("admits approved, unblocked, bound reviews and tightens guest vs public views", async () => {
    const courseId = await createBoundCourse();
    const publicId = await seedReview(courseId, "公开可见的任课评价正文");
    const loginOnlyId = await seedReview(courseId, "仅登录可见的任课评价正文", {
      loginOnly: true,
    });
    const blockedId = await seedReview(courseId, "已屏蔽的任课评价正文", {
      blocked: true,
    });
    const deletedId = await seedReview(courseId, "已删除的任课评价正文", {
      deleted: true,
    });
    const pendingId = await seedReview(courseId, "投稿中的任课评价正文", {
      status: "pending",
    });

    const notDeleted = await matchingIds(reviewNotDeletedBindingSql, courseId);
    const publicVisible = await matchingIds(publicReviewBindingSql, courseId);
    const guestVisible = await matchingIds(guestReviewBindingSql, courseId);

    expect(notDeleted).toEqual([publicId, loginOnlyId, blockedId]);
    expect(publicVisible).toEqual([publicId, loginOnlyId]);
    expect(guestVisible).toEqual([publicId]);
    expect(notDeleted).not.toContain(deletedId);
    expect(notDeleted).not.toContain(pendingId);
    expect(publicVisible).not.toContain(blockedId);
    expect(guestVisible).not.toContain(loginOnlyId);
  });

  it("rejects reviews whose relation or offering binding is no longer valid", async () => {
    const boundCourse = await createBoundCourse();
    const unboundCourse = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES(?,'无关系课','general','测试学院')",
    )
      .bind(`VIS${courseSequence++}`)
      .run();
    const unboundCourseId = Number(unboundCourse.meta.last_row_id);
    const orphanId = await seedReview(unboundCourseId, "没有任课关系的评价");

    const brokenOffering = await env.DB.prepare(
      "INSERT INTO offerings(course_id,term,section,status) VALUES(?,?,?,'active')",
    )
      .bind(boundCourse, "2026 秋", "VIS")
      .run();
    const brokenOfferingId = Number(brokenOffering.meta.last_row_id);
    const danglingOfferingId = await seedReview(
      boundCourse,
      "开课班教师绑定已失效的评价",
      { offeringId: brokenOfferingId },
    );
    const validId = await seedReview(boundCourse, "关系与开课班都有效的评价");

    const publicVisible = await matchingIds(publicReviewBindingSql, boundCourse);
    const orphanVisible = await matchingIds(
      publicReviewBindingSql,
      unboundCourseId,
    );

    expect(publicVisible).toEqual([validId]);
    expect(publicVisible).not.toContain(danglingOfferingId);
    expect(orphanVisible).not.toContain(orphanId);
  });
});
