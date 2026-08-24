import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { adminLogin as login, adminHeaders } from "./admin-session";

const origin = "https://example.com";

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
      headers: adminHeaders(auth),
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
      headers: adminHeaders(auth),
      body: JSON.stringify({ content: "   " }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ ok: true, content: "" });
  });

  it("rejects invalid content and a missing course", async () => {
    const auth = await login();
    const invalid = await SELF.fetch(`${origin}/api/admin/courses/1/notice`, {
      method: "PUT",
      headers: adminHeaders(auth),
      body: JSON.stringify({ content: "x".repeat(2001) }),
    });
    expect(invalid.status).toBe(400);

    const missing = await SELF.fetch(
      `${origin}/api/admin/courses/999999/notice`,
      {
        method: "PUT",
        headers: adminHeaders(auth),
        body: JSON.stringify({ content: "不存在" }),
      },
    );
    expect(missing.status).toBe(404);
  });
});
