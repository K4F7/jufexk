import { useEffect, useState } from "react";
import { api } from "../lib/api";

/** 消息页标记全部已读后广播，顶栏未读角标随之清零。 */
export const NOTIFICATIONS_READ_EVENT = "jufexk:notifications-read";

export function announceNotificationsRead() {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_READ_EVENT));
}

/**
 * 顶栏未读消息角标（#460）：GET /api/user/notifications/unread-count。
 * 接口未上线或请求失败时返回 null —— 隐藏角标，不影响账号菜单可用性。
 */
export function useUnreadNotificationCount(authenticated: boolean) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!authenticated) {
      setCount(null);
      return;
    }
    let cancelled = false;
    // 消息页清零事件可能先于未读数响应到达；已清零后忽略迟到的旧计数。
    let readFired = false;
    const onRead = () => {
      readFired = true;
      setCount(0);
    };
    window.addEventListener(NOTIFICATIONS_READ_EVENT, onRead);
    api<{ count?: number; unread?: number; unread_count?: number }>(
      "/api/user/notifications/unread-count",
    )
      .then((data) => {
        if (cancelled || readFired) return;
        const value =
          typeof data?.count === "number"
            ? data.count
            : typeof data?.unread === "number"
              ? data.unread
              : typeof data?.unread_count === "number"
                ? data.unread_count
                : 0;
        setCount(value);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, onRead);
    };
  }, [authenticated]);

  return count;
}
