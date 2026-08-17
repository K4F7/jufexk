import { Alert, Card } from "@heroui/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { api } from "../lib/api";

type CampusAuthStatus = {
  enabled: boolean;
  reason?: string;
};

const DEFAULT_BACK_TARGET = "/courses";

/**
 * The return target must stay on this site: absolute URLs, protocol-relative
 * URLs and a loop back onto /login itself all fall back to the catalog.
 */
function backTargetFrom(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return DEFAULT_BACK_TARGET;
  }
  const path = raw.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  if (path === "/login") return DEFAULT_BACK_TARGET;
  return raw;
}

export function LoginPage() {
  const [campusAuth, setCampusAuth] = useState<CampusAuthStatus | null>(null);
  const [searchParams] = useSearchParams();
  const backTarget = backTargetFrom(searchParams.get("from"));

  useEffect(() => {
    api<CampusAuthStatus>("/api/auth/campus")
      .then(setCampusAuth)
      .catch(() => setCampusAuth({ enabled: false, reason: "not_whitelisted" }));
  }, []);

  return (
    <section aria-labelledby="login-heading" className="mx-auto max-w-xl py-8">
      <Card role="article" aria-labelledby="login-heading">
        <Card.Header>
          <Card.Title id="login-heading">普通用户登录</Card.Title>
          <Card.Description>
            大多数访问者是游客，课程、教师和公开评价可直接浏览。只有投稿或认可时才需要校园
            JWT 普通用户会话；管理员后台使用单独的口令登录。
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>校园 JWT 登录尚未开放</Alert.Title>
              <Alert.Description>
                已按 AuthBridge 预留 callback 槽位，但现在不会跳转或请求校方认证服务。
                {campusAuth && !campusAuth.enabled
                  ? " 接入状态：未开放。"
                  : null}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        </Card.Content>
        <Card.Footer>
          <RouterAriaLink to={backTarget}>返回继续浏览</RouterAriaLink>
        </Card.Footer>
      </Card>
    </section>
  );
}
