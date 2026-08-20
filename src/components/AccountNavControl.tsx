import { Button, Dropdown, Label, buttonVariants } from "@heroui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { useViewer } from "../hooks/useViewer";
import { RouterAriaLink } from "./RouterAriaLink";

/**
 * Low-emphasis login / account entry in the shell nav (issue #139 / #325).
 * The session payload carries no email, sub or users.id, so the authenticated
 * entry is a generic account menu — nothing identifying is ever rendered.
 * Guests always get a real login link: school-email verification is the
 * production path, independent of the parked AuthBridge callback.
 */
export function AccountNavControl() {
  const { viewer, ready } = useViewer();
  const location = useLocation();
  const navigate = useNavigate();

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

  return (
    <Dropdown>
      <Button aria-label="账号" size="sm" variant="ghost">
        账号
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          aria-label="账号菜单"
          onAction={(key) => {
            if (key === "account") navigate("/account");
            if (key === "logout") navigate(viewer.logoutPath);
          }}
        >
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
