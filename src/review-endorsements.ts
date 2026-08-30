import type { Context } from "hono";
import {
  isEndorsablePublicId,
  parseCurrentReviewId,
  parsePublicReviewTarget,
  type PublicReviewTarget,
} from "./lib/public-review-id";
import { requireVoteActor } from "./review-vote-actor";
import { takeRateLimit } from "./routes/support";

export { isEndorsablePublicId, parseCurrentReviewId };

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

export const CREATE_OPERATION = "endorsement.create";
export const WITHDRAW_OPERATION = "endorsement.withdraw";
export const CHALLENGE_CREATE_OPERATION = "challenge.create";
export const CHALLENGE_WITHDRAW_OPERATION = "challenge.withdraw";

async function loadEligibleTarget(db: D1Database, target: PublicReviewTarget) {
  if (target.kind === "review") {
    return db
      .prepare(
        `SELECT r.id
         FROM reviews r
         WHERE r.id=?
           AND r.status='approved'
           AND r.blocked_at IS NULL
           AND r.deleted_at IS NULL
           AND trim(COALESCE(r.comment,''))<>''
           AND EXISTS(
             SELECT 1 FROM course_teachers relation
             WHERE relation.course_id=r.course_id
               AND relation.teacher_id=r.teacher_id
           )`,
      )
      .bind(target.id)
      .first();
  }
  if (target.kind === "historical") {
    return db
      .prepare(
        `SELECT id FROM public_historical_reviews
         WHERE id=? AND blocked_at IS NULL AND deleted_at IS NULL`,
      )
      .bind(target.id)
      .first();
  }
  return db
    .prepare(
      `SELECT id FROM legacy_reviews
       WHERE id=? AND status='approved'
         AND trim(COALESCE(comment,''))<>''
         AND blocked_at IS NULL AND deleted_at IS NULL`,
    )
    .bind(target.id)
    .first();
}

async function targetExists(db: D1Database, target: PublicReviewTarget) {
  if (target.kind === "review") {
    return db
      .prepare("SELECT id FROM reviews WHERE id=?")
      .bind(target.id)
      .first();
  }
  if (target.kind === "historical") {
    return db
      .prepare("SELECT id FROM public_historical_reviews WHERE id=?")
      .bind(target.id)
      .first();
  }
  return db
    .prepare("SELECT id FROM legacy_reviews WHERE id=?")
    .bind(target.id)
    .first();
}

async function endorsementCount(db: D1Database, target: PublicReviewTarget) {
  const row =
    target.kind === "review"
      ? await db
          .prepare(
            "SELECT COUNT(*) count FROM review_endorsements WHERE review_id=?",
          )
          .bind(target.id)
          .first<{ count: number }>()
      : target.kind === "historical"
        ? await db
            .prepare(
              "SELECT COUNT(*) count FROM historical_review_endorsements WHERE historical_review_id=?",
            )
            .bind(target.id)
            .first<{ count: number }>()
        : await db
            .prepare(
              "SELECT COUNT(*) count FROM legacy_review_endorsements WHERE legacy_review_id=?",
            )
            .bind(target.id)
            .first<{ count: number }>();
  return row?.count || 0;
}

async function viewerEndorsed(
  db: D1Database,
  userId: string,
  target: PublicReviewTarget,
) {
  const row =
    target.kind === "review"
      ? await db
          .prepare(
            "SELECT 1 ok FROM review_endorsements WHERE user_id=? AND review_id=?",
          )
          .bind(userId, target.id)
          .first()
      : target.kind === "historical"
        ? await db
            .prepare(
              "SELECT 1 ok FROM historical_review_endorsements WHERE user_id=? AND historical_review_id=?",
            )
            .bind(userId, target.id)
            .first()
        : await db
            .prepare(
              "SELECT 1 ok FROM legacy_review_endorsements WHERE user_id=? AND legacy_review_id=?",
            )
            .bind(userId, target.id)
            .first();
  return !!row;
}

async function insertEndorsement(
  db: D1Database,
  userId: string,
  target: PublicReviewTarget,
) {
  if (target.kind === "review") {
    await db
      .prepare(
        "INSERT OR IGNORE INTO review_endorsements(user_id,review_id) VALUES(?,?)",
      )
      .bind(userId, target.id)
      .run();
    return;
  }
  if (target.kind === "historical") {
    await db
      .prepare(
        "INSERT OR IGNORE INTO historical_review_endorsements(user_id,historical_review_id) VALUES(?,?)",
      )
      .bind(userId, target.id)
      .run();
    return;
  }
  await db
    .prepare(
      "INSERT OR IGNORE INTO legacy_review_endorsements(user_id,legacy_review_id) VALUES(?,?)",
    )
    .bind(userId, target.id)
    .run();
}

