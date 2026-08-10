import { Button, Table } from "@heroui/react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

type SessionRow = {
  session_id: string;
  current?: boolean;
  revoked_at?: string | null;
  created_at: string;
  expires_at: string;
};

export function AdminSessions() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [msg, setMsg] = useState("");

  async function load() {
    const data = await api<{ sessions: SessionRow[] }>("/api/admin/sessions");
    setSessions(data.sessions || []);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  async function revoke(id: string) {
    await api(`/api/admin/sessions/${encodeURIComponent(id)}/revoke`, {
      method: "POST",
      body: "{}",
    });
    await load();
  }

  async function revokeOthers() {
    await api("/api/admin/sessions/revoke-others", {
      method: "POST",
      body: "{}",
    });
    await load();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-base font-bold">管理会话</h3>
        <Button size="sm" variant="danger" onPress={revokeOthers}>
          撤销其他会话
        </Button>
      </div>
      {msg ? <p className="text-sm text-danger">{msg}</p> : null}
      <Table className="dense-table">
        <Table.ScrollContainer>
          <Table.Content aria-label="管理会话" className="min-w-[560px]">
            <Table.Header>
              <Table.Column isRowHeader>状态</Table.Column>
              <Table.Column>创建</Table.Column>
              <Table.Column>过期</Table.Column>
              <Table.Column>操作</Table.Column>
            </Table.Header>
            <Table.Body items={sessions}>
              {(s) => (
                <Table.Row key={s.session_id} id={s.session_id}>
                  <Table.Cell>
                    {s.current ? "当前" : s.revoked_at ? "已撤销" : "有效"}
                  </Table.Cell>
                  <Table.Cell>{s.created_at}</Table.Cell>
                  <Table.Cell>{s.expires_at}</Table.Cell>
                  <Table.Cell>
                    {!s.current && !s.revoked_at ? (
                      <Button size="sm" variant="outline" onPress={() => revoke(s.session_id)}>
                        撤销
                      </Button>
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}
