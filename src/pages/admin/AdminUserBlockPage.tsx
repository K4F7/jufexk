import {
  Alert,
  Button,
  Card,
  Chip,
  Description,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { DetailLoadingStatus } from "../../components/DetailFeedback";
import { api } from "../../lib/api";
import type { AdminUserBlockStatus } from "../../lib/types";
import { AdminGate, AdminPageHeader } from "./AdminGate";

/**
 * 用户禁言管理（/admin/users/:userRef，仅管理员）。
 * 站点没有公开用户主页；userRef 是管理员侧的不透明引用，
 * 来自「查询作者资料」的管理员邮件。页面不展示 email、学号、users.id。
 */
export function AdminUserBlockPage() {
  const { id } = useParams();
  const userRef = id ?? "";
  return (
    <AdminGate>
      <section className="max-w-[560px]">
        <AdminPageHeader
          title="用户禁言"
          description="禁言期间该用户无法提交评价或认可；解除后立即恢复。"
        />
        <UserBlockPanel userRef={userRef} />
      </section>
    </AdminGate>
  );
}

function UserBlockPanel({ userRef }: { userRef: string }) {
  const [status, setStatus] = useState<AdminUserBlockStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState("7");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    const d = await api<AdminUserBlockStatus>(
      `/api/admin/users/${encodeURIComponent(userRef)}`,
    );
    setStatus(d);
  }, [userRef]);

  useEffect(() => {
    if (!userRef) {
      setLoading(false);
      setError("缺少用户引用。");
      return;
    }
    setLoading(true);
    load()
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [load, userRef]);

  const run = async (fn: () => Promise<unknown>) => {
    setActionError("");
    setPending(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const onBlock = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = Number(days);
    if (!Number.isInteger(n) || n <= 0) {
      setActionError("禁言天数必须是正整数。");
      return;
    }
    await run(() =>
      api(`/api/admin/users/${encodeURIComponent(userRef)}/block`, {
        method: "POST",
        body: JSON.stringify({ days: n }),
      }),
    );
  };

  const onUnblock = () =>
    run(() =>
      api(`/api/admin/users/${encodeURIComponent(userRef)}/unblock`, {
        method: "POST",
        body: "{}",
      }),
    );

  if (loading) return <DetailLoadingStatus label="用户状态加载中…" />;
  if (error) {
    return (
      <Alert role="alert" status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>加载失败</Alert.Title>
          <Alert.Description>{error}</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  const blocked = !!status?.blocked;
  return (
    <Card>
      <Card.Header>
        <Card.Title className="flex items-center gap-2">
          当前状态
          {blocked ? (
            <Chip color="danger" size="sm" variant="soft">
              <Chip.Label>禁言中</Chip.Label>
            </Chip>
          ) : (
            <Chip size="sm" variant="soft">
              <Chip.Label>未禁言</Chip.Label>
            </Chip>
          )}
        </Card.Title>
        <Card.Description>
          用户引用：{status?.user_ref || userRef}
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <p className="m-0 text-[13px]">
          {blocked
            ? `该用户已被禁言${status?.blocked_until ? `，将于 ${status.blocked_until} 解除` : ""}。`
            : "该用户当前未被禁言。"}
        </p>
        <Form className="mt-4 flex flex-col gap-3" onSubmit={onBlock}>
          <TextField
            className="max-w-[200px]"
            isRequired
            name="days"
            value={days}
            onChange={setDays}
          >
            <Label>禁言天数</Label>
            <Input inputMode="numeric" />
            <Description>正整数；到期自动解除。</Description>
          </TextField>
          <div className="flex flex-wrap gap-2">
            <Button isPending={pending} type="submit" variant="danger">
              禁言此用户
            </Button>
            {blocked ? (
              <Button
                isDisabled={pending}
                variant="secondary"
                onPress={() => void onUnblock()}
              >
                立即解除禁言
              </Button>
            ) : null}
          </div>
        </Form>
        {actionError ? (
          <Alert className="mt-4" role="alert" status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>操作失败</Alert.Title>
              <Alert.Description>{actionError}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
      </Card.Content>
    </Card>
  );
}
