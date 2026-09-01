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
import {
  filterPublicPeCourseItems,
  loadPublicPeCourseProjection,
  publicCourseIdentity,
  publicPeCourseIdentity,
  publicPeMappedSourceCourseExcludeSql,
  publicPeRelationIdentity,
  publicRelationIdentity,
} from "./lib/public-pe-course-projection";
import {
  filterPublicPeRelationItems,
  loadPublicPeRelationProjection,
  publicPeMappedSourceRelationExcludeSql,
} from "./lib/public-pe-relation-projection";
import { relationDimensionKey } from "./lib/relation-four-dims";
import {
  loadGroupedRelationDimensionLabels,
  loadRelationDimensionLabels,
} from "./lib/relation-projections";
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
  /** Ordinary Course identity is `courses.id`; PE public specializations are `null`. */
  id: number | null;
  /** `course:<id>` for ordinary rows; `pe:<normalizedSpecialization>` for PE public items. */
  public_id: string;
  code: string;
  name: string;
  category: string;
  department: string;
  teachers: string | null;
  teacher_refs: string | null;
  review_count: number;
};

export type PublicRelationListItem = {
  /** Ordinary Relation identity is `courses.id`; PE public specializations are `null`. */
  course_id: number | null;
  /** `relation:<courseId>:<teacherId>` for ordinary rows; `pe:<spec>:<teacherId>` for PE. */
  public_id: string;
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
  course_id: number | null;
  public_id?: string;
  code: string;
  name: string;
  category: string;
  department: string;
  teacher_id: number | null;
  teacher_name: string | null;
  rating: number | null;
  review_count: number;
  source_course_ids?: number[];
};
type ExactTeacherHits = {
  ids: number[];
  matchedTerms: Set<string>;
  active: boolean;
};

const withPublicCourseItem = <
  T extends { id?: unknown; name?: unknown; category?: unknown },
>(
  row: T,
) => {
  const rawName = typeof row.name === "string" ? row.name : "";
  const id = Number(row.id);
  return {
    ...row,
    id,
    public_id: publicCourseIdentity(id),
    name: publicCourseDisplayName(rawName),
    category: publicCourseCategory(
      rawName,
      typeof row.category === "string" ? row.category : "",
    ),
  };
};

const withPublicRelationNames = (row: RelationRow): RelationRow & { public_id: string } => {
  const rawName = row.name || "";
  const courseId = row.course_id == null ? null : Number(row.course_id);
  const teacherId = row.teacher_id == null ? null : Number(row.teacher_id);
  const pePublic = (row.public_id ?? "").startsWith("pe:");
  const publicId =
    row.public_id ||
    (courseId == null
      ? publicPeRelationIdentity("", teacherId ?? 0)
      : publicRelationIdentity(courseId, teacherId));
  return {
    ...row,
    course_id: courseId,
    public_id: publicId,
    name: pePublic ? rawName : publicCourseDisplayName(rawName),
    category: pePublic
      ? "sports"
      : publicCourseCategory(rawName, row.category),
    rating: row.rating == null ? null : Number(row.rating),
    review_count: Number(row.review_count) || 0,
    teacher_id: teacherId,
  };
};

