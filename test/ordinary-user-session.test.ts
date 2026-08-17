import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CAMPUS_JWT_COOKIE, verifyCampusJwtHs256 } from "../src/campus-jwt";
import { campusIdentitySubject } from "../src/ordinary-user-identity";
import {
  ORDINARY_USER_CSRF_COOKIE,
  ordinaryUserTestHeaders,
} from "../src/ordinary-user-session";

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

function setCookies(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?(): string[] };
  return headers.getSetCookie?.() || [];
}

function firstSetCookie(response: Response) {
  return (
    setCookies(response).find((value) =>
      value.startsWith(`${CAMPUS_JWT_COOKIE}=`),
    ) ||
    response.headers.get("set-cookie") ||
    ""
  );
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

  it("maps a verified campus JWT to a stable user and issues CSRF", async () => {
    const token = await campusToken();
    const first = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Cookie: `${CAMPUS_JWT_COOKIE}=${token}` },
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(firstBody.authenticated).toBe(true);
    expect(firstBody.csrfToken).toBeTruthy();
    assertNoIdentityLeak(firstBody);

    const second = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await second.json<{ authenticated: boolean }>()).authenticated).toBe(
      true,
    );
    const subject = await campusSubject(token);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) count FROM auth_identities WHERE subject=?",
    )
      .bind(subject)
      .first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it("reuses one user across AES-wrapped tokens for the same campus handle", async () => {
    const firstWrap = await encryptStudentId("20230001");
    const secondWrap = await encryptStudentId("20230001");
    expect(firstWrap.sub).not.toBe(secondWrap.sub);
    const first = await SELF.fetch(`${origin}/api/user/session`, {
      headers: {
        Cookie: `${CAMPUS_JWT_COOKIE}=${await campusToken(firstWrap)}`,
      },
    });
    const second = await SELF.fetch(`${origin}/api/user/session`, {
      headers: {
        Cookie: `${CAMPUS_JWT_COOKIE}=${await campusToken(secondWrap)}`,
      },
    });
    expect((await first.json<{ authenticated: boolean }>()).authenticated).toBe(
      true,
    );
    expect((await second.json<{ authenticated: boolean }>()).authenticated).toBe(
      true,
    );
    const subject = await campusSubject(await campusToken(firstWrap));
    const row = await env.DB.prepare(
      "SELECT COUNT(*) count, COUNT(DISTINCT user_id) users FROM auth_identities WHERE subject=?",
    )
      .bind(subject)
      .first<{ count: number; users: number }>();
    expect(row?.count).toBe(1);
    expect(row?.users).toBe(1);
  });

  it("creates only one identity and user when the same campus subject logs in concurrently", async () => {
    const token = await campusToken({ sub: "campus-concurrent-sub" });
    const before = await env.DB.prepare("SELECT COUNT(*) count FROM users").first<{
      count: number;
    }>();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        SELF.fetch(`${origin}/api/user/session`, {
          headers: { Cookie: `${CAMPUS_JWT_COOKIE}=${token}` },
        }),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const bodies = await Promise.all(
      responses.map((response) =>
        response.json<{ authenticated: boolean }>(),
      ),
    );
    expect(bodies.every((body) => body.authenticated)).toBe(true);
    for (const body of bodies) assertNoIdentityLeak(body);

    const subject = await campusSubject(token);
    const identity = await env.DB.prepare(
      "SELECT COUNT(*) count, COUNT(DISTINCT user_id) users FROM auth_identities WHERE subject=?",
    )
      .bind(subject)
      .first<{ count: number; users: number }>();
    expect(identity?.count).toBe(1);
    expect(identity?.users).toBe(1);

    const after = await env.DB.prepare("SELECT COUNT(*) count FROM users").first<{
      count: number;
    }>();
    expect((after?.count || 0) - (before?.count || 0)).toBe(1);
  });

  it("rejects bad signatures, wrong aud, encrypted tokens without decrypt, and ecc", async () => {
    const good = await campusToken();
    const badSig = `${good.slice(0, -2)}ab`;
    const wrongAud = await campusToken({ aud: "other-app" });
    const ecc = await campusToken({ enc: "ecc" });
    const brokenAes = await campusToken({
      enc: "aes",
      sub: "not-ciphertext",
      iv: "****",
      tag: "****",
    });
    for (const token of [badSig, wrongAud, ecc, brokenAes]) {
      const response = await SELF.fetch(`${origin}/api/user/session`, {
        headers: { Cookie: `${CAMPUS_JWT_COOKIE}=${token}` },
      });
      expect(await response.json()).toMatchObject({ authenticated: false });
    }
  });

  it("does not treat banned accounts or admin cookies as writable ordinary users", async () => {
    const token = await campusToken({ sub: "banned-subject" });
    await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Cookie: `${CAMPUS_JWT_COOKIE}=${token}` },
    });
    const bannedSubject = await campusSubject(token);
    const bannedUser = await env.DB.prepare(
      "SELECT user_id FROM auth_identities WHERE subject=?",
    )
      .bind(bannedSubject)
      .first<{ user_id: string }>();
    expect(bannedUser?.user_id).toBeTruthy();
    await env.DB.prepare("UPDATE users SET status='banned' WHERE id=?")
      .bind(bannedUser?.user_id)
      .run();
    const banned = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Cookie: `${CAMPUS_JWT_COOKIE}=${token}` },
    });
    expect(await banned.json()).toMatchObject({ authenticated: false });

    const login = await SELF.fetch(`${origin}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ password: "test-password" }),
    });
    expect(login.status).toBe(200);
    const adminBody = await login.json<{ kind: string; csrfToken: string }>();
    expect(adminBody.kind).toBe("admin");
    const adminCookie = (
      login.headers as Headers & { getSetCookie(): string[] }
    )
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
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
      headers: { Cookie: `${CAMPUS_JWT_COOKIE}=${token}`, Origin: origin },
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

  it("writes an HttpOnly campus cookie and session after a live AuthBridge callback", async () => {
    const restore = enableCampusJwt();
    try {
      const status = await SELF.fetch(`${origin}/api/auth/campus`);
      expect(await status.json()).toMatchObject({
        enabled: true,
        reason: "live",
        appId: "jufexk",
        audience: "jufexk",
      });
      const wrap = await encryptStudentId("20230001");
      const token = await campusToken({ ...wrap, aud: undefined });
      const response = await SELF.fetch(
        `${origin}/api/auth/callback?from=/courses/1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `token=${encodeURIComponent(token)}`,
          redirect: "manual",
        },
      );
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/courses/1");
      const cookie = firstSetCookie(response);
      expect(cookie).toMatch(new RegExp(`${CAMPUS_JWT_COOKIE}=`));
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      const bodyText = await response.text();
      expect(bodyText).not.toContain(token);
      expect(bodyText).not.toMatch(/20230001|campus-stable-sub/);
      const sessionCookie = cookie.split(";", 1)[0];
      const session = await SELF.fetch(`${origin}/api/user/session`, {
        headers: { Cookie: sessionCookie },
      });
      const body = await session.json<{
        authenticated: boolean;
        csrfToken?: string;
      }>();
      expect(body.authenticated).toBe(true);
      assertNoIdentityLeak(body);
      const logout = await SELF.fetch(`${origin}/api/user/logout`, {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: `${sessionCookie}; ${ORDINARY_USER_CSRF_COOKIE}=${body.csrfToken}`,
          "X-CSRF-Token": body.csrfToken || "",
        },
      });
      expect(logout.status).toBe(200);
      expect(await logout.json()).toMatchObject({ authenticated: false });
      const cleared = setCookies(logout).find((value) =>
        value.startsWith(`${CAMPUS_JWT_COOKIE}=`),
      );
      expect(cleared).toMatch(/Max-Age=0|Expires=/i);
      const after = await SELF.fetch(`${origin}/api/user/session`);
      expect(await after.json()).toMatchObject({ authenticated: false });
    } finally {
      restore();
    }
  });

  it("lets pending_deletion complete callback without restoring, and rejects banned", async () => {
    const restore = enableCampusJwt();
    try {
      const token = await campusToken({ sub: "campus-recovery-sub" });
      const first = await SELF.fetch(`${origin}/api/auth/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `token=${encodeURIComponent(token)}`,
        redirect: "manual",
      });
      expect(first.status).toBe(303);
      const subject = await campusSubject(token);
      const account = await env.DB.prepare(
        "SELECT user_id FROM auth_identities WHERE subject=?",
      )
        .bind(subject)
        .first<{ user_id: string }>();
      expect(account?.user_id).toBeTruthy();
      const setStatus = (status: string, pendingDeletionAt: string | null = null) =>
        env.DB.prepare(
          "UPDATE users SET status=?, pending_deletion_at=? WHERE id=?",
        )
          .bind(status, pendingDeletionAt, account?.user_id)
          .run();

      const requestedAt = new Date(Date.now() - 3600_000).toISOString();
      await setStatus("pending_deletion", requestedAt);
      const recovered = await SELF.fetch(`${origin}/api/auth/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `token=${encodeURIComponent(token)}`,
        redirect: "manual",
      });
      expect(recovered.status).toBe(303);
      expect(recovered.headers.get("location")).not.toBe("/login?error=campus");
      const cookie = firstSetCookie(recovered).split(";", 1)[0];
      const session = await SELF.fetch(`${origin}/api/user/session`, {
        headers: { Cookie: cookie },
      });
      const sessionBody = await session.json<{
        authenticated: boolean;
        accountStatus?: string;
        csrfToken?: string;
        restoreUntil?: string;
      }>();
      expect(sessionBody).toMatchObject({
        authenticated: false,
        accountStatus: "pending_deletion",
      });
      expect(sessionBody.csrfToken).toBeTruthy();
      expect(Date.parse(sessionBody.restoreUntil || "")).toBe(
        Date.parse(requestedAt) + 30 * 24 * 60 * 60 * 1000,
      );
      const stillPending = await env.DB.prepare(
        "SELECT status FROM users WHERE id=?",
      )
        .bind(account?.user_id)
        .first<{ status: string }>();
      expect(stillPending?.status).toBe("pending_deletion");

      await setStatus("banned");
      const banned = await SELF.fetch(`${origin}/api/auth/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `token=${encodeURIComponent(token)}`,
        redirect: "manual",
      });
      expect(banned.status).toBe(303);
      expect(banned.headers.get("location")).toBe("/login?error=campus");
      expect(banned.headers.get("set-cookie")).toBeNull();
    } finally {
      restore();
    }
  });

  it("keeps callback closed with 503 when campus secrets are unbound", async () => {
    const restore = enableCampusJwt();
    const testEnv = env as typeof env & {
      CAMPUS_JWT_SECRET?: string;
      CAMPUS_JWT_AES_KEY?: string;
    };
    const previousSecret = testEnv.CAMPUS_JWT_SECRET;
    const previousAes = testEnv.CAMPUS_JWT_AES_KEY;
    try {
      for (const unset of [
        () => {
          testEnv.CAMPUS_JWT_SECRET = "";
        },
        () => {
          testEnv.CAMPUS_JWT_AES_KEY = "";
        },
      ]) {
        testEnv.CAMPUS_JWT_SECRET = previousSecret;
        testEnv.CAMPUS_JWT_AES_KEY = previousAes;
        unset();
        const response = await SELF.fetch(`${origin}/api/auth/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `token=${encodeURIComponent(await campusToken())}`,
        });
        expect(response.status).toBe(503);
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(await response.text()).not.toMatch(
          /campus-stable-sub|test-campus-jwt-secret/,
        );
      }
    } finally {
      testEnv.CAMPUS_JWT_SECRET = previousSecret;
      testEnv.CAMPUS_JWT_AES_KEY = previousAes;
      restore();
    }
  });

  it("rejects live callback tokens with a bad signature, wrong aud, or expiry", async () => {
    const restore = enableCampusJwt();
    try {
      const good = await campusToken();
      const badSig = `${good.slice(0, -2)}ab`;
      const wrongAud = await campusToken({ aud: "other-app" });
      const expired = await campusToken({
        exp: Math.floor(Date.now() / 1000) - 30,
      });
      for (const token of [badSig, wrongAud, expired, ""]) {
        const response = await SELF.fetch(`${origin}/api/auth/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: token ? `token=${encodeURIComponent(token)}` : "",
          redirect: "manual",
        });
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("/login?error=campus");
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(await response.text()).not.toMatch(
          /campus-stable-sub|test-campus-jwt-secret/,
        );
      }
    } finally {
      restore();
    }
  });
});
