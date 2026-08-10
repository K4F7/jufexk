import { Button, Input } from "@heroui/react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { LegacyReview, Paginated } from "../../lib/types";

type Batch = {
  id: string;
  status: string;
  row_count: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  imported_at?: string;
  created_at?: string;
};

export function AdminLegacy() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Batch> | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [payload, setPayload] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [activeBatch, setActiveBatch] = useState("");
  const [reviewStatus, setReviewStatus] = useState("pending");
  const [reviewQ, setReviewQ] = useState("");
  const [reviewPage, setReviewPage] = useState(1);
  const [rows, setRows] = useState<Paginated<LegacyReview> | null>(null);

  async function loadBatches(nextPage = page, nextStatus = status) {
    const d = await api<Paginated<Batch>>(
      `/api/admin/legacy-imports?page=${nextPage}&pageSize=20&status=${encodeURIComponent(nextStatus)}`,
    );
    setData(d);
  }

  useEffect(() => {
    loadBatches().catch((e) => setMsg(e.message));
  }, [page, status]);

  async function onFile(file?: File | null) {
    if (!file) return;
    if (file.size > 1_900_000) {
      setMsg("文件过大，请使用审批工具生成的分片 payload");
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setMsg("JSON 文件格式错误");
      return;
    }
    if (!parsed || !Array.isArray(parsed.rows)) {
      setMsg("JSON 缺少 rows 数组");
      return;
    }
    setPayload(parsed);
    const result = await api("/api/admin/legacy-imports/preview", {
      method: "POST",
      body: JSON.stringify({ rows: parsed.rows }),
    });
    setPreview(result);
    setMsg(
      result.ok
        ? "尚未写入数据库"
        : "请回到人工确认队列修正错误并重新生成批准文件",
    );
  }

  async function commit() {
    if (!payload) return;
    const result = await api("/api/admin/legacy-imports", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setPayload(null);
    setPreview(null);
    setStatus("imported");
    setPage(1);
    await loadBatches(1, "imported");
    setMsg(`已导入批次 ${result.batchId}，共 ${result.count} 条，仍需管理员审核。`);
  }

  async function rollback(id: string) {
    if (!confirm(`确认回滚批次 ${id}？该批次的历史评价将被删除。`)) return;
    await api(`/api/admin/legacy-imports/${encodeURIComponent(id)}/rollback`, {
      method: "POST",
      body: "{}",
    });
    await loadBatches();
  }

  async function loadRows(
    batchId = activeBatch,
    nextStatus = reviewStatus,
    nextPage = reviewPage,
    nextQ = reviewQ,
  ) {
    if (!batchId) return;
    const d = await api<Paginated<LegacyReview>>(
      `/api/admin/legacy-reviews?batchId=${encodeURIComponent(batchId)}&status=${encodeURIComponent(nextStatus)}&q=${encodeURIComponent(nextQ)}&page=${nextPage}&pageSize=20`,
    );
    setRows(d);
  }

  async function openBatch(id: string) {
    setActiveBatch(id);
    setReviewStatus("pending");
    setReviewPage(1);
    setReviewQ("");
    await loadRows(id, "pending", 1, "");
  }

  async function moderate(id: number | string | undefined, next: string) {
    if (id == null) return;
    let note = "";
    if (next === "rejected") {
      note = prompt("请输入驳回理由") || "";
      if (!note) return;
    }
    await api(`/api/admin/legacy-reviews/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next, note }),
    });
    await loadRows();
    await loadBatches();
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="m-0 text-base font-bold">历史评价批次</h3>
        <p className="mt-1 text-sm text-muted">
          只接受由本地人工确认工具生成的 JSON。先校验，确认后才写入；历史文字评价不包含 overall。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="field-control max-w-[160px]"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">全部批次</option>
          {["imported", "rolled_back", "failed"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <label className="rounded border border-border px-3 py-2 text-sm">
          选择批准 JSON
          <input
            className="ml-2"
            type="file"
            accept=".json,application/json"
            onChange={(e) => onFile(e.target.files?.[0]).catch((err) => setMsg(err.message))}
          />
        </label>
      </div>
      {preview ? (
        <div className="space-y-2 text-sm">
          <p>
            总行数：{preview.total}；错误：{preview.errors?.length || 0}
          </p>
          {preview.errors?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-border">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="border-b border-border p-2">行</th>
                    <th className="border-b border-border p-2">字段</th>
                    <th className="border-b border-border p-2">问题</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.errors.map((item: any, i: number) => (
                    <tr key={i}>
                      <td className="border-b border-border p-2">{item.row}</td>
                      <td className="border-b border-border p-2">{item.field}</td>
                      <td className="border-b border-border p-2">{item.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>服务端校验通过。请再次确认来源截图和人工审核记录后导入。</p>
          )}
          {preview.ok ? <Button onPress={commit}>确认导入为待审核</Button> : null}
        </div>
      ) : null}
      {msg ? <p className="text-sm text-muted">{msg}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-border text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="border-b border-border p-2">批次</th>
              <th className="border-b border-border p-2">状态</th>
              <th className="border-b border-border p-2">行数</th>
              <th className="border-b border-border p-2">审核状态</th>
              <th className="border-b border-border p-2">导入时间</th>
              <th className="border-b border-border p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((batch) => (
              <tr key={batch.id}>
                <td className="border-b border-border p-2">
                  <code>{batch.id}</code>
                </td>
                <td className="border-b border-border p-2">{batch.status}</td>
                <td className="border-b border-border p-2">{batch.row_count}</td>
                <td className="border-b border-border p-2">
                  待审 {batch.pending_count} / 通过 {batch.approved_count} / 驳回{" "}
                  {batch.rejected_count}
                </td>
                <td className="border-b border-border p-2">
                  {batch.imported_at || batch.created_at}
                </td>
                <td className="border-b border-border p-2">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onPress={() => openBatch(batch.id)}>
                      审核记录
                    </Button>
                    {batch.status === "imported" &&
                    Number(batch.approved_count) === 0 &&
                    Number(batch.rejected_count) === 0 ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onPress={() => rollback(batch.id)}
                      >
                        回滚
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {!data?.items?.length ? (
              <tr>
                <td className="p-4 text-center text-muted" colSpan={6}>
                  暂无历史导入批次
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

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
          {page} / {data?.pages || 1}
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

      {activeBatch ? (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="m-0 text-base font-bold">批次记录审核</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="field-control max-w-[140px]"
              value={reviewStatus}
              onChange={(e) => {
                setReviewStatus(e.target.value);
                setReviewPage(1);
                loadRows(activeBatch, e.target.value, 1, reviewQ).catch((err) =>
                  setMsg(err.message),
                );
              }}
            >
              {["pending", "approved", "rejected", "all"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <Input
              className="min-w-[220px] flex-1"
              placeholder="课程、教师、原文或截图"
              value={reviewQ}
              onChange={(e) => setReviewQ(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              onPress={() => {
                setReviewPage(1);
                loadRows(activeBatch, reviewStatus, 1, reviewQ).catch((err) =>
                  setMsg(err.message),
                );
              }}
            >
              搜索
            </Button>
          </div>
          {(rows?.items || []).map((row) => (
            <article
              key={row.id}
              className="rounded border border-border bg-surface p-3"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <b>
                  {row.course_name} · {row.teacher_name}
                </b>
                <span className="text-sm text-muted">
                  {row.source_file} / {row.source_row} · OCR {row.ocr_confidence}
                </span>
              </div>
              <p className="my-2">{row.comment}</p>
              <details>
                <summary className="cursor-pointer text-sm">核对原始 OCR 和来源</summary>
                <p className="text-sm">
                  <b>OCR 课程：</b>
                  {row.ocr_course_name}；<b>OCR 教师：</b>
                  {row.ocr_teacher_name}
                </p>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-default p-2 text-xs">
                  {row.raw_ocr_text}
                </pre>
                <p className="text-sm text-muted">
                  继承：{row.inherited_from || "无"}；重复组：
                  {row.duplicate_group || "无"}
                </p>
              </details>
              <div className="mt-2 flex flex-wrap gap-2">
                {row.status === "pending" ? (
                  <>
                    <Button size="sm" onPress={() => moderate(row.id, "approved")}>
                      通过
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onPress={() => moderate(row.id, "rejected")}
                    >
                      驳回
                    </Button>
                  </>
                ) : (
                  <span className="text-sm text-muted">
                    {row.status} · {row.moderator_note || ""}
                  </span>
                )}
              </div>
            </article>
          ))}
          <div className="flex items-center justify-center gap-3 text-sm text-muted">
            <Button
              size="sm"
              variant="outline"
              isDisabled={reviewPage <= 1}
              onPress={() => {
                const next = reviewPage - 1;
                setReviewPage(next);
                loadRows(activeBatch, reviewStatus, next, reviewQ);
              }}
            >
              上一页
            </Button>
            <span>
              {reviewPage} / {rows?.pages || 1}
            </span>
            <Button
              size="sm"
              variant="outline"
              isDisabled={reviewPage >= (rows?.pages || 1)}
              onPress={() => {
                const next = reviewPage + 1;
                setReviewPage(next);
                loadRows(activeBatch, reviewStatus, next, reviewQ);
              }}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
