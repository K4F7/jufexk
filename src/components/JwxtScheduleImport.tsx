import { Button, Label, Modal, TextArea, TextField, buttonVariants } from "@heroui/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { jwxtImportBookmarkletHref } from "../lib/jwxt-import-bookmarklet";
import {
  EHALL_URL,
  extractJwxtImportRowsFromText,
  JWXT_CHANNEL2_URL,
  type JwxtImportRow,
} from "../lib/jwxt-schedule-text";

export function JwxtScheduleImport({
  canEdit,
  loginHref,
  onImport,
}: {
  canEdit: boolean;
  loginHref: string;
  onImport: (rows: JwxtImportRow[]) => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState("");
  const bookmarklet = useMemo(
    () => jwxtImportBookmarkletHref(window.location.origin),
    [],
  );

  function importPasted() {
    const rows = extractJwxtImportRowsFromText(paste);
    if (rows.length === 0) {
      setPasteError("没有解析到上课时间。请粘贴带「星期一 第1-2节」的课表行。");
      return;
    }
    setPasteError("");
    onImport(rows);
    setOpen(false);
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onPress={() => {
          if (!canEdit) {
            setLoginOpen(true);
            return;
          }
          setOpen(true);
        }}
      >
        从本科教务导入
      </Button>
      <Modal.Backdrop isOpen={loginOpen} onOpenChange={setLoginOpen}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[400px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>导入需要先登录</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>从本科教务导入课表前，请先登录选课志。</p>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="tertiary">
                取消
              </Button>
              <Button variant="primary" onPress={() => navigate(loginHref)}>
                去登录
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>从本科教务导入</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-3 text-sm">
              <p className="m-0">
                在你自己的浏览器打开本科教务。教务 Cookie 只留在教务网站，选课志不代持、不落库；回传的只有课程名、教师和上课时间。
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  className={`${buttonVariants({ size: "sm", variant: "primary" })} no-underline`}
                  href={JWXT_CHANNEL2_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  打开本科教务
                </a>
                <a
                  className={`${buttonVariants({ size: "sm", variant: "tertiary" })} no-underline`}
                  href={EHALL_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  打开智慧江财
                </a>
              </div>
              <p className="m-0 text-muted">
                登录后打开个人课表或选课结果，再把下面这个链接拖到书签栏，在教务页点一次。
              </p>
              <a className="text-accent" href={bookmarklet}>
                导入到选课志
              </a>
              <TextField
                className="w-full"
                name="jwxt-paste"
                value={paste}
                onChange={(value) => {
                  setPaste(value);
                  if (pasteError) setPasteError("");
                }}
              >
                <Label>或粘贴上课时间</Label>
                <TextArea
                  aria-label="粘贴上课时间"
                  className="w-full"
                  placeholder={"高等数学 张三 星期一 第1-2节"}
                  rows={4}
                />
              </TextField>
              {pasteError ? (
                <p className="m-0 text-danger" role="status">
                  {pasteError}
                </p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="secondary">
                取消
              </Button>
              <Button variant="primary" onPress={importPasted}>
                导入粘贴内容
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
