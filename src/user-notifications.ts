import { resolveOrdinaryUser } from "./ordinary-user-authentication";
import {
  canOrdinaryUserWrite,
  requireOrdinaryWriteUser,
} from "./ordinary-user-write-authorization";
import type { AppContext } from "./routes/types";

type NotificationRow = {
  id: number;
  type:
    | "followed_relation_review"
    | "review_endorsed"
    | "followed_user_review"
    | "user_followed"
    | "review_comment_replied";
  message: string;
  link: string;
  createdAt: string;
  read: number;
  windowTotal: number;
};

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value || !/^[1-9]\d*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

async function requireNotificationReader(c: AppContext) {
  const user = await resolveOrdinaryUser(c);
  if (!user) return { error: c.json({ error: "请先登录后查看消息" }, 401) };
  if (!canOrdinaryUserWrite(user))
    return { error: c.json({ error: "当前账号无法查看消息" }, 403) };
  return { user };
}

export async function handleListNotifications(c: AppContext) {
  const auth = await requireNotificationReader(c);
  if ("error" in auth) return auth.error;
  const page = positiveInteger(c.req.query("page"), 1);
  const pageSize = Math.min(50, positiveInteger(c.req.query("pageSize"), 20));
  const offset = (page - 1) * pageSize;
  const { results } = await c.env.DB.prepare(
    `SELECT id,type,message,link,created_at AS createdAt,
            read_at IS NOT NULL AS read,COUNT(*) OVER() AS windowTotal
     FROM user_notifications
     WHERE user_id=?
     ORDER BY created_at DESC,id DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(auth.user.id, pageSize, offset)
    .all<NotificationRow>();
  const total = results.length
    ? Number(results[0].windowTotal) || 0
    : page > 1
      ? Number(
          (
            await c.env.DB.prepare(
              "SELECT COUNT(*) count FROM user_notifications WHERE user_id=?",
            )
              .bind(auth.user.id)
              .first<{ count: number }>()
          )?.count || 0,
        )
      : 0;
  return c.json({
    items: results.map(({ windowTotal: _windowTotal, read, ...item }) => ({
      ...item,
      read: Boolean(read),
    })),
    total,
    page,
    pages: Math.ceil(total / pageSize),
  });
}

export async function handleUnreadNotificationCount(c: AppContext) {
  const auth = await requireNotificationReader(c);
  if ("error" in auth) return auth.error;
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) unreadCount FROM user_notifications WHERE user_id=? AND read_at IS NULL",
  )
    .bind(auth.user.id)
    .first<{ unreadCount: number }>();
  return c.json({ unreadCount: Number(row?.unreadCount) || 0 });
}

export async function handleMarkAllNotificationsRead(c: AppContext) {
  const auth = await requireOrdinaryWriteUser(
    c,
    "请先登录后再标记消息",
    "当前账号无法标记消息",
  );
  if ("error" in auth) return auth.error;
  const result = await c.env.DB.prepare(
    `UPDATE user_notifications
     SET read_at=CURRENT_TIMESTAMP
     WHERE user_id=? AND read_at IS NULL`,
  )
    .bind(auth.user.id)
    .run();
  return c.json({
    ok: true,
    markedRead: Number(result.meta.changes) || 0,
    unreadCount: 0,
  });
}
