import { Button, Input, TextArea } from "@heroui/react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Teacher } from "../../lib/types";

export function AdminTeachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [form, setForm] = useState({
    id: "",
    name: "",
    title: "",
    department: "",
    bio: "",
  });
  const [msg, setMsg] = useState("");

  async function load() {
    setTeachers(await api<Teacher[]>("/api/admin/teachers"));
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await api("/api/admin/teachers", {
      method: "POST",
      body: JSON.stringify(form),
    });
    setForm({ id: "", name: "", title: "", department: "", bio: "" });
    await load();
  }

  function edit(t: Teacher) {
    setForm({
      id: String(t.id),
      name: t.name || "",
      title: t.title || "",
      department: t.department || "",
      bio: t.bio || "",
    });
  }

  async function remove(id: number) {
    if (!confirm("确认删除？")) return;
    await api(`/api/admin/teachers/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded border border-border bg-surface p-4"
      >
        <h3 className="m-0 text-base font-bold">新增/编辑教师</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="field-label">
            姓名
            <Input
              fullWidth
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="field-label">
            职称
            <Input
              fullWidth
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
        </div>
        <label className="field-label">
          院系
          <Input
            fullWidth
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          />
        </label>
        <label className="field-label">
          简介
          <TextArea
            fullWidth
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
        </label>
        <Button type="submit">保存</Button>
      </form>
      {msg ? <p className="text-sm text-danger">{msg}</p> : null}
      {teachers.map((t) => (
        <article
          key={t.id}
          className="rounded border border-border bg-surface p-3"
        >
          <b>{t.name}</b>
          <p className="my-1 text-muted">
            {t.title} · {t.department}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onPress={() => edit(t)}>
              编辑
            </Button>
            <Button size="sm" variant="danger" onPress={() => remove(t.id)}>
              删除
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
