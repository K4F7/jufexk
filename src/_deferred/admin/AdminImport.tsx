import { Button } from "@heroui/react";
import { useState } from "react";
import { api } from "../../lib/api";
import { parseCsv } from "../../lib/csv";

export function AdminImport() {
  const [type, setType] = useState("courses");
  const [preview, setPreview] = useState<any>(null);
  const [pendingRows, setPendingRows] = useState<Record<string, string>[]>([]);
  const [msg, setMsg] = useState("");
  const [committing, setCommitting] = useState(false);

  async function onFile(file?: File | null) {
    if (!file) return;
    if (file.size > 900_000) {
      setMsg("文件过大，请拆分后导入");
      return;
    }
    const rows = parseCsv(await file.text());
    setPendingRows(rows);
    const result = await api("/api/admin/import/preview", {
      method: "POST",
      body: JSON.stringify({ type, rows }),
    });
    setPreview(result);
    setMsg(result.ok ? "校验通过，可以确认导入" : "请修复表格中的错误后重新选择文件");
  }

  async function commit() {
    setCommitting(true);
    try {
      const result = await api("/api/admin/import", {
        method: "POST",
        body: JSON.stringify({
          type,
          rows: pendingRows,
          confirmWarnings: Boolean(preview?.warnings?.length),
        }),
      });
      setMsg(`新增 ${result.count} 行；跳过 ${result.skippedCount} 行`);
      setPreview(null);
      setPendingRows([]);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="m-0 text-base font-bold">CSV 批量导入</h3>
      <p className="m-0 text-sm text-muted">
        选择文件后先执行服务端校验，确认预览无误后才会写入数据库。
      </p>
      <label className="field-label max-w-xl">
        数据类型
        <select
          className="field-control"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPreview(null);
            setPendingRows([]);
          }}
        >
          <option value="courses">
            课程：code,name,category,department,credits,description
          </option>
          <option value="teachers">教师：name,department,title,bio</option>
          <option value="relations">
            任课关系：course_code,course_name,teacher_name,teacher_department
          </option>
          <option value="offerings">
            开课班：course_code,course_name,teacher_name,teacher_department,term,section,campus,schedule,status
          </option>
        </select>
      </label>
      <label className="block rounded border border-border p-3.5 text-center">
        选择 CSV
        <input
          className="mt-2 block w-full"
          type="file"
          accept=".csv"
          onChange={(e) => onFile(e.target.files?.[0]).catch((err) => setMsg(err.message))}
        />
      </label>
      {preview ? (
        <div className="space-y-2 text-sm">
          <p>
            总行数：{preview.total}；新增：{preview.newCount}；跳过：
            {preview.skipCount}；错误：{preview.errors?.length || 0}；警告：
            {preview.warnings?.length || 0}
          </p>
          {preview.warnings?.length ? (
            <div className="rounded border border-border p-3">
              <p className="m-0 font-medium">请确认以下风险后再导入：</p>
              <ul className="mb-0 mt-2 list-disc pl-5">
                {preview.warnings.map((item: any, i: number) => (
                  <li key={i}>
                    第 {item.row} 行（{item.field}）：{item.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-border">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="border-b border-border p-2">行</th>
                    <th className="border-b border-border p-2">状态</th>
                    <th className="border-b border-border p-2">规范化数据</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.preview || []).map((row: any, index: number) => (
                    <tr key={index}>
                      <td className="border-b border-border p-2">{index + 2}</td>
                      <td className="border-b border-border p-2">
                        {row.exists ? "已存在，将跳过" : "新增"}
                      </td>
                      <td className="border-b border-border p-2">
                        <code className="text-xs">{JSON.stringify(row)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.ok ? (
            <Button isPending={committing} onPress={commit}>
              {preview.warnings?.length ? "确认风险并导入" : "确认导入"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {msg ? <p className="text-sm text-muted">{msg}</p> : null}
    </div>
  );
}
