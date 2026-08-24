import type { Context } from "hono";
import { isAsciiLetterTerm } from "./lib/catalog-pinyin";
import {
  andSearchTerms,
  andSearchTermsWithPinyin,
  containsPattern,
  likeSql,
  parseSearchTerms,
  prefixPattern,
  type SearchFilter,
} from "./lib/catalog-search";
import {
  isPublicListCategoryFilter,
  publicBrowseFamilySql,
  publicCategoryFilterError,
  publicCategoryFilterSql,
  publicCourseCategory,
  publicCourseDisplayName,
  publicCourseVisibleSql,
  VIRTUAL_PE_SPORTS,
  virtualPeSportMatchesQuery,
} from "./lib/public-course-presentation";
import { relationDimensionKey } from "./lib/relation-four-dims";
import { loadRelationDimensionLabels } from "./lib/relation-projections";
import {
  loadRelationSignalPayloads,
  type RelationSignalCounts,
  type RelationSignalViewer,
} from "./relation-signals";
import { publicCourseCanonicalJoin } from "./public-list-precompute";
import { publicReviewBindingSql } from "./review-summary";

const clean = (v: unknown, n = 500) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
const integer = (v: unknown) => {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v !== "string" || !/^-?(?:0|[1-9]\d*)$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};
const fail = (c: Context, error: string, status = 400) =>
  c.json({ error }, status as 400);

type WindowedRow = { window_total?: number };
const stripWindowTotal = <T extends WindowedRow>(row: T) => {
  const { window_total: _total, ...rest } = row;
  return rest;
};

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

function withPublicNames(row: RelationRow): RelationRow {
  const rawName = row.name || "";
  return {
    ...row,
    name: publicCourseDisplayName(rawName),
    category: publicCourseCategory(rawName, row.category),
    rating: row.rating == null ? null : Number(row.rating),
    review_count: Number(row.review_count) || 0,
    teacher_id: row.teacher_id == null ? null : Number(row.teacher_id),
  };
}

