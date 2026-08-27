import { describe, expect, it } from "vitest";
import {
  DEV_ATLAS_PARAM,
  DEV_PREVIEW_PARAM,
  PREVIEW_NOTICES_BADGE,
  PREVIEW_NOTICES_BADGE_COUNT,
  PREVIEW_NOTICES_BADGE_ZERO,
  PREVIEW_REVIEW_COMMENTS,
  previewFilledCourseDetail,
  previewFilledCourseReviews,
  previewNotificationInbox,
  previewReviewComments,
  previewUnreadNotificationCount,
  resolveDevAtlasSession,
  resolveDevPreview,
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
    expect(previewNotificationInbox("error")).toEqual({
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
