import { Envelope } from "@gravity-ui/icons";
import { Badge, Button, Dropdown, Label, Separator, buttonVariants } from "@heroui/react";
import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAdminSession } from "../hooks/useAdminSession";
import { useViewer } from "../hooks/useViewer";
import {
  groupRecentNotifications,
  markNotificationsRead,
  noticeHrefToLocation,
  useRecentNotifications,
  useUnreadNotificationCount,
} from "../hooks/useUnreadNotifications";
import {
  previewNotificationInbox,
  previewUnreadNotificationCount,
  readDevIdentity,
  readDevPreview,
} from "../lib/dev-preview";
import type { UserNotification } from "../lib/types";
import { LogoutConfirmDialog } from "./LogoutConfirmDialog";
import { RouterAriaLink } from "./RouterAriaLink";

const EMPTY_NOTICE_KEY = "empty";
const LOADING_NOTICE_KEY = "loading";
const UNAVAILABLE_NOTICE_KEY = "unavailable";

/**
 * Low-emphasis login / account entry in the shell nav (issue #139 / #325 / #595 / #609).
 * The session payload carries no email, sub or users.id. After login the
 * trigger shows only the public handle (mobile and desktop); guests still
 * see 「登录」. The accessible name stays 「账号」 so existing tests keep
 * working.
 * Guests always get a real login link through the production CAS password proxy.
 *
 * 登录后顶栏为「消息」图标下拉 + 昵称下拉（#459 / #460 / #607）；昵称下拉含「主页」，
 * 管理员会话再多一项「管理后台」。未读角标挂在消息图标上；接口不可用时隐藏。
 * 信封打开官方 Dropdown：关注课/人的新过审评价在上，其余通知在下。
 */
export function AccountNavControl() {
  const { viewer, ready } = useViewer();
  const { authed: adminAuthed, ready: adminReady, ensure: ensureAdmin } = useAdminSession();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const unread = useUnreadNotificationCount(viewer.authenticated);
  const notices = useRecentNotifications(viewer.authenticated);
  const preview = readDevPreview(searchParams);
  const identity = readDevIdentity(searchParams);
  const previewAccount =
    identity !== "guest" &&
    (previewUnreadNotificationCount(preview) != null ||
      previewNotificationInbox(preview) != null);

  if (!ready && !previewAccount) {
    return <span aria-hidden className="inline-block h-8 w-12 shrink-0" />;
  }

  if (!viewer.authenticated && !previewAccount) {
    const from = `${location.pathname}${location.search}`;
    return (
      <RouterAriaLink
        className={`${buttonVariants({ size: "sm", variant: "ghost" })} no-underline`}
        to={`${viewer.loginPath}?from=${encodeURIComponent(from)}`}
      >
        登录
      </RouterAriaLink>
    );
  }

  const unreadLabel = unread && unread > 0 ? (unread > 99 ? "99+" : unread) : null;
  const accountLabel = viewer.handle || (previewAccount ? "匿名用户#000001" : "账号");
  const { followReviews, others } = groupRecentNotifications(notices.items);
  const statusKey = notices.loading
    ? LOADING_NOTICE_KEY
    : !notices.available
      ? UNAVAILABLE_NOTICE_KEY
      : notices.items.length === 0
        ? EMPTY_NOTICE_KEY
        : null;

  return (
    <div className="flex items-center">
      <Badge.Anchor>
        <Dropdown
          onOpenChange={(open) => {
            if (!open || previewAccount || !viewer.authenticated) return;
            if (!notices.available && !notices.loading) return;
            void markNotificationsRead();
          }}
        >
          <Button
            aria-label="消息"
            isIconOnly
            size="sm"
            variant="ghost"
          >
            <Envelope aria-hidden />
          </Button>
          <Dropdown.Popover
            className="notice-popover min-w-[256px] max-sm:min-w-0 max-sm:w-max max-sm:max-w-xs"
            containerPadding={8}
            placement="bottom end"
          >
            <Dropdown.Menu
              aria-label="消息列表"
              disabledKeys={statusKey ? [statusKey] : []}
              onAction={(key) => {
                const notice = notices.items.find(
                  (item) => String(item.id) === String(key),
                );
                if (notice?.href) navigate(noticeHrefToLocation(notice.href));
              }}
            >
              {notices.loading ? (
                <Dropdown.Item
                  className="max-sm:min-h-11"
                  id={LOADING_NOTICE_KEY}
                  textValue="正在加载消息…"
                >
                  <Label className="whitespace-normal">正在加载消息…</Label>
                </Dropdown.Item>
              ) : !notices.available ? (
                <Dropdown.Item
                  className="max-sm:min-h-11"
                  id={UNAVAILABLE_NOTICE_KEY}
                  textValue="消息暂时加载不了"
                >
                  <Label className="whitespace-normal">消息暂时加载不了</Label>
                </Dropdown.Item>
              ) : notices.items.length === 0 ? (
                <Dropdown.Item
                  className="max-sm:min-h-11"
                  id={EMPTY_NOTICE_KEY}
                  textValue="还没有消息哦！"
                >
                  <Label className="whitespace-normal">还没有消息哦！</Label>
                </Dropdown.Item>
              ) : (
                <>
                  {followReviews.length ? (
                    <Dropdown.Section>
                      {followReviews.map((notice) => (
                        <NoticeMenuItem key={String(notice.id)} notice={notice} />
                      ))}
                    </Dropdown.Section>
                  ) : null}
                  {followReviews.length && others.length ? <Separator /> : null}
                  {others.length ? (
                    <Dropdown.Section>
                      {others.map((notice) => (
                        <NoticeMenuItem key={String(notice.id)} notice={notice} />
                      ))}
                    </Dropdown.Section>
                  ) : null}
                </>
              )}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        {unreadLabel ? (
          <Badge color="danger" size="sm" aria-label={`${unread} 条未读消息`}>
            {unreadLabel}
          </Badge>
        ) : null}
      </Badge.Anchor>
      <Dropdown
        onOpenChange={(open) => {
          if (open && viewer.authenticated && !previewAccount) void ensureAdmin();
        }}
      >
        <Button aria-label="账号" size="sm" variant="ghost">
          <span className="inline-block max-w-28 truncate">{accountLabel}</span>
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            aria-label="账号菜单"
            onAction={(key) => {
              if (key === "profile") navigate("/profile");
              if (key === "admin") navigate("/admin");
              if (key === "logout") setLogoutOpen(true);
            }}
          >
            <Dropdown.Item id="profile" textValue="主页">
              <Label>主页</Label>
            </Dropdown.Item>
            {identity === "admin" ||
            (identity !== "guest" &&
              identity !== "user" &&
              adminReady &&
              adminAuthed) ? (
              <Dropdown.Item id="admin" textValue="管理后台">
                <Label>管理后台</Label>
              </Dropdown.Item>
            ) : null}
            <Dropdown.Item id="logout" textValue="退出登录">
              <Label>退出登录</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      <LogoutConfirmDialog isOpen={logoutOpen} onOpenChange={setLogoutOpen} />
    </div>
  );
}

function NoticeMenuItem({ notice }: { notice: UserNotification }) {
  return (
    <Dropdown.Item
      className="max-sm:min-h-11"
      href={notice.href ?? undefined}
      id={String(notice.id)}
      textValue={notice.text}
    >
      <Label className="max-w-full whitespace-normal break-words [overflow-wrap:anywhere]">
        {notice.text}
      </Label>
    </Dropdown.Item>
  );
}
