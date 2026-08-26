import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  EMAIL_LOGIN_COOKIE,
  ORDINARY_USER_ID_HEADER,
  ORDINARY_USER_MAC_HEADER,
  clearOrdinaryUserSessionCookie,
  createOrdinaryUserResolver,
  hmacHex,
  issueOrdinaryUserSessionCookie,
  ordinaryUserTestHeaders,
  resolveOrdinaryUser,
  resolveOrdinaryUserSessionCredential,
  resolveTestHmacCredential,
  type OrdinaryUser,
} from "../src/ordinary-user-authentication";
import { insertUserWithPublicHandle } from "../src/public-handle";
import {
  ORDINARY_IDENTITY_SECRET,
  ORDINARY_TEST_AUTH_SECRET,
  ORDINARY_TEST_ORIGIN,
  ordinaryUserRequest,
  withBinding,
  withOrdinaryUserContext,
} from "./ordinary-user-context";
import { adminAuth } from "./admin-session";

const hmacHeaders = (userId: string) =>
  ordinaryUserTestHeaders(userId, ORDINARY_TEST_AUTH_SECRET);

async function sessionCookieValue(
  userId: string,
  secret = ORDINARY_IDENTITY_SECRET,
  exp = Math.floor(Date.now() / 1000) + 3600,
) {
  const mac = await hmacHex(`email-session:v1:${userId}:${exp}`, secret);
  return { value: `v1.${userId}.${exp}.${mac}`, exp };
}

async function insertUser(id: string, status: OrdinaryUser["status"]) {
  await insertUserWithPublicHandle(env.DB, id);
  if (status !== "active") {
    await env.DB.prepare("UPDATE users SET status=? WHERE id=?")
      .bind(status, id)
      .run();
  }
}

async function resolveFrom(request: Request, testEnv: typeof env = env) {
  const { value } = await withOrdinaryUserContext(
    request,
    (c) => resolveOrdinaryUser(c),
    testEnv,
  );
  return value;
}

