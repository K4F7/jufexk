import { likeSql } from "./catalog-search";
import {
  GENERAL_EDUCATION_FILTER,
  GENERAL_EDUCATION_SCHEME_KEYS,
  isGeneralEducationFilter,
} from "./public-categories";
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

/** Shared sort-group key for 大学英语 1–4 / I–IV. Not a collapsed 公开展示课名. */
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

const ENGLISH_LEVEL_ORDER: Record<(typeof ENGLISH_LEVEL_COURSE_NAMES)[number], number> =
  {
    大学英语1: 1,
    大学英语I: 1,
    大学英语Ⅰ: 1,
    大学英语2: 2,
    大学英语II: 2,
    大学英语Ⅱ: 2,
    大学英语3: 3,
    大学英语III: 3,
    大学英语Ⅲ: 3,
    大学英语4: 4,
    大学英语IV: 4,
    大学英语Ⅳ: 4,
  };

/** Public PE skill prefix. Space before `[` is required. */
export const PE_PUBLIC_DISPLAY_PREFIX = "体育1-4";

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
  { label: "跆拳道", keys: ["跆拳道"] },
  { label: "游泳", keys: ["游泳"] },
  { label: "田径", keys: ["田径"] },
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

export function formatPeSkillDisplayName(skillLabel: string): string {
  return `${PE_PUBLIC_DISPLAY_PREFIX} [${skillLabel}]`;
}

export function virtualPeSportDisplayName(
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
): string {
  return formatPeSkillDisplayName(sport.label);
}

/** 与目录搜索同构：每个词条都要命中课名或某位任课教师。 */
export function virtualPeSportMatchesQuery(
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
  terms: string[],
) {
  const displayName = virtualPeSportDisplayName(sport);
  return terms.every(
    (term) =>
      sport.label.includes(term) ||
      displayName.includes(term) ||
      sport.teacherNames.some((teacher) => teacher.includes(term)),
  );
}

/** Skill-style PE titles shown as 体育课, not 普通课程. */
export const PUBLIC_SPORTS_NAME_PREFIXES = [
  ...new Set(PE_SKILL_FAMILIES.flatMap((family) => family.keys)),
] as const;

/** Numbered / 专项理论与实践 siblings, plus 田径1（体适能为主）. */
const SKILL_NAME_REST = /^(专项理论与实践)?\d*(（体适能为主）)?$/;

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

export function publicPeSkillDisplayName(name?: string | null): string | null {
  const label = publicPeSkillLabel(name);
  return label ? formatPeSkillDisplayName(label) : null;
}

export function isEnglishLevelCourseName(name?: string | null): boolean {
  const trimmed = name?.trim() ?? "";
  return (ENGLISH_LEVEL_COURSE_NAMES as readonly string[]).includes(trimmed);
}

export function englishLevelSortOrder(name?: string | null): number | null {
  const trimmed = name?.trim() ?? "";
  if (!isEnglishLevelCourseName(trimmed)) return null;
  return ENGLISH_LEVEL_ORDER[trimmed as (typeof ENGLISH_LEVEL_COURSE_NAMES)[number]];
}

/** Identify 大学英语 1–4 / I–IV for grouping. Does not rewrite the 公开展示课名. */
export function publicEnglishFamilyLabel(name?: string | null): string | null {
  return isEnglishLevelCourseName(name) ? ENGLISH_PUBLIC_LABEL : null;
}

export function publicCourseDisplayName(name?: string | null): string {
  const trimmed = name?.trim() ?? "";
  return publicPeSkillDisplayName(trimmed) ?? trimmed;
}

/** 投稿选项折叠体育专项展示名，保留大学英语 I–IV 教务名。 */
export function publicOptionDisplayName(name?: string | null): string {
  return publicCourseDisplayName(name);
}

export function groupEnglishLevelItems<
  T extends {
    name: string;
    teacher_id?: number | null;
    teacher_name?: string | null;
  },
