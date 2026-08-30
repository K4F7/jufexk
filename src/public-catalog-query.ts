import { isAsciiLetterTerm } from "./lib/catalog-pinyin";
import {
  extraMergedIndexes,
  mergedNameRealWindow,
} from "./lib/catalog-merge-page";
import {
  andSearchTerms,
  andSearchTermsWithPinyin,
  andSearchTermsWithTrigram,
  containsPattern,
  likeSql,
  parseSearchTerms,
  type SearchFilter,
} from "./lib/catalog-search";
import { buildCatalogSearchRanking } from "./lib/catalog-search-ranking";
import {
  publicBrowseFamilySql,
  publicCategoryFilterSql,
  publicCourseCategory,
  publicCourseDisplayName,
  publicCourseDisplayNameSql,
  publicCourseVisibleSql,
  publicRelationNameSortKey,
  publicRelationNameSortKeySql,
  publicRelationNameSortSql,
  VIRTUAL_PE_SPORTS,
  virtualPeSportDisplayName,
  virtualPeSportMatchesQuery,
} from "./lib/public-course-presentation";
import { relationDimensionKey } from "./lib/relation-four-dims";
import { loadRelationDimensionLabels } from "./lib/relation-projections";
import type { PublicDimensionLabel } from "./lib/review-schemes";
import {
  ensurePublicListPrecomputes,
  type PublicPrecomputeReadOptions,
} from "./public-list-precompute";
import { publicCourseCanonicalJoin } from "./public-list-projection-plan";
import { publicReviewBindingSql } from "./public-review-visibility";
import {
  loadRelationSignalPayloads,
  type RelationSignalCounts,
  type RelationSignalViewer,
} from "./relation-signals";

export type PublicCourseListSort = "name" | "reviews";
export type PublicRelationListSort = "name" | "rating" | "reviews";

export type PublicCatalogListQuery<Sort extends string> = {
  page: number;
  pageSize: number;
  q: string;
  category: string;
  department: string;
  teacherId: number | null;
  sort: Sort;
};

export type PublicCourseListQuery = PublicCatalogListQuery<PublicCourseListSort>;
export type PublicRelationListQuery =
  PublicCatalogListQuery<PublicRelationListSort>;

export type PublicCatalogPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

export type PublicCourseListItem = {
  id: number;
  code: string;
  name: string;
  category: string;
  department: string;
  teachers: string | null;
  teacher_refs: string | null;
  review_count: number;
};

export type PublicRelationListItem = {
  course_id: number;
  code: string;
  name: string;
  category: string;
  department: string;
  teacher_id: number | null;
  teacher_name: string | null;
  rating: number | null;
  review_count: number;
  dimensionLabels: PublicDimensionLabel[] | null;
} & RelationSignalCounts &
  Partial<RelationSignalViewer>;

type RelationRow = {
  course_id: number;
  code: string;
  name: string;
  category: string;
  department: string;
  teacher_id: number | null;
  teacher_name: string | null;
  rating: number | null;
  review_count: number;
};
type ExactTeacherHits = {
  ids: number[];
  matchedTerms: Set<string>;
  active: boolean;
};

const withPublicCourseItem = <
  T extends { name?: unknown; category?: unknown },
>(
  row: T,
) => {
  const rawName = typeof row.name === "string" ? row.name : "";
  return {
    ...row,
    name: publicCourseDisplayName(rawName),
    category: publicCourseCategory(
      rawName,
      typeof row.category === "string" ? row.category : "",
    ),
  };
};

const withPublicRelationNames = (row: RelationRow): RelationRow => {
  const rawName = row.name || "";
  return {
    ...row,
    name: publicCourseDisplayName(rawName),
    category: publicCourseCategory(rawName, row.category),
    rating: row.rating == null ? null : Number(row.rating),
    review_count: Number(row.review_count) || 0,
    teacher_id: row.teacher_id == null ? null : Number(row.teacher_id),
  };
};

