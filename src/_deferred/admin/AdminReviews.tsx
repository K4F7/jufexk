import { Button, Input, TextArea } from "@heroui/react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Paginated, Review } from "../../lib/types";

export function AdminReviews() {
  const [status, setStatus] = useState("pending");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Review> | null>(null);
  const [events, setEvents] = useState<Record<number, any[]>>({});
  const [msg, setMsg] = useState("");

  async function load(nextPage = page, nextStatus = status, nextQ = q) {
    const d = await api<Paginated<Review>>(
      `/api/admin/reviews?status=${nextStatus}&q=${encodeURIComponent(nextQ)}&page=${nextPage}&pageSize=20`,
    );
    setData(d);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, [status, page]);

  async function moderate(id: number, next: string) {
    let note = "";
    if (next === "rejected") {
      note = prompt("请输入驳回理由") || "";
      if (!note) return;
    }
    await api(`/api/admin/reviews/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next, note }),
    });
    await load();
  }

  async function saveContent(id: number, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    await api(`/api/admin/reviews/${id}/content`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await load();
  }

  async function loadEvents(id: number) {
    const list = await api<any[]>(`/api/admin/reviews/${id}/events`);
    setEvents((prev) => ({ ...prev, [id]: list }));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="field-control max-w-[140px]"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="pending">待审核</option>
          <option value="approved">已通过</option>
          <option value="rejected">已驳回</option>
          <option value="all">全部</option>
        </select>
        <Input
          className="min-w-[220px] flex-1"
          placeholder="课程、教师、学期或内容"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setPage(1);
              load(1, status, q).catch((err) => setMsg(err.message));
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onPress={() => {
            setPage(1);
            load(1, status, q).catch((err) => setMsg(err.message));
          }}
        >
          搜索
        </Button>
        <span className="text-sm text-muted">共 {data?.total ?? 0} 条</span>
      </div>

      {msg ? <p className="text-sm text-danger">{msg}</p> : null}

      {(data?.items || []).map((r) => (
        <article
          key={r.id}
          className="rounded border border-border bg-surface p-3"
        >
          <b>
            {r.course_name} · {r.teacher_name || "未指定教师"} · {r.overall}/5
          </b>
          <p className="my-1 text-muted">
            {r.term} · {r.comment || r.teaching || "无补充内容"}
          </p>
          <small className="text-muted">
            {r.status}
            {r.moderator_note ? ` · ${r.moderator_note}` : ""}
          </small>
          <details className="mt-2">
            <summary className="cursor-pointer">编辑评价内容</summary>
            <form
              className="mt-2 grid gap-2"
              onSubmit={(e) => saveContent(r.id, e)}
            >
              <label className="field-label">
                补充说明
                <TextArea name="comment" fullWidth defaultValue={r.comment || ""} />
              </label>
              <label className="field-label">
                课堂质量
                <TextArea name="teaching" fullWidth defaultValue={r.teaching || ""} />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="field-label">
                  点名
                  <Input name="attendance" fullWidth defaultValue={r.attendance || ""} />
                </label>
                <label className="field-label">
                  给分
                  <Input name="grading" fullWidth defaultValue={r.grading || ""} />
                </label>
                <label className="field-label">
                  强度
                  <Input name="workload" fullWidth defaultValue={r.workload || ""} />
                </label>
                <label className="field-label">
                  是否捞人
                  <Input name="rescue" fullWidth defaultValue={r.rescue || ""} />
                </label>
              </div>
              <label className="field-label">
                考核方式
                <Input name="assessment" fullWidth defaultValue={r.assessment || ""} />
              </label>
              <label className="field-label">
                修改说明
                <Input name="note" fullWidth required />
              </label>
              <Button type="submit" size="sm">
                保存修改
              </Button>
            </form>
          </details>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onPress={() => loadEvents(r.id)}>
              审核时间线
            </Button>
            {r.status === "pending" ? (
              <>
                <Button size="sm" onPress={() => moderate(r.id, "approved")}>
                  通过
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onPress={() => moderate(r.id, "rejected")}
                >
                  驳回
                </Button>
              </>
            ) : null}
          </div>
          {events[r.id]?.length ? (
            <div className="mt-2 border-l-2 border-border pl-2.5 text-sm">
              {events[r.id].map((item, i) => (
                <p key={i} className="my-1.5">
                  <b>{item.action}</b> · {item.created_at}
                  <br />
                  {item.note || "无备注"}
                </p>
              ))}
            </div>
          ) : null}
        </article>
      ))}

      <div className="flex items-center justify-center gap-3 text-sm text-muted">
        <Button
          size="sm"
          variant="outline"
          isDisabled={page <= 1}
          onPress={() => setPage((p) => p - 1)}
        >
          上一页
        </Button>
        <span>
          {data?.page || page} / {Math.max(1, data?.pages || 1)}
        </span>
        <Button
          size="sm"
          variant="outline"
          isDisabled={page >= (data?.pages || 1)}
          onPress={() => setPage((p) => p + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
