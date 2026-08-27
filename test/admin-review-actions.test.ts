import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { deliverReviewAuthorLookup } from "../src/admin-review-author-mail";
import { refreshPublicListPrecomputes } from "../src/public-list-precompute";
import {
  consumeAiSummaryQueue,
  type AiSummaryQueueMessage,
} from "../src/review-summary";
import { CURRENT_SCORES } from "./review-score-fixtures";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
  setOrdinaryUserStatus,
} from "./ordinary-write-session";
import { formatPublicCode } from "../src/public-handle";
import { adminAuth, adminHeaders } from "./admin-session";

const origin = "https://example.com";
const mailOrigin = "https://mail.example.test";
const originalFetch = globalThis.fetch;

type CapturedMail = {
  to?: string[];
  subject?: string;
  text?: string;
  html?: string;
};

let capturedMail: CapturedMail[] = [];

function installMailMock(status = 200) {
  capturedMail = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin === mailOrigin) {
      capturedMail.push((await request.json()) as CapturedMail);
      return new Response(JSON.stringify({ id: "admin_review_mail" }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  capturedMail = [];
});

async function login() {
  return adminAuth();
}

async function adminAction(
  auth: { cookie: string; csrf: string },
  reviewId: number | string,
  action: "block" | "unblock" | "author-lookup" | "delete",
) {
  const id = encodeURIComponent(String(reviewId));
  return SELF.fetch(`${origin}/api/admin/reviews/${id}${action === "delete" ? "" : `/${action}`}`, {
    method: action === "delete" ? "DELETE" : "POST",
    headers: adminHeaders(auth),
  });
}

async function publicReviewText() {
  const response = await SELF.fetch(`${origin}/api/courses/1/reviews`);
  expect(response.status).toBe(200);
  return response.text();
}

async function summaryInputContains(
  courseId: number,
  teacherId: number,
  comment: string,
) {
  await env.DB.prepare(
    "UPDATE course_teachers SET ai_summary_source_hash='' WHERE course_id=? AND teacher_id=?",
  )
    .bind(courseId, teacherId)
    .run();

  const prompts: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = (await request.json()) as {
      messages?: Array<{ content?: string }>;
    };
    const prompt = body.messages?.[1]?.content;
    if (typeof prompt === "string") prompts.push(prompt);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "客观总结" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const message: Message<AiSummaryQueueMessage> = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    body: { courseId, teacherId, immediate: true },
    attempts: 1,
    ack() {},
    retry() {},
  };
  await consumeAiSummaryQueue(
    { messages: [message] } as MessageBatch<AiSummaryQueueMessage>,
    {
      OPENAI_BASE_URL: "https://openai.example.test/v1",
      OPENAI_API_KEY: "test-openai-key",
      OPENAI_MODEL: "test-model",
      DB: env.DB,
      AI_SUMMARY_QUEUE: { async send() {} },
    },
    fetchImpl,
  );
  return prompts.some((prompt) => prompt.includes(comment));
}

type CourseReviewItem = {
  id: string;
  comment: string;
  blocked?: boolean;
  endorsable?: boolean;
};

async function courseReviewPage(headers?: HeadersInit) {
  const response = await SELF.fetch(`${origin}/api/courses/1/reviews`, {
    headers,
  });
  expect(response.status).toBe(200);
  return response.json<{ items: CourseReviewItem[]; total?: number }>();
}

function reviewByComment(items: CourseReviewItem[], comment: string) {
  return items.find((item) => item.comment === comment);
}

