import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CAMPUS_JWT_COOKIE, verifyCampusJwtHs256 } from "../src/campus-jwt";
import { campusIdentitySubject } from "../src/ordinary-user-identity";
import {
  ORDINARY_USER_CSRF_COOKIE,
  hmacHex,
  ordinaryUserTestHeaders,
} from "../src/ordinary-user-session";
import { adminAuth } from "./admin-session";

const origin = "https://example.com";
const jwtSecret = "test-campus-jwt-secret";
const aesKeyHex =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const toBase64Url = (bytes: ArrayBuffer | Uint8Array | string) => {
  const raw =
    typeof bytes === "string"
      ? bytes
      : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};

const toStandardBase64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes));

async function signHs256(payload: Record<string, unknown>, secret = jwtSecret) {
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = toBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = toBase64Url(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${header}.${body}`),
    ),
  );
  return `${header}.${body}.${signature}`;
}

async function encryptStudentId(studentId: string) {
  const keyBytes = new Uint8Array(aesKeyHex.length / 2);
  for (let index = 0; index < keyBytes.length; index += 1) {
    keyBytes[index] = Number.parseInt(aesKeyHex.slice(index * 2, index * 2 + 2), 16);
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
  ]);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(studentId),
    ),
  );
  return {
    sub: toStandardBase64(encrypted.slice(0, -16)),
    iv: toStandardBase64(iv),
    tag: toStandardBase64(encrypted.slice(-16)),
    enc: "aes",
  };
}

async function campusToken(input: Record<string, unknown> = {}) {
  return signHs256({
    sub: "campus-stable-sub",
    aud: "jufexk",
    exp: Math.floor(Date.now() / 1000) + 600,
    ...input,
  });
}

async function campusSubject(token: string) {
  const claims = await verifyCampusJwtHs256(token, jwtSecret, "jufexk");
  expect(claims).toBeTruthy();
  const subject = await campusIdentitySubject(claims!, {
    identitySecret: "test-campus-identity",
    aesKeyHex,
  });
  expect(subject).toBeTruthy();
  return subject!;
}

function assertNoIdentityLeak(value: unknown) {
  const raw = JSON.stringify(value);
  expect(raw).not.toMatch(
    /campus-stable-sub|campus-concurrent-sub|20230001|test-campus-jwt-secret/,
  );
  expect(raw).not.toMatch(/"id":"[0-9a-f]{32}"/);
}

function enableCampusJwt() {
  const testEnv = env as typeof env & { CAMPUS_JWT_ENABLED?: string };
  const previous = testEnv.CAMPUS_JWT_ENABLED;
  testEnv.CAMPUS_JWT_ENABLED = "1";
  return () => {
    testEnv.CAMPUS_JWT_ENABLED = previous;
  };
}

describe("ordinary user session boundary", () => {
  it("lets guests read public catalog without a JWT", async () => {
    const response = await SELF.fetch(`${origin}/api/courses`);
    expect(response.status).toBe(200);
    const session = await SELF.fetch(`${origin}/api/user/session`);
    expect(session.status).toBe(200);
    const body = await session.json();
    expect(body).toEqual({
      authenticated: false,
      loginPath: "/login",
      logoutPath: "/logout",
    });
    assertNoIdentityLeak(body);
  });

  it("does not authenticate AuthBridge JWT cookies or Bearer tokens", async () => {
    const token = await campusToken();
    const cookieSession = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Cookie: `${CAMPUS_JWT_COOKIE}=${token}` },
    });
    expect(await cookieSession.json()).toMatchObject({ authenticated: false });
    const bearerSession = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await bearerSession.json()).toMatchObject({ authenticated: false });
    const subject = await campusSubject(token);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) count FROM auth_identities WHERE subject=?",
    )
      .bind(subject)
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
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
    }>();
    expect(body.authenticated).toBe(true);
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

  it("leaves AuthBridge callback closed even when a local token is posted", async () => {
    const response = await SELF.fetch(`${origin}/api/auth/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `token=${await campusToken()}`,
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps AuthBridge callback abandoned even when CAMPUS_JWT_ENABLED=1", async () => {
    const restore = enableCampusJwt();
    try {
      const status = await SELF.fetch(`${origin}/api/auth/campus`);
      expect(await status.json()).toMatchObject({
        enabled: false,
        reason: "abandoned",
      });
      const wrap = await encryptStudentId("20239999");
      const token = await campusToken({ ...wrap, aud: undefined });
      const subject = await campusSubject(token);
      const before = await env.DB.prepare(
        "SELECT COUNT(*) n FROM auth_identities WHERE subject=?",
      )
        .bind(subject)
        .first<{ n: number }>();
      const response = await SELF.fetch(
        `${origin}/api/auth/callback?from=/courses/1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `token=${encodeURIComponent(token)}`,
          redirect: "manual",
        },
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.json()).toMatchObject({
        error: "普通用户认证尚未开放接入",
        reason: "abandoned",
      });
      const after = await env.DB.prepare(
        "SELECT COUNT(*) n FROM auth_identities WHERE subject=?",
      )
        .bind(subject)
        .first<{ n: number }>();
      expect(after?.n).toBe(before?.n || 0);
    } finally {
      restore();
    }
  });
});
