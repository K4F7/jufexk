import { likeSql } from "./catalog-search";
import {
  normalizeReviewTemplateKind,
  type ReviewTemplateKind,
} from "./review-template-kind";

/** 教务伞形课名. Hidden from public browse. */
export const UMBRELLA_PE_COURSE_NAMES = [
  "体育1",
  "体育2",
  "体育3",
  "体育4",
  "体育Ⅰ（留）",
  "体育Ⅱ（留）",
  "体育I（留）",
  "体育II（留）",
  "大学体育1",
  "大学体育2",
  "大学体育3",
  "大学体育4",
  "大学体育I",
  "大学体育II",
  "大学体育III",
  "大学体育IV",
  "大学体育Ⅰ",
  "大学体育Ⅱ",
  "大学体育Ⅲ",
  "大学体育Ⅳ",
] as const;

/** Exact 大学英语 1–4 / I–IV titles that collapse to one public name. */
export const ENGLISH_PUBLIC_LABEL = "大学英语";

export const ENGLISH_LEVEL_COURSE_NAMES = [
  "大学英语1",
  "大学英语2",
  "大学英语3",
  "大学英语4",
  "大学英语I",
  "大学英语II",
  "大学英语III",
  "大学英语IV",
  "大学英语Ⅰ",
  "大学英语Ⅱ",
  "大学英语Ⅲ",
  "大学英语Ⅳ",
] as const;

export const ENGLISH_FIRST_LEVEL_NAMES = [
  "大学英语1",
  "大学英语I",
  "大学英语Ⅰ",
] as const;

/**
 * Public PE skill families. Numbered / 专项理论与实践 siblings collapse
 * to one 公开展示课名. 健身教练 is the catalog name for historical 健美操.
 */
export const PE_SKILL_FAMILIES = [
  { label: "健美操", keys: ["健美操", "健身教练"] },
  { label: "击剑", keys: ["击剑"] },
  { label: "篮球", keys: ["篮球"] },
  { label: "网球", keys: ["网球"] },
  { label: "羽毛球", keys: ["羽毛球"] },
  { label: "排球", keys: ["排球"] },
  { label: "乒乓球", keys: ["乒乓球"] },
  { label: "足球", keys: ["足球"] },
  { label: "瑜伽", keys: ["瑜伽"] },
  { label: "武术", keys: ["武术"] },
  { label: "体育舞蹈", keys: ["体育舞蹈"] },
  { label: "轮滑", keys: ["轮滑"] },
  { label: "散打", keys: ["散打"] },
] as const;

/**
 * Visible PE sports that have no non-umbrella catalog course.
 * 表上黄丽华 → 目录黄丽萍；刘春来 only has 体育1–4 + 体育心理学.
 */
export const VIRTUAL_PE_SPORTS = [
  { id: 800001, label: "瑜伽", teacherNames: ["黄丽萍"] },
  { id: 800002, label: "武术", teacherNames: ["刘春来"] },
] as const;

export function isVirtualPeSportId(id?: number | null): boolean {
  return VIRTUAL_PE_SPORTS.some((sport) => sport.id === id);
}

export function virtualPeSportById(id: number) {
  return VIRTUAL_PE_SPORTS.find((sport) => sport.id === id) ?? null;
}

export function virtualPeSportForTeacherName(name?: string | null) {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return null;
  return (
    VIRTUAL_PE_SPORTS.find((sport) =>
      (sport.teacherNames as readonly string[]).includes(trimmed),
    ) ?? null
  );
}

/** 与目录搜索同构：每个词条都要命中课名或某位任课教师。 */
export function virtualPeSportMatchesQuery(
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
  terms: string[],
) {
  return terms.every(
    (term) =>
      sport.label.includes(term) ||
      sport.teacherNames.some((teacher) => teacher.includes(term)),
  );
}

/** Skill-style PE titles shown as 体育课, not 普通课程. */
export const PUBLIC_SPORTS_NAME_PREFIXES = [
  ...new Set(PE_SKILL_FAMILIES.flatMap((family) => family.keys)),
] as const;

