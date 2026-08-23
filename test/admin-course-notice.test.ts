import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";
let loginSequence = 180;

async function login() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": `198.51.100.${loginSequence++}`,
    },
    body: JSON.stringify({ password: "test-password" }),
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ csrfToken: string }>();
  const cookie = (
    response.headers as Headers & { getSetCookie(): string[] }
  )
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return {
    cookie,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: origin,
      "X-CSRF-Token": body.csrfToken,
    },
  };
}

describe("course administrator notice", () => {
  it("requires an administrator session", async () => {
    const response = await SELF.fetch(`${origin}/api/admin/courses/1/notice`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ content: "公开公告" }),
    });
    expect(response.status).toBe(401);
  });

  it("updates, publishes, and clears a course notice", async () => {
    const auth = await login();
    const updated = await SELF.fetch(`${origin}/api/admin/courses/1/notice`, {
      method: "PUT",
      headers: auth.headers,
      body: JSON.stringify({ content: "  本周课程改为线上进行。  " }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      ok: true,
      content: "本周课程改为线上进行。",
      updatedAt: expect.any(String),
    });

    const detail = await (
      await SELF.fetch(`${origin}/api/courses/1`)
    ).json<{ course: Record<string, unknown> }>();
    expect(detail.course).toMatchObject({
      admin_notice: "本周课程改为线上进行。",
      admin_notice_updated_at: expect.any(String),
    });

    const cleared = await SELF.fetch(`${origin}/api/admin/courses/1/notice`, {
      method: "PUT",
      headers: auth.headers,
      body: JSON.stringify({ content: "   " }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ ok: true, content: "" });
  });

  it("rejects invalid content and a missing course", async () => {
    const auth = await login();
    const invalid = await SELF.fetch(`${origin}/api/admin/courses/1/notice`, {
      method: "PUT",
      headers: auth.headers,
      body: JSON.stringify({ content: "x".repeat(2001) }),
    });
    expect(invalid.status).toBe(400);

    const missing = await SELF.fetch(
      `${origin}/api/admin/courses/999999/notice`,
      {
        method: "PUT",
        headers: auth.headers,
        body: JSON.stringify({ content: "不存在" }),
      },
    );
    expect(missing.status).toBe(404);
  });
});
