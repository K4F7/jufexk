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
            登录使用江西财经大学校内邮箱，取得普通用户会话后即可投稿或认可任课评价。公开课程、教师和评价页面无需登录，可继续匿名浏览。
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>校内邮箱登录尚未开放</Alert.Title>
              <Alert.Description>
                学校认证服务还未放行本站，开放前无法登录，也不需要任何操作。
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
