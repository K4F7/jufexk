import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  hmacHex,
  ordinaryUserTestHeaders,
} from "../src/ordinary-user-authentication";
import {
  ORDINARY_USER_CSRF_COOKIE,
  canOrdinaryUserWrite,
  ordinaryUserMutationSecurityOk,
  originOk,
  requireOrdinaryWriteUser,
} from "../src/ordinary-user-write-authorization";
import {
  ORDINARY_TEST_AUTH_SECRET,
  ORDINARY_TEST_ORIGIN,
  ordinaryUserRequest,
  withOrdinaryUserContext,
} from "./ordinary-user-context";

const LOGIN_ERROR = "请先登录后再投稿";
const FORBIDDEN_ERROR = "当前账号无法投稿";
const SECURITY_ERROR = "安全校验失败，请刷新后重试";
const CSRF = "csrf-write-gate-token";

async function hmacUser(userId: string) {
  const auth = await ordinaryUserTestHeaders(userId, ORDINARY_TEST_AUTH_SECRET);
  const stableId = await hmacHex(
    `ordinary-test-user:${userId}`,
    ORDINARY_TEST_AUTH_SECRET,
  );
  return { auth, stableId };
}

function writeRequest(
  headers: HeadersInit,
  urlOrigin = ORDINARY_TEST_ORIGIN,
) {
  return ordinaryUserRequest("/write", headers, urlOrigin);
}

async function writeGate(request: Request) {
  const { value } = await withOrdinaryUserContext(request, (c) =>
    requireOrdinaryWriteUser(c, LOGIN_ERROR, FORBIDDEN_ERROR),
  );
  if ("error" in value) {
    return {
      status: value.error.status,
      body: await value.error.json(),
    };
  }
  return { status: 200 as const, user: value.user };
}

function csrfHeaders(auth: Record<string, string>, origin = ORDINARY_TEST_ORIGIN) {
  return {
    ...auth,
    Origin: origin,
    Cookie: `${ORDINARY_USER_CSRF_COOKIE}=${CSRF}`,
    "X-CSRF-Token": CSRF,
  };
}

describe("ordinary user write authorization", () => {
  it("returns 401 for guests before any security or account check", async () => {
    const guest = await writeGate(
      writeRequest({
        Origin: ORDINARY_TEST_ORIGIN,
        Cookie: `${ORDINARY_USER_CSRF_COOKIE}=${CSRF}`,
        "X-CSRF-Token": CSRF,
      }),
    );
    expect(guest).toEqual({ status: 401, body: { error: LOGIN_ERROR } });
  });

  it("returns 403 for banned, pending_deletion, deleted, and muted users", async () => {
    for (const [userId, patch] of [
      ["write-banned-user", "UPDATE users SET status='banned' WHERE id=?"],
      [
        "write-pending-user",
        "UPDATE users SET status='pending_deletion' WHERE id=?",
      ],
      ["write-deleted-user", "UPDATE users SET status='deleted' WHERE id=?"],
    ] as const) {
      const { auth, stableId } = await hmacUser(userId);
      await writeGate(writeRequest(csrfHeaders(auth)));
      await env.DB.prepare(patch).bind(stableId).run();
      const denied = await writeGate(writeRequest(csrfHeaders(auth)));
      expect(denied).toEqual({
        status: 403,
        body: { error: FORBIDDEN_ERROR },
      });
    }

    const muted = await hmacUser("write-muted-user");
    await writeGate(writeRequest(csrfHeaders(muted.auth)));
    await env.DB.prepare(
      "UPDATE users SET muted_until=? WHERE id=?",
    )
      .bind(Math.floor(Date.now() / 1000) + 3600, muted.stableId)
      .run();
    expect(await writeGate(writeRequest(csrfHeaders(muted.auth)))).toEqual({
      status: 403,
      body: { error: FORBIDDEN_ERROR },
    });
  });

  it("requires both exact Origin and CSRF after a writable user is resolved", async () => {
    const { auth } = await hmacUser("write-security-user");
    await writeGate(writeRequest(csrfHeaders(auth)));

    const noOrigin = await writeGate(
      writeRequest({
        ...auth,
        Cookie: `${ORDINARY_USER_CSRF_COOKIE}=${CSRF}`,
        "X-CSRF-Token": CSRF,
      }),
    );
    expect(noOrigin).toEqual({
      status: 403,
      body: { error: SECURITY_ERROR },
    });

    const noCsrf = await writeGate(
      writeRequest({ ...auth, Origin: ORDINARY_TEST_ORIGIN }),
    );
    expect(noCsrf).toEqual({
      status: 403,
      body: { error: SECURITY_ERROR },
    });

    const ok = await writeGate(writeRequest(csrfHeaders(auth)));
    expect(ok.status).toBe(200);
    if ("user" in ok) expect(ok.user.status).toBe("active");
  });

  it("keeps the loopback Origin exception and rejects a foreign Origin", async () => {
    const { value: loopback } = await withOrdinaryUserContext(
      writeRequest(
        { Origin: "http://127.0.0.1:5173", Host: "127.0.0.1:8787" },
        "http://127.0.0.1:8787",
      ),
      async (c) => originOk(c),
    );
    expect(loopback).toBe(true);

    const { value: foreign } = await withOrdinaryUserContext(
      writeRequest({ Origin: "https://evil.example" }),
      async (c) => originOk(c),
    );
    expect(foreign).toBe(false);
  });

  it("rejects non-active users that authentication still returns", async () => {
    const { auth, stableId } = await hmacUser("write-auth-status");
    await writeGate(writeRequest(csrfHeaders(auth)));
    await env.DB.prepare("UPDATE users SET status='banned' WHERE id=?")
      .bind(stableId)
      .run();
    const denied = await writeGate(writeRequest(csrfHeaders(auth)));
    expect(denied).toEqual({
      status: 403,
      body: { error: FORBIDDEN_ERROR },
    });
    expect(
      canOrdinaryUserWrite({ id: stableId, status: "banned" }),
    ).toBe(false);
  });

  it("lets special account mutations reuse Origin+CSRF without the active-only gate", async () => {
    const { value: ok } = await withOrdinaryUserContext(
      writeRequest({
        Origin: ORDINARY_TEST_ORIGIN,
        Cookie: `${ORDINARY_USER_CSRF_COOKIE}=${CSRF}`,
        "X-CSRF-Token": CSRF,
      }),
      async (c) => ordinaryUserMutationSecurityOk(c),
    );
    expect(ok).toBe(true);

    const pending = await hmacUser("write-restore-security");
    await writeGate(writeRequest(csrfHeaders(pending.auth)));
    await env.DB.prepare(
      "UPDATE users SET status='pending_deletion' WHERE id=?",
    )
      .bind(pending.stableId)
      .run();
    const blockedByWriteGate = await writeGate(
      writeRequest(csrfHeaders(pending.auth)),
    );
    expect(blockedByWriteGate).toEqual({
      status: 403,
      body: { error: FORBIDDEN_ERROR },
    });
    const { value: securityStillOk } = await withOrdinaryUserContext(
      writeRequest(csrfHeaders(pending.auth)),
      async (c) => ordinaryUserMutationSecurityOk(c),
    );
    expect(securityStillOk).toBe(true);
  });
});
