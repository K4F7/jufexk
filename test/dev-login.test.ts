import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  AUTH_PROVIDER_CAS,
  CAS_IDENTITY_ISSUER,
} from "../src/ordinary-user-identity";
import {
  DEV_LOGIN_PATH,
  DEV_LOGIN_USERNAME,
} from "../src/cas-login";
import {
  EMAIL_LOGIN_COOKIE,
  hmacHex,
} from "../src/ordinary-user-authentication";
import { ORDINARY_USER_CSRF_COOKIE } from "../src/ordinary-user-write-authorization";

const productionOrigin = "https://example.com";

function cookieHeader(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?(): string[] };
  return (headers.getSetCookie?.() || [])
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

describe("local-only dev login", () => {
  it("is absent on a production-like Worker hostname", async () => {
    const response = await SELF.fetch(`${productionOrigin}${DEV_LOGIN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: productionOrigin,
      },
      body: "{}",
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Not Found" });
    expect(cookieHeader(response)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
  });

  it("is absent on the production custom domain over HTTPS", async () => {
    const response = await SELF.fetch(
      `https://courses.sein.moe${DEV_LOGIN_PATH}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:5173",
        },
        body: "{}",
      },
    );
    expect(response.status).toBe(404);
    expect(cookieHeader(response)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
  });

  it("rejects a public origin even against a loopback Worker", async () => {
    const response = await SELF.fetch(`http://127.0.0.1:8787${DEV_LOGIN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
      },
      body: "{}",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "来源校验失败" });
    expect(cookieHeader(response)).not.toContain(`${EMAIL_LOGIN_COOKIE}=`);
  });

  it("issues a session when wrangler remaps Host and URL over HTTP", async () => {
    const response = await SELF.fetch(
      `http://courses.sein.moe${DEV_LOGIN_PATH}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:5173",
        },
        body: "{}",
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated: true });
    expect(cookieHeader(response)).toContain(`${EMAIL_LOGIN_COOKIE}=`);
  });

  it("issues a session when wrangler rewrites the URL but Host stays loopback", async () => {
    const response = await SELF.fetch(
      `https://courses.sein.moe${DEV_LOGIN_PATH}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:5173",
          Host: "127.0.0.1:8787",
        },
        body: "{}",
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated: true });
    expect(cookieHeader(response)).toContain(`${EMAIL_LOGIN_COOKIE}=`);
  });

  it("issues the ordinary-user session on wrangler loopback", async () => {
    const response = await SELF.fetch(`http://127.0.0.1:8787${DEV_LOGIN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:5173",
      },
      body: "{}",
    });
    expect(response.status).toBe(200);
    const session = await response.json<{
      authenticated: boolean;
      csrfToken?: string;
    }>();
    expect(session.authenticated).toBe(true);
    expect(session.csrfToken).toBeTruthy();
    expect(JSON.stringify(session)).not.toContain(DEV_LOGIN_USERNAME);
    expect(JSON.stringify(session)).not.toMatch(/"id":"[0-9a-f]{32}"/);
    const cookies = cookieHeader(response);
    expect(cookies).toContain(`${EMAIL_LOGIN_COOKIE}=`);
    expect(cookies).toContain(`${ORDINARY_USER_CSRF_COOKIE}=`);

    const subject = await hmacHex(
      `cas-username:${DEV_LOGIN_USERNAME}`,
      "test-campus-identity",
    );
    const identity = await env.DB.prepare(
      "SELECT user_id FROM auth_identities WHERE provider=? AND issuer=? AND subject=?",
    )
      .bind(AUTH_PROVIDER_CAS, CAS_IDENTITY_ISSUER, subject)
      .first<{ user_id: string }>();
    expect(identity?.user_id).toMatch(/^[0-9a-f]{32}$/);

    const probe = await SELF.fetch("http://127.0.0.1:8787/api/user/session", {
      headers: { Cookie: cookies },
    });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toMatchObject({ authenticated: true });
  });
});
