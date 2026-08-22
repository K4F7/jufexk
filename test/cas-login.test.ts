import { SELF, env } from "cloudflare:test";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTH_PROVIDER_CAS,
  CAS_IDENTITY_ISSUER,
} from "../src/ordinary-user-identity";
import {
  EMAIL_LOGIN_COOKIE,
  ORDINARY_USER_CSRF_COOKIE,
} from "../src/ordinary-user-session";
import {
  isAllowedCasUrl,
  isSuccessfulCasRedirect,
  normalizeCasUsername,
  parseLoginPage,
} from "../src/lib/jxufe-cas";

const origin = "https://example.com";
const studentId = "2202100099";
const password = "campus-pass-99";
const loginHtml = (execution = "e1s1", encrypt = false) =>
  `<html><body><form><input name="execution" value="${execution}"></form><script>var cfg={"encryptEnabled":"${encrypt ? "true" : "false"}"}</script></body></html>`;

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

type CasCall = { url: string; method: string; body: string };

const originalFetch = globalThis.fetch;
let calls: CasCall[] = [];
let mode:
  | "success"
  | "wrong-password"
  | "mfa"
  | "mfa-bad-code"
  | "blocked-attest"
  | "encrypt" = "success";
let mfaCodeAccepted = "654321";

function installCasMock() {
  calls = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = init?.body ? String(init.body) : "";
    calls.push({ url: request.url, method: request.method, body });

    if (url.hostname === "evil.example") {
      return new Response("blocked", { status: 500 });
    }

    if (url.hostname === "ssl.jxufe.edu.cn" && url.pathname === "/cas/login") {
      if (request.method === "GET") {
        return new Response(loginHtml(mode === "mfa" ? "e1s2" : "e1s1", mode === "encrypt"), {
          status: 200,
          headers: {
            "content-type": "text/html",
            "set-cookie": "JSESSIONID=abc; Path=/cas",
          },
        });
      }
      if (body.includes("wrong-pass") || mode === "wrong-password") {
        return new Response(
          `<html><div id="showErrorTip">用户名或密码错误</div></html>`,
          { status: 401, headers: { "content-type": "text/html" } },
        );
      }
      return new Response(null, {
        status: 302,
        headers: { location: "http://ehall.jxufe.edu.cn/?ticket=ST-test-1" },
      });
    }

    if (url.hostname === "ssl.jxufe.edu.cn" && url.pathname === "/cas/jwt/publicKey") {
      return new Response(publicKeyPem, { status: 200 });
    }

    if (url.hostname === "ssl.jxufe.edu.cn" && url.pathname === "/cas/mfa/detect") {
      const need = mode === "mfa" || mode === "mfa-bad-code" || mode === "blocked-attest";
      return Response.json({
        code: 0,
        data: { need, state: need ? "mfa-state-1" : "" },
      });
    }

    if (
      url.hostname === "ssl.jxufe.edu.cn" &&
      url.pathname === "/cas/mfa/initByType/securephone"
    ) {
      return Response.json({
        code: 0,
        data: {
          attestServerUrl:
            mode === "blocked-attest"
              ? "https://evil.example"
              : "https://mfa.jxufe.edu.cn",
          gid: "gid-1",
          securePhone: "157****3669",
        },
      });
    }

    if (url.hostname === "mfa.jxufe.edu.cn" && url.pathname.endsWith("/send")) {
      return Response.json({ code: 0 });
    }

    if (url.hostname === "mfa.jxufe.edu.cn" && url.pathname.endsWith("/valid")) {
      const parsed = JSON.parse(body || "{}") as { code?: string };
      if (mode === "mfa-bad-code" || parsed.code !== mfaCodeAccepted) {
        return Response.json({ code: 0, data: { status: 0 } });
      }
      return Response.json({ code: 0, data: { status: 2 } });
    }

    return originalFetch(input, init);
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls = [];
  mode = "success";
});

function assertNoIdentityLeak(value: unknown) {
  const raw = JSON.stringify(value);
  expect(raw).not.toMatch(new RegExp(studentId));
  expect(raw).not.toMatch(/campus-pass-99|CASTGC|JSESSIONID=abc|gid-1/);
  expect(raw).not.toMatch(/"id":"[0-9a-f]{32}"/);
}

function cookieHeader(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?(): string[] };
  return (headers.getSetCookie?.() || [])
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

let ipSeq = 20;
function nextIp() {
  ipSeq += 1;
  return `203.0.113.${ipSeq}`;
}

