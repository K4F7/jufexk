import { Button, Card, Label, TextArea, TextField } from "@heroui/react";
import { useEffect, useState } from "react";
import { useAdminSession } from "../hooks/useAdminSession";
import { useViewer } from "../hooks/useViewer";
import { api } from "../lib/api";

/**
 * 课程管理员公告（对齐 icourse course-edit.html 的管理员公告栏）：
 * 公开侧在课程头部下方展示公告卡片；管理员会话多出编辑面板，
 * 保存走 PUT /api/admin/courses/:id/notice。
 */
export function CourseAdminNotice({
  courseId,
  notice,
  updatedAt,
  onSaved,
}: {
  courseId: number | null;
  /** 当前已公开的管理员公告；未设置为空串。 */
  notice: string;
  updatedAt?: string | null;
  /** 保存成功后触发课程详情重拉。 */
  onSaved: () => void;
}) {
  const { authed: adminAuthed, ensure: ensureAdmin } = useAdminSession();
  const { viewer } = useViewer();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notice);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  // Anonymous detail pages must not pay for an admin 401 probe; an authenticated
  // viewer still gets the existing notice editing capability on demand.
  useEffect(() => {
    if (viewer.authenticated) void ensureAdmin();
  }, [ensureAdmin, viewer.authenticated]);

  // 课程详情重拉后同步最新公告，避免旧草稿覆盖。
  useEffect(() => {
    if (!editing) setDraft(notice);
  }, [notice, editing]);

  const save = async () => {
    if (courseId == null) return;
    setPending(true);
    setMessage("");
    setFailed(false);
    try {
      await api(`/api/admin/courses/${courseId}/notice`, {
        method: "PUT",
        body: JSON.stringify({ content: draft }),
      });
      setEditing(false);
      onSaved();
    } catch (e) {
      setFailed(true);
      setMessage((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const hasNotice = Boolean(notice);

  // 无公告时对普通访客整块不渲染；管理员仍看到可编辑的空状态框。
  // 体育公共专项没有课程级数字 ID，不能写管理员公告。
  if (courseId == null) return hasNotice ? (
    <Card className="mt-6">
      <Card.Header>
        <Card.Title>管理员公告</Card.Title>
        {updatedAt ? (
          <Card.Description>更新于 {updatedAt}</Card.Description>
        ) : null}
      </Card.Header>
      <Card.Content className="whitespace-pre-wrap text-sm">
        {notice}
      </Card.Content>
    </Card>
  ) : null;
  if (!hasNotice && !adminAuthed) return null;

  return (
    <>
      {hasNotice ? (
        <Card className="mt-6">
          <Card.Header>
            <Card.Title>管理员公告</Card.Title>
            {updatedAt ? (
              <Card.Description>更新于 {updatedAt}</Card.Description>
            ) : null}
          </Card.Header>
          <Card.Content className="whitespace-pre-wrap text-sm">
            {notice}
          </Card.Content>
        </Card>
      ) : null}

      {adminAuthed ? (
        <div className="mt-4 rounded-md border border-dashed border-border bg-surface-secondary/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-[12px] font-medium text-muted">
              {hasNotice ? "管理员公告（仅管理员可编辑，公开展示）" : "暂无公告"}
            </p>
            {!editing ? (
              <Button
                size="sm"
                variant="outline"
                onPress={() => {
                  setDraft(notice);
                  setMessage("");
                  setFailed(false);
                  setEditing(true);
                }}
              >
                {hasNotice ? "编辑公告" : "设置公告"}
              </Button>
            ) : null}
          </div>
          {editing ? (
            <div className="mt-2 flex flex-col gap-2">
              <TextField fullWidth name="adminNotice" value={draft} onChange={setDraft}>
                <Label className="sr-only">管理员公告</Label>
                <TextArea
                  className="w-full"
                  placeholder="向所有访客展示的课程公告；留空保存即撤下。"
                  rows={3}
                />
              </TextField>
              <div className="flex gap-2">
                <Button
                  isPending={pending}
                  size="sm"
                  variant="primary"
                  onPress={() => void save()}
                >
                  保存公告
                </Button>
                <Button
                  isDisabled={pending}
                  size="sm"
                  variant="tertiary"
                  onPress={() => {
                    setEditing(false);
                    setDraft(notice);
                    setMessage("");
                    setFailed(false);
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}
          {message ? (
            <p
              className={`mb-0 mt-2 text-[12px] ${failed ? "text-danger" : "text-muted"}`}
              role={failed ? "alert" : "status"}
            >
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
