import type { Context } from "hono";
import { isAsciiLetterTerm } from "./lib/catalog-pinyin";
import {
  andSearchTerms,
  andSearchTermsWithPinyin,
  containsPattern,
  delimitedExactSql,
  likeSql,
  parseSearchTerms,
  prefixPattern,
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
import {
  publicCourseCanonicalJoin,
} from "./public-list-precompute";
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

const publicTextReviewCounts = `
  SELECT course_id,teacher_id,COUNT(*) review_count
  FROM (
    SELECT r.course_id,r.teacher_id
    FROM reviews r
    WHERE r.status='approved'
      AND trim(COALESCE(r.comment,''))<>''${publicReviewBindingSql}
    UNION ALL
    SELECT phr.course_id,phr.teacher_id
    FROM public_historical_reviews phr
    UNION ALL
    SELECT lr.course_id,lr.teacher_id
    FROM legacy_reviews lr
    JOIN courses legacy_course ON legacy_course.id=lr.course_id
    JOIN teachers legacy_teacher ON legacy_teacher.id=lr.teacher_id
    WHERE lr.status='approved'
      AND trim(COALESCE(lr.comment,''))<>''
  ) visible_text_reviews
  GROUP BY course_id,teacher_id`;

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

async function loadVirtualPeRelations(
  db: D1Database,
  searchTerms: string[],
  teacherId: number | null,
  department: string,
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
  const teacherA = String(a.teacher_name ?? "");
  const teacherB = String(b.teacher_name ?? "");
  if (teacherA !== teacherB) return teacherA < teacherB ? -1 : 1;
  return Number(a.course_id ?? 0) - Number(b.course_id ?? 0);
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
  const searchGroup = andSearchTermsWithPinyin(
    searchTerms,
    likeSql("pcc.match_text"),
    likeSql("pcc.pinyin_text"),
    isAsciiLetterTerm,
  );
  const where = `${publicCourseVisibleSql("c")} AND ${categoryFilter.sql} AND (?='' OR trim(c.department)=trim(?))${teacherFilter}${searchGroup.sql ? ` AND ${searchGroup.sql}` : ""}`;
  const args = [
    ...categoryFilter.args,
    department,
    department,
    ...(teacherId === null ? [] : [teacherId]),
    ...searchGroup.args,
  ];
  const relationCount = () =>
    c.env.DB.prepare(
      `SELECT COUNT(*) n
       FROM courses c
       ${publicCourseCanonicalJoin}
       LEFT JOIN course_teachers ct ON ct.course_id=c.id
       WHERE ${where}`,
    )
      .bind(...args)
      .first()
      .then((row) => Number((row as { n?: number } | null)?.n) || 0);

  const allTermsInTitle =
    searchTerms.length > 1
      ? andSearchTerms(searchTerms, `${likeSql("c.name")} OR ${likeSql("c.code")}`)
      : { sql: "", args: [] };
  const relevanceOrder = `CASE
       WHEN ?='' THEN 0
       WHEN c.name=? OR c.code=? OR (${publicBrowseFamilySql("c")})=? THEN 0
       WHEN ${likeSql("c.name")} OR ${likeSql("c.code")} THEN 1
       ${allTermsInTitle.sql ? `WHEN ${allTermsInTitle.sql} THEN 2` : ""}
       WHEN c.department=? THEN 3
       WHEN ${likeSql("c.department")} THEN 4
       WHEN ${delimitedExactSql("pcc.teacher_variant_text")} THEN 5
       WHEN ${likeSql("pcc.teacher_variant_text")} THEN 6
       WHEN ${likeSql("pcc.pinyin_text")} THEN 7
       ELSE 8
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
    search,
    prefixPattern(search),
    containsPattern(search),
  ];
  const orderBy =
    sort === "name"
      ? "c.name,c.code,c.id,COALESCE(t.name,''),COALESCE(t.id,0)"
      : sort === "rating"
        ? "(rel_rating.rating IS NULL),rel_rating.rating DESC,review_count DESC,c.name,c.code,c.id,COALESCE(t.name,''),COALESCE(t.id,0)"
        : relevanceOrder;

  const { results } = await c.env.DB.prepare(
    `SELECT c.id course_id,c.code,c.name,c.category,c.department,
       t.id teacher_id,t.name teacher_name,
       rel_rating.rating,
       COALESCE(rel_counts.review_count,0) review_count,
       COUNT(*) OVER() window_total
      FROM courses c
      ${publicCourseCanonicalJoin}
      LEFT JOIN course_teachers ct ON ct.course_id=c.id
      LEFT JOIN teachers t ON t.id=ct.teacher_id
      LEFT JOIN (${publicTextReviewCounts}) rel_counts
        ON rel_counts.course_id=c.id AND rel_counts.teacher_id=t.id
      LEFT JOIN (
        SELECT r.course_id,r.teacher_id,ROUND(AVG(r.overall),1) rating
        FROM reviews r
        WHERE r.status='approved'${publicReviewBindingSql}
        GROUP BY r.course_id,r.teacher_id
      ) rel_rating ON rel_rating.course_id=c.id AND rel_rating.teacher_id=t.id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
  )
    .bind(
      ...args,
      ...(sort === "name" || sort === "rating" ? [] : searchRankArgs),
      size,
      (page - 1) * size,
    )
    .all();

  const rows = results as Array<RelationRow & WindowedRow>;
  const realTotal = rows.length
    ? Number(rows[0].window_total) || 0
    : page > 1
      ? await relationCount()
      : 0;
  const listed = rows.map((row) => withPublicNames(stripWindowTotal(row)));
  const virtualItems =
    !cat || cat === "sports"
      ? await loadVirtualPeRelations(
          c.env.DB,
          searchTerms,
          teacherId,
          department,
        )
      : [];
  const extras = virtualItems.filter(
    (item) =>
      !listed.some(
        (row) =>
          row.course_id === item.course_id && row.teacher_id === item.teacher_id,
      ),
  );
  const totalCount = realTotal + extras.length;
  const pages = Math.max(1, Math.ceil(totalCount / size) || 1);
  let items = listed;
  if (extras.length) {
    if (sort === "rating") {
      if (page === pages) items = [...listed, ...extras];
    } else if (sort === "name") {
      if (page === 1) items = [...listed, ...extras].sort(byNameCodeTeacher);
    } else if (page === 1) {
      items = [...listed, ...extras];
    }
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
