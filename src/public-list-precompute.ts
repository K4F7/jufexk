import { catalogPinyinText } from "./lib/catalog-pinyin";
import {
  PE_SKILL_FAMILIES,
  publicPeHasTextReviewSql,
  publicPeSkillFamilySql,
  publicCourseVisibleSql,
} from "./lib/public-course-presentation";

const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

const canonicalInsert = `
  WITH classified AS (
    SELECT c.id,c.name,c.code,c.department,
      (${publicPeSkillFamilySql("c")}) family_label,
      CASE WHEN ${publicPeHasTextReviewSql("c")} THEN 0 ELSE 1 END has_text,
      CASE
        WHEN c.name IN (${PE_SKILL_FAMILIES.flatMap((f) => f.keys).map(sqlLiteral).join(",")}) THEN 0
        WHEN c.name IN (${PE_SKILL_FAMILIES.flatMap((f) => f.keys.flatMap((k) => [`${k}1`, `${k}专项理论与实践1`])).map(sqlLiteral).join(",")}) THEN 1
        ELSE 2
      END preference
    FROM courses c
  ), ranked AS (
    SELECT id,family_label,
      FIRST_VALUE(id) OVER (
        PARTITION BY family_label
        ORDER BY has_text,preference,id
      ) canonical_id
    FROM classified
    WHERE family_label IS NOT NULL
  ), family_search AS (
    SELECT family_label,
      GROUP_CONCAT(COALESCE(name,'') || ' ' || COALESCE(code,''),' ') search_text
    FROM classified
    WHERE family_label IS NOT NULL
    GROUP BY family_label
  ), teacher_text AS (
    SELECT ct.course_id,
      GROUP_CONCAT(COALESCE(t.name,''), ' ') names,
      GROUP_CONCAT(char(31) || t.name || char(31), '') delimited
    FROM course_teachers ct
    JOIN teachers t ON t.id=ct.teacher_id
    GROUP BY ct.course_id
  ), variant_text AS (
    SELECT course_id,
      GROUP_CONCAT(COALESCE(name,''), ' ') names,
      GROUP_CONCAT(char(31) || name || char(31), '') delimited
    FROM course_name_variants
    GROUP BY course_id
  )
  INSERT INTO public_course_canonicals(
    course_id,canonical_course_id,family_label,search_text,match_text,teacher_variant_text
  )
  SELECT c.id,COALESCE(r.canonical_id,c.id),c.family_label,
    COALESCE(fs.search_text,COALESCE(c.name,'') || ' ' || COALESCE(c.code,'')),
    trim(
      COALESCE(c.name,'') || ' ' ||
      COALESCE(c.code,'') || ' ' ||
      COALESCE(c.department,'') || ' ' ||
      COALESCE(c.family_label,'') || ' ' ||
      COALESCE(fs.search_text,'') || ' ' ||
      COALESCE(tt.names,'') || ' ' ||
      COALESCE(vt.names,'')
    ),
    COALESCE(tt.delimited,'') || COALESCE(vt.delimited,'')
  FROM classified c
  LEFT JOIN ranked r ON r.id=c.id
  LEFT JOIN family_search fs ON fs.family_label=c.family_label
  LEFT JOIN teacher_text tt ON tt.course_id=c.id
  LEFT JOIN variant_text vt ON vt.course_id=c.id;
`;

const teacherSearchInsert = `
  INSERT INTO public_teacher_search(teacher_id,match_text)
  SELECT id, trim(COALESCE(name,'') || ' ' || COALESCE(department,''))
  FROM teachers;
`;

const aggregateInsert = `
  INSERT INTO public_review_counts(course_id,teacher_id,review_count)
  SELECT course_id,teacher_id,COUNT(*)
  FROM (
    SELECT r.course_id,r.teacher_id
    FROM reviews r
    WHERE r.status='approved'
      AND trim(COALESCE(r.comment,''))<>''
      AND EXISTS(
        SELECT 1 FROM course_teachers public_relation
        WHERE public_relation.course_id=r.course_id
          AND public_relation.teacher_id=r.teacher_id
      )
      AND (
        r.offering_id IS NULL OR EXISTS(
          SELECT 1
          FROM offerings public_offering
          JOIN offering_teachers public_offering_teacher
            ON public_offering_teacher.offering_id=public_offering.id
           AND public_offering_teacher.teacher_id=r.teacher_id
          WHERE public_offering.id=r.offering_id
            AND public_offering.course_id=r.course_id
        )
      )
    UNION ALL
    SELECT phr.course_id,phr.teacher_id
    FROM public_historical_reviews phr
    UNION ALL
    SELECT lr.course_id,lr.teacher_id
    FROM legacy_reviews lr
    WHERE lr.status='approved'
      AND trim(COALESCE(lr.comment,''))<>''
  ) visible_text_reviews
  GROUP BY course_id,teacher_id;
`;

const teacherCourseCountInsert = `
  INSERT INTO public_teacher_course_counts(teacher_id,course_count)
  SELECT ct.teacher_id,COUNT(DISTINCT pcc.canonical_course_id)
  FROM course_teachers ct
  JOIN courses c ON c.id=ct.course_id
  JOIN public_course_canonicals pcc ON pcc.course_id=c.id
  WHERE ${publicCourseVisibleSql("c")}
  GROUP BY ct.teacher_id;
`;

export const publicCourseCanonicalJoin =
  "JOIN public_course_canonicals pcc ON pcc.course_id=c.id AND pcc.canonical_course_id=c.id";

export const publicCourseMatchJoin =
  "JOIN public_course_canonicals pcc ON pcc.course_id=c.id";

