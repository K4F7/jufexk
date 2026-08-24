import { AlertDialog, Button, Typography, buttonVariants } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DetailErrorAlert,
  DetailLoadingStatus,
} from "../components/DetailFeedback";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useAdminSession } from "../hooks/useAdminSession";
import { api } from "../lib/api";
import { formatReviewDate } from "../lib/review-date";
import type { Announcement } from "../lib/types";

/**
 * 公告栏（/announcements，公开只读）。
 * 管理员会话下多出发布 / 编辑 / 删除；删除走 AlertDialog 确认。
 */
export function AnnouncementsPage() {
  const { authed: isAdmin, ready: adminReady } = useAdminSession();
  const navigate = useNavigate();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    const d = await api<{ items: Announcement[] }>("/api/announcements");
    setItems(d.items);
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const remove = async (id: number) => {
    setActionError("");
    try {
      await api(`/api/admin/announcements/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  return (
    <section className="mx-auto max-w-[860px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Typography className="m-0 text-[22px] font-bold" type="h1">
          公告栏
        </Typography>
        {adminReady && isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <RouterAriaLink
              className={`${buttonVariants({ variant: "ghost" })} no-underline`}
              to="/admin"
            >
              管理首页
            </RouterAriaLink>
            <Button
              variant="primary"
              onPress={() => navigate("/admin/announcements/new")}
            >
              发布公告
            </Button>
          </div>
        ) : null}
      </div>

      {actionError ? (
        <div className="mt-4">
          <DetailErrorAlert title="操作失败" message={actionError} />
        </div>
      ) : null}

      {error && items === null ? (
        <div className="mt-6">
          <DetailErrorAlert title="公告加载失败" message={error} />
        </div>
      ) : items === null ? (
        <div className="mt-6">
          <DetailLoadingStatus label="公告加载中…" />
        </div>
      ) : items.length === 0 ? (
        <p className="mt-10 text-center text-[13px] text-muted" role="status">
          暂时没有公告。
        </p>
      ) : (
        <ul className="mt-6 list-none space-y-6 p-0">
          {items.map((a) => (
            <li key={a.id} className="border-b border-separator pb-6">
              <Typography
                className="m-0 text-[16px] font-bold"
                type="h2"
              >
                {a.title}
              </Typography>
              <p className="mb-0 mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed">
                {a.content}
              </p>
              <p className="mb-0 mt-2 text-[12px] text-muted">
                发表于 {formatReviewDate(a.time) || "—"}
              </p>
              {adminReady && isAdmin ? (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => navigate(`/admin/announcements/${a.id}`)}
                  >
                    编辑
                  </Button>
                  <AlertDialog>
                    <Button size="sm" variant="danger">
                      删除
                    </Button>
                    <AlertDialog.Backdrop>
                      <AlertDialog.Container>
                        <AlertDialog.Dialog className="sm:max-w-[400px]">
                          <AlertDialog.CloseTrigger />
                          <AlertDialog.Header>
                            <AlertDialog.Heading>删除公告</AlertDialog.Heading>
                          </AlertDialog.Header>
                          <AlertDialog.Body>
                            <p>
                              确定删除公告「{a.title}」吗？删除后不可恢复。
                            </p>
                          </AlertDialog.Body>
                          <AlertDialog.Footer>
                            <Button slot="close" variant="tertiary">
                              取消
                            </Button>
                            <Button
                              slot="close"
                              variant="danger"
                              onPress={() => void remove(a.id)}
                            >
                              确认删除
                            </Button>
                          </AlertDialog.Footer>
                        </AlertDialog.Dialog>
                      </AlertDialog.Container>
                    </AlertDialog.Backdrop>
                  </AlertDialog>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
