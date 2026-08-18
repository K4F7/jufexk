import {
  Alert,
  AlertDialog,
  Button,
  Card,
  Checkbox,
  Spinner,
} from "@heroui/react";
import { useState } from "react";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useViewer } from "../hooks/useViewer";
import { ApiError, api } from "../lib/api";

type DeletionState = "idle" | "pending" | "done";

/**
 * Ordinary-user account page (issue #139). The session payload carries no
 * email, sub or users.id, so the page only describes the login state and the
 * deletion contract — no identifiers are ever rendered.
 */
export function AccountPage() {
  const { viewer, ready, clear } = useViewer();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [deletion, setDeletion] = useState<DeletionState>("idle");
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setAcknowledged(false);
    setError(null);
    setDialogOpen(true);
  };

  const confirmDeletion = async () => {
    if (deletion === "pending") return;
    setDeletion("pending");
    setError(null);
    try {
      await api("/api/user/account", { method: "DELETE" });
      clear();
      setDeletion("done");
      setDialogOpen(false);
    } catch (cause) {
      setDeletion("idle");
      if (cause instanceof ApiError && cause.status === 401) {
        clear();
        setDialogOpen(false);
      } else {
        setError("删除失败，请稍后重试；账号状态未改变。");
      }
    }
  };

  if (!ready) {
    return (
      <section aria-labelledby="account-heading" className="mx-auto max-w-xl py-8">
        <p className="m-0 flex items-center gap-2 text-sm text-muted">
          <Spinner color="current" size="sm" />
          正在读取登录状态…
        </p>
      </section>
    );
  }

  if (deletion === "done") {
    return (
      <section aria-labelledby="account-heading" className="mx-auto max-w-xl py-8">
        <Card role="article" aria-labelledby="account-heading">
          <Card.Header>
            <Card.Title id="account-heading">账号管理</Card.Title>
          </Card.Header>
          <Card.Content>
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>账号已进入删除流程</Alert.Title>
                <Alert.Description>
                  账号将在 30
                  天恢复期后删除，期间重新完成校园统一身份认证即可恢复账号；你的认可已被删除，已批准的任课评价继续匿名保留。
                </Alert.Description>
              </Alert.Content>
            </Alert>
          </Card.Content>
          <Card.Footer>
            <RouterAriaLink to="/courses">返回继续浏览</RouterAriaLink>
          </Card.Footer>
        </Card>
      </section>
    );
  }

  if (!viewer.authenticated) {
    return (
      <section aria-labelledby="account-heading" className="mx-auto max-w-xl py-8">
        <Card role="article" aria-labelledby="account-heading">
          <Card.Header>
            <Card.Title id="account-heading">账号管理</Card.Title>
            <Card.Description>
              账号管理需要先登录普通用户。
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <Alert status="accent">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>当前未登录</Alert.Title>
                <Alert.Description>
                  登录只证明你持有江西财经大学校园统一身份认证，本站不展示邮箱或站内标识。
                </Alert.Description>
              </Alert.Content>
            </Alert>
          </Card.Content>
          <Card.Footer>
            <RouterAriaLink
              to={`/login?from=${encodeURIComponent("/account")}`}
            >
              前往登录
            </RouterAriaLink>
          </Card.Footer>
        </Card>
      </section>
    );
  }

  return (
    <section aria-labelledby="account-heading" className="mx-auto max-w-xl py-8">
      <Card role="article" aria-labelledby="account-heading">
        <Card.Header>
          <Card.Title id="account-heading">账号管理</Card.Title>
          <Card.Description>
            当前为普通用户登录状态。本站不展示邮箱、学号或站内用户标识。
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-col items-start gap-3">
            <div>
              <h2 className="m-0 text-base font-semibold text-danger">
                删除账号
              </h2>
              <p className="mb-0 mt-1.5 text-sm text-muted">
                删除后账号进入 30 天恢复期：你的认可会被删除，未公开内容会被删除，已批准的任课评价匿名保留。
              </p>
            </div>
            <Button variant="danger" onPress={openDialog}>
              删除账号
            </Button>
          </div>
        </Card.Content>
        <Card.Footer>
          <RouterAriaLink to="/courses">返回继续浏览</RouterAriaLink>
        </Card.Footer>
      </Card>

      <AlertDialog.Backdrop isOpen={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[400px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>确认删除账号？</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <ul className="m-0 list-disc ps-5 text-sm leading-relaxed">
                <li>账号进入 30 天恢复期，期间重新完成校园统一身份认证即可恢复；</li>
                <li>你给出的所有认可将被删除；</li>
                <li>未公开的内容将被删除；</li>
                <li>已批准的任课评价匿名保留，无法找回或认领。</li>
              </ul>
              <div className="mt-3">
                <Checkbox isSelected={acknowledged} onChange={setAcknowledged}>
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    我已了解以上后果
                  </Checkbox.Content>
                </Checkbox>
              </div>
              {error ? (
                <Alert className="mt-3" role="alert" status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>删除失败</Alert.Title>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                取消
              </Button>
              <Button
                variant="danger"
                isDisabled={!acknowledged}
                isPending={deletion === "pending"}
                onPress={() => void confirmDeletion()}
              >
                确认删除账号
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </section>
  );
}