export const publicTeacherSearchJoin =
  "JOIN public_teacher_search pts ON pts.teacher_id=t.id";

const publicListMutationRoutes: ReadonlyArray<readonly [string, RegExp]> = [
  ["POST", /^\/api\/admin\/catalog-relation-additions$/],
  ["POST", /^\/api\/admin\/import\/relations$/],
  ["POST", /^\/api\/admin\/historical-review-batch-imports$/],
  ["POST", /^\/api\/admin\/historical-review-v5-imports$/],
  ["POST", /^\/api\/admin\/historical-review-imports$/],
  ["POST", /^\/api\/admin\/offerings$/],
  ["DELETE", /^\/api\/admin\/offerings\/[^/]+$/],
  ["POST", /^\/api\/admin\/courses$/],
  ["DELETE", /^\/api\/admin\/courses\/[^/]+$/],
  ["POST", /^\/api\/admin\/teachers$/],
  ["DELETE", /^\/api\/admin\/teachers\/[^/]+$/],
  ["PUT", /^\/api\/admin\/courses\/[^/]+\/teachers$/],
  ["POST", /^\/api\/admin\/catalog-baseline\/uploads\/[^/]+\/publish$/],
];

export function shouldRefreshPublicListPrecomputes(method: string, path: string) {
  const normalizedMethod = method.toUpperCase();
  return publicListMutationRoutes.some(
    ([routeMethod, routePath]) =>
      normalizedMethod === routeMethod && routePath.test(path),
  );
}

export async function refreshPublicListPrecomputes(db: D1Database) {
  const fingerprint = await publicListSourceFingerprint(db);
  await db.batch([
    db.prepare("DELETE FROM public_course_canonicals"),
    db.prepare(canonicalInsert),
    db.prepare("DELETE FROM public_review_counts"),
    db.prepare(aggregateInsert),
    db.prepare("DELETE FROM public_teacher_course_counts"),
    db.prepare(teacherCourseCountInsert),
    db.prepare("DELETE FROM public_teacher_search"),
    db.prepare(teacherSearchInsert),
    db.prepare("UPDATE public_precompute_state SET dirty=0,fingerprint=? WHERE id=1").bind(fingerprint),
  ]);
  await refreshCatalogPinyinTexts(db);
}

const PYINYIN_BATCH = 40;
const NAME_SPLIT = "\u001f";

async function refreshCatalogPinyinTexts(db: D1Database) {
  const courses = await db
    .prepare(
      `SELECT pcc.course_id,
        COALESCE(c.name,'') name,
        COALESCE(pcc.family_label,'') family_label,
        COALESCE((
          SELECT GROUP_CONCAT(t.name, '${NAME_SPLIT}')
          FROM course_teachers ct JOIN teachers t ON t.id=ct.teacher_id
          WHERE ct.course_id=c.id
        ),'') teachers,
        COALESCE((
          SELECT GROUP_CONCAT(cnv.name, '${NAME_SPLIT}')
          FROM course_name_variants cnv
          WHERE cnv.course_id=c.id
        ),'') variants
       FROM public_course_canonicals pcc
       JOIN courses c ON c.id=pcc.course_id`,
    )
    .all<{
      course_id: number;
      name: string;
      family_label: string;
      teachers: string;
      variants: string;
    }>();
  const teachers = await db
    .prepare("SELECT id,name FROM teachers")
    .all<{ id: number; name: string }>();

  const splitNames = (value: string) =>
    value.split(NAME_SPLIT).map((part) => part.trim()).filter(Boolean);

  const updates = [
    ...courses.results.map((row) =>
      db
        .prepare(
          "UPDATE public_course_canonicals SET pinyin_text=? WHERE course_id=?",
        )
        .bind(
          catalogPinyinText([
            row.name,
            row.family_label,
            ...splitNames(row.teachers),
            ...splitNames(row.variants),
          ]),
          row.course_id,
        ),
    ),
    ...teachers.results.map((row) =>
      db
        .prepare("UPDATE public_teacher_search SET pinyin_text=? WHERE teacher_id=?")
        .bind(catalogPinyinText([row.name], { surname: true }), row.id),
    ),
  ];

  for (let offset = 0; offset < updates.length; offset += PYINYIN_BATCH) {
    await db.batch(updates.slice(offset, offset + PYINYIN_BATCH));
  }
}

async function publicListSourceFingerprint(db: D1Database) {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) || ':' || COALESCE(MAX(id),0) || ':' || COALESCE(SUM(length(name)+length(COALESCE(code,''))+length(COALESCE(department,''))),0) FROM courses) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(SUM(length(name)),0) FROM course_name_variants) || '|' ||
      (SELECT COUNT(*) FROM course_teachers) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(MAX(id),0) || ':' || COALESCE(SUM(length(name)+length(COALESCE(department,''))),0) FROM teachers) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(MAX(id),0) FROM reviews) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(MAX(id),0) FROM legacy_reviews) || '|' ||
      (SELECT COUNT(*) || ':' || COALESCE(MAX(id),0) FROM public_historical_reviews) fingerprint
  `).first<{ fingerprint: string }>();
  return row?.fingerprint || "";
}

export async function ensurePublicListPrecomputes(db: D1Database) {
  const state = await db
    .prepare("SELECT dirty,fingerprint FROM public_precompute_state WHERE id=1")
    .first<{ dirty: number; fingerprint: string }>();
  if (!state) return refreshPublicListPrecomputes(db);
  const fingerprint = await publicListSourceFingerprint(db);
  if (state.dirty || state.fingerprint !== fingerprint)
    await refreshPublicListPrecomputes(db);
}
