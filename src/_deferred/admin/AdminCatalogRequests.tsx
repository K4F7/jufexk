import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { categoryLabel } from "../../lib/labels";
import type { CatalogRequest, Paginated } from "../../lib/types";

export function AdminCatalogRequests() {
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState<Paginated<CatalogRequest> | null>(null);
  const [msg, setMsg] = useState("");

  async function load(next = status) {
    const d = await api<Paginated<CatalogRequest>>(
      `/api/admin/catalog-requests?status=${next}`,
    );
    setData(d);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [status]);

  async function approve(id: number) {
    await api(`/api/admin/catalog-requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    });
    await load();
  }

  async function reject(id: number) {
    const note = prompt("驳回理由");
    if (!note) return;
    await api(`/api/admin/catalog-requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "rejected", note }),
    });
    await load();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          className="field-control max-w-[160px]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="pending">待审核</option>
          <option value="approved">已通过</option>
          <option value="rejected">已驳回</option>
          <option value="all">全部</option>
        </select>
        <span className="text-sm text-muted">共 {data?.total ?? 0} 条</span>
      </div>
      {msg ? <p className="text-sm text-danger">{msg}</p> : null}
      {(data?.items || []).map((r) => (
        <article
          key={r.id}
          className="rounded border border-border bg-surface p-3"
        >
          <b>
            {r.kind === "course" ? "课程" : "教师"}申请 ·{" "}
            {r.course_name || r.teacher_name}
          </b>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[11px] font-bold text-muted">课号</dt>
              <dd className="m-0">{r.course_code || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold text-muted">课程</dt>
              <dd className="m-0">{r.course_name || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold text-muted">类别</dt>
              <dd className="m-0">{categoryLabel(r.category)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold text-muted">教师</dt>
              <dd className="m-0">{r.teacher_name || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold text-muted">院系</dt>
              <dd className="m-0">{r.department || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold text-muted">随附评价</dt>
              <dd className="m-0">{r.has_review ? "有" : "无"}</dd>
            </div>
          </dl>
          {r.note ? <p className="mt-2">{r.note}</p> : null}
          <p className="text-[13px] text-muted">
            {r.created_at}
            {r.moderator_note ? ` · ${r.moderator_note}` : ""}
          </p>
          {r.status === "pending" ? (
            <div className="mt-2 flex gap-2">
              <Button size="sm" onPress={() => approve(r.id)}>
                批准并建立目录对象
              </Button>
              <Button size="sm" variant="danger" onPress={() => reject(r.id)}>
                驳回
              </Button>
            </div>
          ) : (
            <span className="text-sm text-muted">
              {r.status === "approved" ? "已通过" : "已驳回"}
            </span>
          )}
        </article>
      ))}
      {!data?.items?.length ? (
        <div className="rounded border border-dashed border-border p-7 text-center text-muted">
          没有补充申请
        </div>
      ) : null}
    </div>
  );
}
