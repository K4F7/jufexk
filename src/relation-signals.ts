import type { Context } from "hono";
import {
  isVirtualPeSportId,
  virtualPeSportById,
} from "./lib/public-course-presentation";
import { requireOrdinaryWriteUser } from "./ordinary-user-session";

const fail = (
  c: Context,
  error: string,
  status: 400 | 401 | 403 | 404 | 409 = 400,
) => c.json({ error }, status);

const digest = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const FOLLOW_CREATE = "relation.follow.create";
export const FOLLOW_WITHDRAW = "relation.follow.withdraw";
export const RECOMMEND_CREATE = "relation.recommend.create";
export const RECOMMEND_WITHDRAW = "relation.recommend.withdraw";
export const NOT_RECOMMEND_CREATE = "relation.not_recommend.create";
export const NOT_RECOMMEND_WITHDRAW = "relation.not_recommend.withdraw";

export type RelationSignalKind = "follow" | "recommend" | "not_recommend";
export type RelationSignalState = {
  followCount: number;
  recommendCount: number;
  notRecommendCount: number;
  viewerFollowed: boolean;
  viewerRecommended: boolean;
  viewerNotRecommended: boolean;
};

export type RelationSignalCounts = {
  follow_count: number;
  recommend_count: number;
  not_recommend_count: number;
};

export type RelationSignalViewer = {
  viewer_followed: boolean;
  viewer_recommended: boolean;
  viewer_not_recommended: boolean;
};

type RelationKey = { courseId: number; teacherId: number };

