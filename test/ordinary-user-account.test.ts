import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ORDINARY_USER_CSRF_COOKIE,
  hmacHex,
  ordinaryUserTestHeaders,
} from "../src/ordinary-user-session";

const origin = "https://example.com";
const testAuthSecret = "test-ordinary-user-auth";

type SessionBody = {
  authenticated: boolean;
  csrfToken?: string;
};

async function authedUser(userId: string) {
  const auth = await ordinaryUserTestHeaders(userId, testAuthSecret);
  const session = await SELF.fetch(`${origin}/api/user/session`, {
    headers: auth,
  });
  expect(session.status).toBe(200);
  const body = await session.json<SessionBody>();
  expect(body.authenticated).toBe(true);
  expect(body.csrfToken).toBeTruthy();
  return {
    auth,
    csrf: body.csrfToken || "",
    stableUserId: await hmacHex(`ordinary-test-user:${userId}`, testAuthSecret),
  };
}

function deleteHeaders(user: Awaited<ReturnType<typeof authedUser>>) {
  return {
    ...user.auth,
    Origin: origin,
    Cookie: `${ORDINARY_USER_CSRF_COOKIE}=${user.csrf}`,
    "X-CSRF-Token": user.csrf,
  };
}

async function insertReviewWithEndorsement(userId: string, comment: string) {
  const review = await env.DB.prepare(
    `INSERT INTO reviews(
      course_id,teacher_id,category,overall,comment,status,submitter_hash
    ) VALUES(1,1,'general',4,?,'approved',?)`,
  )
    .bind(comment, `account-${comment}-${Date.now()}-${Math.random()}`)
    .run();
  const reviewId = Number(review.meta.last_row_id);
  await env.DB.prepare(
    "INSERT INTO review_endorsements(user_id,review_id) VALUES(?,?)",
  )
    .bind(userId, reviewId)
    .run();
  await env.DB.prepare(
    `INSERT INTO write_idempotency(user_id,operation,idempotency_key,request_digest,status,response_json)
     VALUES(?,'endorsement:create',?,?,200,'{}')`,
  )
    .bind(userId, `account-key-${Date.now()}-${Math.random()}`, "digest")
    .run();
  return reviewId;
}

