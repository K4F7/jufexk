import { Alert, Button, Card, Spinner } from "@heroui/react";
import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import { backTargetFrom } from "../lib/back-target";

type LogoutState = "confirm" | "pending" | "done" | "error";

/**
 * Guide page for signing out (ADR-0016): the real work is the explicit
 * POST /api/user/logout below, which clears the ordinary-user cookies; this
 * page only guides that action and reports the result. Visiting the URL
 * alone never destroys a session.
 */
export function LogoutPage() {
  const { viewer, ready, clear } = useViewer();
  const [state, setState] = useState<LogoutState>("confirm");
  const [searchParams] = useSearchParams();
  const backTarget = backTargetFrom(searchParams.get("from"));

  const logout = useCallback(async () => {
    setState("pending");
    try {
      await api("/api/user/logout", { method: "POST" });
      clear();
      setState("done");
    } catch {
      setState("error");
    }
  }, [clear]);

  return (
    <section aria-labelledby="logout-heading" className="mx-auto max-w-xl py-8">
      <Card role="article" aria-labelledby="logout-heading">
        <Card.Header>
          <Card.Title id="logout-heading">退出登录</Card.Title>
          <Card.Description>
            退出只会清除本站普通用户会话，公开页面始终可以继续浏览。
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {!ready ? (
            <p className="m-0 flex items-center gap-2 text-sm text-muted">
              <Spinner color="current" size="sm" />
              正在读取登录状态…
            </p>
          ) : null}
          {ready && state === "done" ? (
            <Alert status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>已退出登录</Alert.Title>
                <Alert.Description>
                  普通用户会话已清除，当前为游客状态。
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          {ready && state === "error" ? (
            <div className="flex flex-col items-start gap-3">
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>退出失败</Alert.Title>
                  <Alert.Description>
                    网络或服务暂时不可用，请重试；关闭页面也会随会话过期自动退出。
                  </Alert.Description>
                </Alert.Content>
              </Alert>
              <Button variant="secondary" onPress={() => void logout()}>
                重试退出
              </Button>
            </div>
          ) : null}
          {ready && (state === "confirm" || state === "pending") ? (
            viewer.authenticated ? (
              <Button
                variant="primary"
                isPending={state === "pending"}
                onPress={() => void logout()}
              >
                确认退出登录
              </Button>
            ) : (
              <Alert status="accent">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>当前未登录</Alert.Title>
                  <Alert.Description>
                    你正以游客身份浏览，无需退出。
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            )
          ) : null}
        </Card.Content>
        <Card.Footer>
          <RouterAriaLink to={backTarget}>返回继续浏览</RouterAriaLink>
        </Card.Footer>
      </Card>
    </section>
  );
}
