import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { adminLogin as login, adminHeaders } from "./admin-session";

const origin = "https://example.com";


describe("announcement API", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM announcements").run();
  });

  it("returns a public paginated list without internal fields", async () => {
    await env.DB.prepare(
      `INSERT INTO announcements(title,content,author,created_at)
       VALUES('较早公告','旧内容','教务处','2026-08-20 08:00:00'),
             ('最新公告','新内容','站务组','2026-08-21 08:00:00')`,
    ).run();

    const response = await SELF.fetch(
      `${origin}/api/announcements?page=1&pageSize=1`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json<{
      items: Array<Record<string, unknown>>;
      total: number;
      page: number;
      pages: number;
    }>();
    expect(body).toMatchObject({ total: 2, page: 1, pages: 2 });
    expect(body.items).toEqual([
      {
        id: expect.any(Number),
        title: "最新公告",
        content: "新内容",
        author: "站务组",
        time: "2026-08-21 08:00:00",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("created_at");
  });

  it("requires an admin session, same-origin request, and CSRF for writes", async () => {
    const payload = JSON.stringify({
      title: "维护公告",
      content: "今晚维护",
      author: "站务组",
    });
    const anonymous = await SELF.fetch(`${origin}/api/admin/announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: payload,
    });
    expect(anonymous.status).toBe(401);

    const auth = await login();
    const withoutCsrf = await SELF.fetch(`${origin}/api/admin/announcements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: auth.cookie,
        Origin: origin,
      },
      body: payload,
    });
    expect(withoutCsrf.status).toBe(403);
  });

  it("publishes, edits, and deletes an announcement", async () => {
    const auth = await login();
    const create = await SELF.fetch(`${origin}/api/admin/announcements`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({
        title: " 初始公告 ",
        content: " 初始内容 ",
        author: " 站务组 ",
      }),
    });
    expect(create.status).toBe(201);
    const { id } = await create.json<{ id: number }>();
    expect(id).toBeGreaterThan(0);
    await env.DB.prepare(
      "UPDATE announcements SET created_at='2026-08-01 08:00:00' WHERE id=?",
    )
      .bind(id)
      .run();

    const update = await SELF.fetch(
      `${origin}/api/admin/announcements/${id}`,
      {
        method: "PUT",
        headers: adminHeaders(auth),
        body: JSON.stringify({
          title: "更新公告",
          content: "更新内容",
          author: "管理员",
        }),
      },
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ ok: true });

    const list = await SELF.fetch(`${origin}/api/announcements`);
    const body = await list.json<{
      items: Array<{
        id: number;
        title: string;
        content: string;
        author: string;
        time: string;
      }>;
    }>();
    expect(body.items).toEqual([
      expect.objectContaining({
        id,
        title: "更新公告",
        content: "更新内容",
        author: "管理员",
        time: "2026-08-01 08:00:00",
      }),
    ]);

    const remove = await SELF.fetch(
      `${origin}/api/admin/announcements/${id}`,
      { method: "DELETE", headers: adminHeaders(auth) },
    );
    expect(remove.status).toBe(200);
    expect(await remove.json()).toEqual({ ok: true });
    expect(
      await env.DB.prepare("SELECT id FROM announcements WHERE id=?")
        .bind(id)
        .first(),
    ).toBeNull();
  });

  it("validates payloads and reports missing announcements", async () => {
    const auth = await login();
    const invalid = await SELF.fetch(`${origin}/api/admin/announcements`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ title: "", content: "内容", author: "管理员" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "公告标题、内容或作者无效" });

    const missingUpdate = await SELF.fetch(
      `${origin}/api/admin/announcements/999999`,
      {
        method: "PUT",
        headers: adminHeaders(auth),
        body: JSON.stringify({ title: "公告", content: "内容", author: "管理员" }),
      },
    );
    expect(missingUpdate.status).toBe(404);

    const missingDelete = await SELF.fetch(
      `${origin}/api/admin/announcements/999999`,
      { method: "DELETE", headers: adminHeaders(auth) },
    );
    expect(missingDelete.status).toBe(404);
  });
});