const virtualPeSportItem = (
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
  teachers: Array<{ id: number; name: string }>,
): PublicCourseListItem => ({
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
  excludeLabels: ReadonlySet<string> = new Set(),
) => {
  if (department) return [];
  const matchingSports = VIRTUAL_PE_SPORTS.filter(
    (sport) =>
      !excludeLabels.has(sport.label) &&
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
  excludeLabels: ReadonlySet<string> = new Set(),
): Promise<RelationRow[]> {
  if (department) return [];
  const matchingSports = VIRTUAL_PE_SPORTS.filter(
    (sport) =>
      !excludeLabels.has(sport.label) &&
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
        public_id: publicPeRelationIdentity(sport.label, teacher.id),
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
  a: { id?: unknown; code?: unknown; name?: unknown; public_id?: unknown },
  b: { id?: unknown; code?: unknown; name?: unknown; public_id?: unknown },
) {
  const nameA = String(a.name ?? "");
  const nameB = String(b.name ?? "");
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  const codeA = String(a.code ?? "");
  const codeB = String(b.code ?? "");
  if (codeA !== codeB) return codeA < codeB ? -1 : 1;
  const idA = a.id == null ? Number.POSITIVE_INFINITY : Number(a.id);
  const idB = b.id == null ? Number.POSITIVE_INFINITY : Number(b.id);
  if (idA !== idB) return idA - idB;
  return String(a.public_id ?? "").localeCompare(String(b.public_id ?? ""));
}

function extraSortId(item: PublicCourseListItem): number {
  return item.id == null ? 0 : Number(item.id);
}

function byNameCodeTeacher(a: RelationRow, b: RelationRow) {
  const keyA = publicRelationNameSortKey({
    name: String(a.name ?? ""),
    code: String(a.code ?? ""),
    course_id: a.course_id == null ? 0 : Number(a.course_id),
    teacher_name: a.teacher_name,
    teacher_id: a.teacher_id,
  });
  const keyB = publicRelationNameSortKey({
    name: String(b.name ?? ""),
    code: String(b.code ?? ""),
    course_id: b.course_id == null ? 0 : Number(b.course_id),
    teacher_name: b.teacher_name,
    teacher_id: b.teacher_id,
  });
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

function byRelationRating(a: RelationRow, b: RelationRow) {
  const aMissing = a.rating == null ? 1 : 0;
  const bMissing = b.rating == null ? 1 : 0;
  if (aMissing !== bMissing) return aMissing - bMissing;
  if (a.rating != null && b.rating != null && a.rating !== b.rating) {
    return b.rating - a.rating;
  }
  if (a.review_count !== b.review_count) return b.review_count - a.review_count;
  return byNameCodeTeacher(a, b);
}

function byRelationReviews(a: RelationRow, b: RelationRow) {
  if (a.review_count !== b.review_count) return b.review_count - a.review_count;
  return byNameCodeTeacher(a, b);
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
  const ordinary = items.filter(
    (item): item is RelationRow & { course_id: number } => item.course_id != null,
  );
  const peItems = items.filter(
    (item): item is RelationRow & { public_id: string; teacher_id: number } =>
      item.course_id == null &&
      item.teacher_id != null &&
      Boolean(item.public_id),
  );
  const [dimMap, peDimMap, signalMap] = await Promise.all([
    loadRelationDimensionLabels(
      db,
      ordinary.map((item) => ({
        courseId: item.course_id,
        teacherId: item.teacher_id,
      })),
    ),
    loadGroupedRelationDimensionLabels(
      db,
      peItems.map((item) => ({
        key: item.public_id,
        sources: (item.source_course_ids ?? []).map((courseId) => ({
          courseId,
          teacherId: item.teacher_id,
        })),
      })),
    ),
    loadRelationSignalPayloads(
      db,
      ordinary
        .filter(
          (item): item is RelationRow & { course_id: number; teacher_id: number } =>
            item.teacher_id != null,
        )
        .map((item) => ({ courseId: item.course_id, teacherId: item.teacher_id })),
      viewerUserId,
    ),
  ]);
  return items.map((item) => {
    const { source_course_ids: _sourceCourseIds, ...rest } = item;
    const publicId =
      rest.public_id ||
      (item.course_id == null
        ? publicPeRelationIdentity("", item.teacher_id ?? 0)
        : publicRelationIdentity(item.course_id, item.teacher_id));
    const signals =
      item.course_id != null && item.teacher_id != null
        ? signalMap.get(`${item.course_id}:${item.teacher_id}`)
        : undefined;
    const dimensionLabels =
      item.course_id == null
        ? (peDimMap.get(publicId) ?? null)
        : (dimMap.get(relationDimensionKey(item.course_id, item.teacher_id)) ??
          null);
    return {
      ...rest,
      public_id: publicId,
      dimensionLabels,
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
  const peProjection = await loadPublicPeCourseProjection(db);
  const peItems = filterPublicPeCourseItems(peProjection.items, {
    searchTerms,
    category: query.category,
    department,
    teacherId,
  });
  const baseWhere = `${publicCourseVisibleSql("c")} AND ${publicPeMappedSourceCourseExcludeSql("c")} AND ${categoryFilter.sql} AND (?='' OR trim(c.department)=trim(?))${teacherFilter}`;
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
      ? await loadVirtualPeSportItems(
          db,
          searchTerms,
          teacherId,
          department,
          peProjection.specializations,
        )
      : [];
  const extrasAllUnsorted = [...peItems, ...virtualItems];
  const mergeName = extrasAllUnsorted.length > 0 && sort === "name";
  const mergeReviews =
    extrasAllUnsorted.length > 0 &&
    sort !== "name" &&
    (searchTerms.length === 0 || exactCodeMatched);
  let extrasAll = extrasAllUnsorted;
  let pageExtras: PublicCourseListItem[] = [];
  let realOffset = (page - 1) * size;
  let realLimit = size;
  if (mergeName || mergeReviews) {
    extrasAll = [...extrasAllUnsorted].sort(
      mergeName
        ? byNameCodeId
        : (left, right) =>
            right.review_count - left.review_count || byNameCodeId(left, right),
    );
    const values = extrasAll.map(() => "(?,?,?,?,?)").join(",");
    const reviewCountJoin = `LEFT JOIN (SELECT course_id,SUM(review_count) review_count FROM public_review_counts GROUP BY course_id) course_review_counts ON course_review_counts.course_id=c.id`;
    const beforePredicate = mergeName
      ? `(c.name < extras.sort_name
             OR (c.name = extras.sort_name AND c.code < extras.sort_code)
             OR (c.name = extras.sort_name AND c.code = extras.sort_code AND c.id < extras.sort_id))`
      : `(COALESCE(course_review_counts.review_count,0) > extras.review_count
             OR (COALESCE(course_review_counts.review_count,0) = extras.review_count
               AND (c.name < extras.sort_name
                 OR (c.name = extras.sort_name AND c.code < extras.sort_code)
                 OR (c.name = extras.sort_name AND c.code = extras.sort_code AND c.id < extras.sort_id))))`;
    const { results } = await db
      .prepare(
        `WITH extras(extra_key,sort_name,sort_code,sort_id,review_count) AS (VALUES ${values})
         SELECT extras.extra_key,COUNT(DISTINCT c.id) n
         FROM courses c
         ${countJoins}
         ${mergeReviews ? reviewCountJoin : ""}
         JOIN extras ON 1=1
         WHERE ${where}
           AND ${beforePredicate}
         GROUP BY extras.extra_key`,
      )
      .bind(
        ...extrasAll.flatMap((item) => [
          item.public_id,
          item.name,
          item.code,
          extraSortId(item),
          item.review_count,
        ]),
        ...args,
      )
      .all<{ extra_key: string; n: number }>();
    const realBeforeByKey = new Map(
      (results || []).map((row) => [String(row.extra_key), Number(row.n) || 0]),
    );
    const realBefore: number[] = extrasAll.map(
      (item) => Number(realBeforeByKey.get(item.public_id) || 0),
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
  const extras = mergeName || mergeReviews
    ? pageExtras
    : extrasAll.slice(
        Math.max(0, realOffset - realTotal),
        Math.max(0, realOffset - realTotal) + Math.max(0, size - listed.length),
      );
  const totalCount = realTotal + extrasAll.length;
  const items = mergeName
    ? [...listed, ...pageExtras].sort(byNameCodeId).slice(0, size)
    : mergeReviews
      ? [...listed, ...pageExtras]
          .sort(
            (left, right) =>
              right.review_count - left.review_count ||
              byNameCodeId(left, right),
          )
          .slice(0, size)
    : [...listed, ...extras].slice(0, size);
  return {
    items,
    page,
    pageSize: size,
    total: totalCount,
    pages: Math.ceil(totalCount / size),
  };
}

type RelationMergeKind = "name" | "rating" | "reviews";

function extraPublicId(item: RelationRow): string {
  return item.public_id ?? "";
}

function relationSortKey(item: RelationRow): string {
  return publicRelationNameSortKey({
    name: String(item.name ?? ""),
    code: String(item.code ?? ""),
    course_id: item.course_id == null ? 0 : Number(item.course_id),
    teacher_name: item.teacher_name,
    teacher_id: item.teacher_id,
  });
}

async function planMergedRelationWindow(input: {
  db: D1Database;
  relationFrom: string;
  ratingJoins: string;
  where: string;
  args: unknown[];
  extrasAllUnsorted: RelationRow[];
  mergeKind: RelationMergeKind;
  start: number;
  size: number;
}): Promise<{
  extrasAll: RelationRow[];
  pageExtras: RelationRow[];
  realOffset: number;
  realLimit: number;
}> {
  const extrasAll = [...input.extrasAllUnsorted].sort(
    input.mergeKind === "name"
      ? byNameCodeTeacher
      : input.mergeKind === "rating"
        ? byRelationRating
        : byRelationReviews,
  );
  if (!extrasAll.length) {
    return {
      extrasAll,
      pageExtras: [],
      realOffset: input.start,
      realLimit: input.size,
    };
  }
  const sortKeySql = publicRelationNameSortKeySql("c", "t");
  const values = extrasAll
    .map(() =>
      input.mergeKind === "name"
        ? "(?,?)"
        : input.mergeKind === "rating"
          ? "(?,?,?,?,?)"
          : "(?,?,?)",
    )
    .join(",");
  const beforePredicate =
    input.mergeKind === "name"
      ? `${sortKeySql} < extras.sort_key`
      : input.mergeKind === "reviews"
        ? `(COALESCE(rel_counts.review_count,0) > extras.review_count
             OR (COALESCE(rel_counts.review_count,0) = extras.review_count
               AND ${sortKeySql} < extras.sort_key))`
        : `((CASE WHEN rel_rating.rating IS NULL THEN 1 ELSE 0 END) < extras.rating_missing
             OR ((CASE WHEN rel_rating.rating IS NULL THEN 1 ELSE 0 END) = extras.rating_missing
               AND (
                 (extras.rating_missing = 0 AND rel_rating.rating > extras.rating)
                 OR (
                   (extras.rating_missing = 1 OR rel_rating.rating = extras.rating)
                   AND (
                     COALESCE(rel_counts.review_count,0) > extras.review_count
                     OR (
                       COALESCE(rel_counts.review_count,0) = extras.review_count
                       AND ${sortKeySql} < extras.sort_key
                     )
                   )
                 )
               )))`;
  const extraSelect =
    input.mergeKind === "name"
      ? "WITH extras(extra_key,sort_key) AS"
      : input.mergeKind === "reviews"
        ? "WITH extras(extra_key,review_count,sort_key) AS"
        : "WITH extras(extra_key,rating_missing,rating,review_count,sort_key) AS";
  const extraBinds = extrasAll.flatMap((extra) =>
    input.mergeKind === "name"
      ? [extraPublicId(extra), relationSortKey(extra)]
      : input.mergeKind === "reviews"
        ? [extraPublicId(extra), extra.review_count, relationSortKey(extra)]
        : [
            extraPublicId(extra),
            extra.rating == null ? 1 : 0,
            extra.rating ?? 0,
            extra.review_count,
            relationSortKey(extra),
          ],
  );
  const ratingJoins =
    input.mergeKind === "name" ? "" : input.ratingJoins;
  const { results } = await input.db
    .prepare(
      `${extraSelect} (VALUES ${values})
       SELECT extras.extra_key,COUNT(*) n
       ${input.relationFrom}
       ${ratingJoins}
       JOIN extras ON 1=1
       WHERE ${input.where}
         AND ${beforePredicate}
       GROUP BY extras.extra_key`,
    )
    .bind(...extraBinds, ...input.args)
    .all<{ extra_key: string; n: number }>();
  const counts = new Map(
    (results || []).map((row) => [String(row.extra_key), Number(row.n) || 0]),
  );
  const realBefore: number[] = extrasAll.map(
    (extra) => Number(counts.get(extraPublicId(extra))) || 0,
  );
  const extraIndexes = extraMergedIndexes(realBefore);
  const window = mergedNameRealWindow(input.start, input.size, extraIndexes);
  return {
    extrasAll,
    pageExtras: extrasAll.filter((_, index) =>
      window.extraIndexesOnPage.includes(extraIndexes[index]),
    ),
    realOffset: window.offset,
    realLimit: window.limit,
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
  const where = `${publicCourseVisibleSql("c")} AND ${publicPeMappedSourceRelationExcludeSql("c", "ct")} AND ${categoryFilter.sql} AND (?='' OR trim(c.department)=trim(?))${teacherFilter}${searchGroup.sql ? ` AND ${searchGroup.sql}` : ""}${rowHit.sql ? ` AND ${rowHit.sql}` : ""}${exactTeacherFilter}`;
  const args = [
    ...categoryFilter.args,
    department,
    department,
    ...(teacherId === null ? [] : [teacherId]),
    ...searchGroup.args,
    ...rowHit.args,
    ...exactTeachers.ids,
  ];
  const relationFrom = `FROM courses c
      ${publicCourseCanonicalJoin}
      JOIN course_teachers ct ON ct.course_id=c.id
      JOIN teachers t ON t.id=ct.teacher_id`;
  const ratingJoins = `
      LEFT JOIN public_review_counts rel_counts
        ON rel_counts.course_id=c.id AND rel_counts.teacher_id=t.id
      LEFT JOIN public_relation_ratings rel_rating
        ON rel_rating.course_id=c.id AND rel_rating.teacher_id=t.id`;
  const relationCount = () =>
    db
      .prepare(
        `SELECT COUNT(*) n
       ${relationFrom}
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
  const peProjection = await loadPublicPeRelationProjection(db);
  const peItems = filterPublicPeRelationItems(peProjection.items, {
    category: query.category,
    department,
    teacherId,
    exactTeacherIds: exactTeachers.active ? exactTeachers.ids : null,
    courseSearchTerms,
  });
  const virtualItems =
    !query.category || query.category === "sports"
      ? await loadVirtualPeRelations(
          db,
          searchTerms,
          teacherId,
          department,
          exactTeachers,
          courseSearchTerms,
          peProjection.specializations,
        )
      : [];
  const extrasAllUnsorted = [
    ...peItems,
    ...virtualItems.filter(
      (item) => !peProjection.identities.has(extraPublicId(item)),
    ),
  ];
  const mergeKind: RelationMergeKind | null = !extrasAllUnsorted.length
    ? null
    : sort === "name"
      ? "name"
      : sort === "rating"
        ? "rating"
        : searchTerms.length === 0
          ? "reviews"
          : null;
  const queryOrderBy =
    mergeKind === "reviews" ? `review_count DESC,${nameSortSql}` : orderBy;
  const start = (page - 1) * size;
  let extrasAll = extrasAllUnsorted;
  let pageExtras: RelationRow[] = [];
  let realOffset = start;
  let realLimit = size;

  if (mergeKind) {
    const window = await planMergedRelationWindow({
      db,
      relationFrom,
      ratingJoins,
      where,
      args,
      extrasAllUnsorted,
      mergeKind,
      start,
      size,
    });
    extrasAll = window.extrasAll;
    pageExtras = window.pageExtras;
    realOffset = window.realOffset;
    realLimit = window.realLimit;
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
      ${relationFrom}
      ${ratingJoins}
     WHERE ${where}
     ORDER BY ${queryOrderBy}
     LIMIT ? OFFSET ?`,
          )
          .bind(
            ...args,
            ...(mergeKind === "reviews" || sort === "name" || sort === "rating"
              ? []
              : searchRankArgs),
            realLimit + 1,
            realOffset,
          )
          .all(),
    relationCount(),
  ]);

  const rows = ((pageResult.results || []) as RelationRow[]).slice(0, realLimit);
  const listed = rows.map((row) => withPublicRelationNames(row));
  const extras = mergeKind
    ? pageExtras
    : extrasAllUnsorted.filter(
        (item) =>
          !listed.some((row) => extraPublicId(row) === extraPublicId(item)),
      );
  const extrasTotal = mergeKind ? extrasAll.length : extras.length;
  const realTotal = Number(countResult) || 0;
  const totalCount = realTotal + extrasTotal;
  const pages = Math.ceil(totalCount / size);
  let items: RelationRow[];
  if (mergeKind === "name") {
    items = [...listed, ...pageExtras].sort(byNameCodeTeacher).slice(0, size);
  } else if (mergeKind === "rating") {
    items = [...listed, ...pageExtras].sort(byRelationRating).slice(0, size);
  } else if (mergeKind === "reviews") {
    items = [...listed, ...pageExtras].sort(byRelationReviews).slice(0, size);
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
