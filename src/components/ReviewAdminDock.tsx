import { Button, Description, Drawer, Label, Switch } from "@heroui/react";
import { useState } from "react";

/**
 * 管理员侧面 dock：官方 Drawer + Switch。
 * 开关关闭时点评卡上不渲染 ReviewAdminControls。
 */
export function ReviewAdminDock({
  visible,
  onVisibleChange,
}: {
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className="fixed right-4 top-1/2 z-50 hidden -translate-y-1/2 lg:block"
        data-review-admin-dock=""
      >
        <Button
          size="sm"
          variant={visible ? "primary" : "secondary"}
          onPress={() => setOpen(true)}
        >
          管理动作
        </Button>
      </div>
      <Drawer.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>管理动作</Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>
              <Switch isSelected={visible} onChange={onVisibleChange}>
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>在点评上显示管理动作</Label>
                </Switch.Content>
                <Description>
                  关闭后不显示点评屏蔽、查询作者资料、删除与回复删除。公告不受此开关影响。
                </Description>
              </Switch>
            </Drawer.Body>
            <Drawer.Footer>
              <Button slot="close" variant="secondary">
                关闭
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  );
}
