import { Button, Input } from "@heroui/react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Course, Offering, Teacher } from "../../lib/types";

export function AdminOfferings() {
  const [offerings, setOfferings] = useState<any[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [form, setForm] = useState({
    id: "",
    courseId: "",
    term: "",
    section: "",
    campus: "",
    schedule: "",
    status: "active",
    teacherIds: [] as string[],
  });
  const [msg, setMsg] = useState("");

  async function load() {
    const [os, cs, ts] = await Promise.all([
      api<any[]>("/api/admin/offerings"),
      api<Course[]>("/api/admin/courses"),
      api<Teacher[]>("/api/admin/teachers"),
    ]);
    setOfferings(os);
    setCourses(cs);
    setTeachers(ts);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await api("/api/admin/offerings", {
      method: "POST",
      body: JSON.stringify(form),
    });
    setForm({
      id: "",
      courseId: "",
      term: "",
      section: "",
      campus: "",
      schedule: "",
      status: "active",
      teacherIds: [],
    });
    await load();
  }

  function edit(o: any) {
    setForm({
      id: String(o.id || ""),
      courseId: String(o.course_id || o.courseId || ""),
      term: o.term || "",
      section: o.section || "",
      campus: o.campus || "",
      schedule: o.schedule || "",
      status: o.status || "active",
      teacherIds: String(o.teacher_ids || "")
        .split(",")
        .filter(Boolean),
    });
  }

  async function remove(id: number) {
    if (!confirm("确认删除这个开课班？")) return;
    await api(`/api/admin/offerings/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded border border-border bg-surface p-4"
      >
        <h3 className="m-0 text-base font-bold">新增 / 编辑开课班</h3>
        <label className="field-label">
          课程
          <select
            className="field-control"
            required
            value={form.courseId}
            onChange={(e) => setForm({ ...form, courseId: e.target.value })}
          >
            <option value="">请选择</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-label">
            学期
            <Input
              fullWidth
              placeholder="2026 春"
              value={form.term}
              onChange={(e) => setForm({ ...form, term: e.target.value })}
            />
          </label>
          <label className="field-label">
            班次
            <Input
              fullWidth
              required
              placeholder="01班"
              value={form.section}
              onChange={(e) => setForm({ ...form, section: e.target.value })}
            />
          </label>
          <label className="field-label">
            校区
            <Input
              fullWidth
              value={form.campus}
              onChange={(e) => setForm({ ...form, campus: e.target.value })}
            />
          </label>
          <label className="field-label">
            上课安排
            <Input
              fullWidth
              value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value })}
            />
          </label>
        </div>
        <label className="field-label">
          状态
          <select
            className="field-control"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="active">开放</option>
            <option value="archived">归档</option>
          </select>
        </label>
        <fieldset className="m-0 rounded border border-border p-3">
          <legend className="px-1 font-bold">任课教师</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {teachers.map((t) => {
              const checked = form.teacherIds.includes(String(t.id));
              return (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const id = String(t.id);
                      setForm((prev) => ({
                        ...prev,
                        teacherIds: e.target.checked
                          ? [...prev.teacherIds, id]
                          : prev.teacherIds.filter((x) => x !== id),
                      }));
                    }}
                  />
                  {t.name}
                </label>
              );
            })}
          </div>
        </fieldset>
        <Button type="submit">保存开课班</Button>
      </form>
      {msg ? <p className="text-sm text-danger">{msg}</p> : null}
      {offerings.map((o) => (
        <article
          key={o.id}
          className="rounded border border-border bg-surface p-3"
        >
          <b>
            {o.course_name} · {o.term || "学期未标注"} · {o.section}
          </b>
          <p className="my-1 text-muted">
            {o.teachers || "无教师"} · {o.campus} · {o.schedule}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onPress={() => edit(o)}>
              编辑
            </Button>
            <Button size="sm" variant="danger" onPress={() => remove(o.id)}>
              删除
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
