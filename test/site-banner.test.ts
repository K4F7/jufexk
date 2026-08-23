import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const origin = "https://example.com";

async function login() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": "198.51.100.161",
    },
    body: JSON.stringify({ password: "test-password" }),
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ csrfToken: string }>();
  const setCookies = (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie();
  return {
    cookie: setCookies.map((value) => value.split(";", 1)[0]).join("; "),
    csrf: body.csrfToken,
  };
}

const adminHeaders = (auth: { cookie: string; csrf: string }) => ({
  "Content-Type": "application/json",
  Cookie: auth.cookie,
  Origin: origin,
  "X-CSRF-Token": auth.csrf,
});

describe.sequential("site banner", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM site_banner_history"),
      env.DB.prepare(
        `UPDATE site_banner_current
         SET desktop_html='',mobile_html='',updated_by_session_id=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE id=1`,
      ),
    ]);
  });

  it("returns an empty public banner by default", async () => {
    const response = await SELF.fetch(`${origin}/api/site/banner`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      desktopHtml: "",
      mobileHtml: "",
      updatedAt: expect.any(String),
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("requires an administrator session and CSRF token", async () => {
    const anonymous = await SELF.fetch(`${origin}/api/admin/banner`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ desktopHtml: "桌面", mobileHtml: "移动" }),
    });
    expect(anonymous.status).toBe(401);

    const auth = await login();
    const missingCsrf = await SELF.fetch(`${origin}/api/admin/banner`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: auth.cookie,
        Origin: origin,
      },
      body: JSON.stringify({ desktopHtml: "桌面", mobileHtml: "移动" }),
    });
    expect(missingCsrf.status).toBe(403);
  });

  it("sanitizes, publishes, and records every submitted version", async () => {
    const auth = await login();
    const update = await SELF.fetch(`${origin}/api/admin/banner`, {
      method: "PUT",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        desktopHtml:
          '<p>桌面公告 <a href="https://example.com">详情</a><script>bad()</script></p>',
        mobileHtml: '<p onclick="bad()">移动公告</p>',
      }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      ok: true,
      banner: { updatedAt: expect.any(String) },
    });

    const published = await (
      await SELF.fetch(`${origin}/api/site/banner`)
    ).json<Record<string, unknown>>();
    expect(published).toMatchObject({
      desktopHtml:
        '<p>桌面公告 <a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">详情</a></p>',
      mobileHtml: "<p>移动公告</p>",
    });
    expect(JSON.stringify(published)).not.toContain("session");
    expect(JSON.stringify(published)).not.toContain("script");
    expect(JSON.stringify(published)).not.toContain("onclick");

    const clear = await SELF.fetch(`${origin}/api/admin/banner`, {
      method: "PUT",
      headers: adminHeaders(auth),
      body: JSON.stringify({ desktopHtml: "", mobileHtml: "" }),
    });
    expect(clear.status).toBe(200);
    expect(
      await env.DB.prepare(
        `SELECT desktop_html,mobile_html,updated_by_session_id
         FROM site_banner_current WHERE id=1`,
      ).first(),
    ).toEqual({
      desktop_html: "",
      mobile_html: "",
      updated_by_session_id: expect.any(String),
    });
    const history = await env.DB.prepare(
      `SELECT desktop_html,mobile_html,actor_session_id
       FROM site_banner_history ORDER BY id`,
    ).all();
    expect(history.results).toHaveLength(2);
    expect(history.results[0]).toMatchObject({
      mobile_html: "<p>移动公告</p>",
      actor_session_id: expect.any(String),
    });
    expect(history.results[1]).toMatchObject({
      desktop_html: "",
      mobile_html: "",
      actor_session_id: expect.any(String),
    });
  });

  it("rejects malformed or oversized payloads without writing history", async () => {
    const auth = await login();
    for (const body of [
      { desktopHtml: 123, mobileHtml: "" },
      { desktopHtml: "x".repeat(20_001), mobileHtml: "" },
    ]) {
      const response = await SELF.fetch(`${origin}/api/admin/banner`, {
        method: "PUT",
        headers: adminHeaders(auth),
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(
      await env.DB.prepare("SELECT COUNT(*) count FROM site_banner_history").first(),
    ).toEqual({ count: 0 });
  });
});
