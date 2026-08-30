/**
 * DEV-only `?preview=` / `?atlas=1` helpers.
 * Production builds must treat every call as a no-op (Vite DCE on import.meta.env.DEV).
 */

import { courseSchemeView } from "./review-schemes";
import type {
  Course,
  CourseOption,
  CourseRelation,
  CourseReviewScheme,
  LatestReview,
  Paginated,
  PublicReview,
  PublicUserProfile,
  ReviewComment,
  Teacher,
  UserNotification,
  UserProfile,
} from "./types";

export const DEV_PREVIEW_PARAM = "preview";
export const DEV_ATLAS_PARAM = "atlas";
export const DEV_AS_PARAM = "as";
export const DEV_AS_STORAGE_KEY = "jufexk-dev-as";

export type DevIdentity = "guest" | "user" | "admin";

const DEV_IDENTITIES = new Set<DevIdentity>(["guest", "user", "admin"]);

export function parseDevIdentity(value: string | null | undefined): DevIdentity | null {
  if (value === "guest" || value === "user" || value === "admin") return value;
  return null;
}

function readStoredDevIdentity(): DevIdentity | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return parseDevIdentity(sessionStorage.getItem(DEV_AS_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** DEV `?as=guest|user|admin`; URL wins, then sessionStorage so in-app nav keeps the role. */
export function resolveDevIdentity(
  isDev: boolean,
  search: { get(name: string): string | null },
  stored: string | null = readStoredDevIdentity(),
): DevIdentity | null {
  if (!isDev) return null;
  return parseDevIdentity(search.get(DEV_AS_PARAM)) ?? parseDevIdentity(stored);
}

export function persistDevIdentity(isDev: boolean, identity: DevIdentity): void {
  if (!isDev || !DEV_IDENTITIES.has(identity)) return;
  try {
    sessionStorage.setItem(DEV_AS_STORAGE_KEY, identity);
  } catch {
    // ignore quota / private-mode
  }
}

export function readDevIdentity(search: URLSearchParams): DevIdentity | null {
  return resolveDevIdentity(import.meta.env.DEV, search);
}

/** Ordinary-user payload used by the DEV identity switcher (same handle as 本地测试登录). */
export function previewDevViewerSession() {
  return {
    authenticated: true,
    loginPath: "/login",
    logoutPath: "/logout",
    handle: "匿名用户#000001",
    avatar_key: 0,
  };
}

export function resolveDevPreview(
  isDev: boolean,
  search: { get(name: string): string | null },
): string | null {
  if (!isDev) return null;
  return search.get(DEV_PREVIEW_PARAM);
}

const DEV_EMPTY_PREVIEWS = new Set(["empty", "empty-catalog"]);

/**
 * DEV mocks only when `?preview=` or `?atlas=1` is present.
 * Bare Vite DEV / Playwright must hit the real (or test-mocked) API.
 * Login-only previews (mfa, qr, …) should keep using {@link resolveDevPreview}.
 */
export function resolveDevPreviewOrFilled(
  isDev: boolean,
  search: { get(name: string): string | null },
): string | null {
  if (!isDev) return null;
  const explicit = search.get(DEV_PREVIEW_PARAM);
  const atlas = search.get(DEV_ATLAS_PARAM) === "1";
  if (!explicit && !atlas) return null;
  if (explicit === "error") return "error";
  if (explicit && DEV_EMPTY_PREVIEWS.has(explicit)) return explicit;
  return "filled";
}

export function readDevPreviewOrFilled(search: URLSearchParams): string | null {
  return resolveDevPreviewOrFilled(import.meta.env.DEV, search);
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

/** DEV `/courses` 默认满态：几条真实感的课程×教师行，不打 relations API。 */
export function previewFilledCourseRelations(
  page = 1,
): Paginated<CourseRelation> {
  const items: CourseRelation[] = [
    {
      course_id: 8,
      code: "ACC2101",
      name: "中级财务会计",
      category: "general",
      department: "会计学院",
      teacher_id: 2,
      teacher_name: "林晓雯",
      rating: 4.5,
      review_count: 18,
      dimensionLabels: [
        { id: "difficulty", label: "课程难度", option: "适中" },
        { id: "homework", label: "作业多少", option: "适中" },
        { id: "grading", label: "给分好坏", option: "较好" },
        { id: "gain", label: "收获多少", option: "较多" },
      ],
    },
    {
      course_id: 9,
      code: "FIN2203",
      name: "货币金融学原理与商业银行经营管理专题",
      category: "general",
      department: "金融学院",
      teacher_id: 3,
      teacher_name: "赵启明",
      rating: 4.2,
      review_count: 9,
      dimensionLabels: [
        { id: "difficulty", label: "课程难度", option: "较难" },
        { id: "homework", label: "作业多少", option: "较多" },
        { id: "grading", label: "给分好坏", option: "一般" },
        { id: "gain", label: "收获多少", option: "较多" },
      ],
    },
    {
      course_id: 11,
      code: "PE0101",
      name: "篮球",
      category: "sports",
      department: "体育学院",
      teacher_id: 12,
      teacher_name: "周凯",
      rating: null,
      review_count: 0,
    },
    {
      course_id: 21,
      code: "EN0101",
      name: "大学英语",
      category: "english",
      department: "外国语学院",
      teacher_id: 22,
      teacher_name: "陈思远",
      rating: 3.8,
      review_count: 7,
      dimensionLabels: [
        { id: "difficulty", label: "课程难度", option: "简单" },
        { id: "homework", label: "作业多少", option: "不多" },
        { id: "grading", label: "给分好坏", option: "较好" },
        { id: "gain", label: "收获多少", option: "一般" },
      ],
    },
    {
      course_id: 31,
      code: "ID0101",
      name: "思想道德与法治",
      category: "ideology",
      department: "马克思主义学院",
      teacher_id: 32,
      teacher_name: "吴婷",
      rating: 4.0,
      review_count: 12,
      dimensionLabels: [
        { id: "difficulty", label: "课程难度", option: "适中" },
        { id: "homework", label: "作业多少", option: "不多" },
        { id: "grading", label: "给分好坏", option: "较好" },
        { id: "gain", label: "收获多少", option: "一般" },
      ],
    },
    {
      course_id: 41,
      code: "MA0101",
      name: "高等数学",
      category: "math",
      department: "统计学院",
      teacher_id: 42,
      teacher_name: "郑海波",
      rating: 3.6,
      review_count: 31,
      dimensionLabels: [
        { id: "difficulty", label: "课程难度", option: "很难" },
        { id: "homework", label: "作业多少", option: "很多" },
        { id: "grading", label: "给分好坏", option: "一般" },
        { id: "gain", label: "收获多少", option: "较多" },
      ],
    },
    {
      course_id: 16,
      code: "SEM016",
      name: "未评分研讨课",
      category: "general",
      department: "人文学院",
      teacher_id: 17,
      teacher_name: "研讨教师",
      rating: null,
      review_count: 13,
    },
    {
      course_id: 14,
      code: "LECT01",
      name: "讲座合集",
      category: "general",
      department: "教务处",
      teacher_id: null,
      teacher_name: null,
      rating: null,
      review_count: 0,
    },
  ];
  const pages = 3;
  const safePage =
    Number.isInteger(page) && page > 0 ? Math.min(page, pages) : 1;
  return {
    items,
    total: 48,
    page: safePage,
    pageSize: items.length,
    pages,
  };
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

export type PreviewSubmitCourse = CourseOption &
  CourseReviewScheme & {
    teachers: Teacher[];
  };

/** DEV `/submit?preview=filled`: preset course × teacher plus a complete draft. */
export function previewFilledSubmitCourse(): PreviewSubmitCourse {
  const { course } = previewFilledCourseDetail(8);
  return {
    id: course.id,
    code: course.code,
    name: course.name,
    category: course.category,
    department: course.department,
    teachers: course.teachers,
    ...courseSchemeView("major", course.category, []),
  };
}

export function previewFilledSubmitDraft() {
  const course = previewFilledSubmitCourse();
  return {
    teacherId: String(course.teachers[0]?.id ?? 2),
    scores: {
      difficulty: "2",
      homework: "2",
      grading: "1",
      gain: "1",
    } as Record<string, string>,
    overall: "5",
    note: "例题扎实，作业量适中。讲课节奏清楚，期末按作业过一遍就能覆盖考点。",
    grade: "90",
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

const PREVIEW_DIMENSION_LABELS = [
  { id: "difficulty", label: "课程难度", option: "适中" },
  { id: "homework", label: "作业多少", option: "适中" },
  { id: "grading", label: "给分好坏", option: "较好" },
  { id: "gain", label: "收获多少", option: "较多" },
] as const;

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
      rating: 4.5,
      dimensionLabels: [...PREVIEW_DIMENSION_LABELS],
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

export function previewFilledTeacherDetail(teacherId = 1): {
  teacher: Teacher;
  courses: Course[];
  reviewCount: number;
} {
  const teacher: Teacher = {
    id: teacherId,
    name: "林晓雯",
    department: "会计学院",
    title: "",
    bio: "会计学院教师，主讲中级财务会计与相关专业课。",
    review_count: 2,
    course_count: 2,
    rating: 4.5,
  };
  return {
    teacher,
    courses: [
      {
        id: 8,
        code: "ACC2101",
        name: "中级财务会计",
        category: "general",
        department: "会计学院",
        teachers: teacher.name,
        review_count: 2,
        rating: 4.5,
        credits: 3,
      },
      {
        id: 9,
        code: "FIN2101",
        name: "货币金融学",
        category: "general",
        department: "金融学院",
        teachers: teacher.name,
        review_count: 1,
        rating: 4.0,
        credits: 3,
      },
    ],
    reviewCount: 2,
  };
}

export function previewFilledLatestReviews(): LatestReview[] {
  return [
    {
      id: "review:201",
      course_id: 8,
      teacher_id: 2,
      course_name: "中级财务会计",
      course_code: "ACC2101",
      teacher_name: "林晓雯",
      comment: "例题扎实，作业量适中。",
      headline: "例题扎实值得选",
      created_at: "2026-08-21 10:00:00",
      author_public_code: 1,
      author_avatar_key: 1,
    },
    {
      id: "review:207",
      course_id: 11,
      teacher_id: 12,
      course_name: "篮球",
      course_code: "PE0101",
      teacher_name: "周凯",
      comment: "气氛好。",
      headline: "还行",
      created_at: "2026-08-20 08:40:00",
      author_public_code: 6,
      author_avatar_key: 2,
    },
    {
      id: "review:202",
      course_id: 9,
      teacher_id: 3,
      course_name: "货币金融学",
      course_code: "FIN2102",
      teacher_name: "苏晚",
      comment: "课堂节奏清楚，案例能对上作业。",
      headline: "案例能对上作业",
      created_at: "2026-08-18 14:20:00",
      author_public_code: 3,
      author_avatar_key: 2,
    },
    {
      id: "review:208",
      course_id: 9,
      teacher_id: 3,
      course_name: "货币金融学原理与商业银行经营管理专题",
      course_code: "FIN2203",
      teacher_name: "赵启明·商业银行经营管理教研室",
      comment: "专题课信息密度高，银行案例能对上作业。",
      headline: "专题密度高但能跟上",
      created_at: "2026-08-16 21:05:00",
      author_public_code: 8,
      author_avatar_key: 4,
    },
    {
      id: "review:203",
      course_id: 12,
      teacher_id: 5,
      course_name: "习近平新时代中国特色社会主义思想概论",
      course_code: "IDE2103",
      teacher_name: "陈知行",
      comment: "讨论课认真听就能跟上。",
      headline: "讨论课值得去",
      created_at: "2026-08-12 09:15:00",
      author_public_code: 4,
      author_avatar_key: 3,
    },
    {
      id: "review:209",
      course_id: 41,
      teacher_id: 42,
      course_name: "高等数学",
      course_code: "MA0101",
      teacher_name: "郑海波",
      comment:
        "作业量很大，课后题建议当天做完。期中那周连着两次小测，又要交书面作业，时间要自己排。期末最好提前按作业题型过一遍，光看课件不够，讨论课漏掉的口头划范围也容易考到，开学前两周的例题也建议回看。",
      headline:
        "作业量大、小测密，期中那周连着两次测验还要交书面作业，时间要自己排；期末最好提前按作业题型过一遍，光看课件不够，讨论课漏掉的口头划范围也容易考到，开学前两周的例题也建议回看一遍再进考场。",
      created_at: "2026-08-11 07:30:00",
      author_public_code: 7,
      author_avatar_key: 1,
    },
    {
      id: "review:204",
      course_id: 8,
      teacher_id: 6,
      course_name: "中级财务会计",
      course_code: "ACC2101",
      teacher_name: "苏晚",
      comment: "另一位老师的节奏更快，建议提前预习例题。",
      headline: "节奏偏快要预习",
      created_at: "2026-08-08 16:40:00",
      author_public_code: 2,
      author_avatar_key: 4,
    },
    {
      id: "review:210",
      course_id: 21,
      teacher_id: 22,
      course_name: "大学英语",
      course_code: "EN0101",
      teacher_name: "陈思远",
      comment: "听力材料按周更新，课堂抽问比较勤，建议把上次作业的错题先过一遍再去。",
      created_at: "2026-08-03 13:12:00",
      author_public_code: 0,
      author_avatar_key: 0,
    },
    {
      id: "review:205",
      course_id: 15,
      teacher_id: 7,
      course_name: "大学英语 II",
      course_code: "ENG1202",
      teacher_name: "周宁",
      comment: "口语练习多，作业按周交。",
      headline: "口语练习多",
      created_at: "2026-07-30 11:05:00",
      author_public_code: 5,
      author_avatar_key: 0,
    },
    {
      id: "review:206",
      course_id: 9,
      teacher_id: 2,
      course_name: "货币金融学",
      course_code: "FIN2101",
      teacher_name: "林晓雯",
      comment: "作业量适中，期末按作业题型复习即可。",
      headline: "作业题型覆盖考点",
      created_at: "2026-07-22 19:30:00",
      author_public_code: 1,
      author_avatar_key: 1,
    },
  ];
}

export function previewFilledPublicUser(): PublicUserProfile {
  const profile = previewFilledProfile();
  const fromProfile = (profile.reviews ?? [])
    .filter((item) => !item.status || item.status === "approved")
    .map(
      (item): LatestReview => ({
        id: String(item.id),
        course_id: item.course_id,
        teacher_id: item.teacher_id,
        course_name: item.course_name,
        course_code: "",
        teacher_name: item.teacher_name ?? "",
        comment: item.comment ?? "",
        headline: item.headline,
        created_at: item.created_at ?? null,
        author_public_code: profile.public_code ?? 1,
        author_avatar_key: profile.avatar_key ?? 1,
      }),
    );
  const reviews = [...fromProfile];
  for (const item of previewFilledLatestReviews()) {
    if (item.author_public_code !== (profile.public_code ?? 1)) continue;
    if (reviews.some((existing) => existing.id === item.id)) continue;
    reviews.push(item);
  }
  return {
    public_code: profile.public_code ?? 1,
    handle: profile.handle ?? "#000001",
    avatar_key: profile.avatar_key ?? 1,
    reserved: false,
    followable: true,
    viewer_followed: false,
    viewer_is_self: false,
    note: null,
    review_count: reviews.length,
    following_count: profile.following_user_count ?? 0,
    follower_count: profile.follower_count ?? 0,
    reviews,
  };
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