const SKILL_NAME_REST = /^(专项理论与实践)?\d*$/;

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function isUmbrellaPeCourseName(name?: string | null): boolean {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return false;
  return (UMBRELLA_PE_COURSE_NAMES as readonly string[]).includes(trimmed);
}

export function publicPeSkillLabel(name?: string | null): string | null {
  const trimmed = name?.trim() ?? "";
  if (!trimmed || isUmbrellaPeCourseName(trimmed)) return null;
  const keys = PE_SKILL_FAMILIES.flatMap((family) =>
    family.keys.map((key) => ({ key, label: family.label })),
  ).sort((left, right) => right.key.length - left.key.length);
  for (const { key, label } of keys) {
    if (trimmed === key) return label;
    if (
      trimmed.startsWith(key) &&
      SKILL_NAME_REST.test(trimmed.slice(key.length))
    )
      return label;
  }
  return null;
}

export function isPublicSportsSkillName(name?: string | null): boolean {
  return publicPeSkillLabel(name) !== null;
}

export function publicEnglishFamilyLabel(name?: string | null): string | null {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return null;
  return (ENGLISH_LEVEL_COURSE_NAMES as readonly string[]).includes(trimmed)
    ? ENGLISH_PUBLIC_LABEL
    : null;
}

export function publicCourseDisplayName(name?: string | null): string {
  const trimmed = name?.trim() ?? "";
  return (
    publicPeSkillLabel(trimmed) ?? publicEnglishFamilyLabel(trimmed) ?? trimmed
  );
}

