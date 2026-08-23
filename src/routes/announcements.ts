import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { adminAnnouncementSchema } from "./request-schemas";
import { fail, integer, pageArgs, windowedPage } from "./support";

type AnnouncementRow = {
  id: number;
  title: string;
  content: string;
  author: string;
  time: string;
  window_total?: number;
};

const announcementRoutes = new Hono<AppEnv>();

announcementRoutes.get("/api/announcements", async (c) => {
  const { page, size } = pageArgs(c);
  const rows = (
    await c.env.DB.prepare(
      `SELECT id,title,content,author,created_at time,COUNT(*) OVER() window_total
       FROM announcements
       ORDER BY created_at DESC,id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(size, (page - 1) * size)
      .all<AnnouncementRow>()
  ).results;
  const result = await windowedPage(rows, page, async () => {
    const count = await c.env.DB.prepare(
      "SELECT COUNT(*) total FROM announcements",
    ).first<{ total: number }>();
    return Number(count?.total) || 0;
  });
  return c.json({
    ...result,
    page,
    pages: Math.ceil(result.total / size),
  });
});

announcementRoutes.post("/api/admin/announcements", async (c) => {
  const parsed = adminAnnouncementSchema.safeParse(await c.req.json<unknown>());
  if (!parsed.success) return fail(c, "公告标题、内容或作者无效");
  const result = await c.env.DB.prepare(
    "INSERT INTO announcements(title,content,author) VALUES(?,?,?)",
  )
    .bind(parsed.data.title, parsed.data.content, parsed.data.author)
    .run();
  return c.json({ id: Number(result.meta.last_row_id) }, 201);
});

announcementRoutes.put("/api/admin/announcements/:id", async (c) => {
  const id = integer(c.req.param("id"));
  if (!id || id < 1) return fail(c, "公告 ID 无效");
  const parsed = adminAnnouncementSchema.safeParse(await c.req.json<unknown>());
  if (!parsed.success) return fail(c, "公告标题、内容或作者无效");
  const result = await c.env.DB.prepare(
    `UPDATE announcements
     SET title=?,content=?,author=?
     WHERE id=?`,
  )
    .bind(parsed.data.title, parsed.data.content, parsed.data.author, id)
    .run();
  if (!(result.meta.changes || 0)) return fail(c, "公告不存在", 404);
  return c.json({ ok: true });
});

announcementRoutes.delete("/api/admin/announcements/:id", async (c) => {
  const id = integer(c.req.param("id"));
  if (!id || id < 1) return fail(c, "公告 ID 无效");
  const result = await c.env.DB.prepare("DELETE FROM announcements WHERE id=?")
    .bind(id)
    .run();
  if (!(result.meta.changes || 0)) return fail(c, "公告不存在", 404);
  return c.json({ ok: true });
});

export default announcementRoutes;
