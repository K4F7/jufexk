import { AlertDialog, Button } from "@heroui/react";
import { useState } from "react";
import { api } from "../lib/api";
import type { PublicReview } from "../lib/types";

/**
 * 课程页点评上的管理动作（仅管理员会话渲染，对齐 icourse）：
 * 屏蔽 / 解除屏蔽 · 删除（AlertDialog 确认）· 查询作者资料。
 * 公开流 id 形如 review:123 / legacy:456；管理动作只适用于任课评价行，
 * 历史评价没有作者账号，不渲染这些动作。
 */

function adminReviewId(id: string | number): number | null {
  if (typeof id === "number") {
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  const match = /^review:(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

export function ReviewAdminControls({
  review,
  onChanged,
}: {
  review: PublicReview;
  /** 屏蔽 / 删除等改变公开集合的动作完成后调用，触发列表刷新。 */
  onChanged: () => void;
}) {
  const reviewId = adminReviewId(review.id);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [lookupSent, setLookupSent] = useState(false);

  if (reviewId == null) return null;

  const blocked = !!review.blocked;

  const run = async (fn: () => Promise<unknown>, reload = true) => {
    setPending(true);
    setError("");
    try {
      await fn();
      if (reload) onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const toggleBlock = () =>
    run(() =>
      api(`/api/admin/reviews/${reviewId}/${blocked ? "unblock" : "block"}`, {
        method: "POST",
        body: "{}",
      }),
    );

  const lookupAuthor = () =>
    run(async () => {
      await api(`/api/admin/reviews/${reviewId}/author-lookup`, {
        method: "POST",
        body: "{}",
      });
      setLookupSent(true);
    }, false);

  const deleteReview = () =>
    run(() => api(`/api/admin/reviews/${reviewId}`, { method: "DELETE" }));

  return (
    <div
      className="mt-3 rounded-md border border-dashed border-danger/40 bg-danger/5 px-3 py-2"
      data-review-admin=""
    >
      <p className="m-0 text-[12px] font-medium text-danger">
        管理动作（仅管理员可见）
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          isDisabled={pending}
          size="sm"
          variant={blocked ? "secondary" : "danger"}
          onPress={() => void toggleBlock()}
        >
          {blocked ? "解除屏蔽" : "屏蔽"}
        </Button>
        <Button
          isDisabled={pending || lookupSent}
          size="sm"
          variant="outline"
          onPress={() => void lookupAuthor()}
        >
          查询作者资料
        </Button>
        <AlertDialog>
          <Button isDisabled={pending} size="sm" variant="danger">
            删除
          </Button>
          <AlertDialog.Backdrop>
            <AlertDialog.Container>
              <AlertDialog.Dialog className="sm:max-w-[400px]">
                <AlertDialog.CloseTrigger />
                <AlertDialog.Header>
                  <AlertDialog.Heading>删除评价</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  <p>
                    你正在作为管理员删除其他用户的评价。建议使用屏蔽而非删除；删除后不可恢复。
                  </p>
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button slot="close" variant="tertiary">
                    取消
                  </Button>
                  <Button
                    slot="close"
                    variant="danger"
                    onPress={() => void deleteReview()}
                  >
                    确认删除
                  </Button>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </AlertDialog>
      </div>
      {lookupSent ? (
        <p className="mb-0 mt-2 text-[12px] text-muted" role="status">
          已提交查询：作者资料将发送到管理员邮箱，不在页面展示。
        </p>
      ) : null}
      {error ? (
        <p className="mb-0 mt-2 text-[12px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