async function deleteEndorsement(
  db: D1Database,
  userId: string,
  target: PublicReviewTarget,
) {
  if (target.kind === "review") {
    await db
      .prepare("DELETE FROM review_endorsements WHERE user_id=? AND review_id=?")
      .bind(userId, target.id)
      .run();
    return;
  }
  if (target.kind === "historical") {
    await db
      .prepare(
        "DELETE FROM historical_review_endorsements WHERE user_id=? AND historical_review_id=?",
      )
      .bind(userId, target.id)
      .run();
    return;
  }
  await db
    .prepare(
      "DELETE FROM legacy_review_endorsements WHERE user_id=? AND legacy_review_id=?",
    )
    .bind(userId, target.id)
    .run();
}

function endorsementState(count: number, endorsed: boolean) {
  return { endorsementCount: count, viewerEndorsed: endorsed };
}

function reviewStanceState(
  endorsementCount: number,
  challengeCount: number,
  endorsed: boolean,
  challenged: boolean,
) {
  return {
    endorsementCount,
    challengeCount,
    viewerEndorsed: endorsed,
    viewerChallenged: challenged,
  };
}

async function challengeCount(db: D1Database, target: PublicReviewTarget) {
  const row =
    target.kind === "review"
      ? await db
          .prepare(
            "SELECT COUNT(*) count FROM review_challenges WHERE review_id=?",
          )
          .bind(target.id)
          .first<{ count: number }>()
      : target.kind === "historical"
        ? await db
            .prepare(
              "SELECT COUNT(*) count FROM historical_review_challenges WHERE historical_review_id=?",
            )
            .bind(target.id)
            .first<{ count: number }>()
        : await db
            .prepare(
              "SELECT COUNT(*) count FROM legacy_review_challenges WHERE legacy_review_id=?",
            )
            .bind(target.id)
            .first<{ count: number }>();
  return row?.count || 0;
}

async function viewerChallenged(
  db: D1Database,
  userId: string,
  target: PublicReviewTarget,
) {
  const row =
    target.kind === "review"
      ? await db
          .prepare(
            "SELECT 1 ok FROM review_challenges WHERE user_id=? AND review_id=?",
          )
          .bind(userId, target.id)
          .first()
      : target.kind === "historical"
        ? await db
            .prepare(
              "SELECT 1 ok FROM historical_review_challenges WHERE user_id=? AND historical_review_id=?",
            )
            .bind(userId, target.id)
            .first()
        : await db
            .prepare(
              "SELECT 1 ok FROM legacy_review_challenges WHERE user_id=? AND legacy_review_id=?",
            )
            .bind(userId, target.id)
            .first();
  return !!row;
}

async function insertChallenge(
  db: D1Database,
  userId: string,
  target: PublicReviewTarget,
) {
  if (target.kind === "review") {
    await db
      .prepare(
        "INSERT OR IGNORE INTO review_challenges(user_id,review_id) VALUES(?,?)",
      )
      .bind(userId, target.id)
      .run();
    return;
  }
  if (target.kind === "historical") {
    await db
      .prepare(
        "INSERT OR IGNORE INTO historical_review_challenges(user_id,historical_review_id) VALUES(?,?)",
      )
      .bind(userId, target.id)
      .run();
    return;
  }
  await db
    .prepare(
      "INSERT OR IGNORE INTO legacy_review_challenges(user_id,legacy_review_id) VALUES(?,?)",
    )
    .bind(userId, target.id)
    .run();
}

async function deleteChallenge(
  db: D1Database,
  userId: string,
  target: PublicReviewTarget,
) {
  if (target.kind === "review") {
    await db
      .prepare("DELETE FROM review_challenges WHERE user_id=? AND review_id=?")
      .bind(userId, target.id)
      .run();
    return;
  }
  if (target.kind === "historical") {
    await db
      .prepare(
        "DELETE FROM historical_review_challenges WHERE user_id=? AND historical_review_id=?",
      )
      .bind(userId, target.id)
      .run();
    return;
  }
  await db
    .prepare(
      "DELETE FROM legacy_review_challenges WHERE user_id=? AND legacy_review_id=?",
    )
    .bind(userId, target.id)
    .run();
}

async function loadReviewStance(
  db: D1Database,
  userId: string,
  target: PublicReviewTarget,
) {
  return reviewStanceState(
    await endorsementCount(db, target),
    await challengeCount(db, target),
    await viewerEndorsed(db, userId, target),
    await viewerChallenged(db, userId, target),
  );
}

