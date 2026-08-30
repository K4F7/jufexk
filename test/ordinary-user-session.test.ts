import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  hmacHex,
  ordinaryUserTestHeaders,
} from "../src/ordinary-user-authentication";
import { ORDINARY_USER_CSRF_COOKIE } from "../src/ordinary-user-write-authorization";
import { adminAuth } from "./admin-session";

const origin = "https://example.com";
function assertNoIdentityLeak(value: unknown) {
  const raw = JSON.stringify(value);
  expect(raw).not.toMatch(/20230001|test-campus-identity/);
  expect(raw).not.toMatch(/"id":"[0-9a-f]{32}"/);
}

describe("ordinary user session boundary", () => {
  it("lets guests read public catalog without a session", async () => {
    const response = await SELF.fetch(`${origin}/api/courses`);
    expect(response.status).toBe(200);
    const session = await SELF.fetch(`${origin}/api/user/session`);
    expect(session.status).toBe(200);
    const body = await session.json();
    expect(body).toMatchObject({
      authenticated: false,
      loginPath: "/login",
      logoutPath: "/logout",
    });
    expect(body).toEqual(
      expect.objectContaining({ csrfToken: expect.any(String) }),
    );
    expect(JSON.stringify(body)).not.toMatch(/guest:|jufexk_voter/);
    assertNoIdentityLeak(body);
    const cookies = (
      session.headers as Headers & { getSetCookie(): string[] }
    ).getSetCookie();
    expect(cookies.some((value) => value.startsWith("jufexk_voter="))).toBe(true);
    expect(cookies.some((value) => value.startsWith("jufexk_user_csrf="))).toBe(
      true,
    );
  });

  it("does not treat banned accounts or admin cookies as writable ordinary users", async () => {
    const auth = await ordinaryUserTestHeaders(
      "banned-hmac-user",
      "test-ordinary-user-auth",
    );
    const created = await SELF.fetch(`${origin}/api/user/session`, {
      headers: auth,
    });
    expect((await created.json<{ authenticated: boolean }>()).authenticated).toBe(
      true,
    );
    const bannedUserId = await hmacHex(
      "ordinary-test-user:banned-hmac-user",
      "test-ordinary-user-auth",
    );
    await env.DB.prepare("UPDATE users SET status='banned' WHERE id=?")
      .bind(bannedUserId)
      .run();
    const banned = await SELF.fetch(`${origin}/api/user/session`, {
      headers: auth,
    });
    expect(await banned.json()).toMatchObject({ authenticated: false });

    const admin = await adminAuth();
    const adminCookie = admin.cookie;
    const adminSession = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Cookie: adminCookie },
    });
    expect(await adminSession.json()).toMatchObject({ authenticated: false });
    const adminMe = await SELF.fetch(`${origin}/api/admin/session`, {
      headers: { Cookie: adminCookie },
    });
    expect(await adminMe.json()).toMatchObject({
      ok: true,
      kind: "admin",
    });
    const bannedLogout = await SELF.fetch(`${origin}/api/user/logout`, {
      method: "POST",
      headers: { ...auth, Origin: origin },
    });
    expect(bannedLogout.status).toBe(200);
  });

  it("keeps the test HMAC path and requires CSRF to log out an authenticated user", async () => {
    const auth = await ordinaryUserTestHeaders(
      "session-hmac-user",
      "test-ordinary-user-auth",
    );
    const session = await SELF.fetch(`${origin}/api/user/session`, {
      headers: auth,
    });
    const body = await session.json<{
      authenticated: boolean;
      csrfToken?: string;
      handle?: string;
      avatar_key?: number;
    }>();
    expect(body.authenticated).toBe(true);
    expect(body.handle).toMatch(/^匿名用户#\d{6}$/);
    expect(body.handle).not.toBe("匿名用户#000000");
    expect(body.avatar_key).toBeGreaterThanOrEqual(0);
    expect(body.avatar_key).toBeLessThan(5);
    assertNoIdentityLeak(body);
    const denied = await SELF.fetch(`${origin}/api/user/logout`, {
      method: "POST",
      headers: { ...auth, Origin: origin },
    });
    expect(denied.status).toBe(403);
    const logout = await SELF.fetch(`${origin}/api/user/logout`, {
      method: "POST",
      headers: {
        ...auth,
        Origin: origin,
        Cookie: `${ORDINARY_USER_CSRF_COOKIE}=${body.csrfToken}`,
        "X-CSRF-Token": body.csrfToken || "",
      },
    });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toMatchObject({
      ok: true,
      authenticated: false,
    });
  });

});
