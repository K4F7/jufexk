import { Alert, Button, Card, Spinner } from "@heroui/react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import { backTargetFrom } from "../lib/back-target";
import { campusAuthUrl, type CampusAuthStatus } from "../lib/campus-auth";

const SESSION_POLL_MS = 2500;

export function LoginPage() {
  const [campusAuth, setCampusAuth] = useState<CampusAuthStatus | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [searchParams] = useSearchParams();
  const backTarget = backTargetFrom(searchParams.get("from"));
  const { viewer, ready, refresh } = useViewer();
  const navigate = useNavigate();

  useEffect(() => {
    api<CampusAuthStatus>("/api/auth/campus")
      .then(setCampusAuth)
      .catch(() => setCampusAuth({ enabled: false, reason: "not_whitelisted" }));
  }, []);

  const authUrl = campusAuth
    ? campusAuthUrl(campusAuth, backTarget, window.location.origin)
    : "";

  const openAuth = () => {
    if (!authUrl) return;
    const opened = window.open(authUrl, "_blank", "noopener,noreferrer");
    setPopupBlocked(!opened);
    setWaiting(true);
  };

  // While waiting, re-check the session on a timer and whenever the user
  // returns to this tab from the campus auth tab.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void refresh(), SESSION_POLL_MS);
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [waiting, refresh]);

  useEffect(() => {
    if (waiting && viewer.authenticated) {
      navigate(backTarget, { replace: true });
    }
  }, [waiting, viewer.authenticated, navigate, backTarget]);

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
          {ready && viewer.authenticated ? (
            <Alert status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>当前已登录</Alert.Title>
                <Alert.Description>
                  你已完成江西财经大学校园统一身份认证，可以继续浏览；如需退出，请使用导航中的账号菜单。
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : waiting && authUrl ? (
            <div className="flex flex-col items-start gap-3">
              <Alert status="accent">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>等待校园认证完成</Alert.Title>
                  <Alert.Description>
                    已在新标签页打开江西财经大学校园统一身份认证。完成认证后回到此页，会自动继续。
                  </Alert.Description>
                </Alert.Content>
              </Alert>
              <p className="m-0 flex items-center gap-2 text-sm text-muted">
                <Spinner color="current" size="sm" />
                正在等待认证结果…
              </p>
              {popupBlocked ? (
                <p role="alert" className="m-0 text-sm text-danger">
                  浏览器拦截了新标签页，请点击下方按钮重新打开认证页面。
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onPress={openAuth}>
                  重新打开认证页面
                </Button>
                <Button variant="tertiary" onPress={() => setWaiting(false)}>
                  取消等待
                </Button>
              </div>
            </div>
          ) : authUrl ? (
            <div className="flex flex-col items-start gap-3">
              <Button variant="primary" onPress={openAuth}>
                使用校园统一身份认证登录
              </Button>
              <p className="m-0 text-sm text-muted">
                将在新标签页打开江西财经大学校园统一身份认证，完成后回到此页自动继续。
              </p>
            </div>
          ) : (
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
          )}
        </Card.Content>
        <Card.Footer>
          <RouterAriaLink to={backTarget}>返回继续浏览</RouterAriaLink>
        </Card.Footer>
      </Card>
    </section>
  );
}
