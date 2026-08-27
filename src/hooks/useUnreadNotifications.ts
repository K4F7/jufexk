import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  previewNotificationInbox,
  previewUnreadNotificationCount,
  readDevPreview,
} from "../lib/dev-preview";
import type { UserNotification } from "../lib/types";

/** 顶栏下拉标记全部已读后广播，未读角标随之清零。 */
export const NOTIFICATIONS_READ_EVENT = "jufexk:notifications-read";

export function announceNotificationsRead() {
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_READ_EVENT));
}

/** 打开顶栏消息下拉后清零未读；失败不影响列表展示。 */
export function markNotificationsRead() {
  return api("/api/user/notifications/read", { method: "POST", body: "{}" })
    .then(() => announceNotificationsRead())
    .catch(() => {});
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
    // 下拉清零事件可能先于未读数响应到达；已清零后忽略迟到的旧计数。
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

export function normalizeNotifications(
  data: UserNotification[] | { items?: UserNotification[] } | null,
): UserNotification[] {
  const items = Array.isArray(data) ? data : (data?.items ?? []);
  return items.map((item) => ({
    ...item,
    text: item.text || item.message || "",
    href: item.href ?? item.link,
    created_at: item.created_at ?? item.createdAt,
  }));
}

const FOLLOW_REVIEW_TYPES = new Set([
  "followed_relation_review",
  "followed_user_review",
]);

/** Same-origin notice href → React Router location, keeping ?teacher= and #review-. */
export function noticeHrefToLocation(href: string) {
  const url = new URL(href, "https://jufexk.invalid");
  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
}

/** 顶栏下拉：关注对象的新过审评价在上，其余通知在下。组内保持原列表顺序。 */
export function groupRecentNotifications(items: UserNotification[]) {
  const followReviews: UserNotification[] = [];
  const others: UserNotification[] = [];
  for (const item of items) {
    if (FOLLOW_REVIEW_TYPES.has(item.type ?? "")) followReviews.push(item);
    else others.push(item);
  }
  return { followReviews, others };
}

const RECENT_NOTIFICATION_PAGE_SIZE = 8;

/**
 * 顶栏消息下拉：GET /api/user/notifications（最近若干条）。
 * 打开下拉后由 AccountNavControl POST /read 清零未读。
 * DEV preview 复用图集 mock，不打接口。
 */
export function useRecentNotifications(authenticated: boolean) {
  const [searchParams] = useSearchParams();
  const previewKey = readDevPreview(searchParams);
  const preview = previewNotificationInbox(previewKey);
  const [items, setItems] = useState<UserNotification[]>(preview?.items ?? []);
  const [loading, setLoading] = useState(preview == null && authenticated);
  const [available, setAvailable] = useState(preview?.available ?? true);

  useEffect(() => {
    const mocked = previewNotificationInbox(previewKey);
    if (mocked) {
      setItems(mocked.items);
      setAvailable(mocked.available);
      setLoading(false);
      return;
    }
    if (!authenticated) {
      setItems([]);
      setAvailable(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<UserNotification[] | { items?: UserNotification[] }>(
      `/api/user/notifications?pageSize=${RECENT_NOTIFICATION_PAGE_SIZE}`,
    )
      .then((data) => {
        if (cancelled) return;
        setItems(
          normalizeNotifications(data).slice(0, RECENT_NOTIFICATION_PAGE_SIZE),
        );
        setAvailable(true);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setAvailable(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, previewKey]);

  return { items, loading, available };
}
