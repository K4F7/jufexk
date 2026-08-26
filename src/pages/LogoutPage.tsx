import { Alert, Button, Card } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DetailLoadingStatus } from "../components/DetailFeedback";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";
import { readDevPreview } from "../lib/dev-preview";

type LogoutState = "confirm" | "pending" | "done" | "error";

/**
 * Guide page for signing out (ADR-0016): the real work is the explicit
 * POST /api/user/logout below, which clears the ordinary-user cookies; this
 * page only guides that action and reports the result. Visiting the URL
 * alone never destroys a session.
 */
export function LogoutPage() {
  const { viewer, ready, clear } = useViewer();
  const [searchParams] = useSearchParams();
  const preview = readDevPreview(searchParams);
  const [state, setState] = useState<LogoutState>(() => {
    if (preview === "done") return "done";
    if (preview === "error") return "error";
    return "confirm";
  });
  const previewAuthed = preview === "confirm" || preview === "error";

  useEffect(() => {
    if (preview === "done") setState("done");
    else if (preview === "error") setState("error");
    else if (preview === "confirm") setState("confirm");
  }, [preview]);

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

  const authenticated = previewAuthed || viewer.authenticated;
  const sessionReady = preview != null || ready;
  const showConfirm =
    sessionReady && authenticated && (state === "confirm" || state === "pending");
  const showRetry = sessionReady && state === "error";

  return (
    <section aria-labelledby="logout-heading" className="mx-auto max-w-xl py-8">
      <Card role="article" aria-labelledby="logout-heading">
        <Card.Header>
          <Card.Title id="logout-heading">退出登录</Card.Title>
        </Card.Header>
        <Card.Content>
          {!sessionReady ? <DetailLoadingStatus label="正在读取登录状态…" /> : null}
          {sessionReady && state === "done" ? (
            <Alert status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>已退出登录</Alert.Title>
                <Alert.Description>
                  你已退出，现在是游客。
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          {sessionReady && state === "error" ? (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>退出失败</Alert.Title>
                <Alert.Description>
                  网络或服务暂时不可用，退出没有完成，请重试。
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          {sessionReady &&
          (state === "confirm" || state === "pending") &&
          !authenticated ? (
            <Alert status="accent">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>当前未登录</Alert.Title>
                <Alert.Description>
                  你正以游客身份浏览，无需退出。
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
        </Card.Content>
        {showConfirm || showRetry ? (
          <Card.Footer>
            {showConfirm ? (
              <Button
                variant="primary"
                isPending={state === "pending"}
                onPress={() => void logout()}
              >
                确认退出
              </Button>
            ) : (
              <Button variant="secondary" onPress={() => void logout()}>
                重试退出
              </Button>
            )}
          </Card.Footer>
        ) : null}
      </Card>
    </section>
  );
}
