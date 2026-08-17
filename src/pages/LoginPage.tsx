import { Alert } from "@heroui/react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

type CampusAuthStatus = {
  enabled: boolean;
  reason?: string;
};

export function LoginPage() {
  const [campusAuth, setCampusAuth] = useState<CampusAuthStatus | null>(null);

  useEffect(() => {
    api<CampusAuthStatus>("/api/auth/campus")
      .then(setCampusAuth)
      .catch(() => setCampusAuth({ enabled: false, reason: "not_whitelisted" }));
  }, []);

  return (
    <section aria-labelledby="login-heading" className="mx-auto max-w-xl py-8">
      <h1 id="login-heading" className="m-0 text-xl font-bold">
        普通用户登录
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        通过校园 JWT 取得普通用户会话后，即可投稿或认可任课评价。公开课程、教师和评价页面仍可匿名浏览。
      </p>
      <Alert status="warning" className="mt-4">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>校园 JWT 白名单尚未开通</Alert.Title>
          <Alert.Description>
            已按 AuthBridge 预留 callback 槽位（POST /api/auth/callback，字段
            token），但现在不会跳转或请求校方认证服务。
            {campusAuth && !campusAuth.enabled
              ? " 接入状态：未开放。"
              : null}
          </Alert.Description>
        </Alert.Content>
      </Alert>
    </section>
  );
}