function parsePositiveId(raw: string | undefined) {
  const value = (raw || "").trim();
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function parseIdempotencyKey(raw: string | undefined) {
  const key = (raw || "").trim();
  return key.length >= 8 && key.length <= 128 ? key : null;
}

async function requireWriteUser(c: Context, action: string) {
  return requireOrdinaryWriteUser(
    c,
    `请先登录后再${action}`,
    `当前账号无法${action}`,
  );
}

async function readIdempotency(
  db: D1Database,
  userId: string,
  operation: string,
  key: string,
) {
  return db
    .prepare(
      `SELECT request_digest,status,response_json
       FROM write_idempotency
       WHERE user_id=? AND operation=? AND idempotency_key=?`,
    )
    .bind(userId, operation, key)
    .first<{ request_digest: string; status: number; response_json: string }>();
}

async function saveIdempotency(
  db: D1Database,
  userId: string,
  operation: string,
  key: string,
  requestDigest: string,
  status: number,
  body: unknown,
) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO write_idempotency(
         user_id,operation,idempotency_key,request_digest,status,response_json
       ) VALUES(?,?,?,?,?,?)`,
    )
    .bind(userId, operation, key, requestDigest, status, JSON.stringify(body))
    .run();
  return readIdempotency(db, userId, operation, key);
}

async function loadEligibleRelation(
  db: D1Database,
  courseId: number,
  teacherId: number,
): Promise<RelationKey | null> {
  if (isVirtualPeSportId(courseId)) {
    const virtual = virtualPeSportById(courseId);
    const teacher = await db
      .prepare("SELECT id,name FROM teachers WHERE id=?")
      .bind(teacherId)
      .first<{ id: number; name: string }>();
    if (
      !virtual ||
      !teacher ||
      !(virtual.teacherNames as readonly string[]).includes(teacher.name)
    )
      return null;
    return { courseId, teacherId };
  }
  const row = await db
    .prepare(
      `SELECT ct.course_id,ct.teacher_id
       FROM course_teachers ct
       JOIN courses c ON c.id=ct.course_id
       JOIN teachers t ON t.id=ct.teacher_id
       WHERE ct.course_id=? AND ct.teacher_id=?`,
    )
    .bind(courseId, teacherId)
    .first<{ course_id: number; teacher_id: number }>();
  return row ? { courseId: row.course_id, teacherId: row.teacher_id } : null;
}

export async function loadRelationSignalState(
  db: D1Database,
  courseId: number,
  teacherId: number,
  viewerUserId: string | null,
): Promise<RelationSignalState> {
  const followRow = await db
    .prepare(
      "SELECT COUNT(*) count FROM relation_follows WHERE course_id=? AND teacher_id=?",
    )
    .bind(courseId, teacherId)
    .first<{ count: number }>();
  const recommendRow = await db
    .prepare(
      `SELECT COUNT(*) count FROM relation_recommendations
       WHERE course_id=? AND teacher_id=? AND stance='recommend'`,
    )
    .bind(courseId, teacherId)
    .first<{ count: number }>();
  const notRecommendRow = await db
    .prepare(
      `SELECT COUNT(*) count FROM relation_recommendations
       WHERE course_id=? AND teacher_id=? AND stance='not_recommend'`,
    )
    .bind(courseId, teacherId)
    .first<{ count: number }>();
  const viewerRow = viewerUserId
    ? await db
        .prepare(
          `SELECT
             EXISTS(
               SELECT 1 FROM relation_follows
               WHERE user_id=? AND course_id=? AND teacher_id=?
             ) followed,
             COALESCE((
               SELECT stance FROM relation_recommendations
               WHERE user_id=? AND course_id=? AND teacher_id=?
             ),'') stance`,
        )
        .bind(
          viewerUserId,
          courseId,
          teacherId,
          viewerUserId,
          courseId,
          teacherId,
        )
        .first<{ followed: number; stance: string }>()
    : null;
  const stance = viewerRow?.stance || "";
  return {
    followCount: Number(followRow?.count) || 0,
    recommendCount: Number(recommendRow?.count) || 0,
    notRecommendCount: Number(notRecommendRow?.count) || 0,
    viewerFollowed: !!viewerRow?.followed,
    viewerRecommended: stance === "recommend",
    viewerNotRecommended: stance === "not_recommend",
  };
}

export function relationSignalCounts(
  state: Pick<
    RelationSignalState,
    "followCount" | "recommendCount" | "notRecommendCount"
  >,
): RelationSignalCounts {
  return {
    follow_count: state.followCount,
    recommend_count: state.recommendCount,
    not_recommend_count: state.notRecommendCount,
  };
}

export function relationSignalViewer(
  state: RelationSignalState,
): RelationSignalViewer {
  return {
    viewer_followed: state.viewerFollowed,
    viewer_recommended: state.viewerRecommended,
    viewer_not_recommended: state.viewerNotRecommended,
  };
}

export async function loadRelationSignalPayloads(
  db: D1Database,
  relations: RelationKey[],
  viewerUserId: string | null,
): Promise<Map<string, RelationSignalCounts & Partial<RelationSignalViewer>>> {
  const map = new Map<
    string,
    RelationSignalCounts & Partial<RelationSignalViewer>
  >();
  if (!relations.length) return map;
  const keyOf = (courseId: number, teacherId: number) =>
    `${courseId}:${teacherId}`;
  for (const relation of relations) {
    map.set(keyOf(relation.courseId, relation.teacherId), {
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
    });
  }
  const courseIds = [...new Set(relations.map((item) => item.courseId))];
  const teacherIds = [...new Set(relations.map((item) => item.teacherId))];
  const coursePlaceholders = courseIds.map(() => "?").join(",");
  const teacherPlaceholders = teacherIds.map(() => "?").join(",");
  const allowed = new Set(relations.map((item) => keyOf(item.courseId, item.teacherId)));
  const [follows, stances, viewerFollows, viewerStances] = await db.batch([
    db
      .prepare(
        `SELECT course_id,teacher_id,COUNT(*) count
         FROM relation_follows
         WHERE course_id IN (${coursePlaceholders})
           AND teacher_id IN (${teacherPlaceholders})
         GROUP BY course_id,teacher_id`,
      )
      .bind(...courseIds, ...teacherIds),
    db
      .prepare(
        `SELECT course_id,teacher_id,stance,COUNT(*) count
         FROM relation_recommendations
         WHERE course_id IN (${coursePlaceholders})
           AND teacher_id IN (${teacherPlaceholders})
         GROUP BY course_id,teacher_id,stance`,
      )
      .bind(...courseIds, ...teacherIds),
    viewerUserId
      ? db
          .prepare(
            `SELECT course_id,teacher_id
             FROM relation_follows
             WHERE user_id=?
               AND course_id IN (${coursePlaceholders})
               AND teacher_id IN (${teacherPlaceholders})`,
          )
          .bind(viewerUserId, ...courseIds, ...teacherIds)
      : db.prepare("SELECT 0 course_id,0 teacher_id WHERE 0"),
    viewerUserId
      ? db
          .prepare(
            `SELECT course_id,teacher_id,stance
             FROM relation_recommendations
             WHERE user_id=?
               AND course_id IN (${coursePlaceholders})
               AND teacher_id IN (${teacherPlaceholders})`,
          )
          .bind(viewerUserId, ...courseIds, ...teacherIds)
      : db.prepare("SELECT 0 course_id,0 teacher_id,'' stance WHERE 0"),
  ]);
  for (const row of follows.results as Array<{
    course_id: number;
    teacher_id: number;
    count: number;
  }>) {
    const key = keyOf(row.course_id, row.teacher_id);
    if (!allowed.has(key)) continue;
    const current = map.get(key);
    if (current) current.follow_count = Number(row.count) || 0;
  }
  for (const row of stances.results as Array<{
    course_id: number;
    teacher_id: number;
    stance: string;
    count: number;
  }>) {
    const key = keyOf(row.course_id, row.teacher_id);
    if (!allowed.has(key)) continue;
    const current = map.get(key);
    if (!current) continue;
    if (row.stance === "recommend")
      current.recommend_count = Number(row.count) || 0;
    if (row.stance === "not_recommend")
      current.not_recommend_count = Number(row.count) || 0;
  }
  if (viewerUserId) {
    for (const row of viewerFollows.results as Array<{
      course_id: number;
      teacher_id: number;
    }>) {
      const current = map.get(keyOf(row.course_id, row.teacher_id));
      if (current) current.viewer_followed = true;
    }
    for (const row of viewerStances.results as Array<{
      course_id: number;
      teacher_id: number;
      stance: string;
    }>) {
      const current = map.get(keyOf(row.course_id, row.teacher_id));
      if (!current) continue;
      current.viewer_recommended = row.stance === "recommend";
      current.viewer_not_recommended = row.stance === "not_recommend";
    }
  }
  return map;
}

async function mutateSignal(
  c: Context,
  kind: RelationSignalKind,
  operation: string,
  apply: (db: D1Database, userId: string, relation: RelationKey) => Promise<void>,
) {
  const action =
    kind === "follow" ? "关注" : kind === "recommend" ? "推荐" : "不推荐";
  const auth = await requireWriteUser(c, action);
  if ("error" in auth) return auth.error;
  const courseId = parsePositiveId(c.req.param("id"));
  const teacherId = parsePositiveId(c.req.param("teacherId"));
  if (!courseId || !teacherId) return fail(c, "任课关系不存在", 404);
  const idempotencyKey = parseIdempotencyKey(c.req.header("Idempotency-Key"));
  if (!idempotencyKey) return fail(c, "缺少有效的幂等键", 400);
  const requestDigest = await digest(
    JSON.stringify({ operation, courseId, teacherId }),
  );
  const replay = await readIdempotency(
    c.env.DB,
    auth.user.id,
    operation,
    idempotencyKey,
  );
  if (replay) {
    if (replay.request_digest !== requestDigest)
      return fail(c, "幂等键与请求不匹配", 409);
    return c.json(JSON.parse(replay.response_json));
  }
  const relation = await loadEligibleRelation(c.env.DB, courseId, teacherId);
  if (!relation) return fail(c, "任课关系不存在", 404);
  await apply(c.env.DB, auth.user.id, relation);
  const body = await loadRelationSignalState(
    c.env.DB,
    relation.courseId,
    relation.teacherId,
    auth.user.id,
  );
  const stored = await saveIdempotency(
    c.env.DB,
    auth.user.id,
    operation,
    idempotencyKey,
    requestDigest,
    200,
    body,
  );
  if (stored && stored.request_digest !== requestDigest)
    return fail(c, "幂等键与请求不匹配", 409);
  return c.json(stored ? JSON.parse(stored.response_json) : body);
}

export const handleCreateFollow = (c: Context) =>
  mutateSignal(c, "follow", FOLLOW_CREATE, async (db, userId, relation) => {
    await db
      .prepare(
        "INSERT OR IGNORE INTO relation_follows(user_id,course_id,teacher_id) VALUES(?,?,?)",
      )
      .bind(userId, relation.courseId, relation.teacherId)
      .run();
  });

export const handleWithdrawFollow = (c: Context) =>
  mutateSignal(c, "follow", FOLLOW_WITHDRAW, async (db, userId, relation) => {
    await db
      .prepare(
        "DELETE FROM relation_follows WHERE user_id=? AND course_id=? AND teacher_id=?",
      )
      .bind(userId, relation.courseId, relation.teacherId)
      .run();
  });

export const handleCreateRecommend = (c: Context) =>
  mutateSignal(c, "recommend", RECOMMEND_CREATE, async (db, userId, relation) => {
    await db
      .prepare(
        `INSERT INTO relation_recommendations(user_id,course_id,teacher_id,stance)
         VALUES(?,?,?,'recommend')
         ON CONFLICT(user_id,course_id,teacher_id) DO UPDATE SET
           stance='recommend',
           created_at=CASE
             WHEN relation_recommendations.stance='recommend'
             THEN relation_recommendations.created_at
             ELSE CURRENT_TIMESTAMP
           END`,
      )
      .bind(userId, relation.courseId, relation.teacherId)
      .run();
  });

export const handleWithdrawRecommend = (c: Context) =>
  mutateSignal(
    c,
    "recommend",
    RECOMMEND_WITHDRAW,
    async (db, userId, relation) => {
      await db
        .prepare(
          `DELETE FROM relation_recommendations
           WHERE user_id=? AND course_id=? AND teacher_id=? AND stance='recommend'`,
        )
        .bind(userId, relation.courseId, relation.teacherId)
        .run();
    },
  );

export const handleCreateNotRecommend = (c: Context) =>
  mutateSignal(
    c,
    "not_recommend",
    NOT_RECOMMEND_CREATE,
    async (db, userId, relation) => {
      await db
        .prepare(
          `INSERT INTO relation_recommendations(user_id,course_id,teacher_id,stance)
           VALUES(?,?,?,'not_recommend')
           ON CONFLICT(user_id,course_id,teacher_id) DO UPDATE SET
             stance='not_recommend',
             created_at=CASE
               WHEN relation_recommendations.stance='not_recommend'
               THEN relation_recommendations.created_at
               ELSE CURRENT_TIMESTAMP
             END`,
        )
        .bind(userId, relation.courseId, relation.teacherId)
        .run();
    },
  );

export const handleWithdrawNotRecommend = (c: Context) =>
  mutateSignal(
    c,
    "not_recommend",
    NOT_RECOMMEND_WITHDRAW,
    async (db, userId, relation) => {
      await db
        .prepare(
          `DELETE FROM relation_recommendations
           WHERE user_id=? AND course_id=? AND teacher_id=? AND stance='not_recommend'`,
        )
        .bind(userId, relation.courseId, relation.teacherId)
        .run();
    },
  );
