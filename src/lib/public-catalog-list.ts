import { isAsciiLetterTerm } from "./catalog-pinyin";
import {
  extraMergedIndexes,
  mergedNameRealWindow,
} from "./catalog-merge-page";
import {
  andSearchTermsWithPinyin,
  andSearchTermsWithTrigram,
  likeSql,
  type SearchFilter,
} from "./catalog-search";
import type { SearchRankingFields } from "./catalog-search-ranking";
import {
  publicBrowseFamilySql,
  publicCategoryFilterSql,
  VIRTUAL_PE_SPORTS,
  virtualPeSportDisplayName,
  virtualPeSportMatchesQuery,
} from "./public-course-presentation";
import {
  filterPublicPeCourseItems,
  loadPublicPeCourseProjection,
  publicPeCourseIdentity,
  publicPeRelationIdentity,
  type PublicPeCourseListRow,
} from "./public-pe-course-projection";
import {
  filterPublicPeRelationItems,
  loadPublicPeRelationProjection,
  type PublicPeRelationListRow,
} from "./public-pe-relation-projection";

export type PublicCatalogScopeQuery = {
  category: string;
  department: string;
  teacherId: number | null;
};

type VirtualPeTeacher = { id: number; name: string };

type VirtualPeMatch = {
  sport: (typeof VIRTUAL_PE_SPORTS)[number];
  teachers: VirtualPeTeacher[];
};

export type VirtualPeRelationListRow = {
  course_id: number;
  public_id: string;
  code: string;
  name: string;
  category: "sports";
  department: string;
  teacher_id: number;
  teacher_name: string;
  rating: null;
  review_count: number;
};

export function publicCatalogListScope(query: PublicCatalogScopeQuery): {
  sql: string;
  args: unknown[];
} {
  const categoryFilter = publicCategoryFilterSql(query.category, "c", "pcc");
  const teacherFilter =
    query.teacherId === null ? "" : " AND ct.teacher_id=?";
  return {
    sql: `${categoryFilter.sql} AND (?='' OR trim(c.department)=trim(?))${teacherFilter}`,
    args: [
      ...categoryFilter.args,
      query.department,
      query.department,
      ...(query.teacherId === null ? [] : [query.teacherId]),
    ],
  };
}

export function publicCatalogIndexedCourseSearch(terms: string[]): SearchFilter {
  return andSearchTermsWithTrigram(
    terms,
    (term) =>
      andSearchTermsWithPinyin(
        [term],
        likeSql("pcc.match_text"),
        likeSql("pcc.pinyin_text"),
        isAsciiLetterTerm,
      ),
    "pcc.course_id IN (SELECT rowid FROM course_search_fts WHERE course_search_fts MATCH ?)",
  );
}

export function publicCatalogCourseRankingFields(
  displayNameSql: string,
): SearchRankingFields {
  return {
    exact: [
      "c.name",
      "c.code",
      `(${publicBrowseFamilySql("c")})`,
      `(${displayNameSql})`,
    ],
    exactPredicates: [
      "EXISTS (SELECT 1 FROM course_name_variants cnv WHERE cnv.course_id=c.id AND lower(cnv.name)=$TERM)",
    ],
    prefix: ["c.name", "c.code", `(${displayNameSql})`],
    prefixPredicates: [
      "EXISTS (SELECT 1 FROM course_name_variants cnv WHERE cnv.course_id=c.id AND lower(cnv.name) LIKE $LITERAL || '%' ESCAPE '\\')",
    ],
    substring: ["c.name", "c.code", `(${displayNameSql})`],
    substringPredicates: [
      "EXISTS (SELECT 1 FROM course_name_variants cnv WHERE cnv.course_id=c.id AND lower(cnv.name) LIKE '%' || $LITERAL || '%' ESCAPE '\\')",
    ],
    pinyin: "pcc.pinyin_text",
  };
}

function includeUnmappedVirtualPe(category: string): boolean {
  return !category || category === "sports";
}

export function publicCatalogPageMeta(
  page: number,
  pageSize: number,
  total: number,
) {
  return {
    page,
    pageSize,
    total,
    pages: Math.ceil(total / pageSize),
  };
}

async function loadVirtualPeTeachersByName(
  db: D1Database,
  sports: readonly (typeof VIRTUAL_PE_SPORTS)[number][],
) {
  const names = [...new Set(sports.flatMap((sport) => sport.teacherNames))];
  if (!names.length) {
    return new Map<string, VirtualPeTeacher[]>();
  }
  const placeholders = names.map(() => "?").join(",");
  const rows = (
    await db
      .prepare(
        `SELECT id,name FROM teachers WHERE name IN (${placeholders}) ORDER BY name,id`,
      )
      .bind(...names)
      .all<VirtualPeTeacher>()
  ).results;
  const byName = new Map<string, VirtualPeTeacher[]>();
  for (const row of rows) {
    byName.set(row.name, [...(byName.get(row.name) || []), row]);
  }
  return byName;
}

