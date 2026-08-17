import type { Context } from "hono";
import {
  canOrdinaryUserWrite,
  ordinaryUserCsrfOk,
  ordinaryUserSessionPayload,
  resolveOrdinaryUser,
} from "./ordinary-user-session";

const fail = (
  c: Context,
  error: string,
  status: 400 | 401 | 403 | 404 | 409 = 400,
) => c.json({ error }, status);

const originOk = (c: Context) => {
  const origin = c.req.header("Origin");
  return origin === new URL(c.req.url).origin;
};

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

export function parseCurrentReviewId(raw: string | undefined) {
  const value = (raw || "").trim();
  const matched = /^(?:review:)?(\d+)$/.exec(value);
  if (!matched) return null;
  const id = Number(matched[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function isEndorsablePublicId(id: unknown) {
  return typeof id === "string" && /^review:\d+$/.test(id);
}

type EligibleReview = { id: number };

async function loadEligibleReview(
  db: D1Database,
  reviewId: number,
): Promise<EligibleReview | null> {
  return db
    .prepare(
      `SELECT r.id
       FROM reviews r
       WHERE r.id=?
         AND r.status='approved'
         AND trim(COALESCE(r.comment,''))<>''
         AND EXISTS(
           SELECT 1 FROM course_teachers relation
           WHERE relation.course_id=r.course_id
             AND relation.teacher_id=r.teacher_id
         )`,
    )
    .bind(reviewId)
    .first<EligibleReview>();
}

async function endorsementCount(db: D1Database, reviewId: number) {
  const row = await db
    .prepare(
      "SELECT COUNT(*) count FROM review_endorsements WHERE review_id=?",
    )
    .bind(reviewId)
    .first<{ count: number }>();
  return row?.count || 0;
}

async function viewerEndorsed(
  db: D1Database,
  userId: string,
  reviewId: number,
) {
  const row = await db
    .prepare(
      "SELECT 1 ok FROM review_endorsements WHERE user_id=? AND review_id=?",
    )
    .bind(userId, reviewId)
    .first();
  return !!row;
}

function endorsementState(count: number, endorsed: boolean) {
  return { endorsementCount: count, viewerEndorsed: endorsed };
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

function parseIdempotencyKey(raw: string | undefined) {
  const key = (raw || "").trim();
  return key.length >= 8 && key.length <= 128 ? key : null;
}

async function requireWriteUser(c: Context) {
  const user = await resolveOrdinaryUser(c);
  if (!user) return { error: fail(c, "请先登录后再认可", 401) };
  if (!canOrdinaryUserWrite(user))
    return { error: fail(c, "当前账号无法认可评价", 403) };
  if (!originOk(c) || !ordinaryUserCsrfOk(c))
    return { error: fail(c, "安全校验失败，请刷新后重试", 403) };
  return { user };
}

export async function decoratePublicReviews(
  db: D1Database,
  items: Array<Record<string, unknown>>,
  viewerUserId: string | null,
) {
  const reviewIds = items
    .map((item) =>
      isEndorsablePublicId(item.id)
        ? parseCurrentReviewId(String(item.id))
        : null,
    )
    .filter((id): id is number => id !== null);
  const endorsed = new Set<number>();
  if (viewerUserId && reviewIds.length) {
    const placeholders = reviewIds.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT review_id FROM review_endorsements
         WHERE user_id=? AND review_id IN (${placeholders})`,
      )
      .bind(viewerUserId, ...reviewIds)
      .all<{ review_id: number }>();
    for (const row of results) endorsed.add(row.review_id);
  }
  return items.map((item) => {
    const endorsable = isEndorsablePublicId(item.id);
    const reviewId = endorsable ? parseCurrentReviewId(String(item.id)) : null;
    const decorated: Record<string, unknown> = {
      ...item,
      endorsement_count: Number(item.endorsement_count) || 0,
      endorsable,
    };
    if (viewerUserId) {
      decorated.viewer_endorsed = !!(reviewId && endorsed.has(reviewId));
    }
    return decorated;
  });
}

export async function handleEndorsementViewer(c: Context) {
  return c.json(await ordinaryUserSessionPayload(c));
}

async function mutateEndorsement(
  c: Context,
  operation: typeof CREATE_OPERATION | typeof WITHDRAW_OPERATION,
) {
  const auth = await requireWriteUser(c);
  if ("error" in auth) return auth.error;
  const reviewId = parseCurrentReviewId(c.req.param("id"));
  if (!reviewId) return fail(c, "评价不存在或不可认可", 404);
  const idempotencyKey = parseIdempotencyKey(c.req.header("Idempotency-Key"));
  if (!idempotencyKey) return fail(c, "缺少有效的幂等键", 400);
  const requestDigest = await digest(
    JSON.stringify({ operation, reviewId }),
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
  if (operation === CREATE_OPERATION) {
    const eligible = await loadEligibleReview(c.env.DB, reviewId);
    if (!eligible) return fail(c, "评价不存在或不可认可", 404);
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO review_endorsements(user_id,review_id) VALUES(?,?)",
    )
      .bind(auth.user.id, reviewId)
      .run();
  } else {
    const exists = await c.env.DB.prepare("SELECT id FROM reviews WHERE id=?")
      .bind(reviewId)
      .first();
    if (!exists) return fail(c, "评价不存在或不可认可", 404);
    await c.env.DB.prepare(
      "DELETE FROM review_endorsements WHERE user_id=? AND review_id=?",
    )
      .bind(auth.user.id, reviewId)
      .run();
  }
  const body = endorsementState(
    await endorsementCount(c.env.DB, reviewId),
    await viewerEndorsed(c.env.DB, auth.user.id, reviewId),
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

export const handleCreateEndorsement = (c: Context) =>
  mutateEndorsement(c, CREATE_OPERATION);

export const handleWithdrawEndorsement = (c: Context) =>
  mutateEndorsement(c, WITHDRAW_OPERATION);