async function startCas(body: Record<string, unknown>, ip = nextIp()) {
  return SELF.fetch(`${origin}/api/auth/cas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
}

async function finishMfa(body: Record<string, unknown>, ip = nextIp()) {
  return SELF.fetch(`${origin}/api/auth/cas/mfa`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("jxufe cas helpers", () => {
  it("accepts campus hosts and ehall ticket redirects", () => {
    expect(isAllowedCasUrl("https://ssl.jxufe.edu.cn/cas/login")).toBe(true);
    expect(isAllowedCasUrl("https://mfa.jxufe.edu.cn/api")).toBe(true);
    expect(isAllowedCasUrl("https://evil.example/cas")).toBe(false);
    expect(isSuccessfulCasRedirect("http://ehall.jxufe.edu.cn/?ticket=ST-1")).toBe(
      true,
    );
    expect(isSuccessfulCasRedirect("/cas/login?reAuthCheck=1")).toBe(false);
    expect(normalizeCasUsername(" 2202100099 ")).toBe("2202100099");
    expect(normalizeCasUsername("not an id")).toBeNull();
    expect(parseLoginPage(loginHtml()).execution).toBe("e1s1");
  });
});

describe("jxufe cas login", () => {
  it("rejects a wrong password without creating a session or identity", async () => {
    mode = "wrong-password";
    installCasMock();
    const before = await env.DB.prepare(
      "SELECT COUNT(*) n FROM auth_identities WHERE provider=?",
    )
      .bind(AUTH_PROVIDER_CAS)
      .first<{ n: number }>();
    const response = await startCas({ username: studentId, password: "wrong-pass" });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: "用户名或密码错误" });
    assertNoIdentityLeak(body);
    expect(cookieHeader(response)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
    const after = await env.DB.prepare(
      "SELECT COUNT(*) n FROM auth_identities WHERE provider=?",
    )
      .bind(AUTH_PROVIDER_CAS)
      .first<{ n: number }>();
    expect(after?.n).toBe(before?.n || 0);
  });

  it("logs in without MFA and reuses the same user", async () => {
    installCasMock();
    const first = await startCas({ username: studentId, password });
    expect(first.status).toBe(200);
    const session = await first.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(session.authenticated).toBe(true);
    expect(session.csrfToken).toBeTruthy();
    assertNoIdentityLeak(session);
    expect(cookieHeader(first)).toContain(`${EMAIL_LOGIN_COOKIE}=`);
    expect(cookieHeader(first)).toContain(`${ORDINARY_USER_CSRF_COOKIE}=`);
    expect(calls.some((call) => /ehall\.jxufe\.edu\.cn\/.+/.test(call.url))).toBe(
      false,
    );

    const identity = await env.DB.prepare(
      "SELECT user_id FROM auth_identities WHERE provider=? AND issuer=?",
    )
      .bind(AUTH_PROVIDER_CAS, CAS_IDENTITY_ISSUER)
      .first<{ user_id: string }>();
    expect(identity?.user_id).toMatch(/^[0-9a-f]{32}$/);

    const leftover = await env.DB.prepare(
      "SELECT COUNT(*) n FROM cas_login_challenges",
    ).first<{ n: number }>();
    expect(leftover?.n).toBe(0);
    const dump = await env.DB.prepare(
      "SELECT * FROM cas_login_challenges",
    ).all();
    expect(JSON.stringify(dump)).not.toContain(password);
    expect(JSON.stringify(dump)).not.toContain("CASTGC");

    const second = await startCas({ username: studentId, password });
    expect(second.status).toBe(200);
    const identities = await env.DB.prepare(
      "SELECT COUNT(*) n FROM auth_identities WHERE provider=? AND issuer=?",
    )
      .bind(AUTH_PROVIDER_CAS, CAS_IDENTITY_ISSUER)
      .first<{ n: number }>();
    expect(identities?.n).toBe(1);
  });

  it("completes MFA then rejects replay and expiry", async () => {
    mode = "mfa";
    installCasMock();
    const started = await startCas({ username: studentId, password });
    expect(started.status).toBe(200);
    const first = await started.json<{
      needsMfa?: boolean;
      challenge?: string;
      maskedPhone?: string;
      authenticated?: boolean;
    }>();
    expect(first.needsMfa).toBe(true);
    expect(first.challenge).toMatch(/^[0-9a-f]{32}$/);
    expect(first.maskedPhone).toBe("157****3669");
    expect(first.authenticated).toBeUndefined();
    assertNoIdentityLeak(first);
    expect(cookieHeader(started)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);

    const stored = await env.DB.prepare(
      "SELECT blob FROM cas_login_challenges WHERE id=?",
    )
      .bind(first.challenge)
      .first<{ blob: string }>();
    expect(stored?.blob).toBeTruthy();
    expect(stored?.blob).not.toContain(password);
    expect(stored?.blob).not.toContain(studentId);
    expect(stored?.blob).not.toContain("CASTGC");

    const bad = await finishMfa({ challenge: first.challenge, code: "000000" });
    expect(bad.status).toBe(401);

    const verified = await finishMfa({
      challenge: first.challenge,
      code: mfaCodeAccepted,
    });
    expect(verified.status).toBe(200);
    const verifiedBody = await verified.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(verifiedBody.authenticated).toBe(true);
    assertNoIdentityLeak(verifiedBody);
    const cookies = cookieHeader(verified);
    expect(cookies).toContain(`${EMAIL_LOGIN_COOKIE}=`);

    const leftover = await env.DB.prepare(
      "SELECT COUNT(*) n FROM cas_login_challenges",
    ).first<{ n: number }>();
    expect(leftover?.n).toBe(0);

    const replay = await finishMfa({
      challenge: first.challenge,
      code: mfaCodeAccepted,
    });
    expect(replay.status).toBe(401);

    mode = "mfa";
    const again = await startCas({ username: studentId, password });
    const againBody = await again.json<{ challenge?: string }>();
    await env.DB.prepare(
      "UPDATE cas_login_challenges SET expires_at=unixepoch()-10",
    ).run();
    const expired = await finishMfa({
      challenge: againBody.challenge,
      code: mfaCodeAccepted,
    });
    expect(expired.status).toBe(401);

    const session = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Cookie: cookies },
    });
    const sessionBody = await session.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(sessionBody.authenticated).toBe(true);
    const logout = await SELF.fetch(`${origin}/api/user/logout`, {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookies,
        "X-CSRF-Token": sessionBody.csrfToken || "",
      },
    });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toMatchObject({ authenticated: false });
  });

  it("fails closed when MFA attest is off campus", async () => {
    mode = "blocked-attest";
    installCasMock();
    const response = await startCas({ username: studentId, password });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "登录失败，请稍后重试",
    });
    expect(
      calls.some((call) => call.url.startsWith("https://evil.example")),
    ).toBe(false);
  });

  it("encrypts the password when CAS enables RSA", async () => {
    mode = "encrypt";
    installCasMock();
    const response = await startCas({ username: studentId, password });
    expect(response.status).toBe(200);
    const detect = calls.find((call) => call.url.includes("/cas/mfa/detect"));
    expect(detect?.body).toContain("__RSA__");
    expect(detect?.body).not.toContain(password);
    const login = calls.find(
      (call) => call.url.includes("/cas/login") && call.method === "POST",
    );
    expect(login?.body).toContain("__RSA__");
    expect(login?.body).not.toContain(password);
    void privateKey;
  });

  it("rate-limits repeated CAS login attempts from one IP", async () => {
    installCasMock();
    const ip = nextIp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await startCas({ username: studentId, password }, ip);
      expect(response.status).toBe(200);
    }
    const blocked = await startCas({ username: studentId, password }, ip);
    expect(blocked.status).toBe(429);
  });

  it("lets cookie+CSRF endorse a review after CAS login", async () => {
    installCasMock();
    const verified = await startCas({ username: studentId, password });
    const body = await verified.json<{ csrfToken?: string }>();
    const cookies = cookieHeader(verified);
    const inserted = await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,category,overall,comment,status,submitter_hash)
       VALUES(1,1,'general',4,'CAS会话可认可的补充说明','approved',?)`,
    )
      .bind(`cas-endorsement-${Date.now()}`)
      .run();
    const reviewId = Number(inserted.meta.last_row_id);
    const endorsed = await SELF.fetch(
      `${origin}/api/reviews/${reviewId}/endorsement`,
      {
        method: "PUT",
        headers: {
          Origin: origin,
          Cookie: cookies,
          "X-CSRF-Token": body.csrfToken || "",
          "Idempotency-Key": crypto.randomUUID(),
        },
      },
    );
    expect(endorsed.status).toBe(200);
    expect(await endorsed.json()).toMatchObject({
      endorsementCount: 1,
      viewerEndorsed: true,
    });
  });
});