async function loadVirtualPeMatches(
  db: D1Database,
  query: {
    searchTerms: string[];
    teacherId: number | null;
    department: string;
    excludeLabels?: ReadonlySet<string>;
  },
): Promise<VirtualPeMatch[]> {
  if (query.department) return [];
  const matchingSports = VIRTUAL_PE_SPORTS.filter(
    (sport) =>
      !query.excludeLabels?.has(sport.label) &&
      virtualPeSportMatchesQuery(sport, query.searchTerms),
  );
  if (!matchingSports.length) return [];
  const teachersByName = await loadVirtualPeTeachersByName(db, matchingSports);
  const items: VirtualPeMatch[] = [];
  for (const sport of matchingSports) {
    const teachers = sport.teacherNames.flatMap(
      (name) => teachersByName.get(name) || [],
    );
    const filtered = query.teacherId
      ? teachers.filter((teacher) => teacher.id === query.teacherId)
      : teachers;
    if (!filtered.length) continue;
    items.push({ sport, teachers: filtered });
  }
  return items;
}

type VirtualPeCourseListRow = Omit<PublicPeCourseListRow, "id"> & { id: number };

function virtualPeCourseListRow(
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
  teachers: readonly VirtualPeTeacher[],
): VirtualPeCourseListRow {
  return {
    id: sport.id,
    public_id: publicPeCourseIdentity(sport.label),
    code: "",
    name: virtualPeSportDisplayName(sport),
    category: "sports",
    department: "",
    teachers: teachers.map((teacher) => teacher.name).join(","),
    teacher_refs: teachers
      .map((teacher) => `${teacher.id}:${teacher.name}`)
      .join(","),
    review_count: 0,
  };
}

function virtualPeRelationListRow(
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
  teacher: VirtualPeTeacher,
): VirtualPeRelationListRow {
  return {
    course_id: sport.id,
    public_id: publicPeRelationIdentity(sport.label, teacher.id),
    code: "",
    name: virtualPeSportDisplayName(sport),
    category: "sports",
    department: "",
    teacher_id: teacher.id,
    teacher_name: teacher.name,
    rating: null,
    review_count: 0,
  };
}

function virtualRelationTeachers(
  match: VirtualPeMatch,
  query: {
    teacherId: number | null;
    exactTeacherIds: number[] | null;
    courseSearchTerms: string[];
  },
): VirtualPeTeacher[] {
  if (query.teacherId) return match.teachers;
  if (query.exactTeacherIds) {
    return match.teachers.filter((teacher) =>
      query.exactTeacherIds?.includes(teacher.id),
    );
  }
  if (!query.courseSearchTerms.length) return match.teachers;
  const displayName = virtualPeSportDisplayName(match.sport);
  return match.teachers.filter((teacher) =>
    query.courseSearchTerms.every(
      (term) =>
        match.sport.label.includes(term) ||
        displayName.includes(term) ||
        teacher.name.includes(term),
    ),
  );
}

export async function loadPublicCourseListExtras(
  db: D1Database,
  query: PublicCatalogScopeQuery & { searchTerms: string[] },
): Promise<Array<PublicPeCourseListRow | VirtualPeCourseListRow>> {
  const peProjection = await loadPublicPeCourseProjection(db);
  const peItems = filterPublicPeCourseItems(peProjection.items, {
    searchTerms: query.searchTerms,
    category: query.category,
    department: query.department,
    teacherId: query.teacherId,
  });
  if (!includeUnmappedVirtualPe(query.category)) return peItems;
  const virtualItems = (
    await loadVirtualPeMatches(db, {
      searchTerms: query.searchTerms,
      teacherId: query.teacherId,
      department: query.department,
      excludeLabels: peProjection.specializations,
    })
  ).map((match) => virtualPeCourseListRow(match.sport, match.teachers));
  return [...peItems, ...virtualItems];
}

export async function loadPublicRelationListExtras(
  db: D1Database,
  query: PublicCatalogScopeQuery & {
    searchTerms: string[];
    exactTeacherIds: number[] | null;
    courseSearchTerms: string[];
  },
): Promise<Array<PublicPeRelationListRow | VirtualPeRelationListRow>> {
  const peProjection = await loadPublicPeRelationProjection(db);
  const peItems = filterPublicPeRelationItems(peProjection.items, {
    category: query.category,
    department: query.department,
    teacherId: query.teacherId,
    exactTeacherIds: query.exactTeacherIds,
    courseSearchTerms: query.courseSearchTerms,
  });
  if (!includeUnmappedVirtualPe(query.category)) return peItems;
  const virtualItems = (
    await loadVirtualPeMatches(db, {
      searchTerms: query.searchTerms,
      teacherId: query.teacherId,
      department: query.department,
      excludeLabels: peProjection.specializations,
    })
  )
    .flatMap((match) =>
      virtualRelationTeachers(match, query).map((teacher) =>
        virtualPeRelationListRow(match.sport, teacher),
      ),
    )
    .filter((item) => !peProjection.identities.has(item.public_id));
  return [...peItems, ...virtualItems];
}

