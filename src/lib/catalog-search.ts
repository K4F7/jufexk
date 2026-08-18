/**
 * 公开目录搜索的关键词解析与 LIKE 片段拼装。
 *
 * 两条不变量：
 * - 用户输入里的 `%` 和 `_` 是字面量，不是通配符：一律转义并配 ESCAPE 子句。
 * - 空白分隔的多个词条按 AND 组合，「高等数学 张三」同时约束课名与任课教师。
 *
 * 绑定参数由片段里的 `?` 个数推导（见 `andSearchTerms`），调用方不再手写
 * `[q,q,q,…]` 这种依赖顺序的重复绑定表。
 */

const LIKE_ESCAPE = "\\";

/** 全角空格也是分词符：中文输入法下 “高等数学　张三” 很常见。 */
const TERM_SEPARATOR = /[\s\u3000]+/;

/**
 * 词条上限。每个词条都会把整个命中面片段复制一遍，而 D1 单条语句的绑定参数
 * 有上限；课程列表最长的那条语句是 18 + 9×词条数，取 6 留足余量。超出的词条
 * 被丢弃（结果偏宽而不是报错）；`q` 本身只有 80 字符，正常查询到不了这里。
 */
const MAX_TERMS = 6;

export type SearchFilter = {
  /** 已按词条展开的 SQL 片段；词条为空时是空串。 */
  sql: string;
  /** 与片段中占位符一一对应的 LIKE 参数。 */
  args: string[];
};

/** 拆出去重后的搜索词条；空查询返回空数组。 */
export function parseSearchTerms(raw: string): string[] {
  const terms = raw
    .split(TERM_SEPARATOR)
    .map((term) => term.trim())
    .filter(Boolean);
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

/** 把字面量里的通配符和转义符本身转义。 */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `${LIKE_ESCAPE}${char}`);
}

/** 前缀匹配模式：`词条%`。 */
export function prefixPattern(term: string): string {
  return `${likeEscape(term)}%`;
}

/** 包含匹配模式：`%词条%`。 */
function containsPattern(term: string): string {
  return `%${likeEscape(term)}%`;
}

/** `expr LIKE ? ESCAPE '\'`——所有用户输入的 LIKE 都要走这里。 */
export function likeSql(expr: string): string {
  return `${expr} LIKE ? ESCAPE '${LIKE_ESCAPE}'`;
}

/**
 * 把「单个词条的 OR 组」按词条数展开成 AND 组。
 *
 * `termSql` 里的每个占位符都绑定同一个词条的包含模式，因此片段可以自由增删
 * 字段而不用同步维护参数表。
 */
export function andSearchTerms(terms: string[], termSql: string): SearchFilter {
  if (!terms.length) return { sql: "", args: [] };
  const placeholders = countPlaceholders(termSql);
  return {
    sql: terms.map(() => `(${termSql})`).join(" AND "),
    args: terms.flatMap((term) =>
      Array.from({ length: placeholders }, () => containsPattern(term)),
    ),
  };
}

/**
 * 数出片段里的绑定占位符；单引号字面量内部的 `?` 不算。
 *
 * 数错就等于整条语句的绑定表错位，而不是一眼能看出的语法错误，所以遇到这个
 * 扫描器读不准的语法（注释、双引号标识符）宁可直接抛错。片段都由常量拼成，
 * 任何一次测试或本地请求都会立刻暴露。
 */
function countPlaceholders(sql: string): number {
  const unparsable = /--|\/\*|"/.exec(sql);
  if (unparsable)
    throw new Error(
      `搜索片段含无法可靠计数占位符的语法：${unparsable[0]}`,
    );
  let count = 0;
  let inLiteral = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "'") {
      // 字面量内部的 '' 是转义单引号，不切换状态。
      if (inLiteral && sql[index + 1] === "'") {
        index += 1;
        continue;
      }
      inLiteral = !inLiteral;
      continue;
    }
    if (!inLiteral && char === "?") count += 1;
  }
  return count;
}
