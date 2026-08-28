/**
 * Shared public-catalog relevance ranking.
 *
 * Callers supply normalized terms, the search surface, and the field
 * capabilities they own. This module returns an ORDER BY fragment plus bind
 * args that stay 1:1 with its numbered placeholders. There is one D1
 * implementation; no repository/port layer.
 *
 * Product buckets high → low: exact, exact pinyin, prefix, pinyin prefix,
 * substring/FTS, teacher/department, fuzzy.
 *
 * Multi-word aggregation is the suggested tuple, packed so SQLite does not
 * receive a bare integer ORDER BY term (those are column indexes) and so the
 * CASE text is not copied into MAX() + SUM() separately:
 *
 *   1. exponential term-bucket sum (base 8; the weakest of ≤6 terms dominates)
 *   2. teacher intra-bucket (exact > prefix > substring)
 *   3. optional FTS/BM25 score (lower is better; omitted when unused)
 *   4. caller tie-breaker
 */
export const SEARCH_RANK_BUCKETS = {
  exact: 0,
  exactPinyin: 1,
  prefix: 2,
  pinyinPrefix: 3,
  substringFts: 4,
  teacherDepartment: 5,
  fuzzy: 6,
  miss: 7,
} as const;

/** Base-8 weights so six better-bucket terms cannot outrank one weaker term. */
export const SEARCH_RANK_WEIGHTS = {
  exact: 0,
  exactPinyin: 1,
  prefix: 8,
  pinyinPrefix: 64,
  substringFts: 512,
  teacherDepartment: 4096,
  fuzzy: 32768,
  miss: 262144,
} as const;

export type SearchRankBucket = (typeof SEARCH_RANK_BUCKETS)[keyof typeof SEARCH_RANK_BUCKETS];
export type SearchRankingSurface = "course" | "relation" | "teacher" | "option";

export type SearchRankingFields = {
  exact?: string[];
  exactPredicates?: string[];
  prefix?: string[];
  prefixPredicates?: string[];
  substring?: string[];
  substringPredicates?: string[];
  pinyin?: string;
  teacher?: string[];
  teacherExactPredicates?: string[];
  /** Per-term boolean SQL. `$TERM` / `$LITERAL` are substituted. */
  fts?: string;
  /** Row-level score, lower is better (e.g. BM25). No dummy args if omitted. */
  ftsScore?: string;
  /** Optional lowest-bucket boolean SQL. No dummy args if omitted. */
  fuzzy?: string;
};

export type SearchRanking = {
  sql: string;
  args: string[];
  buckets: typeof SEARCH_RANK_BUCKETS;
};

const joinOr = (parts: string[]) => {
  const present = parts.filter((part) => part && part !== "0");
  return present.length ? present.join(" OR ") : "0";
};

const escaped = (parameter: string) =>
  `replace(replace(replace(${parameter},'\\','\\\\'),'%','\\%'),'_','\\_')`;

const like = (expr: string, pattern: string) =>
  `lower(${expr}) LIKE ${pattern} ESCAPE '\\'`;

const substitute = (sql: string, term: string, literal: string) =>
  sql.replaceAll("$LITERAL", literal).replaceAll("$TERM", term);

export function buildCatalogSearchRanking(
  terms: string[],
  fields: SearchRankingFields,
  _surface: SearchRankingSurface,
  parameterOffset = 0,
): SearchRanking {
  if (!terms.length) {
    return { sql: "0.0", args: [], buckets: SEARCH_RANK_BUCKETS };
  }

  const exact = fields.exact ?? [];
  const exactPredicates = fields.exactPredicates ?? [];
  const prefix = fields.prefix ?? [];
  const prefixPredicates = fields.prefixPredicates ?? [];
  const substring = fields.substring ?? [];
  const substringPredicates = fields.substringPredicates ?? [];
  const teacher = fields.teacher ?? [];
  const teacherExactPredicates = fields.teacherExactPredicates ?? [];

  const termSql = terms.map((_, index) => {
    const parameter = `?${parameterOffset + index + 1}`;
    const literal = escaped(parameter);
    const pred = (sql: string) => substitute(sql, parameter, literal);

    const exactSql = joinOr([
      ...exact.map((expr) => `lower(${expr})=${parameter}`),
      ...exactPredicates.map(pred),
    ]);
    const pinyinExact = fields.pinyin
      ? `instr(' ' || COALESCE(${fields.pinyin},'') || ' ', ' ' || ${parameter} || ' ') > 0`
      : "0";
    const prefixSql = joinOr([
      ...prefix.map((expr) => like(expr, `${literal} || '%'`)),
      ...prefixPredicates.map(pred),
    ]);
    const pinyinPrefix = fields.pinyin
      ? `(' ' || COALESCE(${fields.pinyin},'') || ' ') LIKE '% ' || ${literal} || '%' ESCAPE '\\'`
      : "0";
    const substringSql = joinOr([
      ...substring.map((expr) => like(expr, `'%' || ${literal} || '%'`)),
      ...(fields.pinyin ? [like(fields.pinyin, `'%' || ${literal} || '%'`) ] : []),
      ...substringPredicates.map(pred),
      ...(fields.fts ? [`(${pred(fields.fts)})`] : []),
    ]);
    const teacherExactSql = joinOr([
      ...teacher.map((expr) => `lower(${expr})=${parameter}`),
      ...teacherExactPredicates.map(pred),
    ]);
    const teacherPrefixSql = joinOr(
      teacher.map((expr) => like(expr, `${literal} || '%'`)),
    );
    const teacherSubstringSql = joinOr(
      teacher.map((expr) => like(expr, `'%' || ${literal} || '%'`)),
    );
    const teacherSql = joinOr([
      teacherExactSql,
      teacherPrefixSql,
      teacherSubstringSql,
    ]);
    const fuzzySql = fields.fuzzy ? pred(fields.fuzzy) : "0";

    const bucket = `CASE WHEN ${exactSql} THEN ${SEARCH_RANK_WEIGHTS.exact} WHEN ${pinyinExact} THEN ${SEARCH_RANK_WEIGHTS.exactPinyin} WHEN ${prefixSql} THEN ${SEARCH_RANK_WEIGHTS.prefix} WHEN ${pinyinPrefix} THEN ${SEARCH_RANK_WEIGHTS.pinyinPrefix} WHEN ${substringSql} THEN ${SEARCH_RANK_WEIGHTS.substringFts} WHEN ${teacherSql} THEN ${SEARCH_RANK_WEIGHTS.teacherDepartment} WHEN ${fuzzySql} THEN ${SEARCH_RANK_WEIGHTS.fuzzy} ELSE ${SEARCH_RANK_WEIGHTS.miss} END`;
    const teacherIntra = `CASE WHEN ${teacherExactSql} THEN 0 WHEN ${teacherPrefixSql} THEN 1 WHEN ${teacherSubstringSql} THEN 2 ELSE 3 END`;
    return { bucket, teacherIntra };
  });

  const keys = [
    `(${termSql.map((part) => part.bucket).join("+")})`,
    `(${termSql.map((part) => part.teacherIntra).join("+")})`,
    ...(fields.ftsScore ? [fields.ftsScore] : []),
  ];

  return {
    sql: keys.join(","),
    args: terms.map((term) => term.toLowerCase()),
    buckets: SEARCH_RANK_BUCKETS,
  };
}
