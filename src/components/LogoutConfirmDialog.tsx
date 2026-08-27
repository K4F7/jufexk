import { Alert, AlertDialog, Button } from "@heroui/react";
import { useCallback, useState } from "react";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";

/**
 * In-page logout confirm (ADR-0016): the real work is POST /api/user/logout.
 * Opening the dialog never destroys a session; only the explicit confirm does.
 */
export function LogoutConfirmDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { clear } = useViewer();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const logout = useCallback(async () => {
    setPending(true);
    setError(false);
    try {
      await api("/api/user/logout", { method: "POST" });
      onOpenChange(false);
      clear();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }, [clear, onOpenChange]);

  return (
    <AlertDialog.Backdrop
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!next) {
          setError(false);
          setPending(false);
        }
        onOpenChange(next);
      }}
    >
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[400px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>确认退出登录？</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            {error ? (
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>退出失败</Alert.Title>
                  <Alert.Description>
                    网络或服务暂时不可用，退出没有完成，请重试。
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : (
              <p>退出后需要重新登录才能投稿、认可或查看账号内容。</p>
            )}
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">
              取消
            </Button>
            <Button
              isPending={pending}
              variant={error ? "secondary" : "primary"}
              onPress={() => void logout()}
            >
              {error ? "重试退出" : "确认退出"}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
