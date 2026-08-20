import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTH_PROVIDER_EMAIL,
  EMAIL_IDENTITY_ISSUER,
} from "../src/ordinary-user-identity";
import {
  EMAIL_LOGIN_COOKIE,
  ORDINARY_USER_CSRF_COOKIE,
} from "../src/ordinary-user-session";

const origin = "https://example.com";
const mailOrigin = "https://mail.example.test";
const studentEmail = "2202100001@stu.jxufe.edu.cn";

type CapturedMail = {
  url: string;
  authorization: string;
  body: {
    from?: string;
    to?: string[];
    subject?: string;
    text?: string;
  };
};

const originalFetch = globalThis.fetch;
let capturedMail: CapturedMail[] = [];
let mailStatus = 200;

function installMailMock() {
  capturedMail = [];
  mailStatus = 200;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin === mailOrigin) {
      capturedMail.push({
        url: request.url,
        authorization: request.headers.get("authorization") || "",
        body: (await request.json()) as CapturedMail["body"],
      });
      return new Response(JSON.stringify({ id: "mail_test" }), {
        status: mailStatus,
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

function assertNoIdentityLeak(value: unknown) {
  const raw = JSON.stringify(value);
  expect(raw).not.toMatch(/2202100001|stu\.jxufe\.edu\.cn|test-mail-token/);
  expect(raw).not.toMatch(/验证码：\d{6}/);
  expect(raw).not.toMatch(/[?&]token=[a-f0-9]{32,}/);
  expect(raw).not.toMatch(/"id":"[0-9a-f]{32}"/);
}

function cookieHeader(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?(): string[] };
  return (headers.getSetCookie?.() || [])
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function parseMailSecrets(text: string) {
  const code = /验证码：(\d{6})/.exec(text)?.[1];
  const token = /[?&]token=([a-f0-9]+)/.exec(text)?.[1];
  expect(code).toMatch(/^\d{6}$/);
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  return { code: code!, token: token! };
}

let ipSeq = 10;
function nextIp() {
  ipSeq += 1;
  return `198.51.100.${ipSeq}`;
}

async function requestEmail(
  email: string,
  ip = nextIp(),
  extra: Record<string, unknown> = {},
) {
  return SELF.fetch(`${origin}/api/auth/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify({ email, ...extra }),
  });
}

async function verifyBody(body: Record<string, unknown>, ip = nextIp()) {
  return SELF.fetch(`${origin}/api/auth/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("school-email login", () => {
  it("sends one outbound mail for a qualified address and hides the mailbox", async () => {
    installMailMock();
    const response = await requestEmail(studentEmail);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    assertNoIdentityLeak(body);
    expect(capturedMail).toHaveLength(1);
    expect(capturedMail[0]?.url).toBe(`${mailOrigin}/emails`);
    expect(capturedMail[0]?.authorization).toBe("Bearer test-mail-token");
    expect(capturedMail[0]?.body.from).toContain("noreply@sein.moe");
    expect(capturedMail[0]?.body.to).toEqual([studentEmail]);
    parseMailSecrets(capturedMail[0]?.body.text || "");
  });

  it("does not deliver for disallowed addresses and keeps the same success shape", async () => {
    installMailMock();
    const rejected = [
      "name@jxufe.edu.cn",
      "name@mail.stu.jxufe.edu.cn",
      "Name <2202100001@stu.jxufe.edu.cn>",
      "not-an-email",
    ];
    for (const email of rejected) {
      const response = await requestEmail(email);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
    expect(capturedMail).toHaveLength(0);
  });

  it("logs in with the intercepted one-time code and reuses the same user", async () => {
    installMailMock();
    const first = await requestEmail(studentEmail);
    expect(first.status).toBe(200);
    const { code } = parseMailSecrets(capturedMail[0]?.body.text || "");
    const verified = await verifyBody({ email: studentEmail, code });
    expect(verified.status).toBe(200);
    const session = await verified.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(session.authenticated).toBe(true);
    expect(session.csrfToken).toBeTruthy();
    assertNoIdentityLeak(session);
    expect(cookieHeader(verified)).toContain(`${EMAIL_LOGIN_COOKIE}=`);
    expect(cookieHeader(verified)).toContain(`${ORDINARY_USER_CSRF_COOKIE}=`);

    const identity = await env.DB.prepare(
      "SELECT user_id FROM auth_identities WHERE provider=? AND issuer=?",
    )
      .bind(AUTH_PROVIDER_EMAIL, EMAIL_IDENTITY_ISSUER)
      .first<{ user_id: string }>();
    expect(identity?.user_id).toMatch(/^[0-9a-f]{32}$/);

    capturedMail = [];
    const secondRequest = await requestEmail(studentEmail);
    expect(secondRequest.status).toBe(200);
    const { code: secondCode } = parseMailSecrets(
      capturedMail[0]?.body.text || "",
    );
    const second = await verifyBody({ email: studentEmail, code: secondCode });
    expect(second.status).toBe(200);
    const identities = await env.DB.prepare(
      "SELECT COUNT(*) n FROM auth_identities WHERE provider=? AND issuer=?",
    )
      .bind(AUTH_PROVIDER_EMAIL, EMAIL_IDENTITY_ISSUER)
      .first<{ n: number }>();
    expect(identities?.n).toBe(1);

    const reused = await verifyBody({ email: studentEmail, code });
    expect(reused.status).toBe(400);
  });

  it("logs in with the magic token then rejects reuse and expiry", async () => {
    installMailMock();
    const requested = await requestEmail(studentEmail, nextIp(), {
      from: "/courses/1",
    });
    expect(requested.status).toBe(200);
    const { token } = parseMailSecrets(capturedMail[0]?.body.text || "");
    expect(capturedMail[0]?.body.text).toContain("from=%2Fcourses%2F1");

    const verified = await verifyBody({ token });
    expect(verified.status).toBe(200);
    const verifiedBody = await verified.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(verifiedBody.authenticated).toBe(true);
    const cookies = cookieHeader(verified);

    const session = await SELF.fetch(`${origin}/api/user/session`, {
      headers: { Cookie: cookies },
    });
    const sessionBody = await session.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(sessionBody.authenticated).toBe(true);

    const replay = await verifyBody({ token });
    expect(replay.status).toBe(400);

    capturedMail = [];
    await requestEmail(studentEmail);
    const { code: expiredCode } = parseMailSecrets(
      capturedMail[0]?.body.text || "",
    );
    await env.DB.prepare(
      "UPDATE email_login_challenges SET expires_at=unixepoch()-10",
    ).run();
    const expired = await verifyBody({
      email: studentEmail,
      code: expiredCode,
    });
    expect(expired.status).toBe(400);

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

  it("lets cookie+CSRF endorse a review without the HMAC test headers", async () => {
    installMailMock();
    await requestEmail(studentEmail);
    const { code } = parseMailSecrets(capturedMail[0]?.body.text || "");
    const verified = await verifyBody({ email: studentEmail, code });
    const body = await verified.json<{ csrfToken?: string }>();
    const cookies = cookieHeader(verified);
    const inserted = await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,category,overall,comment,status,submitter_hash)
       VALUES(1,1,'general',4,'邮箱会话可认可的补充说明','approved',?)`,
    )
      .bind(`email-endorsement-${Date.now()}`)
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

  it("does not leak tokens when delivery is unconfigured and keeps callback closed", async () => {
    const previousUrl = (env as { MAIL_DELIVERY_URL?: string }).MAIL_DELIVERY_URL;
    (env as { MAIL_DELIVERY_URL?: string }).MAIL_DELIVERY_URL = "";
    installMailMock();
    try {
      const response = await requestEmail("2202199999@stu.jxufe.edu.cn");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ ok: true });
      assertNoIdentityLeak(body);
      expect(capturedMail).toHaveLength(0);
    } finally {
      (env as { MAIL_DELIVERY_URL?: string }).MAIL_DELIVERY_URL = previousUrl;
    }

    const callback = await SELF.fetch(`${origin}/api/auth/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ token: "anything" }),
    });
    expect(callback.status).toBe(503);
  });
});