>(items: T[]): T[] {
  const englishIndexes = items.flatMap((item, index) =>
    englishLevelSortOrder(item.name) == null ? [] : [index],
  );
  if (englishIndexes.length <= 1) return items;
  const groups = new Map<string, T[]>();
  const teacherOrder: string[] = [];
  for (const index of englishIndexes) {
    const item = items[index];
    const key = `${item.teacher_id ?? ""}:${item.teacher_name ?? ""}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      teacherOrder.push(key);
    }
    groups.get(key)?.push(item);
  }
  const grouped = teacherOrder.flatMap((key) =>
    (groups.get(key) ?? []).sort((left, right) => {
      const level =
        (englishLevelSortOrder(left.name) ?? 0) -
        (englishLevelSortOrder(right.name) ?? 0);
      return level || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    }),
  );
  const rest = items.filter((item) => englishLevelSortOrder(item.name) == null);
  const insertAt = Math.min(Math.min(...englishIndexes), rest.length);
  return [...rest.slice(0, insertAt), ...grouped, ...rest.slice(insertAt)];
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

export function publicEnglishLevelOrderSql(alias = "c"): string {
  const branches = ENGLISH_LEVEL_COURSE_NAMES.map(
    (name) =>
      `WHEN ${alias}.name=${sqlStringLiteral(name)} THEN ${ENGLISH_LEVEL_ORDER[name]}`,
  );
  return `CASE ${branches.join(" ")} ELSE NULL END`;
}

export function publicCourseDisplayNameSql(alias = "c"): string {
  const family = publicPeSkillFamilySql(alias);
  return `COALESCE(${sqlStringLiteral(`${PE_PUBLIC_DISPLAY_PREFIX} [`)} || (${family}) || ']',${alias}.name)`;
}

export function publicPeDisplaySearchSql(alias = "c"): string {
  const family = publicPeSkillFamilySql(alias);
  return `COALESCE(${sqlStringLiteral(`${PE_PUBLIC_DISPLAY_PREFIX} [`)} || (${family}) || ${sqlStringLiteral(`] ${PE_PUBLIC_DISPLAY_PREFIX}`)},'')`;
}

export function publicRelationNameSortSql(
  alias = "c",
  teacherAlias = "t",
): string {
  const display = publicCourseDisplayNameSql(alias);
  const level = publicEnglishLevelOrderSql(alias);
  const group = `CASE WHEN (${level}) IS NOT NULL THEN ${sqlStringLiteral(ENGLISH_PUBLIC_LABEL)} ELSE ${display} END`;
  return `${group},CASE WHEN (${level}) IS NOT NULL THEN COALESCE(${teacherAlias}.name,'') ELSE '' END,COALESCE(${level},0),${display},${alias}.code,${alias}.id,COALESCE(${teacherAlias}.name,''),COALESCE(${teacherAlias}.id,0)`;
}

function padSortInt(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function publicRelationNameSortKey(row: {
  name: string;
  code?: string | null;
  course_id?: number | null;
  teacher_name?: string | null;
  teacher_id?: number | null;
}): string {
  const level = englishLevelSortOrder(row.name);
  return [
    level != null ? ENGLISH_PUBLIC_LABEL : row.name,
    level != null ? (row.teacher_name ?? "") : "",
    padSortInt(level ?? 0, 2),
    row.name,
    row.code ?? "",
    padSortInt(row.course_id ?? 0, 10),
    row.teacher_name ?? "",
    padSortInt(row.teacher_id ?? 0, 10),
  ].join("\u001f");
}

export function publicRelationNameSortKeySql(
  alias = "c",
  teacherAlias = "t",
): string {
  const display = publicCourseDisplayNameSql(alias);
  const level = publicEnglishLevelOrderSql(alias);
  const group = `CASE WHEN (${level}) IS NOT NULL THEN ${sqlStringLiteral(ENGLISH_PUBLIC_LABEL)} ELSE ${display} END`;
  const engTeacher = `CASE WHEN (${level}) IS NOT NULL THEN COALESCE(${teacherAlias}.name,'') ELSE '' END`;
  return `printf('%s',${group}) || char(31) || printf('%s',${engTeacher}) || char(31) || printf('%02d',COALESCE(${level},0)) || char(31) || printf('%s',${display}) || char(31) || printf('%s',${alias}.code) || char(31) || printf('%010d',${alias}.id) || char(31) || printf('%s',COALESCE(${teacherAlias}.name,'')) || char(31) || printf('%010d',COALESCE(${teacherAlias}.id,0))`;
}

/** PE families still merge. 大学英语 I–IV / 1–4 stay unmerged. */
export function publicBrowseFamilySql(alias = "c"): string {
  return publicPeSkillFamilySql(alias);
}

export function publicPeHasTextReviewSql(alias: string): string {
  return `EXISTS(
    SELECT 1 FROM public_historical_reviews phr
     WHERE phr.course_id=${alias}.id
       AND phr.deleted_at IS NULL AND phr.blocked_at IS NULL
    UNION ALL
    SELECT 1 FROM reviews r
     WHERE r.course_id=${alias}.id AND r.status='approved'
       AND r.blocked_at IS NULL AND r.deleted_at IS NULL
       AND trim(COALESCE(r.comment,''))<>''
  )`;
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
  GENERAL_EDUCATION_FILTER,
  ...GENERAL_EDUCATION_SCHEME_KEYS,
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
 * general / major / public_basic: 通识课 — scheme_key in major|public_basic,
 * excluding mooc-tagged rows.
 * english / ideology / math: exact scheme_key, excluding mooc-tagged rows.
 * mooc: every public course with the mooc tag, regardless of scheme_key.
 */
export function publicCategoryFilterSql(
  category: string,
  alias = "c",
  projectionAlias?: string,
): { sql: string; args: string[] } {
  if (!category) return { sql: "1=1", args: [] };
  const moocTag = publicHasMoocTagSql(alias);
  if (category === "mooc") return { sql: moocTag, args: [] };
  if (category === "sports") {
    return {
      sql: projectionAlias
        ? `(${projectionAlias}.is_public_sports=1)`
        : `((${publicSportsMatchSql(alias)} OR ${alias}.scheme_key='pe') AND NOT ${moocTag})`,
      args: [],
    };
  }
  if (isGeneralEducationFilter(category)) {
    const keys = GENERAL_EDUCATION_SCHEME_KEYS.map(sqlStringLiteral).join(",");
    return {
      sql: `(${alias}.scheme_key IN (${keys}) AND NOT ${moocTag})`,
      args: [],
    };
  }
  return {
    sql: `(${alias}.scheme_key=? AND NOT ${moocTag})`,
    args: [category],
  };
}
