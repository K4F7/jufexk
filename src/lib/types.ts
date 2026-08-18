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
  description?: string;
  /** Catalog list: "id:name,id:name" for real teacher links */
  teacher_refs?: string;
  teacher_ids?: string;
};

export type CourseOption = Pick<
  Course,
  "id" | "code" | "name" | "category" | "department" | "teachers"
>;

export type Teacher = {
  id: number;
  name: string;
  department: string;
  title: string;
  bio: string;
  rating?: number | null;
  course_count?: number;
  review_count?: number;
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

export type PublicReview = {
  id: string | number;
  comment: string;
  course_id: number;
  teacher_id: number;
  course_name?: string;
  course_code?: string;
  teacher_name?: string;
  endorsement_count?: number;
  endorsable?: boolean;
  viewer_endorsed?: boolean;
  /** Present only when the row has a stored scheme snapshot. */
  dimensionAverage?: number;
};

export type EndorsementState = {
  endorsementCount: number;
  viewerEndorsed: boolean;
};

export type PublicReviewPage = {
  items: PublicReview[];
  nextCursor: string | null;
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
