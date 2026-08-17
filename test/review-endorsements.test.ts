import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ORDINARY_USER_CSRF_COOKIE,
  ORDINARY_USER_ID_HEADER,
  ORDINARY_USER_MAC_HEADER,
  ordinaryUserTestHeaders,
} from "../src/ordinary-user-session";

const origin = "https://example.com";
const testAuthSecret = "test-ordinary-user-auth";

type EndorsementState = {
  endorsementCount: number;
  viewerEndorsed: boolean;
};

type PublicReview = {
  id: string;
  comment: string;
  endorsement_count: number;
  endorsable: boolean;
  viewer_endorsed?: boolean;
};

async function userHeaders(userId: string) {
  return ordinaryUserTestHeaders(userId, testAuthSecret);
}

async function viewerSession(userId: string) {
  const auth = await userHeaders(userId);
  const response = await SELF.fetch(`${origin}/api/endorsements/viewer`, {
    headers: auth,
  });
  expect(response.status).toBe(200);
  const body = await response.json<{
    authenticated: boolean;
    csrfToken?: string;
    loginPath: string;
    logoutPath: string;
  }>();
  expect(body.csrfToken).toBeTruthy();
  return {
    userId,
    auth,
    authenticated: body.authenticated,
    csrf: body.csrfToken || "",
    cookie: `${ORDINARY_USER_CSRF_COOKIE}=${body.csrfToken}`,
    loginPath: body.loginPath,
    logoutPath: body.logoutPath,
  };
}

function writeHeaders(
  session: Awaited<ReturnType<typeof viewerSession>>,
  idempotencyKey: string,
) {
  return {
    [ORDINARY_USER_ID_HEADER]: session.auth[ORDINARY_USER_ID_HEADER],
    [ORDINARY_USER_MAC_HEADER]: session.auth[ORDINARY_USER_MAC_HEADER],
    Cookie: session.cookie,
    Origin: origin,
    "X-CSRF-Token": session.csrf,
    "Idempotency-Key": idempotencyKey,
  };
}

async function insertReview(input: {
  comment: string;
  status?: string;
  overall?: number;
}) {
  const result = await env.DB.prepare(
    `INSERT INTO reviews(
      course_id,teacher_id,category,overall,comment,status,submitter_hash
    ) VALUES(1,1,'general',?,?,?,?)`,
  )
    .bind(
      input.overall ?? 4,
      input.comment,
      input.status ?? "approved",
      `endorsement-${input.comment || "empty"}-${Date.now()}-${Math.random()}`,
    )
    .run();
  return Number(result.meta.last_row_id);
}

async function insertHistorical(comment: string) {
  const id = `endorsement-hist-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await env.DB.prepare(
    `INSERT INTO public_historical_reviews(
       id,course_id,teacher_id,comment,package_contract,
       approved_package_manifest_sha256,approved_catalog_content_sha256
     ) VALUES(?,?,?,?,?,?,?)`,
  )
    .bind(id, 1, 1, comment, "legacy-historical-production-freeze-v1", "a".repeat(64), "b".repeat(64))
    .run();
  return id;
}

async function insertLegacy(comment: string) {
  const batchId = `endorsement-legacy-${Date.now()}`;
  await env.DB.prepare(
    `INSERT INTO legacy_import_batches(
      id,source_type,source_label,status,row_count,imported_at
    ) VALUES(?, 'legacy_ocr', '认可测试历史资料', 'imported', 1, CURRENT_TIMESTAMP)`,
  )
    .bind(batchId)
    .run();
  const result = await env.DB.prepare(
    `INSERT INTO legacy_reviews(
      import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,
      ocr_confidence,course_id,teacher_id,category,comment,status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      batchId,
      "endorsement.png",
      "测试表",
      "1",
      "private OCR",
      0.99,
      1,
      1,
      "general",
      comment,
      "approved",
    )
    .run();
  return Number(result.meta.last_row_id);
}

async function putEndorsement(
  reviewId: number | string,
  session: Awaited<ReturnType<typeof viewerSession>>,
  key = crypto.randomUUID(),
) {
  return SELF.fetch(`${origin}/api/reviews/${reviewId}/endorsement`, {
    method: "PUT",
    headers: writeHeaders(session, key),
  });
}

