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
import { ensurePublicListPrecomputes } from "./public-list-precompute";
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

type WindowedRow = { window_total?: number };
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

const stripWindowTotal = <T extends WindowedRow>(row: T) => {
  const { window_total: _total, ...rest } = row;
  return rest;
};

const windowedPage = async <T extends WindowedRow>(
  rows: T[],
  page: number,
  fallbackTotal: () => Promise<number>,
) => ({
  items: rows.map(stripWindowTotal),
  total: rows.length
    ? Number(rows[0].window_total) || 0
    : page > 1
      ? await fallbackTotal()
      : 0,
});

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

const loadVirtualPeTeachers = async (
  db: D1Database,
  teacherNames: readonly string[],
) => {
  const placeholders = teacherNames.map(() => "?").join(",");
  return (
    await db
      .prepare(
        `SELECT id,name FROM teachers WHERE name IN (${placeholders}) ORDER BY name,id`,
      )
      .bind(...teacherNames)
      .all<{ id: number; name: string }>()
  ).results;
};

const loadVirtualPeSportItems = async (
  db: D1Database,
  searchTerms: string[],
  teacherId: number | null,
  department: string,
) => {
  if (department) return [];
  const items: Array<ReturnType<typeof virtualPeSportItem>> = [];
  for (const sport of VIRTUAL_PE_SPORTS) {
    if (!virtualPeSportMatchesQuery(sport, searchTerms)) continue;
    const teachers = await loadVirtualPeTeachers(db, sport.teacherNames);
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
  const items: RelationRow[] = [];
  for (const sport of VIRTUAL_PE_SPORTS) {
    if (!virtualPeSportMatchesQuery(sport, searchTerms)) continue;
    const teachers = await loadVirtualPeTeachers(db, sport.teacherNames);
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
): Promise<PublicCatalogPage<PublicCourseListItem>> {
  await ensurePublicListPrecomputes(db);
  const { page, pageSize: size, department, teacherId, sort } = query;
  const search = query.q;
  const searchTerms = parseSearchTerms(search);
  const categoryFilter = publicCategoryFilterSql(query.category, "c");
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
  const where = `${publicCourseVisibleSql("c")} AND ${categoryFilter.sql} AND (?='' OR trim(c.department)=trim(?))${teacherFilter}${indexedSearchGroup.sql ? ` AND ${indexedSearchGroup.sql}` : ""}`;
  const args = [
    ...categoryFilter.args,
    department,
    department,
    ...(teacherId === null ? [] : [teacherId]),
    ...indexedSearchGroup.args,
  ];
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
    substring: ["c.name", "c.code", `(${displayNameSql})`],
    pinyin: "pcc.pinyin_text",
    teacher: ["c.department", "pcc.teacher_variant_text"],
  }, "course", args.length);
  const relevanceOrder = `${sharedRanking.sql},review_count DESC,c.name,c.code,c.id`;
  const searchRankArgs = sharedRanking.args;
  const { results } = await db
    .prepare(
      `SELECT c.*,
       GROUP_CONCAT(DISTINCT t.id || ':' || t.name) teacher_refs,
       GROUP_CONCAT(DISTINCT t.name) teachers,
       COALESCE(course_review_counts.review_count,0) review_count,
       COUNT(*) OVER() window_total
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
      ...(sort === "name" ? [] : searchRankArgs),
      size,
      (page - 1) * size,
    )
    .all();
  const pageRows = await windowedPage(
    results as WindowedRow[],
    page,
    courseCount,
  );
  const virtualItems =
    !query.category || query.category === "sports"
      ? await loadVirtualPeSportItems(db, searchTerms, teacherId, department)
      : [];
  const listed = pageRows.items.map((row) =>
    withPublicCourseItem(row as PublicCourseListItem),
  );
  const extras = virtualItems.filter(
    (item) => !listed.some((row) => row.name === item.name),
  );
  const totalCount = pageRows.total + extras.length;
  const firstPage =
    sort === "name"
      ? [...listed, ...extras].sort(byNameCodeId)
      : [...listed, ...extras];
  return {
    items: page === 1 ? firstPage : listed,
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
): Promise<PublicCatalogPage<PublicRelationListItem>> {
  await ensurePublicListPrecomputes(db);
  const { page, pageSize: size, department, teacherId, sort } = query;
  const search = query.q;
  const searchTerms = parseSearchTerms(search);
  const categoryFilter = publicCategoryFilterSql(query.category, "c");
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
    substring: ["c.name", "c.code", `(${displayNameSql})`],
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
    const realBefore: number[] = [];
    for (const extra of extrasAll) {
      const row = await db
        .prepare(
          `SELECT COUNT(*) n
         ${relationFrom}
         WHERE ${where}
           AND ${sortKeySql} < ?`,
        )
        .bind(...args, publicRelationNameSortKey(extra))
        .first();
      realBefore.push(Number((row as { n?: number } | null)?.n) || 0);
    }
    const extraIndexes = extraMergedIndexes(realBefore);
    const window = mergedNameRealWindow(start, size, extraIndexes);
    realOffset = window.offset;
    realLimit = window.limit;
    pageExtras = extrasAll.filter((_, index) =>
      window.extraIndexesOnPage.includes(extraIndexes[index]),
    );
  }

  const { results } =
    realLimit === 0
      ? { results: [] }
      : await db
          .prepare(
            `SELECT c.id course_id,c.code,c.name,c.category,c.department,
       t.id teacher_id,t.name teacher_name,
       rel_rating.rating,
       COALESCE(rel_counts.review_count,0) review_count
       , COUNT(*) OVER() window_total
      FROM courses c
      ${publicCourseCanonicalJoin}
      LEFT JOIN course_teachers ct ON ct.course_id=c.id
      LEFT JOIN teachers t ON t.id=ct.teacher_id
      LEFT JOIN public_review_counts rel_counts
        ON rel_counts.course_id=c.id AND rel_counts.teacher_id=t.id
      LEFT JOIN (
        SELECT r.course_id,r.teacher_id,ROUND(AVG(r.overall),1) rating
        FROM reviews r
        WHERE r.status='approved'${publicReviewBindingSql}
        GROUP BY r.course_id,r.teacher_id
      ) rel_rating ON rel_rating.course_id=c.id AND rel_rating.teacher_id=t.id
     WHERE ${where}
     ORDER BY ${queryOrderBy}
     LIMIT ? OFFSET ?`,
          )
          .bind(
            ...args,
            ...(sort === "name" || sort === "rating" ? [] : searchRankArgs),
            realLimit,
            realOffset,
          )
          .all();

  const rows = results as Array<RelationRow & WindowedRow>;
  const listed = rows.map((row) => withPublicRelationNames(stripWindowTotal(row)));
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
  const realTotal = rows.length
    ? Number(rows[0].window_total) || 0
    : page > 1 || mergeName
      ? await relationCount()
      : 0;
  const totalCount = realTotal + extrasTotal;
  const pages = Math.max(1, Math.ceil(totalCount / size) || 1);
  let items: RelationRow[];
  if (mergeName) {
    items = [...listed, ...pageExtras].sort(byNameCodeTeacher);
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
    items: await attachRelationProjection(db, items, viewerUserId),
    page,
    pageSize: size,
    total: totalCount,
    pages,
  };
}
