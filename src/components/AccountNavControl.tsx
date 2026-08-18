import { Button, Dropdown, Label, buttonVariants } from "@heroui/react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import type { CampusAuthStatus } from "../lib/campus-auth";
import { RouterAriaLink } from "./RouterAriaLink";

/**
 * Low-emphasis login / account entry in the shell nav (issue #139).
 * The session payload carries no email, sub or users.id, so the authenticated
 * entry is a generic account menu — nothing identifying is ever rendered.
 *
 * While campus auth reports `enabled: false`, guests get a disabled
 * 「登录未开放」indicator instead of a link into a formless page (Issue #204);
 * the entry becomes a real link again automatically once it is enabled.
 */
export function AccountNavControl() {
  const { viewer, ready } = useViewer();
  const location = useLocation();
  const navigate = useNavigate();
  const [campusEnabled, setCampusEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<CampusAuthStatus>("/api/auth/campus")
      .then((status) => {
        if (!cancelled) setCampusEnabled(Boolean(status.enabled));
      })
      .catch(() => {
        if (!cancelled) setCampusEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;

  if (!viewer.authenticated) {
    // 等接入状态到位再渲染，避免先亮出可点「登录」再收回。
    if (campusEnabled === null) return null;
    if (!campusEnabled) {
      return (
        <Button size="sm" variant="ghost" isDisabled>
          登录未开放
        </Button>
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
