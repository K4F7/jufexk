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
  created_at: string | null;
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

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
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
