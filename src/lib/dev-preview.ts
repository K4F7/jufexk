/**
 * DEV-only `?preview=` / `?atlas=1` helpers.
 * Production builds must treat every call as a no-op (Vite DCE on import.meta.env.DEV).
 */

import type {
  Course,
  Paginated,
  PublicReview,
  ReviewComment,
  Teacher,
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
      href: "/courses/8?teacher=2#review-101",
      created_at: "2026-08-21 09:00:00",
      read: false,
    },
    {
      id: "preview-notice-read",
      type: "review_endorsed",
      text: "有人认可了你对 货币金融学 的点评",
      href: "/courses/9?teacher=3#review-201",
      created_at: "2026-08-20 08:00:00",
      read: true,
    },
    {
      id: "preview-notice-followed-user",
      type: "followed_user_review",
      text: "匿名用户#000002 发布了新任课评价",
      href: "/courses/8?teacher=2#review-102",
      created_at: "2026-08-19 18:00:00",
      read: true,
    },
  ];
}

/** Combined unread count for the header Badge. `null` = use the live API. */
export const PREVIEW_NOTICES_BADGE = "notices-badge";
export const PREVIEW_NOTICES_BADGE_ZERO = "notices-badge-zero";
export const PREVIEW_NOTICES_BADGE_COUNT = 3;
/** DEV mock inbox error for the header dropdown. `null` = use the live API. */
export const PREVIEW_NOTICES_ERROR = "notices-error";

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

/** DEV mock inbox for the header dropdown. `null` = use the live API. */
export function previewNotificationInbox(preview: string | null): {
  items: UserNotification[];
  available: boolean;
} | null {
  if (preview === PREVIEW_NOTICES_ERROR) return { items: [], available: false };
  if (preview === "empty" || preview === PREVIEW_NOTICES_BADGE_ZERO) {
    return { items: [], available: true };
  }
  if (preview === "filled" || preview === PREVIEW_NOTICES_BADGE) {
    return { items: previewFilledNotices(), available: true };
  }
  return null;
}

export const PREVIEW_REVIEW_COMMENTS = "review-comments";

export function previewFilledCourseDetail(courseId = 8): {
  course: Course & { teachers: Teacher[] };
  reviewCount: number;
} {
  const teachers: Teacher[] = [
    {
      id: 2,
      name: "林晓雯",
      department: "会计学院",
      title: "",
      bio: "",
      review_count: 2,
      follow_count: 3,
      recommend_count: 8,
      not_recommend_count: 1,
    },
  ];
  return {
    course: {
      id: courseId,
      code: "ACC2101",
      name: "中级财务会计",
      category: "general",
      department: "会计学院",
      teacher_refs: "2:林晓雯",
      teachers,
      review_count: 2,
      rating: 4.5,
      credits: 3,
      description: "",
      enrollment_category: "专业必修课",
      teaching_type: "理论课",
    } as Course & { teachers: Teacher[] },
    reviewCount: 2,
  };
}

export function previewFilledCourseReviews(courseId = 8): PublicReview[] {
  return [
    {
      id: "review:101",
      course_id: courseId,
      teacher_id: 2,
      course_name: "中级财务会计",
      course_code: "ACC2101",
      teacher_name: "林晓雯",
      comment: "例题扎实，作业量适中。",
      grade: "90",
      overall: 5,
      created_at: "2025-09-12 10:00:00",
      endorsement_count: 8,
      endorsable: true,
      author_public_code: 3,
      author_avatar_key: 2,
      dimensionLabels: [
        { id: "difficulty", label: "课程难度", option: "适中" },
        { id: "homework", label: "作业多少", option: "适中" },
        { id: "grading", label: "给分好坏", option: "较好" },
        { id: "gain", label: "收获多少", option: "较多" },
      ],
    },
    {
      id: "review:102",
      course_id: courseId,
      teacher_id: 2,
      course_name: "中级财务会计",
      course_code: "ACC2101",
      teacher_name: "林晓雯",
      comment: "节奏偏快，建议提前预习例题。",
      overall: 4,
      created_at: "2025-10-03 14:00:00",
      endorsement_count: 2,
      endorsable: true,
      author_public_code: 4,
      author_avatar_key: 3,
    },
  ];
}

/** DEV mock 回复 under a course review card. `null` = no seed (live empty UI). */
export function previewReviewComments(
  preview: string | null,
  atlas: boolean,
  reviewId: string | number,
): ReviewComment[] | null {
  if (preview === "error") return null;
  if (!atlas && preview == null) return null;
  const key = String(reviewId).replace(/[:#]/g, "-");
  return [
    {
      id: `${key}-c1`,
      authorPublicCode: 2,
      body: "作业量确实适中，期中那套例题很有用。老师会把作业题型拆开讲，期末复习按作业过一遍基本能覆盖考点，就是有几周连着两次小测，时间要自己排一下。",
      createdAt: "2026-08-26 18:10:00",
      endorsementCount: 5,
    },
    {
      id: `${key}-c2`,
      authorPublicCode: 1,
      body: "补充：考试范围以作业题型为主。",
      createdAt: "2026-08-27 09:20:00",
      parentId: `${key}-c1`,
      endorsementCount: 2,
      viewerOwned: true,
    },
  ];
}
