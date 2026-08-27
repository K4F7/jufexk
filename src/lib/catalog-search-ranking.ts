export type SearchRankingSurface = "course" | "relation" | "teacher" | "option";
export type SearchRankingFields = {
  exact?: string[];
  exactPredicates?: string[];
  prefix?: string[];
  substring?: string[];
  pinyin?: string;
  teacher?: string[];
  fts?: string;
  fuzzy?: string;
};
export type SearchRanking = { sql: string; args: string[] };

const joinOr = (parts: string[]) => (parts.length ? parts.join(" OR ") : "0");
const escaped = (parameter: string) =>
  `replace(replace(replace(${parameter},'\\','\\\\'),'%','\\%'),'_','\\_')`;
const like = (expr: string, pattern: string) =>
  `lower(${expr}) LIKE ${pattern} ESCAPE '\\'`;

/** Shared score; base 8 makes the weakest of at most six terms dominant. */
export function buildCatalogSearchRanking(
  terms: string[],
  fields: SearchRankingFields,
  _surface: SearchRankingSurface,
  parameterOffset = 0,
): SearchRanking {
  if (!terms.length) return { sql: "0.0", args: [] };
  const exact = fields.exact ?? [];
  const exactPredicates = fields.exactPredicates ?? [];
  const prefix = fields.prefix ?? [];
  const substring = fields.substring ?? [];
  const teacher = fields.teacher ?? [];
  const buckets = terms.map((_, index) => {
    const parameter = `?${parameterOffset + index + 1}`;
    const literal = escaped(parameter);
    const exactSql = joinOr([
      ...exact.map((expr) => `lower(${expr})=${parameter}`),
      ...exactPredicates.map((sql) => sql.replaceAll("$TERM", parameter)),
    ]);
    const pinyinExact = fields.pinyin ? `instr(' ' || COALESCE(${fields.pinyin},'') || ' ', ' ' || ${parameter} || ' ') > 0` : "0";
    const prefixSql = joinOr(prefix.map((expr) => like(expr, `${literal} || '%'`)));
    const pinyinPrefix = fields.pinyin ? `(' ' || COALESCE(${fields.pinyin},'') || ' ') LIKE '% ' || ${literal} || '%' ESCAPE '\\'` : "0";
    const substringSql = joinOr([...substring.map((expr) => like(expr, `'%' || ${literal} || '%'`)), ...(fields.fts ? [`(${fields.fts})`] : [])]);
    const teacherSql = joinOr(teacher.map((expr) => like(expr, `'%' || ${literal} || '%'`)));
    return `CASE WHEN ${exactSql} THEN 0 WHEN ${pinyinExact} THEN 1 WHEN ${prefixSql} THEN 8 WHEN ${pinyinPrefix} THEN 64 WHEN ${substringSql} THEN 512 WHEN ${teacherSql} THEN 4096 WHEN ${fields.fuzzy ?? "0"} THEN 32768 ELSE 262144 END`;
  });
  return { sql: `(${buckets.join("+")})`, args: terms.map((term) => term.toLowerCase()) };
}
