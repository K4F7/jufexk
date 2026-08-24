import {
  Alert,
  Button,
  Description,
  Form,
  Label,
  Table,
  TextArea,
  TextField,
} from "@heroui/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DetailLoadingStatus } from "../../components/DetailFeedback";
import { api } from "../../lib/api";
import type { AdminStudentBinding } from "../../lib/types";
import { AdminGate, AdminPageHeader } from "./AdminGate";

/**
 * 管理员学号绑定（/admin/admins）。
 * 一次可提交多位 CAS 学号；列表只显示绑定时间，不回显学号。
 */
export function AdminStudentBindingsPage() {
  return (
    <AdminGate>
      <section className="max-w-[720px]">
        <AdminPageHeader
          title="管理员学号"
          description="绑定后，持有这些校园统一身份学号的人登录即可进入管理分区。明文学号不会保存或回显。"
        />
        <StudentBindingsEditor />
      </section>
    </AdminGate>
  );
}

function StudentBindingsEditor() {
  const [text, setText] = useState("");
  const [items, setItems] = useState<AdminStudentBinding[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const data = await api<{ items: AdminStudentBinding[] }>(
      "/api/admin/student-bindings",
    );
    setItems(data.items);
  }, []);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [load]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setPending(true);
    try {
      const result = await api<{ added: number; skipped: number }>(
        "/api/admin/student-bindings",
        { method: "POST", body: JSON.stringify({ text }) },
      );
      setText("");
      setMessage(
        `已绑定 ${result.added} 个学号` +
          (result.skipped ? `，${result.skipped} 个已在名单中` : ""),
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const onRemove = async (id: number) => {
    setError("");
    setMessage("");
    setPending(true);
    try {
      await api(`/api/admin/student-bindings/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  if (loading) return <DetailLoadingStatus label="管理员学号加载中…" />;

  return (
    <>
      <Form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
        <TextField
          isRequired
          name="usernames"
          value={text}
          onChange={setText}
        >
          <Label>学号</Label>
          <TextArea placeholder="每行一个，或用逗号分隔。可一次填写多位。" />
          <Description>
            使用江财统一身份学号。绑定后对方用校园登录打开 /admin 即可，不必再输口令。
          </Description>
        </TextField>
        <div>
          <Button isPending={pending} type="submit" variant="primary">
            绑定
          </Button>
        </div>
      </Form>
      {message ? (
        <Alert className="mt-4" role="status" status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>已更新</Alert.Title>
            <Alert.Description>{message}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {error ? (
        <Alert className="mt-4" role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>操作失败</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {items && items.length > 0 ? (
        <Table className="mt-8">
          <Table.ScrollContainer>
            <Table.Content aria-label="已绑定的管理员学号" className="min-w-[420px]">
              <Table.Header>
                <Table.Column isRowHeader>绑定时间</Table.Column>
                <Table.Column>操作</Table.Column>
              </Table.Header>
              <Table.Body>
                {items.map((row) => (
                  <Table.Row id={String(row.id)} key={row.id}>
                    <Table.Cell>
                      <span className="whitespace-nowrap text-[12px] text-muted">
                        {row.created_at || "—"}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        isDisabled={pending}
                        size="sm"
                        variant="danger"
                        onPress={() => void onRemove(row.id)}
                      >
                        解除
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      ) : (
        <p className="mt-8 text-[13px] text-muted">
          还没有通过本页绑定的其他人。允许名单为空时，第一个校园登录打开
          /admin 的人会成为首位管理员；之后可在这里继续添加。
        </p>
      )}
    </>
  );
}
