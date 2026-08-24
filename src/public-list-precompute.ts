import { catalogPinyinText } from "./lib/catalog-pinyin";
import {
  ENGLISH_FIRST_LEVEL_NAMES,
  ENGLISH_PUBLIC_LABEL,
  PE_SKILL_FAMILIES,
  publicBrowseFamilySql,
  publicPeHasTextReviewSql,
  publicCourseVisibleSql,
} from "./lib/public-course-presentation";

const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

const unnumberedPreference = [
  ...PE_SKILL_FAMILIES.flatMap((family) => family.keys),
  ENGLISH_PUBLIC_LABEL,
]
  .map(sqlLiteral)
  .join(",");
const firstNumberedPreference = [
  ...PE_SKILL_FAMILIES.flatMap((family) =>
    family.keys.flatMap((key) => [`${key}1`, `${key}专项理论与实践1`]),
  ),
  ...ENGLISH_FIRST_LEVEL_NAMES,
]
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
      AND r.blocked_at IS NULL
      AND r.deleted_at IS NULL
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

// 投稿选项保留大学英语 I-IV 的教务课名；其余公开族只保留 canonical 行。
export const publicCourseOptionJoin = `JOIN public_course_canonicals pcc
  ON pcc.course_id=c.id
 AND (pcc.canonical_course_id=c.id OR pcc.family_label=${sqlLiteral(ENGLISH_PUBLIC_LABEL)})`;

export const publicTeacherSearchJoin =
  "JOIN public_teacher_search pts ON pts.teacher_id=t.id";