/** 投稿选项只折叠体育专项，保留大学英语 I–IV 教务名。 */
export function publicOptionDisplayName(name?: string | null): string {
  const trimmed = name?.trim() ?? "";
  return publicPeSkillLabel(trimmed) ?? trimmed;
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

export function publicPeSkillFamilySql(alias = "c"): string {
  const branches = PE_SKILL_FAMILIES.map((family) => {
    const conds = family.keys.flatMap((key) => [
      `${alias}.name = ${sqlStringLiteral(key)}`,
      `${alias}.name GLOB ${sqlStringLiteral(`${key}[0-9]*`)}`,
      `${alias}.name LIKE ${sqlStringLiteral(`${key}专项理论与实践%`)}`,
    ]);
    return `WHEN ${conds.join(" OR ")} THEN ${sqlStringLiteral(family.label)}`;
  });
  return `CASE ${branches.join(" ")} ELSE NULL END`;
}

export function publicEnglishFamilySql(alias = "c"): string {
  const names = ENGLISH_LEVEL_COURSE_NAMES.map(sqlStringLiteral).join(",");
  return `CASE WHEN ${alias}.name IN (${names}) THEN ${sqlStringLiteral(ENGLISH_PUBLIC_LABEL)} ELSE NULL END`;
}

export function publicBrowseFamilySql(alias = "c"): string {
  return `COALESCE(${publicPeSkillFamilySql(alias)}, ${publicEnglishFamilySql(alias)})`;
}

export function publicPeHasTextReviewSql(alias: string): string {
  return `EXISTS(
    SELECT 1 FROM public_historical_reviews phr WHERE phr.course_id=${alias}.id
    UNION ALL
    SELECT 1 FROM legacy_reviews lr
     WHERE lr.course_id=${alias}.id AND lr.status='approved'
       AND trim(COALESCE(lr.comment,''))<>''
    UNION ALL
    SELECT 1 FROM reviews r
     WHERE r.course_id=${alias}.id AND r.status='approved'
       AND trim(COALESCE(r.comment,''))<>''
  )`;
}

function publicPeCanonicalOrderSql(alias: string): string {
  const unnumbered = PE_SKILL_FAMILIES.flatMap((family) => family.keys)
    .map((key) => `${alias}.name = ${sqlStringLiteral(key)}`)
    .join(" OR ");
  const firstNumbered = PE_SKILL_FAMILIES.flatMap((family) => family.keys)
    .flatMap((key) => [
      `${alias}.name = ${sqlStringLiteral(`${key}1`)}`,
      `${alias}.name = ${sqlStringLiteral(`${key}专项理论与实践1`)}`,
    ])
    .join(" OR ");
  return `CASE WHEN ${publicPeHasTextReviewSql(alias)} THEN 0 ELSE 1 END,
      CASE
        WHEN ${unnumbered} THEN 0
        WHEN ${firstNumbered} THEN 1
        ELSE 2
      END,
      ${alias}.id`;
}

export function publicPeResolveCanonicalIdSql(taughtAlias: string): string {
  const taughtFamily = publicPeSkillFamilySql(taughtAlias);
  const memberFamily = publicPeSkillFamilySql("pe_family");
  return `COALESCE((
    SELECT pe_family.id FROM courses pe_family
    WHERE (${taughtFamily}) IS NOT NULL AND (${memberFamily}) = (${taughtFamily})
    ORDER BY ${publicPeCanonicalOrderSql("pe_family")}
    LIMIT 1
  ), ${taughtAlias}.id)`;
}

export function publicPeCanonicalCourseSql(alias = "c"): string {
  return `${alias}.id = ${publicPeResolveCanonicalIdSql(alias)}`;
}

export function publicPeFamilySearchSql(alias = "c"): string {
  const family = publicPeSkillFamilySql(alias);
  const hitFamily = publicPeSkillFamilySql("pe_hit");
  return `(${likeSql(`(${family})`)} OR EXISTS(
    SELECT 1 FROM courses pe_hit
    WHERE (${family}) IS NOT NULL
      AND (${hitFamily}) = (${family})
      AND (${likeSql("pe_hit.name")} OR ${likeSql("pe_hit.code")})
  ))`;
}

export function publicSportsMatchSql(alias = "c"): string {
  const prefixes = PUBLIC_SPORTS_NAME_PREFIXES.map(
    (prefix) => `${alias}.name LIKE ${sqlStringLiteral(`${prefix}%`)}`,
  ).join(" OR ");
  return `(${publicCourseVisibleSql(alias)} AND (${alias}.category IN ('sports','pe') OR ${prefixes}))`;
}

/** Public catalog `?category=` values. Empty means all; others stay 400. */
export const PUBLIC_CATEGORY_FILTERS = [
  "sports",
  "english",
  "ideology",
  "math",
  "mooc",
] as const;

export type PublicCategoryFilter = (typeof PUBLIC_CATEGORY_FILTERS)[number];

export function isPublicListCategoryFilter(
  value: string,
): value is PublicCategoryFilter {
  return (PUBLIC_CATEGORY_FILTERS as readonly string[]).includes(value);
}

export function publicHasMoocTagSql(alias = "c"): string {
  return `EXISTS (SELECT 1 FROM course_tags WHERE course_id=${alias}.id AND tag='mooc')`;
}

export function publicCategoryFilterError(): string {
  return `公开筛选仅支持 ${PUBLIC_CATEGORY_FILTERS.join("、")}`;
}

/**
 * sports: existing PE presentation match or scheme_key=pe.
 * english / ideology / math: exact scheme_key, excluding mooc-tagged rows.
 * mooc: every public course with the mooc tag, regardless of scheme_key.
 */
export function publicCategoryFilterSql(
  category: string,
  alias = "c",
): { sql: string; args: string[] } {
  if (!category) return { sql: "1=1", args: [] };
  const moocTag = publicHasMoocTagSql(alias);
  if (category === "mooc") return { sql: moocTag, args: [] };
  if (category === "sports") {
    return {
      sql: `((${publicSportsMatchSql(alias)} OR ${alias}.scheme_key='pe') AND NOT ${moocTag})`,
      args: [],
    };
  }
  return {
    sql: `(${alias}.scheme_key=? AND NOT ${moocTag})`,
    args: [category],
  };
}
