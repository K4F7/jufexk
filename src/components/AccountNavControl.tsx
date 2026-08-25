import { Badge, Button, Chip, Dropdown, Label, buttonVariants } from "@heroui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAdminSession } from "../hooks/useAdminSession";
import { useViewer } from "../hooks/useViewer";
import { useUnreadNotificationCount } from "../hooks/useUnreadNotifications";
import { RouterAriaLink } from "./RouterAriaLink";

/**
 * Low-emphasis login / account entry in the shell nav (issue #139 / #325 / #595 / #609).
 * The session payload carries no email, sub or users.id. After login the
 * trigger shows only the public handle; guests still see 「登录」. The
 * accessible name stays 「账号」 so existing tests keep working.
 * Guests always get a real login link: CAS password proxy is the
 * production path. AuthBridge callback is abandoned.
 *
 * 登录后菜单含「主页」与「消息」（#459 / #460 / #607）；管理员会话再多一项
 * 「管理后台」。未读数接口不可用时隐藏角标，不影响菜单本身。
 */
export function AccountNavControl() {
  const { viewer, ready } = useViewer();
  const { authed: adminAuthed, ready: adminReady } = useAdminSession();
  const location = useLocation();
  const navigate = useNavigate();
  const unread = useUnreadNotificationCount(viewer.authenticated);

  if (!ready) return null;

  if (!viewer.authenticated) {
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

  return (
    <Dropdown>
      <Badge.Anchor>
        <Button aria-label="账号" size="sm" variant="ghost">
          {viewer.handle ? (
            <span className="max-w-28 truncate">{viewer.handle}</span>
          ) : null}
        </Button>
        {unreadLabel ? (
          <Badge color="danger" size="sm" aria-label={`${unread} 条未读消息`}>
            <Badge.Label>{unreadLabel}</Badge.Label>
          </Badge>
        ) : null}
      </Badge.Anchor>
      <Dropdown.Popover>
        <Dropdown.Menu
          aria-label="账号菜单"
          onAction={(key) => {
            if (key === "profile") navigate("/profile");
            if (key === "notices") navigate("/notices");
            if (key === "admin") navigate("/admin");
            if (key === "logout") navigate(viewer.logoutPath);
          }}
        >
          <Dropdown.Item id="profile" textValue="主页">
            <Label>主页</Label>
          </Dropdown.Item>
          <Dropdown.Item
            id="notices"
            textValue={unreadLabel ? `消息，${unread} 条未读` : "消息"}
          >
            <Label>消息</Label>
            {unreadLabel ? (
              <Chip className="ms-auto" color="danger" size="sm" variant="soft">
                <Chip.Label>{unreadLabel}</Chip.Label>
              </Chip>
            ) : null}
          </Dropdown.Item>
          {adminReady && adminAuthed ? (
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
  );
}