const publicListMutationRoutes: ReadonlyArray<readonly [string, RegExp]> = [
  ["POST", /^\/api\/admin\/catalog-relation-additions$/],
  ["POST", /^\/api\/admin\/import\/relations$/],
  ["POST", /^\/api\/admin\/import\/course-plan-attributes$/],
  ["POST", /^\/api\/admin\/historical-review-v5-imports$/],
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

const REFRESH_ATTEMPTS = 2;
const REFRESH_ACQUIRE_ATTEMPTS = 5;
const REFRESH_LEASE_SECONDS = 60;
const REFRESH_LEASE_POLL_MS = 100;
const publicPrecomputeRefreshes = new WeakMap<D1Database, Promise<void>>();

class PublicPrecomputeLeaseLostError extends Error {}

type PublicPrecomputeState = {
  dirty: number;
  generation: number;
  refresh_token: string | null;
  refresh_lease_until: number | null;
};

const publicPrecomputeState = (db: D1Database) =>
  db
    .prepare(
      `SELECT dirty,generation,refresh_token,refresh_lease_until
       FROM public_precompute_state WHERE id=1`,
    )
    .first<PublicPrecomputeState>();

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitForPublicPrecomputeLease(db: D1Database) {
  while (true) {
    const state = await publicPrecomputeState(db);
    if (!state?.dirty) return "clean" as const;
    if (
      !state.refresh_token ||
      (state.refresh_lease_until ?? 0) <= Math.floor(Date.now() / 1000)
    )
      return "retry" as const;
    await pause(REFRESH_LEASE_POLL_MS);
  }
}

async function renewPublicPrecomputeLease(
  db: D1Database,
  generation: number,
  token: string,
) {
  const renewed = await db
    .prepare(
      `UPDATE public_precompute_state
       SET refresh_lease_until=unixepoch()+?
       WHERE id=1
         AND dirty=1
         AND generation=?
         AND refresh_token=?
         AND refresh_lease_until>unixepoch()
       RETURNING id`,
    )
    .bind(REFRESH_LEASE_SECONDS, generation, token)
    .run();
  if (!renewed.results.length)
    throw new PublicPrecomputeLeaseLostError("公开目录预计算刷新租约已失效");
}

const guardedProjectionDelete = (table: string) =>
  `DELETE FROM ${table} WHERE ${refreshLeaseGuard}`;

async function acquirePublicPrecomputeLease(db: D1Database) {
  for (let attempt = 0; attempt < REFRESH_ACQUIRE_ATTEMPTS; attempt += 1) {
    const token = crypto.randomUUID();
    const acquired = await db
      .prepare(
        `UPDATE public_precompute_state
         SET refresh_token=?,refresh_lease_until=unixepoch()+?
         WHERE id=1
           AND dirty=1
           AND (
             refresh_token IS NULL OR
             refresh_lease_until IS NULL OR
             refresh_lease_until<=unixepoch()
           )
         RETURNING generation`,
      )
      .bind(token, REFRESH_LEASE_SECONDS)
      .run<{ generation: number }>();
    const lease = acquired.results[0];
    if (lease)
      return { generation: Number(lease.generation) || 0, token } as const;

    const outcome = await waitForPublicPrecomputeLease(db);
    if (outcome === "clean") return null;
  }
  throw new Error("公开目录预计算刷新租约获取失败");
}

async function refreshPublicListPrecomputesAttempt(
  db: D1Database,
  attempt: number,
): Promise<void> {
  let state = await publicPrecomputeState(db);
  if (!state) {
    await db
      .prepare(
        `INSERT INTO public_precompute_state(id,dirty,generation)
         VALUES(1,1,0) ON CONFLICT(id) DO NOTHING`,
      )
      .run();
    state = await publicPrecomputeState(db);
  }
  if (!state?.dirty) return;

  const lease = await acquirePublicPrecomputeLease(db);
  if (!lease) return;
  const { generation, token } = lease;
  try {
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
    await refreshCatalogPinyinTexts(db, generation, token);
    const published = await db
      .prepare(
        `UPDATE public_precompute_state
         SET dirty=0,refresh_token=NULL,refresh_lease_until=NULL
         WHERE id=1
           AND dirty=1
           AND generation=?
           AND refresh_token=?
           AND refresh_lease_until>unixepoch()
         RETURNING id`,
      )
      .bind(generation, token)
      .run();
    if (published.results.length) return;

    const current = await publicPrecomputeState(db);
    if (!current?.dirty) return;
    if (current.refresh_token && current.refresh_token !== token) {
      const outcome = await waitForPublicPrecomputeLease(db);
      if (outcome === "clean") return;
    }
    if (attempt + 1 >= REFRESH_ATTEMPTS)
      throw new Error("公开目录源数据在刷新期间持续变化或刷新租约失效");
    return refreshPublicListPrecomputesAttempt(db, attempt + 1);
  } catch (error) {
    try {
      await db
        .prepare(
          `UPDATE public_precompute_state
           SET dirty=1,refresh_token=NULL,refresh_lease_until=NULL
           WHERE id=1 AND generation=? AND refresh_token=?`,
        )
        .bind(generation, token)
        .run();
    } catch {
      // Preserve the refresh failure; a later dirty read will retry the rebuild.
    }
    if (error instanceof PublicPrecomputeLeaseLostError) {
      const current = await publicPrecomputeState(db);
      if (!current?.dirty) return;
      if (current.refresh_token && current.refresh_token !== token) {
        const outcome = await waitForPublicPrecomputeLease(db);
        if (outcome === "clean") return;
      }
      if (attempt + 1 < REFRESH_ATTEMPTS)
        return refreshPublicListPrecomputesAttempt(db, attempt + 1);
    }
    throw error;
  }
}

export async function refreshPublicListPrecomputes(db: D1Database) {
  const existing = publicPrecomputeRefreshes.get(db);
  if (existing) return existing;

  const refresh = refreshPublicListPrecomputesAttempt(db, 0);
  publicPrecomputeRefreshes.set(db, refresh);
  try {
    await refresh;
  } finally {
    if (publicPrecomputeRefreshes.get(db) === refresh)
      publicPrecomputeRefreshes.delete(db);
  }
}

const PYINYIN_BATCH = 40;
const NAME_SPLIT = "\u001f";

async function refreshCatalogPinyinTexts(
  db: D1Database,
  generation: number,
  token: string,
) {
  await renewPublicPrecomputeLease(db, generation, token);
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
           WHERE course_id=? AND EXISTS(
             SELECT 1 FROM public_precompute_state
             WHERE id=1
               AND dirty=1
               AND generation=?
               AND refresh_token=?
               AND refresh_lease_until>unixepoch()
           )`,
        )
        .bind(
          catalogPinyinText([
            row.name,
            row.family_label,
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
           WHERE teacher_id=? AND EXISTS(
             SELECT 1 FROM public_precompute_state
             WHERE id=1
               AND dirty=1
               AND generation=?
               AND refresh_token=?
               AND refresh_lease_until>unixepoch()
           )`,
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
    await renewPublicPrecomputeLease(db, generation, token);
    await db.batch(updates.slice(offset, offset + PYINYIN_BATCH));
  }
}

export async function ensurePublicListPrecomputes(db: D1Database) {
  const state = await db
    .prepare("SELECT dirty FROM public_precompute_state WHERE id=1")
    .first<{ dirty: number }>();
  if (!state) return refreshPublicListPrecomputes(db);
  if (state.dirty) await refreshPublicListPrecomputes(db);
}