describe("admin review actions", () => {
  it("links the writer and block/unblock/delete hide the review across public consumers", async () => {
    const writer = await ordinaryWriteSession("admin-review-action-writer");
    const stableUserId = await setOrdinaryUserStatus(writer.userId, "active");
    const comment = "管理员动作可见性回归点评正文";
    const submitted = await SELF.fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: ordinaryWriteHeaders(writer, {
        "CF-Connecting-IP": "203.0.113.211",
      }),
      body: JSON.stringify({
        courseId: 1,
        teacherId: 1,
        overall: 5,
        scores: CURRENT_SCORES,
        headline: "管理员动作回归",
        comment,
      }),
    });
    expect(submitted.status).toBe(200);
    const review = await env.DB.prepare(
      "SELECT id,author_user_id FROM reviews WHERE comment=?",
    )
      .bind(comment)
      .first<{ id: number; author_user_id: string | null }>();
    expect(review?.author_user_id).toBe(stableUserId);
    const reviewId = review!.id;
    for (let index = 0; index < 5; index += 1) {
      await env.DB.prepare(
        `INSERT INTO reviews(course_id,teacher_id,category,overall,comment,status,reviewed_at)
         VALUES(1,1,'general',4,?,'approved',CURRENT_TIMESTAMP)`,
      )
        .bind(`管理员动作总结门槛填充第${index + 1}条，内容足够十个字以上`)
        .run();
    }

    expect(await publicReviewText()).toContain(comment);
    expect(await summaryInputContains(1, 1, comment)).toBe(true);
    await refreshPublicListPrecomputes(env.DB);
    const visibleCount = await env.DB.prepare(
      "SELECT review_count FROM public_review_counts WHERE course_id=1 AND teacher_id=1",
    ).first<{ review_count: number }>();

    const auth = await login();
    const blocked = await adminAction(auth, reviewId, "block");
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({ ok: true, changed: true });
    const blockedAgain = await adminAction(auth, reviewId, "block");
    expect(await blockedAgain.json()).toEqual({ ok: true, changed: false });
    expect(await publicReviewText()).not.toContain(comment);
    expect(await summaryInputContains(1, 1, comment)).toBe(false);
    await refreshPublicListPrecomputes(env.DB);
    const blockedCount = await env.DB.prepare(
      "SELECT review_count FROM public_review_counts WHERE course_id=1 AND teacher_id=1",
    ).first<{ review_count: number }>();
    expect(blockedCount?.review_count || 0).toBe((visibleCount?.review_count || 1) - 1);

    const endorser = await ordinaryWriteSession("admin-review-action-endorser");
    const endorsement = await SELF.fetch(
      `${origin}/api/reviews/${reviewId}/endorsement`,
      {
        method: "PUT",
        headers: ordinaryWriteHeaders(endorser, {
          "Idempotency-Key": "blocked-review-endorsement",
        }),
      },
    );
    expect(endorsement.status).toBe(404);

    const unblocked = await adminAction(auth, reviewId, "unblock");
    expect(await unblocked.json()).toEqual({ ok: true, changed: true });
    expect(await publicReviewText()).toContain(comment);
    expect(await summaryInputContains(1, 1, comment)).toBe(true);

    const deleted = await adminAction(auth, reviewId, "delete");
    expect(await deleted.json()).toEqual({ ok: true, changed: true });
    expect(await summaryInputContains(1, 1, comment)).toBe(false);
    const deletedAgain = await adminAction(auth, reviewId, "delete");
    expect(await deletedAgain.json()).toEqual({ ok: true, changed: false });
    expect(await publicReviewText()).not.toContain(comment);
    expect(
      await env.DB.prepare(
        "SELECT blocked_at,deleted_at FROM reviews WHERE id=?",
      )
        .bind(reviewId)
        .first(),
    ).toMatchObject({ blocked_at: null, deleted_at: expect.any(String) });

    const events = (
      await env.DB.prepare(
        `SELECT action,actor_session_id FROM review_moderation_events
         WHERE review_id=? ORDER BY id`,
      )
        .bind(reviewId)
        .all<{ action: string; actor_session_id: string | null }>()
    ).results;
    expect(events.map((event) => event.action)).toEqual([
      "blocked",
      "unblocked",
      "deleted",
    ]);
    expect(events.every((event) => Boolean(event.actor_session_id))).toBe(true);
  });

  it("keeps blocked reviews on course and teacher lists for admin sessions only", async () => {
    const writer = await ordinaryWriteSession("admin-blocked-list-writer");
    const stableUserId = await setOrdinaryUserStatus(writer.userId, "active");
    const comment = "管理员会话仍可见已屏蔽点评";
    const submitted = await SELF.fetch(`${origin}/api/reviews`, {
      method: "POST",
      headers: ordinaryWriteHeaders(writer, {
        "CF-Connecting-IP": "203.0.113.40",
      }),
      body: JSON.stringify({
        courseId: 1,
        teacherId: 1,
        overall: 4,
        scores: CURRENT_SCORES,
        headline: "屏蔽后管理员仍可见",
        comment,
      }),
    });
    expect(submitted.status).toBe(200);
    const review = await env.DB.prepare(
      "SELECT id FROM reviews WHERE comment=?",
    )
      .bind(comment)
      .first<{ id: number }>();
    const reviewId = review!.id;
    const publicCode = (
      await env.DB.prepare("SELECT public_code FROM users WHERE id=?").bind(
        stableUserId,
      ).first<{ public_code: number }>()
    )?.public_code;
    expect(publicCode).toEqual(expect.any(Number));

    await refreshPublicListPrecomputes(env.DB);
    const visibleCount = await env.DB.prepare(
      "SELECT review_count FROM public_review_counts WHERE course_id=1 AND teacher_id=1",
    ).first<{ review_count: number }>();

    const auth = await login();
    expect((await adminAction(auth, reviewId, "block")).status).toBe(200);

    const publicPage = await courseReviewPage();
    expect(reviewByComment(publicPage.items, comment)).toBeUndefined();
    expect(JSON.stringify(publicPage)).not.toContain('"blocked":true');

    const ordinaryPage = await courseReviewPage(ordinaryWriteHeaders(writer));
    expect(reviewByComment(ordinaryPage.items, comment)).toBeUndefined();
    expect(JSON.stringify(ordinaryPage)).not.toContain('"blocked":true');

    const bogusPage = await courseReviewPage({
      Cookie: "jufexk_admin=not-a-session",
    });
    expect(reviewByComment(bogusPage.items, comment)).toBeUndefined();

    const revoked = await login();
    await env.DB.prepare(
      "UPDATE admin_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_id=?",
    )
      .bind(revoked.sessionId)
      .run();
    expect(
      reviewByComment(
        (await courseReviewPage({ Cookie: revoked.cookie })).items,
        comment,
      ),
    ).toBeUndefined();

    const expired = await login();
    await env.DB.prepare(
      "UPDATE admin_sessions SET expires_at=datetime('now','-1 hours') WHERE session_id=?",
    )
      .bind(expired.sessionId)
      .run();
    expect(
      reviewByComment(
        (await courseReviewPage({ Cookie: expired.cookie })).items,
        comment,
      ),
    ).toBeUndefined();

    const adminPage = await courseReviewPage({ Cookie: auth.cookie });
    const adminItem = reviewByComment(adminPage.items, comment);
    expect(adminItem).toMatchObject({
      id: `review:${reviewId}`,
      comment,
      blocked: true,
      endorsable: false,
    });
    expect(JSON.stringify(adminPage)).not.toContain("blocked_at");

    const teacherPage = await SELF.fetch(`${origin}/api/teachers/1/reviews`, {
      headers: { Cookie: auth.cookie },
    });
    expect(teacherPage.status).toBe(200);
    const teacherBody = await teacherPage.json<{ items: CourseReviewItem[] }>();
    expect(reviewByComment(teacherBody.items, comment)).toMatchObject({
      blocked: true,
    });

    const latest = await SELF.fetch(`${origin}/api/reviews/latest`);
    expect(latest.status).toBe(200);
    expect(await latest.text()).not.toContain(comment);

    const latestAsAdmin = await SELF.fetch(`${origin}/api/reviews/latest`, {
      headers: { Cookie: auth.cookie },
    });
    expect(await latestAsAdmin.text()).not.toContain(comment);

    const profile = await SELF.fetch(
      `${origin}/api/u/${formatPublicCode(publicCode!)}`,
    );
    expect(profile.status).toBe(200);
    expect(await profile.text()).not.toContain(comment);

    await refreshPublicListPrecomputes(env.DB);
    const blockedCount = await env.DB.prepare(
      "SELECT review_count FROM public_review_counts WHERE course_id=1 AND teacher_id=1",
    ).first<{ review_count: number }>();
    expect(blockedCount?.review_count || 0).toBe(
      (visibleCount?.review_count || 1) - 1,
    );

    const endorser = await ordinaryWriteSession("admin-blocked-list-endorser");
    expect(
      (
        await SELF.fetch(`${origin}/api/reviews/${reviewId}/endorsement`, {
          method: "PUT",
          headers: ordinaryWriteHeaders(endorser, {
            "Idempotency-Key": "admin-blocked-list-endorsement",
          }),
        })
      ).status,
    ).toBe(404);

    expect(await (await adminAction(auth, reviewId, "unblock")).json()).toEqual({
      ok: true,
      changed: true,
    });
    const unblockedPublic = await courseReviewPage();
    expect(reviewByComment(unblockedPublic.items, comment)).toMatchObject({
      comment,
    });
    expect(reviewByComment(unblockedPublic.items, comment)).not.toHaveProperty(
      "blocked",
    );
    const unblockedAdmin = await courseReviewPage({ Cookie: auth.cookie });
    expect(reviewByComment(unblockedAdmin.items, comment)).not.toHaveProperty(
      "blocked",
    );

    expect(await (await adminAction(auth, reviewId, "delete")).json()).toEqual({
      ok: true,
      changed: true,
    });
    expect(
      reviewByComment((await courseReviewPage({ Cookie: auth.cookie })).items, comment),
    ).toBeUndefined();
    expect(await publicReviewText()).not.toContain(comment);
  });

  it("emails author data without returning it in the API response and audits delivery", async () => {
    installMailMock();
    const authorUserId = "author-lookup-private-user";
    const subject = "private-auth-subject-hash";
    const submitterHash = "private-submitter-ip-hash";
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO users(id,status) VALUES(?,'active')").bind(
        authorUserId,
      ),
      env.DB.prepare(
        `INSERT INTO auth_identities(provider,issuer,subject,user_id)
         VALUES('email','jufexk:email',?,?)`,
      ).bind(subject, authorUserId),
    ]);
    const inserted = await env.DB.prepare(
      `INSERT INTO reviews(
         course_id,teacher_id,category,overall,status,submitter_hash,
         author_user_id,headline,comment,reviewed_at
       ) VALUES(1,1,'general',4,'approved',?,?,?, ?,CURRENT_TIMESTAMP)`,
    )
      .bind(
        submitterHash,
        authorUserId,
        "作者查询回归",
        "作者资料只能进入管理员邮箱",
      )
      .run();
    const reviewId = Number(inserted.meta.last_row_id);
    const auth = await login();

    const response = await adminAction(auth, reviewId, "author-lookup");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, delivered: true });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(authorUserId);
    expect(raw).not.toContain(subject);
    expect(raw).not.toContain(submitterHash);

    expect(capturedMail).toHaveLength(1);
    expect(capturedMail[0]?.to).toEqual(["admin@example.test"]);
    expect(capturedMail[0]?.subject).toContain(`#${reviewId}`);
    expect(capturedMail[0]?.text).toContain(authorUserId);
    expect(capturedMail[0]?.text).toContain(subject);
    expect(capturedMail[0]?.text).toContain(submitterHash);
    expect(capturedMail[0]?.html).not.toContain("<script");

    const event = await env.DB.prepare(
      `SELECT action,note,actor_session_id FROM review_moderation_events
       WHERE review_id=? AND action='author_lookup'`,
    )
      .bind(reviewId)
      .first<{
        action: string;
        note: string;
        actor_session_id: string | null;
      }>();
    expect(event).toMatchObject({
      action: "author_lookup",
      note: "sent",
      actor_session_id: expect.any(String),
    });

    const publicEvents = await SELF.fetch(
      `${origin}/api/admin/reviews/${reviewId}/events`,
      { headers: { Cookie: auth.cookie } },
    );
    const publicEventsRaw = await publicEvents.text();
    expect(publicEventsRaw).toContain("author_lookup");
    expect(publicEventsRaw).not.toContain("actor_session_id");
    expect(publicEventsRaw).not.toContain(authorUserId);
  });

  it("audits a failed author mail without returning private data", async () => {
    installMailMock(500);
    const inserted = await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,category,overall,status,submitter_hash,comment)
       VALUES(1,1,'general',4,'approved','failed-mail-private-hash','失败投递审计')`,
    ).run();
    const reviewId = Number(inserted.meta.last_row_id);
    const auth = await login();
    const response = await adminAction(auth, reviewId, "author-lookup");
    expect(response.status).toBe(502);
    const raw = await response.text();
    expect(raw).not.toContain("failed-mail-private-hash");
    expect(
      await env.DB.prepare(
        `SELECT action,note,actor_session_id FROM review_moderation_events
         WHERE review_id=? AND action='author_lookup'`,
      )
        .bind(reviewId)
        .first(),
    ).toMatchObject({
      action: "author_lookup",
      note: "failed",
      actor_session_id: expect.any(String),
    });
  });

  it("treats missing author-lookup mail bindings as unconfigured without leaking private data", async () => {
    const previousTo = (env as { REVIEW_AUTHOR_LOOKUP_TO?: string })
      .REVIEW_AUTHOR_LOOKUP_TO;
    (env as { REVIEW_AUTHOR_LOOKUP_TO?: string }).REVIEW_AUTHOR_LOOKUP_TO = "";
    try {
      expect(await deliverReviewAuthorLookup({}, {
        reviewId: 1,
        courseCode: "TEST0001",
        courseName: "未配置投递",
        teacherName: "",
        headline: "",
        comment: "private-unconfigured-comment",
        reviewCreatedAt: "2026-08-24T00:00:00.000Z",
        reviewStatus: "approved",
        blockedAt: null,
        deletedAt: null,
        submitterHash: "unconfigured-private-hash",
        authorUserId: "unconfigured-private-user",
        authorStatus: "active",
        authorCreatedAt: "2026-08-24T00:00:00.000Z",
        identities: [],
        requestedBySessionId: "session",
      })).toBe("unconfigured");

      const inserted = await env.DB.prepare(
        `INSERT INTO reviews(course_id,teacher_id,category,overall,status,submitter_hash,comment)
         VALUES(1,1,'general',4,'approved','unconfigured-private-hash','未配置投递审计')`,
      ).run();
      const reviewId = Number(inserted.meta.last_row_id);
      const auth = await login();
      const response = await adminAction(auth, reviewId, "author-lookup");
      expect(response.status).toBe(503);
      const raw = await response.text();
      expect(raw).not.toContain("unconfigured-private-hash");
      expect(raw).not.toContain("unconfigured-private-user");
      expect(
        await env.DB.prepare(
          `SELECT action,note,actor_session_id FROM review_moderation_events
           WHERE review_id=? AND action='author_lookup'`,
        )
          .bind(reviewId)
          .first(),
      ).toMatchObject({
        action: "author_lookup",
        note: "unconfigured",
        actor_session_id: expect.any(String),
      });
    } finally {
      (env as { REVIEW_AUTHOR_LOOKUP_TO?: string }).REVIEW_AUTHOR_LOOKUP_TO =
        previousTo;
    }
  });

  it("blocks and deletes a public historical review without author lookup", async () => {
    const historicalId = `admin-hist-${crypto.randomUUID()}`;
    const comment = "管理员可屏蔽删除的历史评价";
    await env.DB.prepare(
      `INSERT INTO public_historical_reviews(
         id,course_id,teacher_id,comment,package_contract,
         approved_package_manifest_sha256,approved_catalog_content_sha256
       ) VALUES(?,?,?,?,?,?,?)`,
    )
      .bind(
        historicalId,
        1,
        1,
        comment,
        "legacy-historical-production-freeze-v1",
        "a".repeat(64),
        "b".repeat(64),
      )
      .run();
    const publicId = `historical:${historicalId}`;
    expect(await publicReviewText()).toContain(comment);

    const auth = await login();
    const lookup = await adminAction(auth, publicId, "author-lookup");
    expect(lookup.status).toBe(404);
    expect(await lookup.json()).toEqual({ error: "历史评价没有作者账号" });

    const blocked = await adminAction(auth, publicId, "block");
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({ ok: true, changed: true });
    expect(await publicReviewText()).not.toContain(comment);

    const adminPage = await courseReviewPage({ Cookie: auth.cookie });
    expect(reviewByComment(adminPage.items, comment)).toMatchObject({
      id: publicId,
      blocked: true,
      endorsable: false,
    });

    const endorser = await ordinaryWriteSession("admin-historical-endorser");
    const endorsement = await SELF.fetch(
      `${origin}/api/reviews/${encodeURIComponent(publicId)}/endorsement`,
      {
        method: "PUT",
        headers: ordinaryWriteHeaders(endorser, {
          "Idempotency-Key": "blocked-historical-endorsement",
        }),
      },
    );
    expect(endorsement.status).toBe(404);

    const unblocked = await adminAction(auth, publicId, "unblock");
    expect(await unblocked.json()).toEqual({ ok: true, changed: true });
    expect(await publicReviewText()).toContain(comment);

    const deleted = await adminAction(auth, publicId, "delete");
    expect(await deleted.json()).toEqual({ ok: true, changed: true });
    expect(await publicReviewText()).not.toContain(comment);
    expect(
      await env.DB.prepare(
        "SELECT blocked_at,deleted_at FROM public_historical_reviews WHERE id=?",
      )
        .bind(historicalId)
        .first(),
    ).toMatchObject({ deleted_at: expect.any(String) });
  });
});
