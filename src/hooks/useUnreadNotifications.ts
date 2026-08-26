import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  previewUnreadNotificationCount,
  readDevPreview,
} from "../lib/dev-preview";

/** 消息页标记全部已读后广播，顶栏未读角标随之清零。 */
export const NOTIFICATIONS_READ_EVENT = "jufexk:notifications-read";

export function announceNotificationsRead() {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_READ_EVENT));
}

type UnreadCountPayload = {
  unreadCount?: number;
  count?: number;
  unread?: number;
  unread_count?: number;
};

function readUnreadCount(data: UnreadCountPayload | null | undefined): number {
  if (typeof data?.unreadCount === "number") return data.unreadCount;
  if (typeof data?.count === "number") return data.count;
  if (typeof data?.unread === "number") return data.unread;
  if (typeof data?.unread_count === "number") return data.unread_count;
  return 0;
}

/**
 * 顶栏未读消息角标（#460）：GET /api/user/notifications/unread-count。
 * Worker 把关注（user_followed）与关注课评新点评（followed_relation_review）
 * 等未读行合成一个 unreadCount。接口未上线或请求失败时返回 null —— 隐藏角标。
 * DEV `?preview=notices-badge|notices-badge-zero|filled|empty` 复用图集 mock，不打接口。
 */
export function useUnreadNotificationCount(authenticated: boolean) {
  const [searchParams] = useSearchParams();
  const previewCount = previewUnreadNotificationCount(
    readDevPreview(searchParams),
  );
  const [count, setCount] = useState<number | null>(previewCount);

  useEffect(() => {
    if (previewCount != null) {
      setCount(previewCount);
      return;
    }
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
    api<UnreadCountPayload>("/api/user/notifications/unread-count")
      .then((data) => {
        if (cancelled || readFired) return;
        setCount(readUnreadCount(data));
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, onRead);
    };
  }, [authenticated, previewCount]);

  return count;
}
