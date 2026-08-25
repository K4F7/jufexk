/** 写评价本机草稿：按课程×教师保存，方便稍后续写。 */

export const REVIEW_DRAFT_VERSION = 1;

export type ReviewDraft = {
  version: typeof REVIEW_DRAFT_VERSION;
  term: string;
  scores: Record<string, string>;
  overall: string;
  note: string;
  grade: string;
  loginOnly: boolean;
  reviewOnly: boolean;
  savedAt: number;
};

export function reviewDraftKey(courseId: number, teacherId: string) {
  return `jufexk-review-draft:v${REVIEW_DRAFT_VERSION}:${courseId}:${teacherId}`;
}

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function parseReviewDraft(raw: unknown): ReviewDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== REVIEW_DRAFT_VERSION) return null;
  if (typeof value.term !== "string") return null;
  if (typeof value.overall !== "string") return null;
  if (typeof value.note !== "string") return null;
  if (typeof value.grade !== "string") return null;
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt))
    return null;
  if (Date.now() - value.savedAt > MAX_AGE_MS) return null;
  if (!value.scores || typeof value.scores !== "object" || Array.isArray(value.scores))
    return null;
  const scores = Object.fromEntries(
    Object.entries(value.scores as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return {
    version: REVIEW_DRAFT_VERSION,
    term: value.term,
    scores,
    overall: value.overall,
    note: value.note,
    grade: value.grade,
    loginOnly: value.loginOnly === true,
    reviewOnly: value.reviewOnly === true,
    savedAt: value.savedAt,
  };
}

export function loadReviewDraft(
  courseId: number,
  teacherId: string,
): ReviewDraft | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(reviewDraftKey(courseId, teacherId));
    if (!raw) return null;
    return parseReviewDraft(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveReviewDraft(
  courseId: number,
  teacherId: string,
  draft: Omit<ReviewDraft, "version" | "savedAt">,
) {
  if (typeof localStorage === "undefined") return;
  const payload: ReviewDraft = {
    ...draft,
    version: REVIEW_DRAFT_VERSION,
    savedAt: Date.now(),
  };
  localStorage.setItem(reviewDraftKey(courseId, teacherId), JSON.stringify(payload));
}

export function clearReviewDraft(courseId: number, teacherId: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(reviewDraftKey(courseId, teacherId));
}