type ExactTeacherHits = {
  ids: number[];
  matchedTerms: Set<string>;
  active: boolean;
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

function teacherRelevanceClauses(terms: string[]): SearchFilter {
  if (!terms.length) return { sql: "", args: [] };
  const exactSql = terms
    .map(() => "t.name=? OR t.source_teacher_label=?")
    .join(" OR ");
  const likePair = `${likeSql("t.name")} OR ${likeSql("t.source_teacher_label")}`;
  const likeSqlAll = terms.map(() => likePair).join(" OR ");
  return {
    sql: `WHEN ${exactSql} THEN 5
       WHEN ${likeSqlAll} THEN 6
       WHEN ${likeSqlAll} THEN 7`,
    args: [
      ...terms.flatMap((term) => [term, term]),
      ...terms.flatMap((term) => [prefixPattern(term), prefixPattern(term)]),
      ...terms.flatMap((term) => [containsPattern(term), containsPattern(term)]),
    ],
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
    const placeholders = sport.teacherNames.map(() => "?").join(",");
    const teachers = (
      await db
        .prepare(
          `SELECT id,name FROM teachers WHERE name IN (${placeholders}) ORDER BY name,id`,
        )
        .bind(...sport.teacherNames)
        .all()
    ).results as Array<{ id: number; name: string }>;
    if (!teachers.length) continue;
    const filtered = teacherId
      ? teachers.filter((teacher) => teacher.id === teacherId)
      : exactTeachers.active
        ? teachers.filter((teacher) => exactTeachers.ids.includes(teacher.id))
        : courseSearchTerms.length
          ? teachers.filter((teacher) =>
              courseSearchTerms.every(
                (term) =>
                  sport.label.includes(term) || teacher.name.includes(term),
              ),
            )
          : teachers;
    for (const teacher of filtered) {
      items.push({
        course_id: sport.id,
        code: "",
        name: sport.label,
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

function byNameCodeTeacher(a: RelationRow, b: RelationRow) {
  const nameA = String(a.name ?? "");
  const nameB = String(b.name ?? "");
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  const codeA = String(a.code ?? "");
  const codeB = String(b.code ?? "");
  if (codeA !== codeB) return codeA < codeB ? -1 : 1;
  const course = Number(a.course_id ?? 0) - Number(b.course_id ?? 0);
  if (course) return course;
  const teacherA = String(a.teacher_name ?? "");
  const teacherB = String(b.teacher_name ?? "");
  if (teacherA !== teacherB) return teacherA < teacherB ? -1 : 1;
  return Number(a.teacher_id ?? 0) - Number(b.teacher_id ?? 0);
}

export async function listCourseRelations(
  c: Context,
  viewerUserId: string | null,
) {
  const page = Math.max(1, integer(c.req.query("page")) || 1);
  const size = Math.min(50, Math.max(1, integer(c.req.query("pageSize")) || 20));
  const search = clean(c.req.query("q"), 80);
  const searchTerms = parseSearchTerms(search);
  const cat = clean(c.req.query("category"), 20);
  const department = clean(c.req.query("department"), 80);
  const teacherId = integer(c.req.query("teacherId"));
  const sortRaw = clean(c.req.query("sort"), 20);
  const sort =
    sortRaw === "name" ? "name" : sortRaw === "rating" ? "rating" : "reviews";
  if (cat && !isPublicListCategoryFilter(cat))
    return fail(c, publicCategoryFilterError());

  const categoryFilter = publicCategoryFilterSql(cat, "c");
  const teacherFilter = teacherId === null ? "" : " AND ct.teacher_id=?";
  const exactTeachers = await loadExactTeacherHits(c.env.DB, searchTerms);
  const exactTeacherFilter = !exactTeachers.active
    ? ""
    : exactTeachers.ids.length === 0
      ? " AND 0"
      : ` AND ct.teacher_id IN (${exactTeachers.ids.map(() => "?").join(",")})`;
  const courseSearchTerms = searchTerms.filter(
    (term) => !exactTeachers.matchedTerms.has(term),
  );
  const searchGroup = andSearchTermsWithPinyin(
    courseSearchTerms,
    likeSql("pcc.match_text"),
    likeSql("pcc.pinyin_text"),
    isAsciiLetterTerm,
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
    c.env.DB.prepare(
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

  const allTermsInTitle =
    searchTerms.length > 1
      ? andSearchTerms(searchTerms, `${likeSql("c.name")} OR ${likeSql("c.code")}`)
      : { sql: "", args: [] };
  const teacherRank = teacherRelevanceClauses(searchTerms);
  const relevanceOrder = `CASE
       WHEN ?='' THEN 0
       WHEN c.name=? OR c.code=? OR (${publicBrowseFamilySql("c")})=? THEN 0
       WHEN ${likeSql("c.name")} OR ${likeSql("c.code")} THEN 1
       ${allTermsInTitle.sql ? `WHEN ${allTermsInTitle.sql} THEN 2` : ""}
       WHEN c.department=? THEN 3
       WHEN ${likeSql("c.department")} THEN 4
       ${teacherRank.sql}
       WHEN ${likeSql("pcc.pinyin_text")} THEN 8
       ELSE 9
     END,review_count DESC,c.name,c.code,c.id,COALESCE(t.name,''),COALESCE(t.id,0)`;
  const searchRankArgs = [
    search,
    search,
    search,
    search,
    prefixPattern(search),
    prefixPattern(search),
    ...allTermsInTitle.args,
    search,
    prefixPattern(search),
    ...teacherRank.args,
    containsPattern(search),
  ];
  const orderBy =
    sort === "name"
      ? "c.name,c.code,c.id,COALESCE(t.name,''),COALESCE(t.id,0)"
      : sort === "rating"
        ? "(rel_rating.rating IS NULL),rel_rating.rating DESC,review_count DESC,c.name,c.code,c.id,COALESCE(t.name,''),COALESCE(t.id,0)"
        : relevanceOrder;
  const virtualItems =
    !cat || cat === "sports"
      ? await loadVirtualPeRelations(
          c.env.DB,
          searchTerms,
          teacherId,
          department,
          exactTeachers,
          courseSearchTerms,
        )
      : [];
  const mergeName = virtualItems.length > 0 && sort === "name";
  const paged = !mergeName;

  const { results } = await c.env.DB.prepare(
    `SELECT c.id course_id,c.code,c.name,c.category,c.department,
       t.id teacher_id,t.name teacher_name,
       rel_rating.rating,
       COALESCE(rel_counts.review_count,0) review_count
       ${paged ? ", COUNT(*) OVER() window_total" : ""}
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
     ORDER BY ${orderBy}
     ${paged ? "LIMIT ? OFFSET ?" : ""}`,
  )
    .bind(
      ...args,
      ...(sort === "name" || sort === "rating" ? [] : searchRankArgs),
      ...(paged ? [size, (page - 1) * size] : []),
    )
    .all();

  const rows = results as Array<RelationRow & WindowedRow>;
  const listed = rows.map((row) => withPublicNames(stripWindowTotal(row)));
  const extras = virtualItems.filter(
    (item) =>
      !listed.some(
        (row) =>
          row.course_id === item.course_id && row.teacher_id === item.teacher_id,
      ),
  );
  const realTotal = mergeName
    ? listed.length
    : rows.length
      ? Number(rows[0].window_total) || 0
      : page > 1
        ? await relationCount()
        : 0;
  const totalCount = realTotal + extras.length;
  const pages = Math.max(1, Math.ceil(totalCount / size) || 1);
  const start = (page - 1) * size;
  let items: RelationRow[];
  if (mergeName) {
    items = [...listed, ...extras]
      .sort(byNameCodeTeacher)
      .slice(start, start + size);
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

  const dimMap = await loadRelationDimensionLabels(
    c.env.DB,
    items.map((item) => ({
      courseId: item.course_id,
      teacherId: item.teacher_id,
    })),
  );
  const signalMap = await loadRelationSignalPayloads(
    c.env.DB,
    items
      .filter(
        (item): item is RelationRow & { teacher_id: number } =>
          item.teacher_id != null,
      )
      .map((item) => ({ courseId: item.course_id, teacherId: item.teacher_id })),
    viewerUserId,
  );

  return c.json({
    items: items.map((item) => {
      const signals =
        item.teacher_id != null
          ? signalMap.get(`${item.course_id}:${item.teacher_id}`)
          : undefined;
      const emptySignals: RelationSignalCounts & Partial<RelationSignalViewer> =
        {
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
      return {
        ...item,
        dimensionLabels:
          dimMap.get(relationDimensionKey(item.course_id, item.teacher_id)) ??
          null,
        ...(signals ?? emptySignals),
      };
    }),
    page,
    pageSize: size,
    total: totalCount,
    pages,
  });
}
