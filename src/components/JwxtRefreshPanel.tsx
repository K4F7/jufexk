import { Button, Modal } from "@heroui/react";
import { useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";

export function JwxtRefreshPanel({
  canEdit,
  csrfToken,
  loginHref,
}: {
  canEdit: boolean;
  csrfToken: string;
  loginHref: string;
}) {
  const [loginOpen, setLoginOpen] = useState(false);
  const launchFormRef = useRef<HTMLFormElement>(null);

  return (
    <>
      <form
        ref={launchFormRef}
        action="/api/ehall/launch"
        method="post"
        target="_blank"
      >
        <input name="_csrf" type="hidden" value={csrfToken} />
        <Button
          size="sm"
          type="button"
          variant="secondary"
          onPress={() => {
            if (!canEdit) {
              setLoginOpen(true);
              return;
            }
            launchFormRef.current?.requestSubmit();
          }}
        >
          刷新教务数据
        </Button>
      </form>

      <Modal.Backdrop isOpen={loginOpen} onOpenChange={setLoginOpen}>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>刷新需要先登录</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>请先登录本站。登录后再刷新教务数据。</p>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="tertiary">
                取消
              </Button>
              <Button
                variant="primary"
                render={(domProps) => (
                  <RouterLink
                    {...(domProps as object)}
                    className={typeof domProps.className === "string" ? domProps.className : undefined}
                    to={loginHref}
                  />
                )}
              >
                去登录
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
