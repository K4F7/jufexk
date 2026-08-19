import { Button, Chip, Dropdown, Label, buttonVariants } from "@heroui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { useViewer } from "../hooks/useViewer";
import { RouterAriaLink } from "./RouterAriaLink";

/**
 * Low-emphasis login / account entry in the shell nav (issue #139).
 * The session payload carries no email, sub or users.id, so the authenticated
 * entry is a generic account menu — nothing identifying is ever rendered.
 *
 * While campus auth reports `enabled: false`, guests get a non-interactive
 * 「登录未开放」status chip instead of a link into a formless page (Issues
 * #204/#277: a disabled ghost button reads as plain text at link weight, so
 * the closed state is a status label, not a control); the entry becomes a
 * real link again automatically once campus auth is enabled.
 */
export function AccountNavControl({
  campusEnabled,
}: {
  campusEnabled: boolean | null;
}) {
  const { viewer, ready } = useViewer();
  const location = useLocation();
  const navigate = useNavigate();

  if (!ready) return null;

  if (!viewer.authenticated) {
    // 等接入状态到位再渲染，避免先亮出可点「登录」再收回。
    if (campusEnabled === null) return null;
    if (!campusEnabled) {
      return (
        <Chip size="sm" variant="soft">
          登录未开放
        </Chip>
      );
    }
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
