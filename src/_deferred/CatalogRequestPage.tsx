import { Button, Input, TextArea } from "@heroui/react";
import { FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TurnstileBox } from "../components/TurnstileBox";
import { api } from "../lib/api";
import type { SiteConfig } from "../lib/types";

export function CatalogRequestPage({ config }: { config: SiteConfig | null }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<"course" | "teacher">("course");
  const [form, setForm] = useState({
    courseCode: "",
    courseName: "",
    category: "",
    department: "",
    teacherName: "",
    note: "",
    reviewOverall: "",
    reviewComment: "",
  });
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(!config?.turnstileSiteKey);
  const [submitting, setSubmitting] = useState(false);
  const widgetRef = useRef<string | number | null>(null);

  function setField(name: string, value: string) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMsg("");
    try {
      let turnstileToken = "";
      if (config?.turnstileSiteKey) {
        turnstileToken = window.turnstile?.getResponse(widgetRef.current ?? undefined) || "";
        if (!turnstileToken || !ready) {
          throw new Error("请等待人机验证重新完成后再提交");
        }
      }
      const body: any = {
        kind,
        courseCode: form.courseCode,
        courseName: form.courseName,
        category: form.category,
        department: form.department,
        teacherName: form.teacherName,
        note: form.note,
        website: "",
        turnstileToken,
      };
      const overall = Number(form.reviewOverall);
      if (overall) {
        body.review = {
          overall,
          comment: form.reviewComment,
        };
      }
      const d = await api<{ message: string }>("/api/catalog-requests", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setMsg(d.message);
      setForm({
        courseCode: "",
        courseName: "",
        category: "",
        department: "",
        teacherName: "",
        note: "",
        reviewOverall: "",
        reviewComment: "",
      });
      if (widgetRef.current != null) {
        window.turnstile?.reset(widgetRef.current);
        setReady(false);
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-[720px]">
      <Button variant="ghost" className="mb-2 px-0" onPress={() => navigate("/submit")}>
        ← 返回
      </Button>
      <h1 className="mb-1 text-2xl font-bold">补充课程或教师</h1>
      <p className="mb-4 mt-0 text-muted">
        提交后进入管理员审核队列，通过后才会出现在课程目录中。
      </p>
      <form
        onSubmit={onSubmit}
        className="grid gap-3.5 rounded border border-border bg-surface p-5"
      >
        <label className="field-label">
          申请类型
          <select
            className="field-control"
            value={kind}
            onChange={(e) => setKind(e.target.value as "course" | "teacher")}
          >
            <option value="course">补充课程（可同时补充教师）</option>
            <option value="teacher">仅补充教师</option>
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-label">
            课号
            <Input
              fullWidth
              placeholder="选填"
              value={form.courseCode}
              onChange={(e) => setField("courseCode", e.target.value)}
            />
          </label>
          <label className="field-label">
            课程名称
            <Input
              fullWidth
              required={kind === "course"}
              value={form.courseName}
              onChange={(e) => setField("courseName", e.target.value)}
            />
          </label>
          <label className="field-label">
            课程类别
            <select
              className="field-control"
              value={form.category}
              onChange={(e) => setField("category", e.target.value)}
            >
              <option value="">未确定</option>
              <option value="major">专业课</option>
              <option value="pe">体育课</option>
              <option value="general">公共选修</option>
            </select>
          </label>
          <label className="field-label">
            院系
            <Input
              fullWidth
              value={form.department}
              onChange={(e) => setField("department", e.target.value)}
            />
          </label>
        </div>
        <label className="field-label">
          教师姓名
          <Input
            fullWidth
            required={kind === "teacher"}
            value={form.teacherName}
            onChange={(e) => setField("teacherName", e.target.value)}
          />
        </label>
        <label className="field-label">
          补充说明（选填）
          <TextArea
            fullWidth
            placeholder="例如你在哪个学期上过这门课"
            value={form.note}
            onChange={(e) => setField("note", e.target.value)}
          />
        </label>

        {kind === "course" ? (
          <fieldset className="m-0 rounded border border-border p-3">
            <legend className="px-1.5 font-bold">随附评价（选填）</legend>
            <p className="mb-3 mt-0 text-[13px] text-muted">
              目录对象获批后，评价进入待审核队列。
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field-label">
                总体推荐度
                <select
                  className="field-control"
                  value={form.reviewOverall}
                  onChange={(e) => setField("reviewOverall", e.target.value)}
                >
                  <option value="">不随附评价</option>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field-label mt-3">
              补充说明
              <TextArea
                fullWidth
                value={form.reviewComment}
                onChange={(e) => setField("reviewComment", e.target.value)}
              />
            </label>
          </fieldset>
        ) : null}

        <input className="trap" name="website" tabIndex={-1} autoComplete="off" />

        {config?.turnstileSiteKey ? (
          <TurnstileBox
            siteKey={config.turnstileSiteKey}
            widgetRef={widgetRef}
            onReadyChange={(r) => setReady(r)}
          />
        ) : null}

        <Button
          type="submit"
          isDisabled={Boolean(config?.turnstileSiteKey) && !ready}
          isPending={submitting}
        >
          提交补充申请
        </Button>
        {msg ? <p className="m-0 text-sm text-muted">{msg}</p> : null}
      </form>
    </section>
  );
}
