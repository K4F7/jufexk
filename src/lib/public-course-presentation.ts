import {
  normalizeReviewTemplateKind,
  type ReviewTemplateKind,
} from "./review-template-kind";

/** Official KINGOSOFT umbrella PE titles. Hidden from public browse. */
export const UMBRELLA_PE_COURSE_NAMES = [
  "体育1",
  "体育2",
  "体育3",
  "体育4",
  "体育Ⅰ（留）",
  "体育Ⅱ（留）",
  "体育I（留）",
  "体育II（留）",
] as const;

/** Skill-style PE titles shown as 体育课, not 普通课程. */
export const PUBLIC_SPORTS_NAME_PREFIXES = [
  "网球",
  "击剑",
  "羽毛球",
  "排球",
  "篮球",
  "健身教练",
  "健美操",
  "瑜伽",
  "武术",
] as const;

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function isUmbrellaPeCourseName(name?: string | null): boolean {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return false;
  return (UMBRELLA_PE_COURSE_NAMES as readonly string[]).includes(trimmed);
}

export function isPublicSportsSkillName(name?: string | null): boolean {
  const trimmed = name?.trim() ?? "";
  if (!trimmed || isUmbrellaPeCourseName(trimmed)) return false;
  return PUBLIC_SPORTS_NAME_PREFIXES.some(
    (prefix) => trimmed === prefix || trimmed.startsWith(prefix),
  );
}

export function publicCourseCategory(
  name?: string | null,
  stored?: string | null,
): ReviewTemplateKind | "" {
  if (isPublicSportsSkillName(name)) return "sports";
  return normalizeReviewTemplateKind(stored);
}

export function publicCourseVisibleSql(alias = "c"): string {
  const names = UMBRELLA_PE_COURSE_NAMES.map(sqlStringLiteral).join(",");
  return `${alias}.name NOT IN (${names})`;
}

export function publicSportsMatchSql(alias = "c"): string {
  const prefixes = PUBLIC_SPORTS_NAME_PREFIXES.map(
    (prefix) => `${alias}.name LIKE ${sqlStringLiteral(`${prefix}%`)}`,
  ).join(" OR ");
  return `(${publicCourseVisibleSql(alias)} AND (${alias}.category IN ('sports','pe') OR ${prefixes}))`;
}
