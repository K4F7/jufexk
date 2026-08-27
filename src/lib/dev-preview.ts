/**
 * DEV-only `?preview=` / `?atlas=1` helpers.
 * Production builds must treat every call as a no-op (Vite DCE on import.meta.env.DEV).
 */

import type {
  Paginated,
  UserNotification,
  UserProfile,
} from "./types";

export const DEV_PREVIEW_PARAM = "preview";
export const DEV_ATLAS_PARAM = "atlas";

export function resolveDevPreview(
  isDev: boolean,
  search: { get(name: string): string | null },
): string | null {
  if (!isDev) return null;
  return search.get(DEV_PREVIEW_PARAM);
}

export function resolveDevAtlasSession(
  isDev: boolean,
  search: { get(name: string): string | null; has(name: string): boolean },
): boolean {
  if (!isDev) return false;
  return search.get(DEV_ATLAS_PARAM) === "1" || search.has(DEV_PREVIEW_PARAM);
}

export function readDevPreview(search: URLSearchParams): string | null {
  return resolveDevPreview(import.meta.env.DEV, search);
}

/** True when a DEV atlas / preview deep-link should skip login / admin gates. */
export function isDevAtlasSession(search: URLSearchParams): boolean {
  return resolveDevAtlasSession(import.meta.env.DEV, search);
}

export function emptyCatalogPage<T>(): Paginated<T> {
  return { items: [], total: 0, page: 1, pageSize: 20, pages: 1 };
}

export function previewFilledProfile(): UserProfile {
  return {
    public_code: 1,
    handle: "#000001",
    avatar_key: 1,
    review_count: 3,
    follow_count: 1,
    following_user_count: 2,
    follower_count: 4,
    reviews: [
      {
        id: "preview-review-approved",
        course_id: 8,
        course_name: "中级财务会计",
        teacher_id: 2,
        teacher_name: "林晓雯",
        headline: "例题扎实值得选",
        comment: "例题扎实，作业量适中。",
        created_at: "2025-09-12 10:00:00",
        status: "approved",
      },
      {
        id: "preview-review-pending",
        course_id: 8,
        course_name: "中级财务会计",
        teacher_id: 2,
        teacher_name: "林晓雯",
        headline: "待审核样例",
        comment: "这是一条待审核的预览点评。",
        created_at: "2026-04-01 10:00:00",
        status: "pending",
      },
      {
        id: "preview-review-rejected",
        course_id: 8,
        course_name: "中级财务会计",
        teacher_id: 2,
        teacher_name: "林晓雯",
        headline: "已驳回样例",
        comment: "这是一条已驳回的预览点评。",
        created_at: "2026-04-02 10:00:00",
        status: "rejected",
      },
    ],
    follows: [
      {
        course_id: 8,
        course_name: "中级财务会计",
        teacher_id: 2,
        teacher_name: "林晓雯",
      },
    ],
  };
}

export function previewEmptyProfile(): UserProfile {
  return {
    public_code: 1,
    handle: "#000001",
    avatar_key: 0,
    review_count: 0,
    follow_count: 0,
    following_user_count: 0,
    follower_count: 0,
    reviews: [],
    follows: [],
  };
}

export function previewFilledNotices(): UserNotification[] {
  return [
    {
      id: "preview-notice-follow",
      type: "user_followed",
      text: "匿名用户#000002 关注了你",
      href: "/u/000002",
      created_at: "2026-08-21 10:00:00",
      read: false,
    },
    {
      id: "preview-notice-unread",
      type: "followed_relation_review",
      text: "你关注的 中级财务会计（林晓雯） 有新点评",
      href: "/courses/8?teacher=2",
      created_at: "2026-08-21 09:00:00",
      read: false,
    },
    {
      id: "preview-notice-read",
      type: "review_endorsed",
      text: "有人认可了你对 货币金融学 的点评",
      href: "/courses/9?teacher=3",
      created_at: "2026-08-20 08:00:00",
      read: true,
    },
  ];
}

/** Combined unread count for the header Badge. `null` = use the live API. */
export const PREVIEW_NOTICES_BADGE = "notices-badge";
export const PREVIEW_NOTICES_BADGE_ZERO = "notices-badge-zero";
export const PREVIEW_NOTICES_BADGE_COUNT = 3;

export function previewUnreadNotificationCount(
  preview: string | null,
): number | null {
  if (preview === PREVIEW_NOTICES_BADGE) return PREVIEW_NOTICES_BADGE_COUNT;
  if (preview === PREVIEW_NOTICES_BADGE_ZERO || preview === "empty") return 0;
  if (preview === "filled") {
    return previewFilledNotices().filter((item) => item.read === false).length;
  }
  return null;
}