export async function readIdempotency(
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

export async function saveIdempotency(
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

export function parseIdempotencyKey(raw: string | undefined) {
  const key = (raw || "").trim();
  return key.length >= 8 && key.length <= 128 ? key : null;
}

async function requireVoteWrite(
  c: Context,
  action: "认可" | "质疑" = "认可",
) {
  const actor = await requireVoteActor(c, `当前账号无法${action}评价`);
  if ("error" in actor) return actor;
  const limited = await takeRateLimit(
    c.env.DB,
    `review-stance:${actor.id}`,
    600,
    40,
  );
  if (!limited) return { error: c.json({ error: "操作过于频繁，请稍后再试" }, 429) };
  return actor;
}

async function commentCountsByPublicId(db: D1Database, publicIds: string[]) {
  const counts = new Map<string, number>();
  if (!publicIds.length) return counts;
  const placeholders = publicIds.map(() => "?").join(",");
  try {
    const { results } = await db
      .prepare(
        `SELECT public_id, COUNT(*) count FROM review_comments
         WHERE deleted_at IS NULL AND public_id IN (${placeholders})
         GROUP BY public_id`,
      )
      .bind(...publicIds)
      .all<{ public_id: string; count: number }>();
    for (const row of results) counts.set(row.public_id, Number(row.count) || 0);
  } catch {
    return new Map();
  }
  return counts;
}

async function loadViewerEndorsedIds(
  db: D1Database,
  userId: string,
  items: Array<Record<string, unknown>>,
) {
  const endorsed = new Set<string>();
  const reviewIds: number[] = [];
  const historicalIds: string[] = [];
  const legacyIds: number[] = [];
  for (const item of items) {
    const target = parsePublicReviewTarget(String(item.id ?? ""));
    if (!target) continue;
    if (target.kind === "review") reviewIds.push(target.id);
    else if (target.kind === "historical") historicalIds.push(target.id);
    else legacyIds.push(target.id);
  }
  if (reviewIds.length) {
    const placeholders = reviewIds.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT review_id FROM review_endorsements
         WHERE user_id=? AND review_id IN (${placeholders})`,
      )
      .bind(userId, ...reviewIds)
      .all<{ review_id: number }>();
    for (const row of results) endorsed.add(`review:${row.review_id}`);
  }
  if (historicalIds.length) {
    const placeholders = historicalIds.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT historical_review_id FROM historical_review_endorsements
         WHERE user_id=? AND historical_review_id IN (${placeholders})`,
      )
      .bind(userId, ...historicalIds)
      .all<{ historical_review_id: string }>();
    for (const row of results)
      endorsed.add(`historical:${row.historical_review_id}`);
  }
  if (legacyIds.length) {
    const placeholders = legacyIds.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT legacy_review_id FROM legacy_review_endorsements
         WHERE user_id=? AND legacy_review_id IN (${placeholders})`,
      )
      .bind(userId, ...legacyIds)
      .all<{ legacy_review_id: number }>();
    for (const row of results) endorsed.add(`legacy:${row.legacy_review_id}`);
  }
  return endorsed;
}

async function loadViewerChallengedIds(
  db: D1Database,
  userId: string,
  items: Array<Record<string, unknown>>,
) {
  const challenged = new Set<string>();
  const reviewIds: number[] = [];
  const historicalIds: string[] = [];
  const legacyIds: number[] = [];
  for (const item of items) {
    const target = parsePublicReviewTarget(String(item.id ?? ""));
    if (!target) continue;
    if (target.kind === "review") reviewIds.push(target.id);
    else if (target.kind === "historical") historicalIds.push(target.id);
    else legacyIds.push(target.id);
  }
  if (reviewIds.length) {
    const placeholders = reviewIds.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT review_id FROM review_challenges
         WHERE user_id=? AND review_id IN (${placeholders})`,
      )
      .bind(userId, ...reviewIds)
      .all<{ review_id: number }>();
    for (const row of results) challenged.add(`review:${row.review_id}`);
  }
  if (historicalIds.length) {
    const placeholders = historicalIds.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT historical_review_id FROM historical_review_challenges
         WHERE user_id=? AND historical_review_id IN (${placeholders})`,
      )
      .bind(userId, ...historicalIds)
      .all<{ historical_review_id: string }>();
    for (const row of results)
      challenged.add(`historical:${row.historical_review_id}`);
  }
  if (legacyIds.length) {
    const placeholders = legacyIds.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT legacy_review_id FROM legacy_review_challenges
         WHERE user_id=? AND legacy_review_id IN (${placeholders})`,
      )
      .bind(userId, ...legacyIds)
      .all<{ legacy_review_id: number }>();
    for (const row of results)
      challenged.add(`legacy:${row.legacy_review_id}`);
  }
  return challenged;
}

