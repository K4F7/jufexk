/** Submit-form question selection and draft-score filtering. */

import {
  COMMON_CORE_QUESTIONS,
  type ApplicableQuestion,
} from "./review-schemes";

/**
 * Questions to paint on the write-review form.
 * When a course preset is still loading, return nothing so the first paint
 * cannot show COMMON_CORE (or any older fallback) before the live scheme.
 */
export function questionsForSubmitForm(
  selectedCourse: { applicableQuestions: readonly ApplicableQuestion[] } | null,
  waitingForCourseScheme: boolean,
): readonly ApplicableQuestion[] {
  if (selectedCourse) return selectedCourse.applicableQuestions;
  if (waitingForCourseScheme) return [];
  return COMMON_CORE_QUESTIONS;
}

/**
 * Keep answers that still exist on the current scheme and use a legal
 * option. Drop obsolete keys (v1 上课表现 / v3 考勤松紧) and out-of-range
 * values (for example a 1–5 leftover on a three-tier question).
 */
export function keepCurrentSchemaScores(
  scores: Record<string, string>,
  questions: readonly ApplicableQuestion[],
): Record<string, string> {
  const allowed = new Map(
    questions.map((question) => [
      question.id,
      new Set(question.options.map((option) => String(option.value))),
    ]),
  );
  return Object.fromEntries(
    Object.entries(scores).filter(([id, value]) => allowed.get(id)?.has(value)),
  );
}
