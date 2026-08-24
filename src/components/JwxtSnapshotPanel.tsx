import { Button, Label, Link, Modal, TextArea, TextField } from "@heroui/react";
import { useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { jwxtSnapshotBookmarkletHref } from "../lib/jwxt-import-bookmarklet";
import {
  EHALL_URL,
  JWXT_CHANNEL2_URL,
} from "../lib/jwxt-schedule-text";
import {
  emptySnapshot,
  importSnapshotText,
  serializeSnapshot,
  type JwxtSnapshotV1,
} from "../lib/jwxt-snapshot";

export const JWXT_REFRESH_NOTICE =
  "协议闸门未打通 Worker 代查教务。刷新只导入本机 JSON / 教务页表格；快照包含来源教师名，不包含 Cookie、学生学号或学生姓名。";

export function JwxtSnapshotPanel({
  canEdit,
  loginHref,
  snapshot,
  sessionExpired,
  onImport,
  onExpired,
}: {
  canEdit: boolean;
  loginHref: string;
  snapshot: JwxtSnapshotV1 | null;
  sessionExpired?: boolean;
  onImport: (snapshot: JwxtSnapshotV1) => void | Promise<void>;
  onExpired?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bookmarklet = useMemo(
    () => jwxtSnapshotBookmarkletHref(window.location.origin),
    [],
  );

  async function applyText(text: string) {
    const result = importSnapshotText(text, undefined, snapshot ?? emptySnapshot());
    if (!result.ok) {
      if (result.kind === "login-expired") {
        setError(result.message);
        onExpired?.();
        return;
      }
      setError(result.message);
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onImport(result.snapshot);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
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
          刷新教务数据
        </Button>
        {snapshot ? (
          <Button
            size="sm"
            variant="tertiary"
            onPress={() => {
              const blob = new Blob([serializeSnapshot(snapshot)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = "jufexk-jwxt-snapshot.v1.json";
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            导出快照
          </Button>
        ) : null}
      </div>
      {sessionExpired ? (
        <p className="mb-0 mt-2 text-sm text-danger" role="status">
          教务登录已失效，请重新导出快照后再导入。
        </p>
      ) : null}
      <Modal.Backdrop isOpen={loginOpen} onOpenChange={setLoginOpen}>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>刷新需要先登录</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>导入教务快照前，请先登录选课志。本站会话过期后只能查看已缓存课表。</p>
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
      <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>刷新教务数据</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-3 text-sm">
              <p className="m-0">{JWXT_REFRESH_NOTICE}</p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={JWXT_CHANNEL2_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  打开本科教务
                </Link>
                <Link
                  href={EHALL_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  打开智慧江财
                </Link>
              </div>
              <p className="m-0 text-muted">
                在已打开的教务页用书签导出 JSON，再回到本页导入。页面加载不会访问教务。
              </p>
              <a className="text-accent" href={bookmarklet}>
                导出教务快照
              </a>
              <input
                ref={fileRef}
                accept="application/json,.json,.html,.htm"
                aria-label="选择教务快照文件"
                className="block w-full text-sm"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file.text().then((text) => applyText(text));
                }}
              />
              <TextField
                className="w-full"
                name="jwxt-snapshot-paste"
                value={paste}
                onChange={(value) => {
                  setPaste(value);
                  if (error) setError("");
                }}
              >
                <Label>或粘贴 JSON / 教务表格</Label>
                <TextArea
                  aria-label="粘贴教务快照"
                  className="w-full"
                  placeholder='{"version":1,"source":"browser-export"...}'
                  rows={5}
                />
              </TextField>
              {error ? (
                <p className="m-0 text-danger" role="status">
                  {error}
                </p>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="secondary">
                取消
              </Button>
              <Button isDisabled={busy} variant="primary" onPress={() => void applyText(paste)}>
                {busy ? "正在导入…" : "导入快照"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
