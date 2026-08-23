import { Button, Input, TextArea } from "@heroui/react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Course, Teacher } from "../../lib/types";

export function AdminCourses() {
  const [courses, setCourses] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [form, setForm] = useState({
    id: "",
    code: "",
    name: "",
    category: "major",
    department: "",
    description: "",
    adminNotice: "",
    teacherIds: [] as string[],
  });
  const [msg, setMsg] = useState("");

  async function load() {
    const [cs, ts] = await Promise.all([
      api<any[]>("/api/admin/courses"),
      api<Teacher[]>("/api/admin/teachers"),
    ]);
    setCourses(cs);
    setTeachers(ts);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { adminNotice, ...courseFields } = form;
    setMsg("");
    try {
      const saved = await api<{ id: number }>("/api/admin/courses", {
        method: "POST",
        body: JSON.stringify(courseFields),
      });
      // The notice has its own endpoint. Keep a newly created course in edit
      // mode so a failed notice write can be retried without creating it again.
      setForm((current) => ({ ...current, id: String(saved.id) }));
      await api(`/api/admin/courses/${saved.id}/notice`, {
        method: "PUT",
        body: JSON.stringify({ content: adminNotice }),
      });
      setForm({
        id: "",
        code: "",
        name: "",
        category: "major",
        department: "",
        description: "",
        adminNotice: "",
        teacherIds: [],
      });
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "保存失败，请重试");
    }
  }

  function edit(course: any) {
    setForm({
      id: String(course.id || ""),
      code: course.code || "",
      name: course.name || "",
      category: course.category || "major",
      department: course.department || "",
      description: course.description || "",
      adminNotice: course.admin_notice || "",
      teacherIds: String(course.teacher_ids || "")
        .split(",")
        .filter(Boolean),
    });
  }

  async function remove(id: number) {
    if (!confirm("确认删除？")) return;
    await api(`/api/admin/courses/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded border border-border bg-surface p-4"
      >
        <h3 className="m-0 text-base font-bold">新增/编辑课程</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-label">
            课号
            <Input
              fullWidth
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </label>
          <label className="field-label">
            课程名
            <Input
              fullWidth
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="field-label">
            类别
            <select
              className="field-control"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
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
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </label>
        </div>
        <label className="field-label">
          简介
          <TextArea
            fullWidth
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label className="field-label">
          管理员公告
          <TextArea
            fullWidth
            maxLength={2000}
            value={form.adminNotice}
            onChange={(e) => setForm({ ...form, adminNotice: e.target.value })}
          />
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
        <Button type="submit">保存</Button>
      </form>

      {msg ? <p className="text-sm text-danger">{msg}</p> : null}

      {courses.map((c) => (
        <article
          key={c.id}
          className="rounded border border-border bg-surface p-3"
        >
          <b>{c.name}</b>
          <p className="my-1 text-muted">{c.teachers}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onPress={() => edit(c)}>
              编辑
            </Button>
            <Button size="sm" variant="danger" onPress={() => remove(c.id)}>
              删除
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