/** D1 rejects a statement with more than 100 bound parameters. */
export const D1_MAX_BOUND_PARAMETERS = 100;

export function extraMergeChunkSize(
  extraCount: number,
  extraBindCount: number,
  argCount: number,
): number {
  if (extraCount <= 0) return 0;
  const bindsPerExtra = extraBindCount / extraCount;
  if (!Number.isInteger(bindsPerExtra) || bindsPerExtra <= 0) {
    throw new Error("PE extras bind 长度必须能被 extras 条数整除");
  }
  const budget = D1_MAX_BOUND_PARAMETERS - argCount;
  return Math.max(1, Math.floor(budget / bindsPerExtra));
}

async function countRealsBeforeExtras(input: {
  db: D1Database;
  extraColumnSql: string;
  extraRowSql: string;
  extraBinds: unknown[];
  extraCount: number;
  selectCountSql: string;
  fromSql: string;
  extraJoins?: string;
  where: string;
  beforePredicate: string;
  args: unknown[];
}): Promise<Map<string, number>> {
  if (input.extraCount === 0) return new Map();
  const bindsPerExtra = input.extraBinds.length / input.extraCount;
  const chunkSize = extraMergeChunkSize(
    input.extraCount,
    input.extraBinds.length,
    input.args.length,
  );
  const merged = new Map<string, number>();
  for (let start = 0; start < input.extraCount; start += chunkSize) {
    const count = Math.min(chunkSize, input.extraCount - start);
    const values = Array.from({ length: count }, () => input.extraRowSql).join(
      ",",
    );
    const extraBinds = input.extraBinds.slice(
      start * bindsPerExtra,
      (start + count) * bindsPerExtra,
    );
    const { results } = await input.db
      .prepare(
        `WITH extras(${input.extraColumnSql}) AS (VALUES ${values})
       SELECT extras.extra_key,${input.selectCountSql} n
       ${input.fromSql}
       ${input.extraJoins ?? ""}
       JOIN extras ON 1=1
       WHERE ${input.where}
         AND ${input.beforePredicate}
       GROUP BY extras.extra_key`,
      )
      .bind(...extraBinds, ...input.args)
      .all<{ extra_key: string; n: number }>();
    for (const row of results || []) {
      merged.set(String(row.extra_key), Number(row.n) || 0);
    }
  }
  return merged;
}

function placeMergedExtras<T>(
  extrasSorted: T[],
  realBeforeByKey: Map<string, number>,
  start: number,
  size: number,
  extraKey: (item: T) => string,
): { pageExtras: T[]; realOffset: number; realLimit: number } {
  const realBefore = extrasSorted.map(
    (item) => Number(realBeforeByKey.get(extraKey(item))) || 0,
  );
  const extraIndexes = extraMergedIndexes(realBefore);
  const window = mergedNameRealWindow(start, size, extraIndexes);
  return {
    pageExtras: extrasSorted.filter((_, index) =>
      window.extraIndexesOnPage.includes(extraIndexes[index]),
    ),
    realOffset: window.offset,
    realLimit: window.limit,
  };
}

export async function planMergedCatalogWindow<T>(input: {
  db: D1Database;
  extras: T[];
  compare: (a: T, b: T) => number;
  extraKey: (item: T) => string;
  extraColumnSql: string;
  extraRowSql: string;
  extraBindsFor: (item: T) => unknown[];
  selectCountSql: string;
  fromSql: string;
  extraJoins?: string;
  where: string;
  beforePredicate: string;
  args: unknown[];
  start: number;
  size: number;
}): Promise<{
  extrasAll: T[];
  pageExtras: T[];
  realOffset: number;
  realLimit: number;
}> {
  const extrasAll = [...input.extras].sort(input.compare);
  if (!extrasAll.length) {
    return {
      extrasAll,
      pageExtras: [],
      realOffset: input.start,
      realLimit: input.size,
    };
  }
  const counts = await countRealsBeforeExtras({
    db: input.db,
    extraColumnSql: input.extraColumnSql,
    extraRowSql: input.extraRowSql,
    extraBinds: extrasAll.flatMap(input.extraBindsFor),
    extraCount: extrasAll.length,
    selectCountSql: input.selectCountSql,
    fromSql: input.fromSql,
    extraJoins: input.extraJoins,
    where: input.where,
    beforePredicate: input.beforePredicate,
    args: input.args,
  });
  return {
    extrasAll,
    ...placeMergedExtras(
      extrasAll,
      counts,
      input.start,
      input.size,
      input.extraKey,
    ),
  };
}
