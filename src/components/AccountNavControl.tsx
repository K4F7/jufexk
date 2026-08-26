import { Envelope } from "@gravity-ui/icons";
import { Badge, Button, Dropdown, Label, buttonVariants } from "@heroui/react";
import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useAdminSession } from "../hooks/useAdminSession";
import { useViewer } from "../hooks/useViewer";
import { useUnreadNotificationCount } from "../hooks/useUnreadNotifications";
import {
  previewUnreadNotificationCount,
  readDevPreview,
} from "../lib/dev-preview";
import { RouterAriaLink } from "./RouterAriaLink";

/**
 * Low-emphasis login / account entry in the shell nav (issue #139 / #325 / #595 / #609).
 * The session payload carries no email, sub or users.id. After login the
 * trigger shows only the public handle; guests still see 「登录」. The
 * accessible name stays 「账号」 so existing tests keep working.
 * Guests always get a real login link through the production CAS password proxy.
 *
 * 登录后顶栏为「消息」图标 + 昵称下拉（#459 / #460 / #607）；下拉含「主页」，
 * 管理员会话再多一项「管理后台」。未读角标挂在消息图标上；接口不可用时隐藏。
 */
export function AccountNavControl() {
  const { viewer, ready } = useViewer();
  const { authed: adminAuthed, ready: adminReady } = useAdminSession();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const unread = useUnreadNotificationCount(viewer.authenticated);
  const previewAccount =
    previewUnreadNotificationCount(readDevPreview(searchParams)) != null;

  if (!ready && !previewAccount) return null;

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

  return (
    <div className="flex items-center">
      <Badge.Anchor>
        <Button
          aria-label="消息"
          isIconOnly
          size="sm"
          variant="ghost"
          render={(domProps) => (
            <RouterLink
              {...(domProps as object)}
              className={
                typeof domProps.className === "string"
                  ? domProps.className
                  : undefined
              }
              to="/notices"
            />
          )}
        >
          <Envelope aria-hidden />
        </Button>
        {unreadLabel ? (
          <Badge color="danger" size="sm" aria-label={`${unread} 条未读消息`}>
            {unreadLabel}
          </Badge>
        ) : null}
      </Badge.Anchor>
      <Dropdown>
        <Button aria-label="账号" size="sm" variant="ghost">
          {viewer.handle || previewAccount ? (
            <span className="max-w-28 truncate">
              {viewer.handle || "匿名用户#000001"}
            </span>
          ) : null}
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            aria-label="账号菜单"
            onAction={(key) => {
              if (key === "profile") navigate("/profile");
              if (key === "admin") navigate("/admin");
              if (key === "logout") navigate(viewer.logoutPath);
            }}
          >
            <Dropdown.Item id="profile" textValue="主页">
              <Label>主页</Label>
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
    </div>
  );
}
