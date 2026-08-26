/**
 * 全部消息 /notices（#460 前端）：仅登录普通用户可见，访客重定向到登录页。
 * 打开本页即调用 POST /api/user/notifications/read 清零未读，
 * 并广播事件让顶栏角标同步消失。接口失败时提示暂时加载不了。
 */
import { Alert, Chip, Spinner, Typography } from "@heroui/react";
import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useViewer } from "../hooks/useViewer";
import { announceNotificationsRead } from "../hooks/useUnreadNotifications";
import { api } from "../lib/api";
import {
  isDevAtlasSession,
  previewFilledNotices,
  readDevPreview,
} from "../lib/dev-preview";
import { formatReviewDate } from "../lib/review-date";
import type { UserNotification } from "../lib/types";

function normalizeNotifications(
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

export function NoticesPage() {
  const { viewer, ready } = useViewer();
  const [searchParams] = useSearchParams();
  const preview = readDevPreview(searchParams);
  const skipGate = isDevAtlasSession(searchParams);
  const [items, setItems] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (preview === "error") {
      setItems([]);
      setAvailable(false);
      setLoading(false);
      return;
    }
    if (preview === "empty") {
      setItems([]);
      setAvailable(true);
      setLoading(false);
      return;
    }
    if (preview === "filled") {
      setItems(previewFilledNotices());
      setAvailable(true);
      setLoading(false);
      return;
    }
    if (!ready) return;
    if (!viewer.authenticated) {
      if (skipGate) {
        setItems([]);
        setAvailable(true);
        setLoading(false);
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<UserNotification[] | { items?: UserNotification[] }>(
      "/api/user/notifications",
    )
      .then((data) => {
        if (cancelled) return;
        setItems(normalizeNotifications(data));
        setAvailable(true);
        // 打开消息页即清零未读（#460）；标记失败不影响列表展示。
        api("/api/user/notifications/read", { method: "POST", body: "{}" })
          .then(() => announceNotificationsRead())
          .catch(() => {});
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
  }, [ready, viewer.authenticated, preview, skipGate]);

  if (!ready && !skipGate) {
    return (
      <section aria-label="全部消息" className="py-8">
        <p className="m-0 flex items-center gap-2 text-sm text-muted">
          <Spinner color="current" size="sm" />
          正在读取登录状态…
        </p>
      </section>
    );
  }

  if (!viewer.authenticated && !skipGate) {
    const from = encodeURIComponent("/notices");
    return <Navigate to={`${viewer.loginPath}?from=${from}`} replace />;
  }

  return (
    <section aria-labelledby="notices-heading" className="mx-auto max-w-2xl">
      <Typography
        className="m-0 text-lg font-bold leading-tight tracking-tight text-foreground"
        id="notices-heading"
        type="h1"
      >
        全部消息
      </Typography>
      {!available ? (
        <Alert className="mt-4" status="accent">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>消息暂时加载不了</Alert.Title>
            <Alert.Description>请稍后再试。</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : loading ? (
        <p
          className="m-0 flex items-center gap-2 py-10 text-sm text-muted"
          role="status"
        >
          <Spinner color="current" size="sm" />
          正在加载消息…
        </p>
      ) : items.length === 0 ? (
        <p className="mt-8 text-sm text-muted" role="status">
          还没有消息哦！
        </p>
      ) : (
        <ul className="m-0 mt-2 list-none divide-y divide-separator p-0">
          {items.map((notice) => {
            const date = formatReviewDate(notice.created_at);
            return (
              <li key={notice.id} className="py-3">
                <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-sm leading-6">
                  {notice.href ? (
                    <RouterAriaLink to={notice.href} className="text-accent">
                      {notice.text}
                    </RouterAriaLink>
                  ) : (
                    <span>{notice.text}</span>
                  )}
                  {notice.read === false ? (
                    <Chip color="accent" size="sm" variant="soft">
                      新
                    </Chip>
                  ) : null}
                </p>
                {date ? (
                  <time
                    className="mt-1 block text-xs text-muted"
                    dateTime={date}
                  >
                    {date}
                  </time>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