const virtualPeSportItem = (
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
  teachers: Array<{ id: number; name: string }>,
) => ({
  id: sport.id,
  code: "",
  name: virtualPeSportDisplayName(sport),
  category: "sports" as const,
  department: "",
  teachers: teachers.map((teacher) => teacher.name).join(","),
  teacher_refs: teachers
    .map((teacher) => `${teacher.id}:${teacher.name}`)
    .join(","),
  review_count: 0,
});

const loadVirtualPeTeachersByName = async (
  db: D1Database,
  sports: readonly (typeof VIRTUAL_PE_SPORTS)[number][],
) => {
  const names = [...new Set(sports.flatMap((sport) => sport.teacherNames))];
  if (!names.length) return new Map<string, Array<{ id: number; name: string }>>();
  const placeholders = names.map(() => "?").join(",");
  const rows = (
    await db
      .prepare(`SELECT id,name FROM teachers WHERE name IN (${placeholders}) ORDER BY name,id`)
      .bind(...names)
      .all<{ id: number; name: string }>()
  ).results;
  const byName = new Map<string, Array<{ id: number; name: string }>>();
  for (const row of rows) byName.set(row.name, [...(byName.get(row.name) || []), row]);
  return byName;
};

const loadVirtualPeSportItems = async (
  db: D1Database,
  searchTerms: string[],
  teacherId: number | null,
  department: string,
) => {
  if (department) return [];
  const matchingSports = VIRTUAL_PE_SPORTS.filter((sport) =>
    virtualPeSportMatchesQuery(sport, searchTerms),
  );
  const teachersByName = await loadVirtualPeTeachersByName(db, matchingSports);
  const items: Array<ReturnType<typeof virtualPeSportItem>> = [];
  for (const sport of matchingSports) {
    const teachers = sport.teacherNames.flatMap(
      (name) => teachersByName.get(name) || [],
    );
    if (!teachers.length) continue;
    if (teacherId && !teachers.some((teacher) => teacher.id === teacherId))
      continue;
    items.push(virtualPeSportItem(sport, teachers));
  }
  return items;
};