describe("ordinary user authentication adapters", () => {
  it("tries injected credential adapters in the given order and stops at the first user", async () => {
    const first: OrdinaryUser = { id: "adapter-first-user", status: "banned" };
    const second: OrdinaryUser = { id: "adapter-second-user", status: "active" };
    const request = ordinaryUserRequest("/auth");
    const { value: winner } = await withOrdinaryUserContext(
      request,
      (c) =>
        createOrdinaryUserResolver([
          async () => first,
          async () => second,
        ])(c),
    );
    expect(winner).toEqual(first);

    const { value: fallback } = await withOrdinaryUserContext(
      request,
      (c) =>
        createOrdinaryUserResolver([
          async () => null,
          async () => second,
        ])(c),
    );
    expect(fallback).toEqual(second);
  });

  it("prefers a valid test HMAC over a valid site session cookie", async () => {
    const hmacKey = "auth-order-hmac";
    const cookieUserId = "cookieuser12";
    await insertUser(cookieUserId, "active");
    const { value: cookie } = await sessionCookieValue(cookieUserId);
    const user = await resolveFrom(
      ordinaryUserRequest("/auth", {
        ...(await hmacHeaders(hmacKey)),
        Cookie: `${EMAIL_LOGIN_COOKIE}=${cookie}`,
      }),
    );
    const expectedId = await hmacHex(
      `ordinary-test-user:${hmacKey}`,
      ORDINARY_TEST_AUTH_SECRET,
    );
    expect(user?.id).toBe(expectedId);
    expect(user?.status).toBe("active");
  });

  it("does not authenticate HMAC headers when the test secret is unbound", async () => {
    const hmacKey = "auth-hmac-unbound";
    const cookieUserId = "cookieplain1";
    await insertUser(cookieUserId, "active");
    const { value: cookie } = await sessionCookieValue(cookieUserId);
    const user = await resolveFrom(
      ordinaryUserRequest("/auth", {
        ...(await hmacHeaders(hmacKey)),
        Cookie: `${EMAIL_LOGIN_COOKIE}=${cookie}`,
      }),
      withBinding("ORDINARY_USER_TEST_AUTH_SECRET", ""),
    );
    expect(user?.id).toBe(cookieUserId);
    const hmacId = await hmacHex(
      `ordinary-test-user:${hmacKey}`,
      ORDINARY_TEST_AUTH_SECRET,
    );
    expect(
      await env.DB.prepare("SELECT id FROM users WHERE id=?")
        .bind(hmacId)
        .first(),
    ).toBeNull();
  });

  it("keeps trying the site cookie after a missing or invalid HMAC header", async () => {
    const cookieUserId = "cookiefallbk";
    await insertUser(cookieUserId, "active");
    const { value: cookie } = await sessionCookieValue(cookieUserId);

    const missing = await resolveFrom(
      ordinaryUserRequest("/auth", {
        Cookie: `${EMAIL_LOGIN_COOKIE}=${cookie}`,
      }),
    );
    expect(missing?.id).toBe(cookieUserId);

    const invalid = await resolveFrom(
      ordinaryUserRequest("/auth", {
        [ORDINARY_USER_ID_HEADER]: "invalid-hmac-user",
        [ORDINARY_USER_MAC_HEADER]: "0".repeat(64),
        Cookie: `${EMAIL_LOGIN_COOKIE}=${cookie}`,
      }),
    );
    expect(invalid?.id).toBe(cookieUserId);
  });

  it("creates and reuses the stable test HMAC user", async () => {
    const hmacKey = "auth-hmac-stable";
    const expectedId = await hmacHex(
      `ordinary-test-user:${hmacKey}`,
      ORDINARY_TEST_AUTH_SECRET,
    );
    const first = await resolveFrom(
      ordinaryUserRequest("/auth", await hmacHeaders(hmacKey)),
    );
    const second = await resolveFrom(
      ordinaryUserRequest("/auth", await hmacHeaders(hmacKey)),
    );
    expect(first?.id).toBe(expectedId);
    expect(second?.id).toBe(expectedId);
    expect(first?.status).toBe("active");
  });

  it("fails closed for a bad, expired, malformed, unsigned, or unknown session cookie", async () => {
    const userId = "cookieclosed1";
    await insertUser(userId, "active");
    const { value: valid } = await sessionCookieValue(userId);
    const { value: expired } = await sessionCookieValue(
      userId,
      ORDINARY_IDENTITY_SECRET,
      Math.floor(Date.now() / 1000) - 10,
    );
    const { value: unknownUser } = await sessionCookieValue("unknownuser1");

    const tampered = (cookie: string) => {
      const last = cookie.slice(-1);
      return `${cookie.slice(0, -1)}${last === "0" ? "1" : "0"}`;
    };

    const cases = [
      ordinaryUserRequest("/auth", {
        Cookie: `${EMAIL_LOGIN_COOKIE}=${tampered(valid)}`,
      }),
      ordinaryUserRequest("/auth", {
        Cookie: `${EMAIL_LOGIN_COOKIE}=${expired}`,
      }),
      ordinaryUserRequest("/auth", {
        Cookie: `${EMAIL_LOGIN_COOKIE}=not-a-session`,
      }),
      ordinaryUserRequest("/auth", {
        Cookie: `${EMAIL_LOGIN_COOKIE}=${unknownUser}`,
      }),
    ];
    for (const request of cases) {
      expect(await resolveFrom(request)).toBeNull();
    }
    expect(
      await env.DB.prepare("SELECT id FROM users WHERE id=?")
        .bind("unknownuser1")
        .first(),
    ).toBeNull();

    const unsigned = await resolveFrom(
      ordinaryUserRequest("/auth", {
        Cookie: `${EMAIL_LOGIN_COOKIE}=${valid}`,
      }),
      withBinding("CAMPUS_IDENTITY_SECRET", ""),
    );
    expect(unsigned).toBeNull();
  });

  it("does not persist expired mute while resolving credentials", async () => {
    const userId = "muteexpired1";
    await insertUser(userId, "active");
    const expiredUntil = Math.floor(Date.now() / 1000) - 10;
    await env.DB.prepare("UPDATE users SET muted_until=? WHERE id=?")
      .bind(expiredUntil, userId)
      .run();
    const { value: cookie } = await sessionCookieValue(userId);
    const user = await resolveFrom(
      ordinaryUserRequest("/auth", {
        Cookie: `${EMAIL_LOGIN_COOKIE}=${cookie}`,
      }),
    );
    expect(user).toMatchObject({ id: userId, status: "active" });
    expect(user?.muted_until).toBe(expiredUntil);
    expect(
      await env.DB.prepare("SELECT muted_until FROM users WHERE id=?")
        .bind(userId)
        .first(),
    ).toEqual({ muted_until: expiredUntil });
  });

  it("issues the same v1.userId.exp.mac site cookie that the cookie adapter accepts", async () => {
    const userId = "issuedcookie1";
    await insertUser(userId, "active");
    const { response } = await withOrdinaryUserContext(
      ordinaryUserRequest("/issue"),
      async (c) => {
        await issueOrdinaryUserSessionCookie(
          c,
          userId,
          ORDINARY_IDENTITY_SECRET,
        );
        return null;
      },
    );
    const setCookie = response.headers.get("set-cookie") || "";
    expect(setCookie).toContain(`${EMAIL_LOGIN_COOKIE}=v1.${userId}.`);
    const match = setCookie.match(
      new RegExp(`${EMAIL_LOGIN_COOKIE}=(v1\\.[^;]+)`),
    );
    expect(match?.[1]).toMatch(/^v1\.[A-Za-z0-9_-]+\.\d+\.[a-f0-9]+$/);

    const { value: fromCookie } = await withOrdinaryUserContext(
      ordinaryUserRequest("/auth", {
        Cookie: `${EMAIL_LOGIN_COOKIE}=${match?.[1]}`,
      }),
      (c) => resolveOrdinaryUserSessionCredential(c),
    );
    expect(fromCookie?.id).toBe(userId);

    const { response: cleared } = await withOrdinaryUserContext(
      ordinaryUserRequest("/clear", {
        Cookie: `${EMAIL_LOGIN_COOKIE}=${match?.[1]}`,
      }),
      async (c) => {
        clearOrdinaryUserSessionCookie(c);
        return null;
      },
    );
    expect(cleared.headers.get("set-cookie") || "").toMatch(
      new RegExp(`${EMAIL_LOGIN_COOKIE}=(?:;|$)`),
    );
  });

  it("returns active, banned, pending_deletion, and deleted users from valid credentials", async () => {
    for (const status of [
      "active",
      "banned",
      "pending_deletion",
      "deleted",
    ] as const) {
      const cookieUserId = `status${status}`.padEnd(12, "x").slice(0, 16);
      await insertUser(cookieUserId, status);
      const { value: cookie } = await sessionCookieValue(cookieUserId);
      const fromCookie = await resolveFrom(
        ordinaryUserRequest("/auth", {
          Cookie: `${EMAIL_LOGIN_COOKIE}=${cookie}`,
        }),
      );
      expect(fromCookie).toMatchObject({ id: cookieUserId, status });

      const hmacKey = `hmac-${status}-user`;
      const created = await resolveFrom(
        ordinaryUserRequest("/auth", await hmacHeaders(hmacKey)),
      );
      expect(created).toBeTruthy();
      await env.DB.prepare("UPDATE users SET status=? WHERE id=?")
        .bind(status, created!.id)
        .run();
      const fromHmac = await resolveFrom(
        ordinaryUserRequest("/auth", await hmacHeaders(hmacKey)),
      );
      expect(fromHmac?.status).toBe(status);
    }
  });

  it("does not authenticate unknown cookies, Bearer tokens, or admin cookies", async () => {
    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjYW1wdXMtc3RhYmxlLXN1YiIsImV4cCI6OTk5OTk5OTk5OX0.sig";
    const admin = await adminAuth();
    expect(
      await resolveFrom(
        ordinaryUserRequest("/auth", {
          Cookie: `unknown_session=${token}`,
        }),
      ),
    ).toBeNull();
    expect(
      await resolveFrom(
        ordinaryUserRequest("/auth", { Authorization: `Bearer ${token}` }),
      ),
    ).toBeNull();
    expect(
      await resolveFrom(
        ordinaryUserRequest("/auth", { Cookie: admin.cookie }),
      ),
    ).toBeNull();
  });

  it("lets the HMAC adapter stay silent when the secret is missing so the cookie adapter can run", async () => {
    const { value } = await withOrdinaryUserContext(
      ordinaryUserRequest("/auth", await hmacHeaders("hmac-silent")),
      (c) => resolveTestHmacCredential(c),
      withBinding("ORDINARY_USER_TEST_AUTH_SECRET", undefined),
    );
    expect(value).toBeNull();
  });
});
