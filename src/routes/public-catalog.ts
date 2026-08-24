import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { isAsciiLetterTerm } from "../lib/catalog-pinyin";
import {
  andSearchTerms,
  andSearchTermsWithPinyin,
  containsPattern,
  delimitedExactSql,
  likeSql,
  parseSearchTerms,
  prefixPattern,
} from "../lib/catalog-search";
import {
  isPublicListCategoryFilter,
  isVirtualPeSportId,
  publicCategoryFilterError,
  publicCategoryFilterSql,
  publicBrowseFamilySql,
  publicOptionDisplayName,
  publicCourseVisibleSql,
  VIRTUAL_PE_SPORTS,
  virtualPeSportById,
  virtualPeSportForTeacherName,
  virtualPeSportMatchesQuery,
} from "../lib/public-course-presentation";
import {
  courseSchemeView,
  publicDimensionAverage,
  publicDimensionLabels,
} from "../lib/review-schemes";
import { setPublicCatalogCacheHeaders } from "../lib/public-catalog-cache";
import {
  ensurePublicListPrecomputes,
  publicCourseCanonicalJoin,
  publicCourseOptionJoin,
  publicTeacherSearchJoin,
} from "../public-list-precompute";
import { deriveCourseCatalogMeta } from "../lib/course-metadata";
import {
  publicCreatedAt,
  publicGrade,
  publicHeadline,
  publicOverall,
  publicTerm,
} from "../lib/public-review-fields";
import { relationDimensionKey } from "../lib/relation-four-dims";
import {
  loadCourseRelationTerms,
  loadRelationDimensionLabels,
} from "../lib/relation-projections";
import { listCourseRelations } from "../course-relations-catalog";
import { handleLatestPublicReviews } from "../public-reviews-latest";
import { decoratePublicReviews } from "../review-endorsements";
import { loadRelationSignalPayloads } from "../relation-signals";
import {
  isOrdinaryUserAuthenticated,
  resolveOrdinaryUser,
} from "../ordinary-user-session";
import {
  authoredReviewAuthorSql,
  authoredReviewJoinSql,
  publicAuthorFields,
  reservedAuthorSql,
} from "../public-handle";
import {
  getCourseRelationSummaries,
  publicReviewBindingSql,
  reviewNotDeletedBindingSql,
} from "../review-summary";
import { readSecret } from "../secrets";
import { loadSiteBanner } from "../site-banner";
import {
  clean,
  fail,
  hasValidAdminSession,
  integer,
  pageArgs,
  parseTagCsv,
  publicCourseRawName,
  skipTurnstile,
  windowedPage,
  withMappedCourseNames,
  withPublicCourseCategory,
  type WindowedRow,
} from "./support";
import type { AppContext } from "./types";

const publicCatalogRoutes = new Hono<AppEnv>();

const withCourseReviewScheme = <
  T extends {
    scheme_key?: unknown;
    category?: unknown;
    tag_csv?: unknown;
    name?: unknown;
    course_name?: unknown;
  },
>(
  row: T,
) => {
  const view = courseSchemeView(
    typeof row.scheme_key === "string" ? row.scheme_key : null,
    typeof row.category === "string" ? row.category : "",
    parseTagCsv(row.tag_csv),
  );
  const { scheme_key: _schemeKey, tag_csv: _tagCsv, ...rest } = row;
  return { ...withPublicCourseCategory(rest), ...view };
};
const withPublicCourseOption = <
  T extends {
    scheme_key?: unknown;
    category?: unknown;
    tag_csv?: unknown;
    name?: unknown;
    course_name?: unknown;
  },
>(
  row: T,
) => {
  const view = courseSchemeView(
    typeof row.scheme_key === "string" ? row.scheme_key : null,
    typeof row.category === "string" ? row.category : "",
    parseTagCsv(row.tag_csv),
  );
  const { scheme_key: _schemeKey, tag_csv: _tagCsv, ...rest } = row;
  return {
    ...withMappedCourseNames(
      rest,
      publicOptionDisplayName(publicCourseRawName(rest)),
    ),
    ...view,
  };
};
const virtualPeSportItem = (
  sport: (typeof VIRTUAL_PE_SPORTS)[number],
  teachers: Array<{ id: number; name: string }>,
) => ({
  id: sport.id,
  code: "",
  name: sport.label,
  category: "sports" as const,
  department: "",
  teachers: teachers.map((teacher) => teacher.name).join(","),
  teacher_refs: teachers
    .map((teacher) => `${teacher.id}:${teacher.name}`)
    .join(","),
  review_count: 0,
  rating: null,
});
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
    const placeholders = sport.teacherNames.map(() => "?").join(",");
    const teachers = (
      await db
        .prepare(
          `SELECT id,name FROM teachers WHERE name IN (${placeholders}) ORDER BY name,id`,
        )
        .bind(...sport.teacherNames)
        .all<{ id: number; name: string }>()
    ).results;
    if (!teachers.length) continue;
    if (teacherId && !teachers.some((teacher) => teacher.id === teacherId))
      continue;
    items.push(virtualPeSportItem(sport, teachers));
  }
  return items;
};
// 公开评价绑定规则的唯一来源在 review-summary.ts（AI 总结收集同一集合）。
const publicReviewBinding = publicReviewBindingSql;
type PublicReviewCursor =
  | { source: number; key: string }
  | {
      source: number;
      key: string;
      order: string | number;
      query: string;
      total: number;
    };
