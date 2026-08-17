import type { Context } from "hono";
import {
  canOrdinaryUserWrite,
  clearOrdinaryUserCookies,
  ordinaryUserCsrfOk,
  originOk,
  resolveOrdinaryUser,
} from "./ordinary-user-session";

export const USER_ACCOUNT_PATH = "/api/user/account";
export const ACCOUNT_DELETION_RECOVERY_DAYS = 30;

/**
 * Account deletion boundary for ordinary users (issue #139 / ADR-0016).
 * Deletion is a two-step danger action in the UI; here it flips the account
 * to `pending_deletion`, removes recognition and idempotency data, and keeps
 * auth identities so a re-login inside the recovery window still resolves the
 * same users.id. Approved teaching reviews stay anonymous and untouched; no
 * user-linked review column exists yet for unpublished content.
 */
export async function handleDeleteOrdinaryUserAccount(c: Context) {
  const user = await resolveOrdinaryUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);
  if (!canOrdinaryUserWrite(user))
    return c.json({ error: "当前账号状态无法执行删除" }, 403);
  if (!originOk(c) || !ordinaryUserCsrfOk(c))
    return c.json({ error: "安全校验失败，请刷新后重试" }, 403);

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM review_endorsements WHERE user_id=?").bind(
      user.id,
    ),
    c.env.DB.prepare("DELETE FROM write_idempotency WHERE user_id=?").bind(
      user.id,
    ),
    c.env.DB.prepare(
      "UPDATE users SET status='pending_deletion', deletion_requested_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(user.id),
  ]);
  clearOrdinaryUserCookies(c);
  return c.json({
    ok: true,
    status: "pending_deletion",
    recoveryDays: ACCOUNT_DELETION_RECOVERY_DAYS,
  });
}