export async function decoratePublicReviews(
  db: D1Database,
  items: Array<Record<string, unknown>>,
  viewerUserId: string | null,
) {
  const [endorsed, challenged] = viewerUserId
    ? await Promise.all([
        loadViewerEndorsedIds(db, viewerUserId, items),
        loadViewerChallengedIds(db, viewerUserId, items),
      ])
    : [new Set<string>(), new Set<string>()];
  const publicIds = items
    .map((item) => parsePublicReviewTarget(String(item.id ?? ""))?.publicId)
    .filter((id): id is string => !!id);
  const comments = await commentCountsByPublicId(db, publicIds);
  return items.map((item) => {
    const target = parsePublicReviewTarget(String(item.id ?? ""));
    const endorsable = !!target && item.blocked !== true;
    const decorated: Record<string, unknown> = {
      ...item,
      endorsement_count: Number(item.endorsement_count) || 0,
      challenge_count: Number(item.challenge_count) || 0,
      endorsable,
    };
    if (target) decorated.comment_count = comments.get(target.publicId) ?? 0;
    if (viewerUserId) {
      decorated.viewer_endorsed = !!(target && endorsed.has(target.publicId));
      decorated.viewer_challenged = !!(
        target && challenged.has(target.publicId)
      );
    }
    return decorated;
  });
}