type PublicReviewSort =
  | "recognized"
  | "latest"
  | "oldest"
  | "rating_desc"
  | "rating_asc";
type PublicReviewQuery = {
  sort: PublicReviewSort;
  term: string;
  rating: number | null;
};
const publicReviewPageSize = (c: AppContext) =>
  Math.min(50, Math.max(1, integer(c.req.query("pageSize")) || 20));
const decodePublicReviewCursor = (
  value: string | undefined,
): PublicReviewCursor | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(value)) as PublicReviewCursor;
    return Number.isInteger(parsed.source) && typeof parsed.key === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
};
const encodePublicReviewCursor = (cursor: PublicReviewCursor) =>
  btoa(JSON.stringify(cursor));
const getPublicReviewPage = async (
  db: D1Database,
  subject: "course_id" | "teacher_id",
  id: number | null,
  size: number,
  cursor: PublicReviewCursor | null,
  viewerUserId: string | null = null,
  teacherId: number | null = null,
  query: PublicReviewQuery | null = null,
  includeBlocked = false,
) => {
  const cursorSource = cursor && "source" in cursor ? cursor.source : -1;
  const cursorKey = cursor && "key" in cursor ? cursor.key : "";
  const reviewBinding = includeBlocked
    ? reviewNotDeletedBindingSql
    : publicReviewBinding;
  /** 课程页评价按 课程×教师 作用域展示：选定教师时追加逐分支过滤。 */
  const teacherFilter = (alias: string) =>
    teacherId ? ` AND ${alias}.teacher_id=?` : "";
  const teacherBinds = teacherId ? [teacherId] : [];
  const filterParts: string[] = [];
  const filterBinds: unknown[] = [];
  if (query?.term) {
    filterParts.push("term=?");
    filterBinds.push(query.term);
  }
  if (query?.rating != null) {
    filterParts.push("overall=?");
    filterBinds.push(query.rating);
  }
  const orderConfig: Record<
    PublicReviewSort,
    { expression: string; direction: "ASC" | "DESC" }
  > = {
    recognized: { expression: "endorsement_count", direction: "DESC" },
    latest: {
      expression: "COALESCE(created_at,'')",
      direction: "DESC",
    },
    oldest: {
      expression: "COALESCE(created_at,'9999-12-31 23:59:59')",
      direction: "ASC",
    },
    rating_desc: { expression: "COALESCE(overall,-1)", direction: "DESC" },
    rating_asc: { expression: "COALESCE(overall,99)", direction: "ASC" },
  };
  const order = query ? orderConfig[query.sort] : null;
  const queryKey = query
    ? JSON.stringify([query.sort, query.term, query.rating])
    : "";
  const orderedCursor =
    query && cursor && "order" in cursor && cursor.query === queryKey
      ? cursor
      : null;
  const orderedCursorSql = orderedCursor
    ? ` AND (${order?.expression} ${order?.direction === "DESC" ? "<" : ">"} ?
         OR (${order?.expression}=? AND
           (source_order>? OR (source_order=? AND sort_key>?))))`
    : "";
  const pageSql = query
    ? `WHERE ${filterParts.length ? filterParts.join(" AND ") : "1=1"}${orderedCursorSql}
       ORDER BY ${order?.expression} ${order?.direction},source_order,sort_key LIMIT ?`
    : `WHERE source_order>? OR (source_order=? AND sort_key>?)
       ORDER BY source_order,sort_key LIMIT ?`;
  const { results } = await db
    .prepare(
      `SELECT source_order,sort_key,id,course_id,teacher_id,comment,comment_format,
         headline,grade,
         course_name,course_code,teacher_name,endorsement_count,
         scheme_key,scheme_version,scores,overall,term,created_at,
         author_public_code,author_avatar_key,blocked_at,
         COUNT(*) OVER() filtered_total
       FROM (
         SELECT 0 source_order,phr.id sort_key,'historical:' || phr.id id,
           phr.course_id,phr.teacher_id,phr.comment,NULL comment_format,
           '' headline,NULL grade,
           c.name course_name,c.code course_code,t.name teacher_name,
           0 endorsement_count,
           NULL scheme_key,NULL scheme_version,NULL scores,
           NULL overall,NULL term,phr.imported_at created_at,
           ${reservedAuthorSql}, NULL blocked_at
         FROM public_historical_reviews phr
         JOIN courses c ON c.id=phr.course_id
         JOIN teachers t ON t.id=phr.teacher_id
         WHERE phr.${subject}=?${teacherFilter("phr")}
         UNION ALL
         SELECT 1 source_order,printf('%020d',lr.id) sort_key,'legacy:' || lr.id id,
           lr.course_id,lr.teacher_id,lr.comment,NULL comment_format,
           '' headline,NULL grade,
           c.name course_name,c.code course_code,t.name teacher_name,
           0 endorsement_count,
           NULL scheme_key,NULL scheme_version,NULL scores,
           NULL overall,NULLIF(trim(COALESCE(lr.term,'')),'') term,lr.created_at,
           ${reservedAuthorSql}, NULL blocked_at
         FROM legacy_reviews lr
         JOIN courses c ON c.id=lr.course_id
         JOIN teachers t ON t.id=lr.teacher_id
         WHERE lr.${subject}=? AND lr.status='approved'
           AND trim(COALESCE(lr.comment,''))<>''${teacherFilter("lr")}
         UNION ALL
         SELECT 2 source_order,printf('%020d',r.id) sort_key,'review:' || r.id id,
           r.course_id,r.teacher_id,r.comment,r.comment_format,
           r.headline,r.grade,
           c.name course_name,c.code course_code,t.name teacher_name,
           (SELECT COUNT(*) FROM review_endorsements e WHERE e.review_id=r.id) endorsement_count,
           r.scheme_key,r.scheme_version,r.scores,
           r.overall,NULLIF(trim(COALESCE(r.term,'')),'') term,r.created_at,
           ${authoredReviewAuthorSql}, r.blocked_at
         FROM reviews r
         JOIN courses c ON c.id=r.course_id
         JOIN teachers t ON t.id=r.teacher_id
         ${authoredReviewJoinSql}
         WHERE r.${subject}=? AND r.status='approved'
           AND trim(COALESCE(r.comment,''))<>''${reviewBinding}${teacherFilter("r")}
       ) public_reviews
       ${pageSql}`,
    )
    .bind(
      id,
      ...teacherBinds,
      id,
      ...teacherBinds,
      id,
      ...teacherBinds,
      ...(query
        ? [
            ...filterBinds,
            ...(orderedCursor
              ? [
                  orderedCursor.order,
                  orderedCursor.order,
                  orderedCursor.source,
                  orderedCursor.source,
                  orderedCursor.key,
                ]
              : []),
            size + 1,
          ]
        : [cursorSource, cursorSource, cursorKey, size + 1]),
    )
    .all();
  const typedResults = results as Array<
    Record<string, unknown> & { source_order: number; sort_key: string }
  >;
  const hasMore = typedResults.length > size;
  const page = typedResults.slice(0, size);
  const last = page.at(-1);
  return {
    items: await decoratePublicReviews(
      db,
      page.map(
        ({
          source_order: _source,
          sort_key: _key,
          scheme_key: schemeKey,
          scheme_version: schemeVersion,
          scores,
          filtered_total: _filteredTotal,
          grade: rawGrade,
          blocked_at: blockedAt,
          ...review
        }) => {
          const dimensionAverage = publicDimensionAverage({
            schemeKey,
            schemeVersion,
            scores,
          });
          const dimensionLabels = publicDimensionLabels({
            schemeKey,
            schemeVersion,
            scores,
          });
          const grade = publicGrade(rawGrade);
          return {
            ...review,
            headline: publicHeadline(review.headline),
            ...(grade == null ? {} : { grade }),
            overall: publicOverall(review.overall),
            term: publicTerm(review.term),
            created_at: publicCreatedAt(review.created_at),
            ...publicAuthorFields(review),
            ...(dimensionAverage == null ? {} : { dimensionAverage }),
            ...(dimensionLabels == null ? {} : { dimensionLabels }),
            ...(includeBlocked && blockedAt ? { blocked: true } : {}),
          };
        },
      ),
      viewerUserId,
    ),
    total: orderedCursor?.total ?? Number(page[0]?.filtered_total ?? 0),
    nextCursor:
      hasMore && last
        ? encodePublicReviewCursor(
            query && order
              ? {
                  source: last.source_order,
                  key: last.sort_key,
                  order:
                    query.sort === "recognized"
                      ? Number(last.endorsement_count)
                      : query.sort === "latest"
                        ? String(last.created_at ?? "")
                        : query.sort === "oldest"
                          ? String(last.created_at ?? "9999-12-31 23:59:59")
                          : query.sort === "rating_desc"
                            ? Number(last.overall ?? -1)
                            : Number(last.overall ?? 99),
                  query: queryKey,
                  total: orderedCursor?.total ?? Number(page[0]?.filtered_total ?? 0),
                }
              : { source: last.source_order, key: last.sort_key },
          )
        : null,
  };
};
const publicReviewViewerId = async (c: AppContext) => {
  const viewer = await resolveOrdinaryUser(c);
  return viewer && isOrdinaryUserAuthenticated(viewer) ? viewer.id : null;
};
const getPublicReviewPageFor = async (
  c: AppContext,
  subject: "course_id" | "teacher_id",
  id: number | null,
  size: number,
  cursor: PublicReviewCursor | null,
  teacherId: number | null = null,
  query: PublicReviewQuery | null = null,
) =>
  getPublicReviewPage(
    c.env.DB,
    subject,
    id,
    size,
    cursor,
    await publicReviewViewerId(c),
    teacherId,
    query,
    await hasValidAdminSession(c),
  );
