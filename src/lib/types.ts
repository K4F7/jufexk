export type CourseCategory = "general" | "sports" | "";

export type Course = {
  id: number;
  code: string;
  name: string;
  category: string;
  department: string;
  teachers: string | null;
  review_count: number;
  rating: number | null;
  credits?: number | null;
  description?: string;
  /** 课程管理员公告（公开纯文本）；未设置时为空串或不下发。 */
  admin_notice?: string | null;
  admin_notice_updated_at?: string | null;
  enrollment_category?: string;
  teaching_type?: string;
  course_level?: string;
  /** Catalog list: "id:name,id:name" for real teacher links */
  teacher_refs?: string;
  teacher_ids?: string;
};

/**
 * 目录页任课关系行（Issue #410）：`GET /api/courses?view=relations`
 * 一行一条课程×教师。无教师课程保留一行，teacher_id/teacher_name 为 null。
 * 无评价关系 rating=null、dimensionLabels=null。
 */
export type CourseRelation = {
  course_id: number;
  code: string;
  name: string;
  category: string;
  department: string;
  teacher_id: number | null;
  teacher_name: string | null;
  rating: number | null;
  review_count: number;
  dimensionLabels?: PublicReviewDimensionLabel[] | null;
  follow_count?: number;
  recommend_count?: number;
  not_recommend_count?: number;
  viewer_followed?: boolean;
  viewer_recommended?: boolean;
  viewer_not_recommended?: boolean;
  /** @deprecated 课程级展开兼容字段；关系接口不再下发。 */
  course_review_count?: number;
};

export type CourseOption = Pick<
  Course,
  "id" | "code" | "name" | "category" | "department" | "teachers"
>;

export type ApplicableQuestion = {
  id: string;
  label: string;
  prompt: string;
  scale: string;
  options: ReadonlyArray<{ value: number; label: string }>;
};

export type CourseReviewScheme = {
  schemeKey: string;
  schemeVersion: number;
  tags: string[];
  applicableQuestions: ApplicableQuestion[];
};

export type Teacher = {
  id: number;
  name: string;
  department: string;
  title: string;
  bio: string;
  rating?: number | null;
  course_count?: number;
  review_count?: number;
  dimensionLabels?: PublicReviewDimensionLabel[] | null;
  terms?: string[];
  follow_count?: number;
  recommend_count?: number;
  not_recommend_count?: number;
  viewer_followed?: boolean;
  viewer_recommended?: boolean;
  viewer_not_recommended?: boolean;
};

export type Offering = {
  id: number;
  course_id: number;
  term: string;
  section: string;
  campus: string;
  schedule: string;
  status: string;
  course_name?: string;
  teachers?: string;
  teacher_ids?: string;
};

export type Review = {
  id: number;
  course_id?: number;
  teacher_id?: number;
  course_name?: string;
  course_code?: string;
  teacher_name?: string;
  overall: number;
  term: string | null;
  created_at?: string | null;
  publishedAt?: string | null;
  comment: string;
  /** 一句话总结本课（#444）；旧行为空串。 */
  headline?: string;
  /** 选填成绩（#444），未填写为 null。 */
  grade?: string | null;
  teaching: string;
  attendance: string;
  grading: string;
  grading_score?: number | null;
  rescue: string;
  workload: string;
  workload_score?: number | null;
  assessment: string;
  clarity?: number | null;
  knowledge?: number | null;
  interest?: number | null;
  practicality?: number | null;
  fairness?: number | null;
  organization?: number | null;
  category?: string;
  status?: string;
  moderator_note?: string;
};

export type PublicReviewDimensionLabel = {
  id: string;
  /** Dimension label, e.g. 课程难度. */
  label: string;
  /** Chosen option label, e.g. 简单. */
  option: string;
};

export type PublicReview = {
  id: string | number;
  comment: string;
  /** 'html' 表示消毒后的富文本补充说明；缺省/null 为纯文本（issue #400）。 */
  comment_format?: string | null;
  /** 一句话总结本课（#444）；历史/旧行为空串。 */
  headline?: string;
  /** 选填成绩（#444）；仅在填写时下发。 */
  grade?: string | null;
  course_id: number;
  teacher_id: number;
  course_name?: string;
  course_code?: string;
  teacher_name?: string;
  overall?: number | null;
  term?: string | null;
  created_at?: string | null;
  endorsement_count?: number;
  endorsable?: boolean;
  viewer_endorsed?: boolean;
  /** Present only for stored snapshots whose scheme version still averages dimensions. */
  dimensionAverage?: number;
  /** Present only for stored snapshots whose scheme version publishes tier labels. */
  dimensionLabels?: PublicReviewDimensionLabel[];
  /** 已屏蔽标记：仅管理员会话的公开流下发；普通访客收不到被屏蔽条目。 */
  blocked?: boolean;
  /** 公开编号；无作者或历史/旧行为 0（匿名用户#000000）。 */
  author_public_code?: number | null;
  /** 官方头像 0–4；#000000 固定为 0。 */
  author_avatar_key?: number | null;
};