async function mutateEndorsement(
  c: Context,
  operation: typeof CREATE_OPERATION | typeof WITHDRAW_OPERATION,
) {
  const auth = await requireVoteWrite(c);
  if ("error" in auth) return auth.error;
  const target = parsePublicReviewTarget(c.req.param("id"));
  if (!target) return fail(c, "评价不存在或不可认可", 404);
  const idempotencyKey = parseIdempotencyKey(c.req.header("Idempotency-Key"));
  if (!idempotencyKey) return fail(c, "缺少有效的幂等键", 400);
  const requestDigest = await digest(
    JSON.stringify({ operation, publicId: target.publicId }),
  );
  const replay = await readIdempotency(
    c.env.DB,
    auth.id,
    operation,
    idempotencyKey,
  );
  if (replay) {
    if (replay.request_digest !== requestDigest)
      return fail(c, "幂等键与请求不匹配", 409);
    return c.json(JSON.parse(replay.response_json));
  }
  if (operation === CREATE_OPERATION) {
    const eligible = await loadEligibleTarget(c.env.DB, target);
    if (!eligible) return fail(c, "评价不存在或不可认可", 404);
    await insertEndorsement(c.env.DB, auth.id, target);
  } else {
    const exists = await targetExists(c.env.DB, target);
    if (!exists) return fail(c, "评价不存在或不可认可", 404);
    await deleteEndorsement(c.env.DB, auth.id, target);
  }
  const body = await loadReviewStance(c.env.DB, auth.id, target);
  const stored = await saveIdempotency(
    c.env.DB,
    auth.id,
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

async function mutateChallenge(
  c: Context,
  operation:
    | typeof CHALLENGE_CREATE_OPERATION
    | typeof CHALLENGE_WITHDRAW_OPERATION,
) {
  const auth = await requireVoteWrite(c, "质疑");
  if ("error" in auth) return auth.error;
  const target = parsePublicReviewTarget(c.req.param("id"));
  if (!target) return fail(c, "评价不存在或不可质疑", 404);
  const idempotencyKey = parseIdempotencyKey(c.req.header("Idempotency-Key"));
  if (!idempotencyKey) return fail(c, "缺少有效的幂等键", 400);
  const requestDigest = await digest(
    JSON.stringify({ operation, publicId: target.publicId }),
  );
  const replay = await readIdempotency(
    c.env.DB,
    auth.id,
    operation,
    idempotencyKey,
  );
  if (replay) {
    if (replay.request_digest !== requestDigest)
      return fail(c, "幂等键与请求不匹配", 409);
    return c.json(JSON.parse(replay.response_json));
  }
  if (operation === CHALLENGE_CREATE_OPERATION) {
    const eligible = await loadEligibleTarget(c.env.DB, target);
    if (!eligible) return fail(c, "评价不存在或不可质疑", 404);
    await insertChallenge(c.env.DB, auth.id, target);
  } else {
    const exists = await targetExists(c.env.DB, target);
    if (!exists) return fail(c, "评价不存在或不可质疑", 404);
    await deleteChallenge(c.env.DB, auth.id, target);
  }
  const body = await loadReviewStance(c.env.DB, auth.id, target);
  const stored = await saveIdempotency(
    c.env.DB,
    auth.id,
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

export const handleCreateEndorsement = (c: Context) =>
  mutateEndorsement(c, CREATE_OPERATION);

export const handleWithdrawEndorsement = (c: Context) =>
  mutateEndorsement(c, WITHDRAW_OPERATION);

export const handleCreateChallenge = (c: Context) =>
  mutateChallenge(c, CHALLENGE_CREATE_OPERATION);

export const handleWithdrawChallenge = (c: Context) =>
  mutateChallenge(c, CHALLENGE_WITHDRAW_OPERATION);

export const COMMENT_CREATE_ENDORSEMENT = "comment-endorsement.create";
export const COMMENT_WITHDRAW_ENDORSEMENT = "comment-endorsement.withdraw";

function parsePositiveInt(raw: string | undefined) {
  const id = Number((raw || "").trim());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function commentEndorsementCount(db: D1Database, commentId: number) {
  const row = await db
    .prepare(
      "SELECT COUNT(*) count FROM review_comment_endorsements WHERE comment_id=?",
    )
    .bind(commentId)
    .first<{ count: number }>();
  return row?.count || 0;
}

async function viewerEndorsedComment(
  db: D1Database,
  userId: string,
  commentId: number,
) {
  const row = await db
    .prepare(
      "SELECT 1 ok FROM review_comment_endorsements WHERE user_id=? AND comment_id=?",
    )
    .bind(userId, commentId)
    .first();
  return !!row;
}

async function loadEndorsableComment(
  db: D1Database,
  publicId: string,
  commentId: number,
) {
  return db
    .prepare(
      `SELECT rc.id
       FROM review_comments rc
       WHERE rc.id=? AND rc.public_id=? AND rc.deleted_at IS NULL`,
    )
    .bind(commentId, publicId)
    .first<{ id: number }>();
}

async function mutateCommentEndorsement(
  c: Context,
  operation:
    | typeof COMMENT_CREATE_ENDORSEMENT
    | typeof COMMENT_WITHDRAW_ENDORSEMENT,
) {
  const auth = await requireVoteWrite(c);
  if ("error" in auth) return auth.error;
  const target = parsePublicReviewTarget(c.req.param("id"));
  const commentId = parsePositiveInt(c.req.param("commentId"));
  if (!target || !commentId) return fail(c, "回复不存在或不可认可", 404);
  if (operation === COMMENT_CREATE_ENDORSEMENT) {
    const parent = await loadEligibleTarget(c.env.DB, target);
    if (!parent) return fail(c, "回复不存在或不可认可", 404);
  }
  const idempotencyKey = parseIdempotencyKey(c.req.header("Idempotency-Key"));
  if (!idempotencyKey) return fail(c, "缺少有效的幂等键", 400);
  const requestDigest = await digest(
    JSON.stringify({ operation, publicId: target.publicId, commentId }),
  );
  const replay = await readIdempotency(
    c.env.DB,
    auth.id,
    operation,
    idempotencyKey,
  );
  if (replay) {
    if (replay.request_digest !== requestDigest)
      return fail(c, "幂等键与请求不匹配", 409);
    return c.json(JSON.parse(replay.response_json));
  }
  if (operation === COMMENT_CREATE_ENDORSEMENT) {
    const eligible = await loadEndorsableComment(
      c.env.DB,
      target.publicId,
      commentId,
    );
    if (!eligible) return fail(c, "回复不存在或不可认可", 404);
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO review_comment_endorsements(user_id,comment_id) VALUES(?,?)",
    )
      .bind(auth.id, commentId)
      .run();
  } else {
    const exists = await c.env.DB.prepare(
      "SELECT id FROM review_comments WHERE id=? AND public_id=?",
    )
      .bind(commentId, target.publicId)
      .first();
    if (!exists) return fail(c, "回复不存在或不可认可", 404);
    await c.env.DB.prepare(
      "DELETE FROM review_comment_endorsements WHERE user_id=? AND comment_id=?",
    )
      .bind(auth.id, commentId)
      .run();
  }
  const body = endorsementState(
    await commentEndorsementCount(c.env.DB, commentId),
    await viewerEndorsedComment(c.env.DB, auth.id, commentId),
  );
  const stored = await saveIdempotency(
    c.env.DB,
    auth.id,
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

export const handleCreateCommentEndorsement = (c: Context) =>
  mutateCommentEndorsement(c, COMMENT_CREATE_ENDORSEMENT);

export const handleWithdrawCommentEndorsement = (c: Context) =>
  mutateCommentEndorsement(c, COMMENT_WITHDRAW_ENDORSEMENT);
