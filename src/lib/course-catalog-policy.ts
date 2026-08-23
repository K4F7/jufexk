const EXCLUDED_COURSE_NAMES = new Set(["班会"]);

export function normalizeCourseNameForPolicy(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]+/gu, " ")
    .trim();
}

export function isExcludedCourseName(value: string) {
  return EXCLUDED_COURSE_NAMES.has(normalizeCourseNameForPolicy(value));
}
