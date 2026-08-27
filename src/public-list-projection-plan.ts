import { catalogPinyinText } from "./lib/catalog-pinyin";
import {
  PE_SKILL_FAMILIES,
  publicBrowseFamilySql,
  publicCourseDisplayName,
  publicPeDisplaySearchSql,
  publicPeHasTextReviewSql,
  publicCourseVisibleSql,
} from "./lib/public-course-presentation";
import {
  guestReviewBindingSql,
  historicalPublicVisibleSql,
  legacyPublicVisibleSql,
} from "./public-review-visibility";

const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

const unnumberedPreference = PE_SKILL_FAMILIES.flatMap((family) => family.keys)
  .map(sqlLiteral)
  .join(",");
const firstNumberedPreference = PE_SKILL_FAMILIES.flatMap((family) =>
  family.keys.flatMap((key) => [`${key}1`, `${key}专项理论与实践1`]),
)
  .map(sqlLiteral)
  .join(",");

const refreshLeaseGuard = `EXISTS(
  SELECT 1 FROM public_precompute_state
  WHERE id=1
    AND dirty=1
    AND generation=?
    AND refresh_token=?
    AND refresh_lease_until>unixepoch()
)`;

const canonicalInsert = `
  WITH classified AS (
    SELECT c.id,c.name,c.code,c.department,
      (${publicBrowseFamilySql("c")}) family_label,
      CASE WHEN ${publicPeHasTextReviewSql("c")} THEN 0 ELSE 1 END has_text,
      CASE
        WHEN c.name IN (${unnumberedPreference}) THEN 0
        WHEN c.name IN (${firstNumberedPreference}) THEN 1
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
      COALESCE((${publicPeDisplaySearchSql("c")}),'') || ' ' ||
      COALESCE(fs.search_text,'') || ' ' ||
      COALESCE(tt.names,'') || ' ' ||
      COALESCE(vt.names,'')
    ),
    COALESCE(tt.delimited,'') || COALESCE(vt.delimited,'')
  FROM classified c
  LEFT JOIN ranked r ON r.id=c.id
  LEFT JOIN family_search fs ON fs.family_label=c.family_label
  LEFT JOIN teacher_text tt ON tt.course_id=c.id
  LEFT JOIN variant_text vt ON vt.course_id=c.id
  WHERE ${refreshLeaseGuard};
`;

const teacherSearchInsert = `
  INSERT INTO public_teacher_search(teacher_id,match_text)
  SELECT id, trim(COALESCE(name,'') || ' ' || COALESCE(department,''))
  FROM teachers
  WHERE ${refreshLeaseGuard};
`;

const aggregateInsert = `
  INSERT INTO public_review_counts(course_id,teacher_id,review_count)
  SELECT course_id,teacher_id,COUNT(*)
  FROM (
    SELECT r.course_id,r.teacher_id
    FROM reviews r
    WHERE r.status='approved'
      AND trim(COALESCE(r.comment,''))<>''
      ${guestReviewBindingSql}
    UNION ALL
    SELECT phr.course_id,phr.teacher_id
    FROM public_historical_reviews phr
    WHERE 1=1${historicalPublicVisibleSql("phr")}
    UNION ALL
    SELECT lr.course_id,lr.teacher_id
    FROM legacy_reviews lr
    WHERE lr.status='approved'
      AND trim(COALESCE(lr.comment,''))<>''${legacyPublicVisibleSql("lr")}
  ) visible_text_reviews
  WHERE ${refreshLeaseGuard}
  GROUP BY course_id,teacher_id;
`;

const teacherCourseCountInsert = `
  INSERT INTO public_teacher_course_counts(teacher_id,course_count)
  SELECT ct.teacher_id,COUNT(DISTINCT pcc.canonical_course_id)
  FROM course_teachers ct
  JOIN courses c ON c.id=ct.course_id
  JOIN public_course_canonicals pcc ON pcc.course_id=c.id
  WHERE ${publicCourseVisibleSql("c")}
    AND ${refreshLeaseGuard}
  GROUP BY ct.teacher_id;
`;

export const publicCourseCanonicalJoin =
  "JOIN public_course_canonicals pcc ON pcc.course_id=c.id AND pcc.canonical_course_id=c.id";

export const publicCourseMatchJoin =
  "JOIN public_course_canonicals pcc ON pcc.course_id=c.id";

// 大学英语 I–IV 各是独立公开展示课名，投稿选项与浏览共用 canonical 行。
export const publicCourseOptionJoin = publicCourseCanonicalJoin;

export const publicTeacherSearchJoin =
  "JOIN public_teacher_search pts ON pts.teacher_id=t.id";

const guardedProjectionDelete = (table: string) =>
  `DELETE FROM ${table} WHERE ${refreshLeaseGuard}`;

const PYINYIN_BATCH = 40;
const NAME_SPLIT = "\u001f";

async function refreshCatalogPinyinTexts(
  db: D1Database,
  generation: number,
  token: string,
  renewLease: () => Promise<void>,
) {
  await renewLease();
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
          `UPDATE public_course_canonicals SET pinyin_text=?
           WHERE course_id=? AND ${refreshLeaseGuard}`,
        )
        .bind(
          catalogPinyinText([
            row.name,
            row.family_label,
            publicCourseDisplayName(row.name),
            ...splitNames(row.teachers),
            ...splitNames(row.variants),
          ]),
          row.course_id,
          generation,
          token,
        ),
    ),
    ...teachers.results.map((row) =>
      db
        .prepare(
          `UPDATE public_teacher_search SET pinyin_text=?
           WHERE teacher_id=? AND ${refreshLeaseGuard}`,
        )
        .bind(
          catalogPinyinText([row.name], { surname: true }),
          row.id,
          generation,
          token,
        ),
    ),
  ];

  for (let offset = 0; offset < updates.length; offset += PYINYIN_BATCH) {
    await renewLease();
    await db.batch(updates.slice(offset, offset + PYINYIN_BATCH));
  }
}

export async function rebuildPublicListProjection({
  db,
  generation,
  token,
  renewLease,
}: {
  db: D1Database;
  generation: number;
  token: string;
  renewLease: () => Promise<void>;
}): Promise<void> {
  await db.batch([
    db
      .prepare(guardedProjectionDelete("public_course_canonicals"))
      .bind(generation, token),
    db.prepare(canonicalInsert).bind(generation, token),
    db
      .prepare(guardedProjectionDelete("public_review_counts"))
      .bind(generation, token),
    db.prepare(aggregateInsert).bind(generation, token),
    db
      .prepare(guardedProjectionDelete("public_teacher_course_counts"))
      .bind(generation, token),
    db.prepare(teacherCourseCountInsert).bind(generation, token),
    db
      .prepare(guardedProjectionDelete("public_teacher_search"))
      .bind(generation, token),
    db.prepare(teacherSearchInsert).bind(generation, token),
  ]);
  await refreshCatalogPinyinTexts(db, generation, token, renewLease);
}