async function deleteEndorsement(
  reviewId: number | string,
  session: Awaited<ReturnType<typeof viewerSession>>,
  key = crypto.randomUUID(),
) {
  return SELF.fetch(`${origin}/api/reviews/${reviewId}/endorsement`, {
    method: "DELETE",
    headers: writeHeaders(session, key),
  });
}

describe("review endorsement API", () => {
  it("rejects unauthenticated create and does not accept admin sessions", async () => {
    const reviewId = await insertReview({ comment: "可认可的补充说明" });
    const anonymous = await SELF.fetch(
      `${origin}/api/reviews/${reviewId}/endorsement`,
      {
        method: "PUT",
        headers: {
          Origin: origin,
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
    );
    expect(anonymous.status).toBe(401);

    const login = await SELF.fetch(`${origin}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ password: "test-password" }),
    });
    expect(login.status).toBe(200);
    const adminBody = await login.json<{ csrfToken: string }>();
    const adminCookie = (
      login.headers as Headers & { getSetCookie(): string[] }
    )
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const adminWrite = await SELF.fetch(
      `${origin}/api/reviews/${reviewId}/endorsement`,
      {
        method: "PUT",
        headers: {
          Cookie: adminCookie,
          Origin: origin,
          "X-CSRF-Token": adminBody.csrfToken,
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
    );
    expect(adminWrite.status).toBe(401);
  });

  it("creates, repeats, withdraws and repeats withdraw with authoritative counts", async () => {
    const reviewId = await insertReview({ comment: "幂等认可补充说明" });
    const session = await viewerSession("user-endorse-repeat");
    expect(session.authenticated).toBe(true);
    expect(session.loginPath).toBe("/login");
    expect(session.logoutPath).toBe("/logout");
    const viewer = await SELF.fetch(`${origin}/api/endorsements/viewer`, {
      headers: session.auth,
    });
    expect(
      (viewer.headers as Headers & { getSetCookie(): string[] })
        .getSetCookie()
        .some((value) => value.startsWith(`${ORDINARY_USER_CSRF_COOKIE}=`)),
    ).toBe(true);

    const first = await putEndorsement(reviewId, session);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      endorsementCount: 1,
      viewerEndorsed: true,
    } satisfies EndorsementState);

    const repeat = await putEndorsement(reviewId, session);
    expect(repeat.status).toBe(200);
    await expect(repeat.json()).resolves.toEqual({
      endorsementCount: 1,
      viewerEndorsed: true,
    });

    const withdrawn = await deleteEndorsement(reviewId, session);
    expect(withdrawn.status).toBe(200);
    await expect(withdrawn.json()).resolves.toEqual({
      endorsementCount: 0,
      viewerEndorsed: false,
    });

    const repeatWithdraw = await deleteEndorsement(reviewId, session);
    expect(repeatWithdraw.status).toBe(200);
    await expect(repeatWithdraw.json()).resolves.toEqual({
      endorsementCount: 0,
      viewerEndorsed: false,
    });
  });

  it("replays the same idempotency key and conflicts on a different request", async () => {
    const reviewId = await insertReview({ comment: "幂等键冲突补充说明" });
    const otherId = await insertReview({ comment: "另一条可认可补充说明" });
    const session = await viewerSession("user-endorse-idem");
    const key = crypto.randomUUID();
    const first = await SELF.fetch(
      `${origin}/api/reviews/${reviewId}/endorsement`,
      { method: "PUT", headers: writeHeaders(session, key) },
    );
    expect(first.status).toBe(200);
    const replay = await SELF.fetch(
      `${origin}/api/reviews/${reviewId}/endorsement`,
      { method: "PUT", headers: writeHeaders(session, key) },
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    const conflict = await SELF.fetch(
      `${origin}/api/reviews/${otherId}/endorsement`,
      { method: "PUT", headers: writeHeaders(session, key) },
    );
    expect(conflict.status).toBe(409);
  });

  it("keeps a single relation when the same user endorses concurrently", async () => {
    const reviewId = await insertReview({ comment: "并发认可补充说明" });
    const session = await viewerSession("user-endorse-concurrent");
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => putEndorsement(reviewId, session)),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const bodies = await Promise.all(
      responses.map((response) => response.json<EndorsementState>()),
    );
    expect(bodies.every((body) => body.endorsementCount === 1)).toBe(true);
    expect(bodies.every((body) => body.viewerEndorsed)).toBe(true);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) count FROM review_endorsements WHERE review_id=?",
    )
      .bind(reviewId)
      .first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it("rejects pending, rejected, historical, score-only and missing targets", async () => {
    const session = await viewerSession("user-endorse-eligibility");
    const pending = await insertReview({
      comment: "待审核补充说明",
      status: "pending",
    });
    const rejected = await insertReview({
      comment: "被驳回补充说明",
      status: "rejected",
    });
    const scoreOnly = await insertReview({ comment: "   " });
    const historicalId = await insertHistorical("历史评价不可认可");
    const legacyId = await insertLegacy("资料评价不可认可");

    for (const target of [
      pending,
      rejected,
      scoreOnly,
      `historical:${historicalId}`,
      `legacy:${legacyId}`,
      9_999_999,
    ]) {
      const response = await putEndorsement(target, session);
      expect(response.status, String(target)).toBe(404);
    }
  });

  it("exposes public counts without identity and viewer state only when authenticated", async () => {
    const reviewId = await insertReview({ comment: "公开计数补充说明" });
    const historicalId = await insertHistorical("公开历史评价正文");
    const first = await viewerSession("user-endorse-public-a");
    const second = await viewerSession("user-endorse-public-b");
    expect((await putEndorsement(reviewId, first)).status).toBe(200);
    expect((await putEndorsement(reviewId, second)).status).toBe(200);

    const anonymous = await SELF.fetch(`${origin}/api/courses/1`);
    expect(anonymous.status).toBe(200);
    const anonymousBody = await anonymous.json<{
      reviews: PublicReview[];
      reviewCount: number;
    }>();
    const anonymousReview = anonymousBody.reviews.find(
      (review) => review.id === `review:${reviewId}`,
    );
    const anonymousHistorical = anonymousBody.reviews.find(
      (review) => review.id === `historical:${historicalId}`,
    );
    expect(anonymousReview).toMatchObject({
      endorsement_count: 2,
      endorsable: true,
    });
    expect(anonymousReview).not.toHaveProperty("viewer_endorsed");
    expect(anonymousHistorical).toMatchObject({
      endorsement_count: 0,
      endorsable: false,
    });
    const publicJson = JSON.stringify(anonymousBody);
    expect(publicJson).not.toContain("user-endorse-public-a");
    expect(publicJson).not.toContain("user-endorse-public-b");
    expect(publicJson).not.toContain("submitter_hash");
    expect(publicJson).not.toMatch(/"user_id"/);

    const authenticated = await SELF.fetch(`${origin}/api/courses/1`, {
      headers: await userHeaders("user-endorse-public-a"),
    });
    const authenticatedBody = await authenticated.json<{
      reviews: PublicReview[];
    }>();
    expect(
      authenticatedBody.reviews.find((review) => review.id === `review:${reviewId}`),
    ).toMatchObject({
      endorsement_count: 2,
      endorsable: true,
      viewer_endorsed: true,
    });
    expect(
      authenticatedBody.reviews.find(
        (review) => review.id === `historical:${historicalId}`,
      ),
    ).toMatchObject({
      endorsable: false,
      viewer_endorsed: false,
    });
  });

  it("does not change ratings, visible review counts or feed order", async () => {
    const older = await insertReview({ comment: "排序前补充说明" });
    const newer = await insertReview({ comment: "排序后补充说明" });
    const before = await SELF.fetch(`${origin}/api/courses/1`).then((response) =>
      response.json<{
        course: { rating: number | null };
        reviewCount: number;
        reviews: Array<{ id: string }>;
      }>(),
    );
    const [catalogBefore, teacherBefore, teacherCatalogBefore] = await Promise.all([
      SELF.fetch(`${origin}/api/courses?q=TEST101`).then((response) =>
        response.json<{
          items: Array<{ id: number; review_count: number; rating: number | null }>;
        }>(),
      ),
      SELF.fetch(`${origin}/api/teachers/1`).then((response) =>
        response.json<{
          teacher: { rating: number | null };
          reviewCount: number;
          reviews: Array<{ id: string }>;
        }>(),
      ),
      SELF.fetch(`${origin}/api/teachers?q=${encodeURIComponent("测试教师")}`).then(
        (response) =>
          response.json<{
            items: Array<{ id: number; review_count: number; rating: number | null }>;
          }>(),
      ),
    ]);
    const session = await viewerSession("user-endorse-sort");
    expect((await putEndorsement(newer, session)).status).toBe(200);
    expect((await putEndorsement(older, session)).status).toBe(200);
    const after = await SELF.fetch(`${origin}/api/courses/1`).then((response) =>
      response.json<{
        course: { rating: number | null };
        reviewCount: number;
        reviews: Array<{ id: string }>;
      }>(),
    );
    const [catalogAfter, teacherAfter, teacherCatalogAfter] = await Promise.all([
      SELF.fetch(`${origin}/api/courses?q=TEST101`).then((response) =>
        response.json<{
          items: Array<{ id: number; review_count: number; rating: number | null }>;
        }>(),
      ),
      SELF.fetch(`${origin}/api/teachers/1`).then((response) =>
        response.json<{
          teacher: { rating: number | null };
          reviewCount: number;
          reviews: Array<{ id: string }>;
        }>(),
      ),
      SELF.fetch(`${origin}/api/teachers?q=${encodeURIComponent("测试教师")}`).then(
        (response) =>
          response.json<{
            items: Array<{ id: number; review_count: number; rating: number | null }>;
          }>(),
      ),
    ]);
    expect(after.reviewCount).toBe(before.reviewCount);
    expect(after.course.rating).toBe(before.course.rating);
    expect(after.reviews.map((review) => review.id)).toEqual(
      before.reviews.map((review) => review.id),
    );
    expect(teacherAfter.reviewCount).toBe(teacherBefore.reviewCount);
    expect(teacherAfter.teacher.rating).toBe(teacherBefore.teacher.rating);
    expect(teacherAfter.reviews.map((review) => review.id)).toEqual(
      teacherBefore.reviews.map((review) => review.id),
    );
    const courseBefore = catalogBefore.items.find((item) => item.id === 1);
    const courseAfter = catalogAfter.items.find((item) => item.id === 1);
    expect(courseAfter?.review_count).toBe(courseBefore?.review_count);
    expect(courseAfter?.rating).toBe(courseBefore?.rating);
    const listedTeacherBefore = teacherCatalogBefore.items.find((item) => item.id === 1);
    const listedTeacherAfter = teacherCatalogAfter.items.find((item) => item.id === 1);
    expect(listedTeacherAfter?.review_count).toBe(listedTeacherBefore?.review_count);
    expect(listedTeacherAfter?.rating).toBe(listedTeacherBefore?.rating);
  });

  it("removes endorsement rows when the review is deleted", async () => {
    const reviewId = await insertReview({ comment: "删除级联补充说明" });
    const session = await viewerSession("user-endorse-cascade");
    expect((await putEndorsement(reviewId, session)).status).toBe(200);
    await env.DB.prepare("DELETE FROM reviews WHERE id=?").bind(reviewId).run();
    const leftover = await env.DB.prepare(
      "SELECT COUNT(*) count FROM review_endorsements WHERE review_id=?",
    )
      .bind(reviewId)
      .first<{ count: number }>();
    expect(leftover?.count).toBe(0);
  });

  it("rejects cross-origin or missing CSRF writes", async () => {
    const reviewId = await insertReview({ comment: "CSRF 认可补充说明" });
    const session = await viewerSession("user-endorse-csrf");
    const missingOrigin = await SELF.fetch(
      `${origin}/api/reviews/${reviewId}/endorsement`,
      {
        method: "PUT",
        headers: {
          [ORDINARY_USER_ID_HEADER]: session.auth[ORDINARY_USER_ID_HEADER],
          [ORDINARY_USER_MAC_HEADER]: session.auth[ORDINARY_USER_MAC_HEADER],
          Cookie: session.cookie,
          "X-CSRF-Token": session.csrf,
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
    );
    expect(missingOrigin.status).toBe(403);
    const badCsrf = await SELF.fetch(
      `${origin}/api/reviews/${reviewId}/endorsement`,
      {
        method: "PUT",
        headers: {
          [ORDINARY_USER_ID_HEADER]: session.auth[ORDINARY_USER_ID_HEADER],
          [ORDINARY_USER_MAC_HEADER]: session.auth[ORDINARY_USER_MAC_HEADER],
          Cookie: session.cookie,
          Origin: origin,
          "X-CSRF-Token": "not-the-csrf",
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
    );
    expect(badCsrf.status).toBe(403);
  });
});
