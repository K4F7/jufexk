import { Badge, Button, Chip, Dropdown, Label, buttonVariants } from "@heroui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { useViewer } from "../hooks/useViewer";
import { useUnreadNotificationCount } from "../hooks/useUnreadNotifications";
import { RouterAriaLink } from "./RouterAriaLink";

/**
 * Low-emphasis login / account entry in the shell nav (issue #139 / #325).
 * The session payload carries no email, sub or users.id, so the authenticated
 * entry is a generic account menu — nothing identifying is ever rendered.
 * Guests always get a real login link: CAS password proxy is the
 * production path. AuthBridge callback is abandoned.
 *
 * 登录后菜单含「我的主页」与「消息」（#459 / #460）；未读数接口不可用时
 * 隐藏角标，不影响菜单本身。
 */
export function AccountNavControl() {
  const { viewer, ready } = useViewer();
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
          账号
        </Button>
        {unreadLabel ? (
          <Badge color="danger" size="sm" aria-label={`${unread} 条未读消息`}>
            {unreadLabel}
          </Badge>
        ) : null}
      </Badge.Anchor>
      <Dropdown.Popover>
        <Dropdown.Menu
          aria-label="账号菜单"
          onAction={(key) => {
            if (key === "profile") navigate("/profile");
            if (key === "notices") navigate("/notices");
            if (key === "account") navigate("/account");
            if (key === "logout") navigate(viewer.logoutPath);
          }}
        >
          <Dropdown.Item id="profile" textValue="我的主页">
            <Label>我的主页</Label>
          </Dropdown.Item>
          <Dropdown.Item
            id="notices"
            textValue={unreadLabel ? `消息，${unread} 条未读` : "消息"}
          >
            <Label>消息</Label>
            {unreadLabel ? (
              <Chip className="ms-auto" color="danger" size="sm" variant="soft">
                {unreadLabel}
              </Chip>
            ) : null}
          </Dropdown.Item>
          <Dropdown.Item id="account" textValue="账号管理">
            <Label>账号管理</Label>
          </Dropdown.Item>
          <Dropdown.Item id="logout" textValue="退出登录">
            <Label>退出登录</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
