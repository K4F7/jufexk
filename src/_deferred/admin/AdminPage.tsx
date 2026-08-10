import { Button, Input, Tabs } from "@heroui/react";
import { FormEvent, useEffect, useState } from "react";
import { api, setCsrfToken } from "../../lib/api";
import { AdminCatalogRequests } from "./AdminCatalogRequests";
import { AdminCourses } from "./AdminCourses";
import { AdminImport } from "./AdminImport";
import { AdminLegacy } from "./AdminLegacy";
import { AdminOfferings } from "./AdminOfferings";
import { AdminReviews } from "./AdminReviews";
import { AdminSessions } from "./AdminSessions";
import { AdminTeachers } from "./AdminTeachers";

const tabs = [
  { id: "reviews", label: "评价" },
  { id: "courses", label: "课程" },
  { id: "teachers", label: "教师" },
  { id: "offerings", label: "开课班" },
  { id: "import", label: "导入" },
  { id: "legacy", label: "历史评价" },
  { id: "requests", label: "补充申请" },
  { id: "sessions", label: "会话" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>("reviews");

  async function checkSession() {
    try {
      const d = await api<{ csrfToken: string }>("/api/admin/session");
      setCsrfToken(d.csrfToken);
      setAuthed(true);
    } catch {
      setAuthed(false);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    checkSession();
  }, []);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const d = await api<{ csrfToken: string }>("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setCsrfToken(d.csrfToken);
      setPassword("");
      setAuthed(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onLogout() {
    await api("/api/admin/logout", { method: "POST", body: "{}" });
    setCsrfToken("");
    setAuthed(false);
  }

  if (checking) {
    return <p className="text-muted">检查登录状态…</p>;
  }

  if (!authed) {
    return (
      <section className="mx-auto max-w-[480px]">
        <h1 className="mb-4 text-2xl font-bold">管理后台</h1>
        <form
          onSubmit={onLogin}
          className="grid gap-3.5 rounded border border-border bg-surface p-5"
        >
          <label className="field-label">
            管理员口令
            <Input
              type="password"
              fullWidth
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <Button type="submit">登录</Button>
          {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
        </form>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-bold">管理后台</h1>
        <Button variant="outline" size="sm" onPress={onLogout}>
          退出
        </Button>
      </div>

      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => setTab(String(key) as TabId)}
        className="w-full"
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label="后台分区">
            {tabs.map((item) => (
              <Tabs.Tab key={item.id} id={item.id}>
                {item.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>

      <div className="mt-4">
        {tab === "reviews" ? <AdminReviews /> : null}
        {tab === "courses" ? <AdminCourses /> : null}
        {tab === "teachers" ? <AdminTeachers /> : null}
        {tab === "offerings" ? <AdminOfferings /> : null}
        {tab === "import" ? <AdminImport /> : null}
        {tab === "legacy" ? <AdminLegacy /> : null}
        {tab === "requests" ? <AdminCatalogRequests /> : null}
        {tab === "sessions" ? <AdminSessions /> : null}
      </div>
    </section>
  );
}