describe("ordinary user account deletion", () => {
  it("rejects guests and admin cookies with 401", async () => {
    const guest = await SELF.fetch(`${origin}/api/user/account`, {
      method: "DELETE",
      headers: { Origin: origin },
    });
    expect(guest.status).toBe(401);

    const login = await SELF.fetch(`${origin}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ password: "test-password" }),
    });
    expect(login.status).toBe(200);
    const adminCookie = (
      login.headers as Headers & { getSetCookie(): string[] }
    )
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const asAdmin = await SELF.fetch(`${origin}/api/user/account`, {
      method: "DELETE",
      headers: { Origin: origin, Cookie: adminCookie },
    });
    expect(asAdmin.status).toBe(401);
  });

  it("requires same origin and CSRF for authenticated users", async () => {
    const user = await authedUser("account-csrf-user");
    const noCsrf = await SELF.fetch(`${origin}/api/user/account`, {
      method: "DELETE",
      headers: { ...user.auth, Origin: origin },
    });
    expect(noCsrf.status).toBe(403);
    const wrongOrigin = await SELF.fetch(`${origin}/api/user/account`, {
      method: "DELETE",
      headers: { ...deleteHeaders(user), Origin: "https://evil.example" },
    });
    expect(wrongOrigin.status).toBe(403);
    const row = await env.DB.prepare("SELECT status FROM users WHERE id=?")
      .bind(user.stableUserId)
      .first<{ status: string }>();
    expect(row?.status).toBe("active");
  });

  it("rejects banned accounts", async () => {
    const user = await authedUser("account-banned-user");
    await env.DB.prepare("UPDATE users SET status='banned' WHERE id=?")
      .bind(user.stableUserId)
      .run();
    const response = await SELF.fetch(`${origin}/api/user/account`, {
      method: "DELETE",
      headers: deleteHeaders(user),
    });
    expect(response.status).toBe(403);
  });

  it("marks the account pending_deletion, removes recognition data, and clears cookies", async () => {
    const user = await authedUser("account-delete-user");
    const reviewId = await insertReviewWithEndorsement(
      user.stableUserId,
      "删除账号认可清理",
    );

    const response = await SELF.fetch(`${origin}/api/user/account`, {
      method: "DELETE",
      headers: deleteHeaders(user),
    });
    expect(response.status).toBe(200);
    const body = await response.json<{
      ok: boolean;
      status: string;
      recoveryDays: number;
    }>();
    expect(body).toEqual({
      ok: true,
      status: "pending_deletion",
      recoveryDays: 30,
    });
    expect(JSON.stringify(body)).not.toContain(user.stableUserId);

    const cookies = (
      response.headers as Headers & { getSetCookie(): string[] }
    ).getSetCookie();
    expect(cookies.some((value) => value.startsWith("jufexk_campus_jwt="))).toBe(
      true,
    );
    expect(cookies.some((value) => value.startsWith("jufexk_user_csrf="))).toBe(
      true,
    );

    const row = await env.DB.prepare(
      "SELECT status, deletion_requested_at FROM users WHERE id=?",
    )
      .bind(user.stableUserId)
      .first<{ status: string; deletion_requested_at: string | null }>();
    expect(row?.status).toBe("pending_deletion");
    expect(row?.deletion_requested_at).toBeTruthy();

    const endorsement = await env.DB.prepare(
      "SELECT COUNT(*) count FROM review_endorsements WHERE user_id=?",
    )
      .bind(user.stableUserId)
      .first<{ count: number }>();
    expect(endorsement?.count).toBe(0);
    const idempotency = await env.DB.prepare(
      "SELECT COUNT(*) count FROM write_idempotency WHERE user_id=?",
    )
      .bind(user.stableUserId)
      .first<{ count: number }>();
    expect(idempotency?.count).toBe(0);

    // The approved review itself stays; the account row is kept so a re-login
    // inside the recovery window still resolves the same users.id.
    const review = await env.DB.prepare(
      "SELECT status FROM reviews WHERE id=?",
    )
      .bind(reviewId)
      .first<{ status: string }>();
    expect(review?.status).toBe("approved");

    // While pending_deletion, writes stay rejected even with valid auth.
    const write = await SELF.fetch(
      `${origin}/api/reviews/${reviewId}/endorsement`,
      {
        method: "PUT",
        headers: {
          ...user.auth,
          Origin: origin,
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
    );
    expect(write.status).toBe(403);
  });

  it("restores the account when the user re-authenticates inside the recovery window", async () => {
    const user = await authedUser("account-recovery-user");
    const deleted = await SELF.fetch(`${origin}/api/user/account`, {
      method: "DELETE",
      headers: deleteHeaders(user),
    });
    expect(deleted.status).toBe(200);

    const session = await SELF.fetch(`${origin}/api/user/session`, {
      headers: user.auth,
    });
    const body = await session.json<SessionBody>();
    expect(body.authenticated).toBe(true);
    expect(body.csrfToken).toBeTruthy();

    const row = await env.DB.prepare(
      "SELECT status, deletion_requested_at FROM users WHERE id=?",
    )
      .bind(user.stableUserId)
      .first<{ status: string; deletion_requested_at: string | null }>();
    expect(row?.status).toBe("active");
    expect(row?.deletion_requested_at).toBeNull();
  });

  it("rejects a repeat deletion once the account is pending_deletion", async () => {
    const user = await authedUser("account-repeat-user");
    const first = await SELF.fetch(`${origin}/api/user/account`, {
      method: "DELETE",
      headers: deleteHeaders(user),
    });
    expect(first.status).toBe(200);
    const second = await SELF.fetch(`${origin}/api/user/account`, {
      method: "DELETE",
      headers: deleteHeaders(user),
    });
    expect(second.status).toBe(403);
  });
});
