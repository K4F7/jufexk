import {
  Alert,
  Button,
  Form,
  Input,
  Label,
  TextField,
  Typography,
} from "@heroui/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { DetailLoadingStatus } from "../../components/DetailFeedback";
import { useAdminSession } from "../../hooks/useAdminSession";

/**
 * 管理员分区门禁：未登录时只渲染口令登录表单。
 * 管理员会话与普通用户会话完全分离；校园 JWT 不能进入这里。
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const { authed, ready, login } = useAdminSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!ready) {
    return (
      <section className="mx-auto max-w-[480px]">
        <DetailLoadingStatus label="检查管理员会话…" />
      </section>
    );
  }

  if (!authed) {
    const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError("");
      setPending(true);
      try {
        await login(password);
        setPassword("");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setPending(false);
      }
    };
    return (
      <section className="mx-auto max-w-[480px]">
        <Typography className="m-0 text-[22px] font-bold" type="h1">
          管理后台
        </Typography>
        <p className="mb-4 mt-2 text-[13px] text-muted">
          使用管理员口令登录。校园统一身份只用于普通用户投稿或认可，不能进入管理分区。
        </p>
        <Form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <TextField
            fullWidth
            isRequired
            name="password"
            type="password"
            value={password}
            onChange={setPassword}
          >
            <Label>管理员口令</Label>
            <Input autoComplete="current-password" />
          </TextField>
          <div>
            <Button isPending={pending} type="submit" variant="primary">
              登录
            </Button>
          </div>
          {error ? (
            <Alert role="alert" status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>登录失败</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
        </Form>
      </section>
    );
  }

  return <>{children}</>;
}

/** 管理分区统一页头：标题 + 说明 + 回管理首页 / 退出。 */
export function AdminPageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const { logout } = useAdminSession();
  const navigate = useNavigate();
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Typography className="m-0 text-[22px] font-bold" type="h1">
          {title}
        </Typography>
        {description ? (
          <p className="mb-0 mt-1 text-[13px] text-muted">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" onPress={() => navigate("/admin")}>
          管理首页
        </Button>
        <Button size="sm" variant="outline" onPress={() => void logout()}>
          退出
        </Button>
      </div>
    </div>
  );
}