export type LatestReview = {
  id: string;
  course_id: number;
  teacher_id: number;
  course_name: string;
  course_code: string;
  teacher_name: string;
  comment: string;
  comment_format?: string | null;
  /** 一句话总结本课（#444）；历史/旧行为空串。展示时优先于 comment 纯文本。 */
  headline?: string;
  /** 选填成绩（#444）；仅在填写时下发。 */
  grade?: string | null;
  created_at: string | null;
  author_public_code?: number | null;
  author_avatar_key?: number | null;
};

export type RelationSignalState = {
  followCount: number;
  recommendCount: number;
  notRecommendCount: number;
  viewerFollowed: boolean;
  viewerRecommended: boolean;
  viewerNotRecommended: boolean;
};

export type EndorsementState = {
  endorsementCount: number;
  viewerEndorsed: boolean;
};

export type PublicReviewPage<T = PublicReview> = {
  items: T[];
  nextCursor: string | null;
  /** Total rows matching the active server-side review filters. */
  total?: number;
};

/** 任课关系 AI 总结（#401）：服务端已渲染并消毒的 HTML + 最近重算时间。 */
export type RelationSummary = {
  html: string;
  updatedAt: string | null;
};

export type LegacyReview = {
  id?: number;
  course_name?: string;
  teacher_name?: string;
  term?: string;
  comment: string;
  source_label?: string;
  source_file?: string;
  source_row?: number | string;
  ocr_confidence?: number | string;
  ocr_course_name?: string;
  ocr_teacher_name?: string;
  raw_ocr_text?: string;
  inherited_from?: string;
  duplicate_group?: string;
  status?: string;
  moderator_note?: string;
};

export type SiteConfig = {
  siteName: string;
  universityName: string;
  turnstileSiteKey?: string;
};

/**
 * 全站 Banner（公开载荷，`GET /api/site/banner`）。
 * 管理员录入的消毒 HTML；桌面版与移动版分别在下发内容非空时展示。
 */
export type SiteBanner = {
  desktop_html: string;
  mobile_html: string;
  updated_at?: string | null;
};

/** Banner 设置历史行（`GET /api/admin/banners`，最新在前）。 */
export type BannerRecord = {
  id: number;
  desktop_html: string;
  mobile_html: string;
  created_at?: string | null;
};

/** 公告栏条目（`GET /api/announcements` 公开只读；管理员经 /api/admin/announcements 维护）。 */
export type Announcement = {
  id: number;
  title: string;
  content: string;
  created_at?: string | null;
  updated_at?: string | null;
};

/**
 * 用户禁言状态（`GET /api/admin/users/:userRef`，仅管理员）。
 * userRef 是管理员侧的不透明用户引用；永远不暴露 email、学号、users.id。
 */
export type AdminUserBlockStatus = {
  user_ref: string;
  blocked: boolean;
  blocked_until?: string | null;
};

/**
 * 管理员学号绑定行（`GET /api/admin/student-bindings`）。
 * 只返回绑定 id 与时间，不含学号明文或哈希。
 */
export type AdminStudentBinding = {
  id: number;
  created_at: string;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

/** 个人主页「我的点评」条目（#459 契约）；status 含未过审状态。 */
export type UserProfileReview = {
  id: number | string;
  course_id: number;
  course_name: string;
  teacher_id: number;
  teacher_name?: string | null;
  term?: string | null;
  headline?: string;
  /** 补充说明摘要纯文本，可能已被服务端截断。 */
  comment?: string;
  created_at?: string | null;
  /** pending / approved / rejected；缺省按 approved 展示。 */
  status?: string;
};

/** 个人主页「我关注的任课关系」条目（#459 契约）。 */
export type UserProfileFollow = {
  course_id: number;
  course_name: string;
  teacher_id: number;
  teacher_name?: string | null;
};

/**
 * GET /api/user/profile 聚合返回（#459 / #493）：仅当前登录普通用户自己的数据，
 * 不含 email、学号或 users.id。可含公开编号与官方头像。
 */
export type UserProfile = {
  public_code?: number;
  handle?: string;
  avatar_key?: number;
  reviews?: UserProfileReview[];
  follows?: UserProfileFollow[];
  review_count?: number;
  follow_count?: number;
  unread_notification_count?: number;
};

/** GET /api/u/:code 公开主页（#493）。 */
export type PublicUserProfile = {
  public_code: number;
  handle: string;
  avatar_key: number;
  reserved: boolean;
  followable: boolean;
  viewer_followed: boolean;
  viewer_is_self: boolean;
  note: string | null;
  review_count: number;
  reviews: LatestReview[];
};

/** 站内消息条目（#460 契约）：文案 + 链接 + 时间 + 已读状态。 */
export type UserNotification = {
  id: number | string;
  /** 消息类型，如关注的任课关系有新点评、我的点评被认可。 */
  type?: string;
  text: string;
  /** 站内链接，如 /courses/8?teacher=9#review-101；缺失时按纯文本展示。 */
  href?: string | null;
  created_at?: string | null;
  read?: boolean;
};

export type CatalogRequest = {
  id: number;
  kind: "course" | "teacher";
  course_code?: string;
  course_name?: string;
  category?: string;
  department?: string;
  teacher_name?: string;
  note?: string;
  has_review?: number | boolean;
  status: string;
  moderator_note?: string;
  created_at?: string;
};