async function loadExactTeacherHits(
  db: D1Database,
  terms: string[],
): Promise<ExactTeacherHits> {
  if (!terms.length) return { ids: [], matchedTerms: new Set(), active: false };
  const placeholders = terms.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT id,name,source_teacher_label FROM teachers WHERE name IN (${placeholders}) OR source_teacher_label IN (${placeholders})`,
    )
    .bind(...terms, ...terms)
    .all<{ id: number; name: string; source_teacher_label: string }>();
  const matchedTerms = new Set<string>();
  const idsByTerm = new Map<string, Set<number>>();
  const termSet = new Set(terms);
  const addHit = (term: string, id: number) => {
    matchedTerms.add(term);
    const ids = idsByTerm.get(term) ?? new Set<number>();
    ids.add(id);
    idsByTerm.set(term, ids);
  };
  for (const row of results ?? []) {
    const id = Number(row.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (termSet.has(row.name)) addHit(row.name, id);
    if (termSet.has(row.source_teacher_label)) {
      addHit(row.source_teacher_label, id);
    }
  }
  if (!idsByTerm.size) return { ids: [], matchedTerms, active: false };
  let intersection: Set<number> | undefined;
  for (const ids of idsByTerm.values()) {
    if (!intersection) {
      intersection = new Set(ids);
      continue;
    }
    for (const id of [...intersection]) {
      if (!ids.has(id)) intersection.delete(id);
    }
  }
  return { ids: [...(intersection ?? [])], matchedTerms, active: true };
}

function relationRowHit(terms: string[]): SearchFilter {
  if (!terms.length) return { sql: "", args: [] };
  const textSql = [
    likeSql("c.name"),
    likeSql("c.code"),
    likeSql("c.department"),
    likeSql("pcc.family_label"),
    likeSql("pcc.teacher_variant_text"),
    likeSql("t.name"),
    likeSql("t.source_teacher_label"),
  ].join(" OR ");
  return {
    sql: terms
      .map((term) =>
        isAsciiLetterTerm(term)
          ? `(${textSql} OR ${likeSql("pcc.pinyin_text")})`
          : `(${textSql})`,
      )
      .join(" AND "),
    args: terms.flatMap((term) => {
      const textArgs = andSearchTerms([term], textSql).args;
      return isAsciiLetterTerm(term)
        ? [...textArgs, containsPattern(term)]
        : textArgs;
    }),
  };
}

async function loadVirtualPeRelations(
  db: D1Database,
  searchTerms: string[],
  teacherId: number | null,
  department: string,
  exactTeachers: ExactTeacherHits,
  courseSearchTerms: string[],
): Promise<RelationRow[]> {
  if (department) return [];
  const matchingSports = VIRTUAL_PE_SPORTS.filter((sport) =>
    virtualPeSportMatchesQuery(sport, searchTerms),
  );
  const teachersByName = await loadVirtualPeTeachersByName(db, matchingSports);
  const items: RelationRow[] = [];
  for (const sport of matchingSports) {
    const teachers = sport.teacherNames.flatMap(
      (name) => teachersByName.get(name) || [],
    );
    if (!teachers.length) continue;
    const filtered = teacherId
      ? teachers.filter((teacher) => teacher.id === teacherId)
      : exactTeachers.active
        ? teachers.filter((teacher) => exactTeachers.ids.includes(teacher.id))
        : courseSearchTerms.length
          ? teachers.filter((teacher) =>
              courseSearchTerms.every(
                (term) =>
                  sport.label.includes(term) ||
                  virtualPeSportDisplayName(sport).includes(term) ||
                  teacher.name.includes(term),
              ),
            )
          : teachers;
    for (const teacher of filtered) {
      items.push({
        course_id: sport.id,
        code: "",
        name: virtualPeSportDisplayName(sport),
        category: "sports",
        department: "",
        teacher_id: teacher.id,
        teacher_name: teacher.name,
        rating: null,
        review_count: 0,
      });
    }
  }
  return items;
}

function byNameCodeId(
  a: { id?: unknown; code?: unknown; name?: unknown },
  b: { id?: unknown; code?: unknown; name?: unknown },
) {
  const nameA = String(a.name ?? "");
  const nameB = String(b.name ?? "");
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  const codeA = String(a.code ?? "");
  const codeB = String(b.code ?? "");
  if (codeA !== codeB) return codeA < codeB ? -1 : 1;
  return Number(a.id ?? 0) - Number(b.id ?? 0);
}

function byNameCodeTeacher(a: RelationRow, b: RelationRow) {
  const keyA = publicRelationNameSortKey({
    name: String(a.name ?? ""),
    code: String(a.code ?? ""),
    course_id: Number(a.course_id ?? 0),
    teacher_name: a.teacher_name,
    teacher_id: a.teacher_id,
  });
  const keyB = publicRelationNameSortKey({
    name: String(b.name ?? ""),
    code: String(b.code ?? ""),
    course_id: Number(b.course_id ?? 0),
    teacher_name: b.teacher_name,
    teacher_id: b.teacher_id,
  });
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

function emptyRelationSignals(
  viewerUserId: string | null,
): RelationSignalCounts & Partial<RelationSignalViewer> {
  return {
    follow_count: 0,
    recommend_count: 0,
    not_recommend_count: 0,
    ...(viewerUserId
      ? {
          viewer_followed: false,
          viewer_recommended: false,
          viewer_not_recommended: false,
        }
      : {}),
  };
}

async function attachRelationProjection(
  db: D1Database,
  items: RelationRow[],
  viewerUserId: string | null,
): Promise<PublicRelationListItem[]> {
  const dimMap = await loadRelationDimensionLabels(
    db,
    items.map((item) => ({
      courseId: item.course_id,
      teacherId: item.teacher_id,
    })),
  );
  const signalMap = await loadRelationSignalPayloads(
    db,
    items
      .filter(
        (item): item is RelationRow & { teacher_id: number } =>
          item.teacher_id != null,
      )
      .map((item) => ({ courseId: item.course_id, teacherId: item.teacher_id })),
    viewerUserId,
  );
  return items.map((item) => {
    const signals =
      item.teacher_id != null
        ? signalMap.get(`${item.course_id}:${item.teacher_id}`)
        : undefined;
    return {
      ...item,
      dimensionLabels:
        dimMap.get(relationDimensionKey(item.course_id, item.teacher_id)) ??
        null,
      ...(signals ?? emptyRelationSignals(viewerUserId)),
    };
  });
}

export async function queryPublicCourses(
  db: D1Database,
  query: PublicCourseListQuery,
  precompute: PublicPrecomputeReadOptions = {},
): Promise<PublicCatalogPage<PublicCourseListItem>> {
  await ensurePublicListPrecomputes(db, precompute);
  const { page, pageSize: size, department, teacherId, sort } = query;
  const search = query.q;
  const searchTerms = parseSearchTerms(search);
  const categoryFilter = publicCategoryFilterSql(query.category, "c", "pcc");
  const teacherFilter = teacherId === null ? "" : " AND ct.teacher_id=?";
  const indexedSearchGroup = andSearchTermsWithTrigram(
    searchTerms,
    (term) =>
      andSearchTermsWithPinyin(
        [term],
        likeSql("pcc.match_text"),
        likeSql("pcc.pinyin_text"),
        isAsciiLetterTerm,
      ),
    "pcc.course_id IN (SELECT rowid FROM course_search_fts WHERE course_search_fts MATCH ?)",
  );
  const baseWhere = `${publicCourseVisibleSql("c")} AND ${categoryFilter.sql} AND (?='' OR trim(c.department)=trim(?))${teacherFilter}`;
  const baseArgs = [
    ...categoryFilter.args,
    department,
    department,
    ...(teacherId === null ? [] : [teacherId]),
  ];
  let where = `${baseWhere}${indexedSearchGroup.sql ? ` AND ${indexedSearchGroup.sql}` : ""}`;
  let args = [...baseArgs, ...indexedSearchGroup.args];

  // Exact course-code queries are common and do not need FTS/ranking work, but
  // only take the fast path after confirming the code exists and matches all
  // visibility/category/department/teacher filters.
  const exactCodeTerm =
    searchTerms.length === 1 && /^[A-Za-z0-9_-]+$/.test(searchTerms[0])
      ? searchTerms[0]
      : null;
  let exactCodeMatched = false;
  if (exactCodeTerm) {
    const exact = await db
      .prepare(
        `SELECT c.id FROM courses c ${publicCourseCanonicalJoin}
         LEFT JOIN course_teachers ct ON ct.course_id=c.id
         WHERE ${baseWhere} AND c.code=? LIMIT 1`,
      )
      .bind(...baseArgs, exactCodeTerm)
      .first();
    if (exact) {
      exactCodeMatched = true;
      where = `${baseWhere} AND c.code=?`;
      args = [...baseArgs, exactCodeTerm];
    }
  }
  const countJoins =
    teacherId === null
      ? publicCourseCanonicalJoin
      : `${publicCourseCanonicalJoin} LEFT JOIN course_teachers ct ON ct.course_id=c.id`;
  const courseCount = () =>
    db
      .prepare(
        `SELECT COUNT(DISTINCT c.id) n FROM courses c ${countJoins} WHERE ${where}`,
      )
      .bind(...args)
      .first<{ n: number }>()
      .then((row) => row?.n || 0);
  const displayNameSql = publicCourseDisplayNameSql("c");
  const sharedRanking = buildCatalogSearchRanking(searchTerms, {
    exact: ["c.name", "c.code", `(${publicBrowseFamilySql("c")})`, `(${displayNameSql})`],
    exactPredicates: ["EXISTS (SELECT 1 FROM course_name_variants cnv WHERE cnv.course_id=c.id AND lower(cnv.name)=$TERM)"],
    prefix: ["c.name", "c.code", `(${displayNameSql})`],
    prefixPredicates: ["EXISTS (SELECT 1 FROM course_name_variants cnv WHERE cnv.course_id=c.id AND lower(cnv.name) LIKE $LITERAL || '%' ESCAPE '\\')"],
    substring: ["c.name", "c.code", `(${displayNameSql})`],
    substringPredicates: ["EXISTS (SELECT 1 FROM course_name_variants cnv WHERE cnv.course_id=c.id AND lower(cnv.name) LIKE '%' || $LITERAL || '%' ESCAPE '\\')"],
    pinyin: "pcc.pinyin_text",
    teacher: ["c.department", "pcc.teacher_variant_text"],
    teacherExactPredicates: ["instr(pcc.teacher_variant_text, char(31) || $TERM || char(31)) > 0"],
  }, "course", args.length);
  const relevanceOrder = exactCodeMatched
    ? "review_count DESC,c.name,c.code,c.id"
    : `${sharedRanking.sql},review_count DESC,c.name,c.code,c.id`;
  const searchRankArgs = exactCodeMatched ? [] : sharedRanking.args;
  const virtualItems =
    !query.category || query.category === "sports"
      ? await loadVirtualPeSportItems(db, searchTerms, teacherId, department)
      : [];
  const mergeName = virtualItems.length > 0 && sort === "name";
  let extrasAll = virtualItems;
  let pageExtras: PublicCourseListItem[] = [];
  let realOffset = (page - 1) * size;
  let realLimit = size;
  if (mergeName) {
    extrasAll = [...virtualItems].sort(byNameCodeId);
    const values = extrasAll.map(() => "(?,?,?)").join(",");
    const { results } = await db
      .prepare(
        `WITH extras(id,sort_name,sort_code) AS (VALUES ${values})
         SELECT extras.id,COUNT(*) n
         FROM courses c
         ${countJoins}
         JOIN extras ON 1=1
         WHERE ${where}
           AND (c.name < extras.sort_name
             OR (c.name = extras.sort_name AND c.code < extras.sort_code)
             OR (c.name = extras.sort_name AND c.code = extras.sort_code AND c.id < extras.id))
         GROUP BY extras.id`,
      )
      .bind(
        ...extrasAll.flatMap((item) => [item.id, item.name, item.code]),
        ...args,
      )
      .all<{ id: number; n: number }>();
    const realBeforeById = new Map(
      (results || []).map((row) => [Number(row.id), Number(row.n) || 0]),
    );
    const realBefore = extrasAll.map(
      (item) => realBeforeById.get(item.id) || 0,
    );
    const extraIndexes = extraMergedIndexes(realBefore);
    const window = mergedNameRealWindow(realOffset, size, extraIndexes);
    realOffset = window.offset;
    realLimit = window.limit;
    pageExtras = extrasAll.filter((_, index) =>
      window.extraIndexesOnPage.includes(extraIndexes[index]),
    );
  }
  const [pageResult, countResult] = await Promise.all([
    realLimit === 0
      ? Promise.resolve({ results: [] as unknown[] })
      : db
          .prepare(
            `SELECT c.id,c.code,c.name,c.category,c.department,c.credits,c.description,
       c.created_at,c.scheme_key,c.enrollment_category,c.teaching_type,c.course_level,
       GROUP_CONCAT(DISTINCT t.id || ':' || t.name) teacher_refs,
       GROUP_CONCAT(DISTINCT t.name) teachers,
       COALESCE(course_review_counts.review_count,0) review_count
      FROM courses c
      ${publicCourseCanonicalJoin}
      LEFT JOIN course_teachers ct ON ct.course_id=c.id
      LEFT JOIN teachers t ON t.id=ct.teacher_id
      LEFT JOIN (SELECT course_id,SUM(review_count) review_count FROM public_review_counts GROUP BY course_id) course_review_counts ON course_review_counts.course_id=c.id
     WHERE ${where}
     GROUP BY c.id
     ORDER BY ${sort === "name" ? "c.name,c.code,c.id" : relevanceOrder}
     LIMIT ? OFFSET ?`,
            )
            .bind(
              ...args,
              ...(sort === "name" || exactCodeMatched ? [] : searchRankArgs),
              realLimit + 1,
              realOffset,
            )
            .all(),
    courseCount(),
  ]);
  const pageRows = {
    items: (pageResult.results || []) as Array<Record<string, unknown>>,
    total: Number(countResult) || 0,
  };
  const listed = pageRows.items.slice(0, realLimit).map((row) =>
    withPublicCourseItem(row as PublicCourseListItem),
  );
  const realTotal = pageRows.total;
  const extras = mergeName
    ? pageExtras
    : extrasAll.slice(
        Math.max(0, realOffset - realTotal),
        Math.max(0, realOffset - realTotal) + Math.max(0, size - listed.length),
      );
  const totalCount = realTotal + extrasAll.length;
  const items = mergeName
    ? [...listed, ...pageExtras].sort(byNameCodeId).slice(0, size)
    : [...listed, ...extras].slice(0, size);
  return {
    items,
    page,
    pageSize: size,
    total: totalCount,
    pages: Math.ceil(totalCount / size),
  };
}

export async function queryPublicCourseRelations(
  db: D1Database,
  query: PublicRelationListQuery,
  viewerUserId: string | null,
  precompute: PublicPrecomputeReadOptions = {},
): Promise<PublicCatalogPage<PublicRelationListItem>> {
  await ensurePublicListPrecomputes(db, precompute);
  const { page, pageSize: size, department, teacherId, sort } = query;
  const search = query.q;
  const searchTerms = parseSearchTerms(search);
  const categoryFilter = publicCategoryFilterSql(query.category, "c", "pcc");
  const teacherFilter = teacherId === null ? "" : " AND ct.teacher_id=?";
  const exactTeachers = await loadExactTeacherHits(db, searchTerms);
  const exactTeacherFilter = !exactTeachers.active
    ? ""
    : exactTeachers.ids.length === 0
      ? " AND 0"
      : ` AND ct.teacher_id IN (${exactTeachers.ids.map(() => "?").join(",")})`;
  const courseSearchTerms = searchTerms.filter(
    (term) => !exactTeachers.matchedTerms.has(term),
  );
  const searchGroup = andSearchTermsWithTrigram(
    courseSearchTerms,
    (term) =>
      andSearchTermsWithPinyin(
        [term],
        likeSql("pcc.match_text"),
        likeSql("pcc.pinyin_text"),
        isAsciiLetterTerm,
      ),
    "pcc.course_id IN (SELECT rowid FROM course_search_fts WHERE course_search_fts MATCH ?)",
  );
  const rowHit = relationRowHit(courseSearchTerms);
  const where = `${publicCourseVisibleSql("c")} AND ${categoryFilter.sql} AND (?='' OR trim(c.department)=trim(?))${teacherFilter}${searchGroup.sql ? ` AND ${searchGroup.sql}` : ""}${rowHit.sql ? ` AND ${rowHit.sql}` : ""}${exactTeacherFilter}`;
  const args = [
    ...categoryFilter.args,
    department,
    department,
    ...(teacherId === null ? [] : [teacherId]),
    ...searchGroup.args,
    ...rowHit.args,
    ...exactTeachers.ids,
  ];
  const relationCount = () =>
    db
      .prepare(
        `SELECT COUNT(*) n
       FROM courses c
       ${publicCourseCanonicalJoin}
       LEFT JOIN course_teachers ct ON ct.course_id=c.id
       LEFT JOIN teachers t ON t.id=ct.teacher_id
       WHERE ${where}`,
      )
      .bind(...args)
      .first()
      .then((row) => Number((row as { n?: number } | null)?.n) || 0);

  const displayNameSql = publicCourseDisplayNameSql("c");
  const nameSortSql = publicRelationNameSortSql("c", "t");
  const sharedRanking = buildCatalogSearchRanking(searchTerms, {
    exact: ["c.name", "c.code", `(${publicBrowseFamilySql("c")})`, `(${displayNameSql})`],
    exactPredicates: ["EXISTS (SELECT 1 FROM course_name_variants cnv WHERE cnv.course_id=c.id AND lower(cnv.name)=$TERM)"],
    prefix: ["c.name", "c.code", `(${displayNameSql})`],
    prefixPredicates: ["EXISTS (SELECT 1 FROM course_name_variants cnv WHERE cnv.course_id=c.id AND lower(cnv.name) LIKE $LITERAL || '%' ESCAPE '\\')"],
    substring: ["c.name", "c.code", `(${displayNameSql})`],
    substringPredicates: ["EXISTS (SELECT 1 FROM course_name_variants cnv WHERE cnv.course_id=c.id AND lower(cnv.name) LIKE '%' || $LITERAL || '%' ESCAPE '\\')"],
    pinyin: "pcc.pinyin_text",
    teacher: ["t.name", "t.source_teacher_label", "c.department"],
  }, "relation", args.length);
  const relevanceOrder = `${sharedRanking.sql},review_count DESC,${nameSortSql}`;
  const searchRankArgs = sharedRanking.args;
  const orderBy =
    sort === "name"
      ? nameSortSql
      : sort === "rating"
        ? `(rel_rating.rating IS NULL),rel_rating.rating DESC,review_count DESC,${nameSortSql}`
        : relevanceOrder;
  const virtualItems =
    !query.category || query.category === "sports"
      ? await loadVirtualPeRelations(
          db,
          searchTerms,
          teacherId,
          department,
          exactTeachers,
          courseSearchTerms,
        )
      : [];
  const mergeName = virtualItems.length > 0 && sort === "name";
  const queryOrderBy = mergeName ? nameSortSql : orderBy;
  const start = (page - 1) * size;
  let extrasAll = virtualItems;
  let pageExtras: RelationRow[] = [];
  let realOffset = start;
  let realLimit = size;

  const relationFrom = `FROM courses c
      ${publicCourseCanonicalJoin}
      LEFT JOIN course_teachers ct ON ct.course_id=c.id
      LEFT JOIN teachers t ON t.id=ct.teacher_id`;

  if (mergeName) {
    if (virtualItems.length) {
      const pairSql = virtualItems
        .map(() => "(c.id=? AND t.id=?)")
        .join(" OR ");
      const found = await db
        .prepare(
          `SELECT c.id course_id, t.id teacher_id
         ${relationFrom}
         WHERE ${where} AND (${pairSql})`,
        )
        .bind(
          ...args,
          ...virtualItems.flatMap((item) => [item.course_id, item.teacher_id]),
        )
        .all();
      const existing = new Set(
        (
          (found.results ?? []) as Array<{
            course_id: number;
            teacher_id: number | null;
          }>
        ).map((row) => `${row.course_id}:${row.teacher_id}`),
      );
      extrasAll = virtualItems.filter(
        (item) => !existing.has(`${item.course_id}:${item.teacher_id}`),
      );
    }
    extrasAll = [...extrasAll].sort(byNameCodeTeacher);
    const sortKeySql = publicRelationNameSortKeySql("c", "t");
    const realBefore = extrasAll.length
      ? extrasAll.map(() => 0)
      : [];
    if (extrasAll.length) {
      const values = extrasAll.map(() => "(?,?,?)").join(",");
      const { results } = await db
        .prepare(
          `WITH extras(course_id,teacher_id,sort_key) AS (VALUES ${values})
           SELECT extras.course_id,extras.teacher_id,COUNT(*) n
           ${relationFrom}
           JOIN extras ON 1=1
           WHERE ${where}
             AND ${sortKeySql} < extras.sort_key
           GROUP BY extras.course_id,extras.teacher_id`,
        )
        .bind(
          ...extrasAll.flatMap((extra) => [
            extra.course_id,
            extra.teacher_id,
            publicRelationNameSortKey(extra),
          ]),
          ...args,
        )
        .all<{ course_id: number; teacher_id: number; n: number }>();
      const counts = new Map(
        (results || []).map((row) => [`${row.course_id}:${row.teacher_id}`, Number(row.n) || 0]),
      );
      extrasAll.forEach((extra, index) => {
        realBefore[index] = counts.get(`${extra.course_id}:${extra.teacher_id}`) || 0;
      });
    }
    const extraIndexes = extraMergedIndexes(realBefore);
    const window = mergedNameRealWindow(start, size, extraIndexes);
    realOffset = window.offset;
    realLimit = window.limit;
    pageExtras = extrasAll.filter((_, index) =>
      window.extraIndexesOnPage.includes(extraIndexes[index]),
    );
  }

  const [pageResult, countResult] = await Promise.all([
    realLimit === 0
      ? Promise.resolve({ results: [] as unknown[] })
      : db
          .prepare(
            `SELECT c.id course_id,c.code,c.name,c.category,c.department,
       t.id teacher_id,t.name teacher_name,
       rel_rating.rating,
       COALESCE(rel_counts.review_count,0) review_count
      FROM courses c
      ${publicCourseCanonicalJoin}
      LEFT JOIN course_teachers ct ON ct.course_id=c.id
      LEFT JOIN teachers t ON t.id=ct.teacher_id
      LEFT JOIN public_review_counts rel_counts
        ON rel_counts.course_id=c.id AND rel_counts.teacher_id=t.id
      LEFT JOIN public_relation_ratings rel_rating
        ON rel_rating.course_id=c.id AND rel_rating.teacher_id=t.id
     WHERE ${where}
     ORDER BY ${queryOrderBy}
     LIMIT ? OFFSET ?`,
          )
          .bind(
            ...args,
            ...(sort === "name" || sort === "rating" ? [] : searchRankArgs),
            realLimit + 1,
            realOffset,
          )
          .all(),
    relationCount(),
  ]);

  const rows = ((pageResult.results || []) as RelationRow[]).slice(0, realLimit);
  const listed = rows.map((row) => withPublicRelationNames(row));
  const extras = mergeName
    ? pageExtras
    : virtualItems.filter(
        (item) =>
          !listed.some(
            (row) =>
              row.course_id === item.course_id &&
              row.teacher_id === item.teacher_id,
          ),
      );
  const extrasTotal = mergeName ? extrasAll.length : extras.length;
  const realTotal = Number(countResult) || 0;
  const totalCount = realTotal + extrasTotal;
  const pages = Math.max(1, Math.ceil(totalCount / size) || 1);
  let items: RelationRow[];
  if (mergeName) {
    items = [...listed, ...pageExtras].sort(byNameCodeTeacher).slice(0, size);
  } else if (extras.length) {
    items =
      start >= realTotal
        ? extras.slice(start - realTotal, start - realTotal + size)
        : [
            ...listed,
            ...extras.slice(0, Math.max(0, start + size - realTotal)),
          ];
  } else {
    items = listed;
  }

  return {
    items: await attachRelationProjection(db, items.slice(0, size), viewerUserId),
    page,
    pageSize: size,
    total: totalCount,
    pages,
  };
}
