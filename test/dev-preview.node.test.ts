import { describe, expect, it } from "vitest";
import {
  groupRecentNotifications,
  noticeHrefToLocation,
} from "../src/hooks/useUnreadNotifications";
import {
  DEV_AS_PARAM,
  DEV_ATLAS_PARAM,
  DEV_PREVIEW_PARAM,
  PREVIEW_NOTICES_BADGE,
  PREVIEW_NOTICES_BADGE_COUNT,
  PREVIEW_NOTICES_BADGE_ZERO,
  PREVIEW_NOTICES_ERROR,
  PREVIEW_REVIEW_COMMENTS,
  previewFilledCourseDetail,
  previewFilledCourseReviews,
  previewFilledSubmitCourse,
  previewFilledSubmitDraft,
  previewFilledNotices,
  previewNotificationInbox,
  previewReviewComments,
  previewUnreadNotificationCount,
  previewDevViewerSession,
  resolveDevAtlasSession,
  resolveDevIdentity,
  resolveDevPreview,
  resolveDevPreviewOrFilled,
} from "../src/lib/dev-preview";
import { formatRelativeTime } from "../src/lib/review-date";
import { reviewSharePath } from "../src/lib/review-dimensions";

describe("DEV preview guards", () => {
  it("ignores preview and atlas in production-like builds", () => {
    const search = new URLSearchParams({
      [DEV_PREVIEW_PARAM]: "mfa",
      [DEV_ATLAS_PARAM]: "1",
    });
    expect(resolveDevPreview(false, search)).toBeNull();
    expect(resolveDevAtlasSession(false, search)).toBe(false);
  });

  it("defaults DEV catalog pages to filled unless empty/error is explicit", () => {
    expect(resolveDevPreviewOrFilled(false, new URLSearchParams())).toBeNull();
    expect(
      resolveDevPreviewOrFilled(
        false,
        new URLSearchParams(`${DEV_PREVIEW_PARAM}=filled`),
      ),
    ).toBeNull();
    expect(resolveDevPreviewOrFilled(true, new URLSearchParams())).toBe(
      "filled",
    );
    expect(
      resolveDevPreviewOrFilled(
        true,
        new URLSearchParams(`${DEV_PREVIEW_PARAM}=notices-badge`),
      ),
    ).toBe("filled");
    expect(
      resolveDevPreviewOrFilled(
        true,
        new URLSearchParams(`${DEV_PREVIEW_PARAM}=error`),
      ),
    ).toBe("error");
    expect(
      resolveDevPreviewOrFilled(
        true,
        new URLSearchParams(`${DEV_PREVIEW_PARAM}=empty`),
      ),
    ).toBe("empty");
    expect(
      resolveDevPreviewOrFilled(
        true,
        new URLSearchParams(`${DEV_PREVIEW_PARAM}=empty-catalog`),
      ),
    ).toBe("empty-catalog");
  });

  it("reads preview and atlas only when DEV", () => {
    expect(
      resolveDevPreview(true, new URLSearchParams(`${DEV_PREVIEW_PARAM}=empty`)),
    ).toBe("empty");
    expect(
      resolveDevAtlasSession(true, new URLSearchParams(`${DEV_ATLAS_PARAM}=1`)),
    ).toBe(true);
    expect(
      resolveDevAtlasSession(true, new URLSearchParams(`${DEV_PREVIEW_PARAM}=error`)),
    ).toBe(true);
    expect(resolveDevAtlasSession(true, new URLSearchParams())).toBe(false);
  });

  it("reads DEV identity from ?as= and ignores it in production-like builds", () => {
    expect(
      resolveDevIdentity(false, new URLSearchParams(`${DEV_AS_PARAM}=admin`), "admin"),
    ).toBeNull();
    expect(
      resolveDevIdentity(true, new URLSearchParams(`${DEV_AS_PARAM}=guest`)),
    ).toBe("guest");
    expect(
      resolveDevIdentity(true, new URLSearchParams(`${DEV_AS_PARAM}=user`)),
    ).toBe("user");
    expect(
      resolveDevIdentity(true, new URLSearchParams(`${DEV_AS_PARAM}=admin`)),
    ).toBe("admin");
    expect(
      resolveDevIdentity(true, new URLSearchParams(`${DEV_AS_PARAM}=nope`)),
    ).toBeNull();
    expect(
      resolveDevIdentity(true, new URLSearchParams(), "admin"),
    ).toBe("admin");
    expect(
      resolveDevIdentity(
        true,
        new URLSearchParams(`${DEV_AS_PARAM}=guest`),
        "admin",
      ),
    ).toBe("guest");
    expect(previewDevViewerSession().handle).toBe("匿名用户#000001");
    expect(previewDevViewerSession().authenticated).toBe(true);
  });

  it("reuses filled/empty notice mocks for the header unread badge", () => {
    expect(previewUnreadNotificationCount(null)).toBeNull();
    expect(previewUnreadNotificationCount("error")).toBeNull();
    expect(previewUnreadNotificationCount("empty")).toBe(0);
    expect(previewUnreadNotificationCount("filled")).toBe(2);
    expect(previewUnreadNotificationCount(PREVIEW_NOTICES_BADGE)).toBe(
      PREVIEW_NOTICES_BADGE_COUNT,
    );
    expect(previewUnreadNotificationCount(PREVIEW_NOTICES_BADGE_ZERO)).toBe(0);
  });

  it("reuses filled/empty notice mocks for the header dropdown", () => {
    expect(previewNotificationInbox(null)).toBeNull();
    expect(previewNotificationInbox("error")).toBeNull();
    expect(previewNotificationInbox(PREVIEW_NOTICES_ERROR)).toEqual({
      items: [],
      available: false,
    });
    expect(previewNotificationInbox("empty")).toEqual({
      items: [],
      available: true,
    });
    expect(previewNotificationInbox(PREVIEW_NOTICES_BADGE_ZERO)).toEqual({
      items: [],
      available: true,
    });
    const filled = previewNotificationInbox("filled");
    expect(filled?.available).toBe(true);
    expect(filled?.items.map((item) => item.type)).toEqual([
      "user_followed",
      "followed_relation_review",
      "review_endorsed",
      "followed_user_review",
    ]);
    expect(previewNotificationInbox(PREVIEW_NOTICES_BADGE)?.items).toEqual(
      filled?.items,
    );
    const grouped = groupRecentNotifications(previewFilledNotices());
    expect(grouped.followReviews.map((item) => item.type)).toEqual([
      "followed_relation_review",
      "followed_user_review",
    ]);
    expect(grouped.others.map((item) => item.type)).toEqual([
      "user_followed",
      "review_endorsed",
    ]);
    expect(grouped.followReviews.map((item) => item.href)).toEqual([
      "/courses/8?teacher=2#review-101",
      "/courses/8?teacher=2#review-102",
    ]);
    expect(grouped.others.map((item) => item.href)).toEqual([
      "/u/000002",
      "/courses/9?teacher=3#review-201",
    ]);
    expect(noticeHrefToLocation("/courses/8?teacher=2#review-101")).toEqual({
      pathname: "/courses/8",
      search: "?teacher=2",
      hash: "#review-101",
    });
  });

  it("seeds review replies only for DEV preview or atlas", () => {
    expect(previewReviewComments(null, false, "review:1")).toBeNull();
    expect(previewReviewComments("error", true, "review:1")).toBeNull();
    const seeded = previewReviewComments("filled", false, "review:1");
    expect(seeded?.map((item) => item.authorPublicCode)).toEqual([2, 1]);
    expect(seeded?.[0]?.body).toContain("作业量");
    expect(seeded?.[0]?.endorsementCount).toBe(5);
    expect(seeded?.[1]?.viewerOwned).toBe(true);
    expect(seeded?.[1]?.endorsementCount).toBe(2);
    expect(previewReviewComments(null, true, "review:1")?.length).toBe(2);
    const submitCourse = previewFilledSubmitCourse();
    expect(submitCourse.name).toBe("中级财务会计");
    expect(submitCourse.teachers.map((teacher) => teacher.id)).toEqual([2]);
    expect(submitCourse.applicableQuestions.map((question) => question.id)).toEqual(
      ["difficulty", "homework", "grading", "gain"],
    );
    expect(previewFilledSubmitDraft().teacherId).toBe("2");
    expect(previewFilledSubmitDraft().note.length).toBeGreaterThan(10);
    expect(previewFilledCourseDetail().course.name).toBe("中级财务会计");
    expect(previewFilledCourseReviews().map((item) => item.id)).toEqual([
      "review:101",
      "review:102",
    ]);
    expect(PREVIEW_REVIEW_COMMENTS).toBe("review-comments");
  });

  it("formats relative reply time and share permalinks", () => {
    const now = Date.parse("2026-08-27T10:10:00");
    expect(formatRelativeTime("2026-08-27 09:30:00", now)).toBe("40 分钟前");
    expect(formatRelativeTime("2026-08-26 18:10:00", now)).toBe("16 小时前");
    expect(
      reviewSharePath({ id: "review:1", course_id: 8, teacher_id: 2 }),
    ).toBe("/courses/8?teacher=2#review-1");
  });
});