publicCatalogRoutes.get("/api/config", async (c) => {
  const turnstileSecret = await readSecret(c.env.TURNSTILE_SECRET);
  return c.json({
    siteName: c.env.SITE_NAME,
    universityName: c.env.UNIVERSITY_NAME,
    admin: false,
    turnstileSiteKey:
      !skipTurnstile(turnstileSecret) &&
      c.env.TURNSTILE_SITE_KEY &&
      turnstileSecret
        ? c.env.TURNSTILE_SITE_KEY
        : "",
  });
});
publicCatalogRoutes.get("/api/site/banner", async (c) =>
  c.json(await loadSiteBanner(c.env.DB)),
);
publicCatalogRoutes.get("/api/courses", async (c) => {
  await ensurePublicListPrecomputes(c.env.DB);
  if (clean(c.req.query("view"), 20) === "relations") {
    const viewerId = await publicReviewViewerId(c);
    const response = await listCourseRelations(c, viewerId);
    if (!viewerId) setPublicCatalogCacheHeaders(c);
    return response;
  }
  const { page, size } = pageArgs(c),
    search = clean(c.req.query("q"), 80),
    searchTerms = parseSearchTerms(search),
    cat = clean(c.req.query("category"), 20),
    department = clean(c.req.query("department"), 80),
    teacherId = integer(c.req.query("teacherId")),
    // 排序：默认投稿数优先（含搜索相关度），sort=name 按课名（Issue #203）。
    sort = clean(c.req.query("sort"), 20) === "name" ? "name" : "reviews";
  if (cat && !isPublicListCategoryFilter(cat))
    return fail(c, publicCategoryFilterError());
  const categoryFilter = publicCategoryFilterSql(cat, "c");
  const teacherFilter = teacherId === null ? "" : " AND ct.teacher_id=?";
  // 单个词条打预计算 match_text；ASCII 字母词条再 OR 拼音面。
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
  const countJoins =
    teacherId === null
      ? publicCourseCanonicalJoin
      : `${publicCourseCanonicalJoin} LEFT JOIN course_teachers ct ON ct.course_id=c.id`;
  const courseCount = () =>
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT c.id) n FROM courses c ${countJoins} WHERE ${where}`,
    )
      .bind(...args)
      .first<{ n: number }>()
      .then((row) => row?.n || 0);
  // 其余档位比的是整串查询（精确、再前缀），多词查询永远到不了那些档：这一档
  // 用包含匹配，让所有词条都落在课名或课号上的结果排在院系与教师命中之前。
  const allTermsInTitle =
    searchTerms.length > 1
      ? andSearchTerms(
          searchTerms,
          `${likeSql("c.name")} OR ${likeSql("c.code")}`,
        )
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
     END,review_count DESC,c.name,c.code,c.id`;
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
  const { results } = await c.env.DB.prepare(
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
    !cat || cat === "sports"
      ? await loadVirtualPeSportItems(
          c.env.DB,
          searchTerms,
          teacherId,
          department,
        )
      : [];
  const listed = pageRows.items.map(withPublicCourseCategory);
  const extras = virtualItems
    .filter((item) => !listed.some((row) => row.name === item.name))
    .map(({ rating: _rating, ...item }) => item);
  const totalCount = pageRows.total + extras.length;
  // 虚拟体育课项只落在第一页；课名排序时按同一次序并入，而不是追加在末尾。
  const byNameCodeId = (
    a: { id?: unknown; code?: unknown; name?: unknown },
    b: { id?: unknown; code?: unknown; name?: unknown },
  ) => {
    const nameA = String(a.name ?? "");
    const nameB = String(b.name ?? "");
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
    const codeA = String(a.code ?? "");
    const codeB = String(b.code ?? "");
    if (codeA !== codeB) return codeA < codeB ? -1 : 1;
    return Number(a.id ?? 0) - Number(b.id ?? 0);
  };
  const firstPage =
    sort === "name"
      ? [...listed, ...extras].sort(byNameCodeId)
      : [...listed, ...extras];
  setPublicCatalogCacheHeaders(c);
  return c.json({
    items: page === 1 ? firstPage : listed,
    page,
    pageSize: size,
    total: totalCount,
    pages: Math.ceil(totalCount / size),
  });
});
publicCatalogRoutes.get("/api/teachers", async (c) => {
  await ensurePublicListPrecomputes(c.env.DB);
  const { page, size } = pageArgs(c);
  const search = clean(c.req.query("q"), 80);
  const searchTerms = parseSearchTerms(search);
  const searchGroup = andSearchTermsWithPinyin(
    searchTerms,
    likeSql("pts.match_text"),
    likeSql("pts.pinyin_text"),
    isAsciiLetterTerm,
  );
  const where = searchGroup.sql || "1=1";
  const args = searchGroup.args;
  const teacherCount = () =>
    c.env.DB.prepare(
      `SELECT COUNT(*) n FROM teachers t ${publicTeacherSearchJoin} WHERE ${where}`,
    )
      .bind(...args)
      .first<{ n: number }>()
      .then((row) => row?.n || 0);
  const { results } = await c.env.DB.prepare(
    `SELECT t.*,
       COALESCE(public_teacher_course_counts.course_count,0) course_count,
       COALESCE(teacher_review_counts.review_count,0) review_count,
       COUNT(*) OVER() window_total
      FROM teachers t
      ${publicTeacherSearchJoin}
      LEFT JOIN public_teacher_course_counts ON public_teacher_course_counts.teacher_id=t.id
      LEFT JOIN (SELECT teacher_id,SUM(review_count) review_count FROM public_review_counts GROUP BY teacher_id) teacher_review_counts ON teacher_review_counts.teacher_id=t.id
     WHERE ${where}
     ORDER BY CASE
       WHEN ?='' THEN 0
       WHEN t.name=? THEN 0
       WHEN ${likeSql("t.name")} THEN 1
       WHEN t.department=? THEN 2
       WHEN ${likeSql("t.department")} THEN 3
       WHEN ${likeSql("pts.pinyin_text")} THEN 4
       ELSE 5
     END,review_count DESC,t.name,t.department,t.id
     LIMIT ? OFFSET ?`,
  )
    .bind(
      ...args,
      search,
      search,
      prefixPattern(search),
      search,
      prefixPattern(search),
      containsPattern(search),
      size,
      (page - 1) * size,
    )
    .all();
  const pageRows = await windowedPage(
    results as WindowedRow[],
    page,
    teacherCount,
  );
  const totalCount = pageRows.total;
  setPublicCatalogCacheHeaders(c);
  return c.json({
    items: pageRows.items.map(
      (row: { name?: string; course_count?: number }) => {
        const sport = virtualPeSportForTeacherName(
          typeof row.name === "string" ? row.name : "",
        );
        if (!sport) return row;
        return { ...row, course_count: Number(row.course_count || 0) + 1 };
      },
    ),
    page,
    pageSize: size,
    total: totalCount,
    pages: Math.ceil(totalCount / size),
  });
});
publicCatalogRoutes.get("/api/teachers/:id", async (c) => {
  await ensurePublicListPrecomputes(c.env.DB);
  const id = integer(c.req.param("id"));
  const [teacherResult, coursesResult] = await c.env.DB.batch<
    Record<string, unknown>
  >([
    c.env.DB.prepare(
      `SELECT t.*,
         COALESCE(public_teacher_course_counts.course_count,0) course_count,
         COALESCE((
           SELECT SUM(public_review_counts.review_count)
           FROM public_review_counts
           WHERE public_review_counts.teacher_id=t.id
         ),0) review_count,
         (SELECT ROUND(AVG(r.overall),1) FROM reviews r WHERE r.teacher_id=t.id AND r.status='approved'${publicReviewBinding}) rating
       FROM teachers t
       LEFT JOIN public_teacher_course_counts ON public_teacher_course_counts.teacher_id=t.id
       WHERE t.id=?`,
    ).bind(id),
    c.env.DB.prepare(
      `SELECT c.*,COALESCE(visible_counts.review_count,0) review_count,
         (SELECT ROUND(AVG(r.overall),1) FROM reviews r WHERE r.course_id=c.id AND r.teacher_id=? AND r.status='approved'${publicReviewBinding}) rating
       FROM course_teachers ct
       JOIN courses taught ON taught.id=ct.course_id
       JOIN public_course_canonicals pcc ON pcc.course_id=taught.id
       JOIN courses c ON c.id=pcc.canonical_course_id
       LEFT JOIN public_review_counts visible_counts
         ON visible_counts.course_id=c.id AND visible_counts.teacher_id=ct.teacher_id
       WHERE ct.teacher_id=? AND ${publicCourseVisibleSql("taught")} AND ${publicCourseVisibleSql("c")}
       GROUP BY c.id
       ORDER BY review_count DESC,c.name,c.id`,
    ).bind(id, id),
  ]);
  const teacher = teacherResult.results[0];
  if (!teacher) return fail(c, "教师不存在", 404);
  const reviewCount = Number(teacher.review_count) || 0;
  const reviewPage = await getPublicReviewPageFor(
    c,
    "teacher_id",
    id,
    20,
    null,
  );
  const courses = coursesResult.results;
  const publicCourses = courses.map(withPublicCourseCategory);
  const visibleSport = virtualPeSportForTeacherName(
    typeof (teacher as { name?: string }).name === "string"
      ? (teacher as { name: string }).name
      : "",
  );
  if (
    visibleSport &&
    !publicCourses.some((course) => course.name === visibleSport.label)
  ) {
    publicCourses.push(
      virtualPeSportItem(visibleSport, [
        {
          id: id as number,
          name: (teacher as { name: string }).name,
        },
      ]),
    );
    (teacher as { course_count: number }).course_count =
      Number((teacher as { course_count?: number }).course_count || 0) + 1;
  }
  return c.json({
    teacher,
    courses: publicCourses,
    reviews: reviewPage.items,
    reviewCount,
    nextReviewCursor: reviewPage.nextCursor,
  });
});
publicCatalogRoutes.get("/api/teachers/:id/reviews", async (c) => {
  const id = integer(c.req.param("id"));
  const teacher = await c.env.DB.prepare("SELECT id FROM teachers WHERE id=?")
    .bind(id)
    .first();
  if (!teacher) return fail(c, "教师不存在", 404);
  const rawCursor = c.req.query("cursor");
  const cursor = decodePublicReviewCursor(rawCursor);
  if (rawCursor && !cursor) return fail(c, "评价游标无效", 400);
  const page = await getPublicReviewPageFor(
    c,
    "teacher_id",
    id,
    publicReviewPageSize(c),
    cursor,
  );
  return c.json(page);
});
publicCatalogRoutes.get("/api/courses/options", async (c) => {
  await ensurePublicListPrecomputes(c.env.DB);
  const { page, size } = pageArgs(c);
  const search = clean(c.req.query("q"), 80);
  const searchGroup = andSearchTermsWithPinyin(
    parseSearchTerms(search),
    likeSql("pcc.match_text"),
    likeSql("pcc.pinyin_text"),
    isAsciiLetterTerm,
  );
  const where = `${publicCourseVisibleSql("c")}${searchGroup.sql ? ` AND ${searchGroup.sql}` : ""}`;
  const args = searchGroup.args;
  const optionCount = () =>
    c.env.DB.prepare(
      `SELECT COUNT(*) n FROM courses c ${publicCourseOptionJoin} WHERE ${where}`,
    )
      .bind(...args)
      .first<{ n: number }>()
      .then((row) => row?.n || 0);
  const { results } = await c.env.DB.prepare(
    `SELECT c.id,c.code,c.name,c.category,c.department,c.scheme_key,
       (SELECT GROUP_CONCAT(tag) FROM course_tags WHERE course_id=c.id) tag_csv,
       GROUP_CONCAT(DISTINCT t.name) teachers,
       COUNT(*) OVER() window_total
     FROM courses c ${publicCourseOptionJoin} LEFT JOIN course_teachers ct ON ct.course_id=c.id LEFT JOIN teachers t ON t.id=ct.teacher_id
     WHERE ${where} GROUP BY c.id ORDER BY c.name,c.id LIMIT ? OFFSET ?`,
  )
    .bind(...args, size, (page - 1) * size)
    .all();
  const pageRows = await windowedPage(
    results as WindowedRow[],
    page,
    optionCount,
  );
  const totalCount = pageRows.total;
  setPublicCatalogCacheHeaders(c);
  return c.json({
    items: pageRows.items.map((row) => withPublicCourseOption(row)),
    page,
    pageSize: size,
    total: totalCount,
    pages: Math.ceil(totalCount / size),
  });
});
// 院筛选项：公开可见课程的去重非空院系（trim 去重）；为空时前端隐藏院系筛（Issue #203）。
publicCatalogRoutes.get("/api/courses/departments", async (c) => {
  await ensurePublicListPrecomputes(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT trim(c.department) department
     FROM courses c
     ${publicCourseCanonicalJoin}
     WHERE ${publicCourseVisibleSql("c")}
       AND trim(COALESCE(c.department,''))<>''
     ORDER BY trim(c.department)`,
  ).all<{ department: string }>();
  setPublicCatalogCacheHeaders(c);
  return c.json({ items: results.map((row) => row.department) });
});
publicCatalogRoutes.get("/api/courses/:id", async (c) => {
  await ensurePublicListPrecomputes(c.env.DB);
  const id = integer(c.req.param("id"));
  const virtual = id ? virtualPeSportById(id) : null;
  if (virtual) {
    const placeholders = virtual.teacherNames.map(() => "?").join(",");
    const teachers = (
      await c.env.DB.prepare(
        `SELECT t.*,0 review_count,NULL rating FROM teachers t
         WHERE t.name IN (${placeholders}) ORDER BY t.name,t.id`,
      )
        .bind(...virtual.teacherNames)
        .all()
    ).results;
    if (!teachers.length) return fail(c, "课程不存在", 404);
    const viewerId = await publicReviewViewerId(c);
    const typedTeachers = teachers as Array<{ id: number; name: string }>;
    const signals = await loadRelationSignalPayloads(
      c.env.DB,
      typedTeachers.map((teacher) => ({
        courseId: virtual.id,
        teacherId: teacher.id,
      })),
      viewerId,
    );
    return c.json({
      course: {
        id: virtual.id,
        code: "",
        name: virtual.label,
        category: "sports",
        department: "",
        teachers: typedTeachers.map((teacher) => ({
          ...teacher,
          review_count: 0,
          rating: null,
          dimensionLabels: null,
          terms: [],
          ...(signals.get(`${virtual.id}:${teacher.id}`) ?? {
            follow_count: 0,
            recommend_count: 0,
            not_recommend_count: 0,
          }),
        })),
        nameVariants: [],
        enrollment_category: "公共必修",
        teaching_type: "实践课",
        course_level: "体育",
        ...courseSchemeView(null, "sports", []),
      },
      reviewCount: 0,
    });
  }
  const [
    courseResult,
    reviewCountResult,
    teachersResult,
    nameVariantsResult,
    tagRowsResult,
  ] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(
      `SELECT c.*,
           (SELECT ROUND(AVG(r.overall),1) FROM reviews r WHERE r.course_id=c.id AND r.status='approved'${publicReviewBinding}) rating
         FROM courses c WHERE c.id=?`,
    ).bind(id),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(review_count),0) count
         FROM public_review_counts WHERE course_id=?`,
    ).bind(id),
    c.env.DB.prepare(
      `SELECT t.*,COALESCE(visible_counts.review_count,0) review_count,
           (SELECT ROUND(AVG(r.overall),1) FROM reviews r WHERE r.course_id=? AND r.teacher_id=t.id AND r.status='approved'${publicReviewBinding}) rating
         FROM teachers t
         JOIN course_teachers ct ON ct.teacher_id=t.id
         JOIN courses taught ON taught.id=ct.course_id
         JOIN courses requested ON requested.id=?
         JOIN public_course_canonicals taught_pcc ON taught_pcc.course_id=taught.id
         JOIN public_course_canonicals requested_pcc ON requested_pcc.course_id=requested.id
         LEFT JOIN public_review_counts visible_counts
           ON visible_counts.course_id=requested.id AND visible_counts.teacher_id=t.id
         WHERE ${publicCourseVisibleSql("taught")}
           AND taught_pcc.canonical_course_id=requested_pcc.canonical_course_id
         GROUP BY t.id
         ORDER BY review_count DESC,t.name,t.id`,
    ).bind(id, id),
    c.env.DB.prepare(
      "SELECT name,created_at FROM course_name_variants WHERE course_id=? ORDER BY name",
    ).bind(id),
    c.env.DB.prepare(
      "SELECT tag FROM course_tags WHERE course_id=? ORDER BY tag",
    ).bind(id),
  ]);
  const course = courseResult.results[0];
  if (!course) return fail(c, "课程不存在", 404);
  const reviewCount = Number(reviewCountResult.results[0]?.count) || 0;
  const teachers = teachersResult.results;
  const nameVariants = nameVariantsResult.results;
  // 课程详情不再直接返回评价流：评价按 课程×教师 作用域经 /reviews?teacherId= 获取。
  // 任课关系 AI 总结（#401）按教师 ID 索引随载荷下发；空总结不下发。
  if (id == null) return fail(c, "课程不存在", 404);
  const summaries = await getCourseRelationSummaries(c.env.DB, id);
  const viewerId = await publicReviewViewerId(c);
  const typedTeachers = teachers as Array<{
    id: number;
    name: string;
    review_count?: number;
    rating?: number | null;
  }>;
  const teacherIds = typedTeachers.map((teacher) => teacher.id);
  const [dimMap, termMap, signalMap] = await Promise.all([
    loadRelationDimensionLabels(
      c.env.DB,
      teacherIds.map((teacherId) => ({ courseId: id, teacherId })),
    ),
    loadCourseRelationTerms(c.env.DB, id, teacherIds),
    loadRelationSignalPayloads(
      c.env.DB,
      teacherIds.map((teacherId) => ({ courseId: id, teacherId })),
      viewerId,
    ),
  ]);
  const tags = (tagRowsResult.results as Array<{ tag: string }>).map(
    (row) => row.tag,
  );
  const decoratedCourse = withCourseReviewScheme({
    ...course,
    tag_csv: tags.join(","),
  });
  const meta = deriveCourseCatalogMeta(course);
  return c.json({
    course: {
      ...decoratedCourse,
      ...meta,
      teachers: typedTeachers.map((teacher) => ({
        ...teacher,
        dimensionLabels:
          dimMap.get(relationDimensionKey(id, teacher.id)) ?? null,
        terms: termMap.get(teacher.id) ?? [],
        ...(signalMap.get(`${id}:${teacher.id}`) ?? {
          follow_count: 0,
          recommend_count: 0,
          not_recommend_count: 0,
        }),
      })),
      nameVariants,
    },
    reviewCount,
    summaries,
  });
});
publicCatalogRoutes.get("/api/courses/:id/reviews", async (c) => {
  const id = integer(c.req.param("id"));
  const teacherId = integer(c.req.query("teacherId"));
  const rawSort = clean(c.req.query("sort"), 20);
  const allowedSorts = new Set<PublicReviewSort>([
    "recognized",
    "latest",
    "oldest",
    "rating_desc",
    "rating_asc",
  ]);
  if (rawSort && !allowedSorts.has(rawSort as PublicReviewSort))
    return fail(c, "评价排序参数无效", 400);
  const rawRating = clean(c.req.query("rating"), 2);
  const rating = rawRating ? integer(rawRating) : null;
  if (rawRating && (rating == null || rating < 1 || rating > 5))
    return fail(c, "评价评分参数无效", 400);
  const hasReviewQuery = Boolean(
    rawSort || c.req.query("term") || c.req.query("rating"),
  );
  const reviewQuery: PublicReviewQuery | null = hasReviewQuery
    ? {
        sort: (rawSort as PublicReviewSort) || "recognized",
        term: clean(c.req.query("term"), 40),
        rating,
      }
    : null;
  if (id && isVirtualPeSportId(id)) {
    // 虚拟体育课没有课程级评价行：未选教师时返回空页，选定教师后按其教师流展示。
    if (!teacherId) return c.json({ items: [], nextCursor: null });
    const virtual = virtualPeSportById(id);
    const teacher = await c.env.DB.prepare(
      "SELECT id,name FROM teachers WHERE id=?",
    )
      .bind(teacherId)
      .first<{ id: number; name: string }>();
    if (
      !virtual ||
      !teacher ||
      !(virtual.teacherNames as readonly string[]).includes(teacher.name)
    )
      return fail(c, "课程不存在", 404);
    const rawVirtualCursor = c.req.query("cursor");
    const virtualCursor = decodePublicReviewCursor(rawVirtualCursor);
    if (rawVirtualCursor && !virtualCursor) return fail(c, "评价游标无效", 400);
    return c.json(
      await getPublicReviewPageFor(
        c,
        "teacher_id",
        teacherId,
        publicReviewPageSize(c),
        virtualCursor,
        null,
        reviewQuery,
      ),
    );
  }
  const course = await c.env.DB.prepare("SELECT id FROM courses WHERE id=?")
    .bind(id)
    .first();
  if (!course) return fail(c, "课程不存在", 404);
  const rawCursor = c.req.query("cursor");
  const cursor = decodePublicReviewCursor(rawCursor);
  if (rawCursor && !cursor) return fail(c, "评价游标无效", 400);
  const page = await getPublicReviewPageFor(
    c,
    "course_id",
    id,
    publicReviewPageSize(c),
    cursor,
    teacherId,
    reviewQuery,
  );
  return c.json(page);
});

publicCatalogRoutes.get("/api/reviews/latest", handleLatestPublicReviews);

export default publicCatalogRoutes;
