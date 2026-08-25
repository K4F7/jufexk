import { AlertDialog, Button } from "@heroui/react";
import { useEffect, useState } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  hasSeenScheduleMobileNotice,
  markScheduleMobileNoticeSeen,
  SCHEDULE_MOBILE_QUERY,
} from "../lib/schedule-mobile-notice";

export function ScheduleMobileNotice() {
  const isMobile = useMediaQuery(SCHEDULE_MOBILE_QUERY);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) return;
    if (hasSeenScheduleMobileNotice(window.localStorage)) return;
    setOpen(true);
  }, [isMobile]);

  function dismiss() {
    markScheduleMobileNoticeSeen(window.localStorage);
    setOpen(false);
  }

  return (
    <AlertDialog.Backdrop
      isOpen={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else dismiss();
      }}
    >
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[400px]">
          <AlertDialog.CloseTrigger />
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>本功能只支持电脑端</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>本功能只支持电脑端，移动端不适配 UI。关掉后仍可继续查看，但布局可能不好用。</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="primary">
              知道了
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
