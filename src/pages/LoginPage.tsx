import {
  Alert,
  Button,
  Card,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  Spinner,
  TextField,
} from "@heroui/react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useViewer } from "../hooks/useViewer";
import { ApiError, api } from "../lib/api";
import { backTargetFrom } from "../lib/back-target";

const SENT_HINT = "若该邮箱符合条件，我们已发送验证信";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const backTarget = backTargetFrom(searchParams.get("from"));
  const magicToken = searchParams.get("token") || "";
  const { viewer, ready, refresh } = useViewer();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [redeeming, setRedeeming] = useState(Boolean(magicToken));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!magicToken || viewer.authenticated) {
      setRedeeming(false);
      return;
    }
    let cancelled = false;
    setRedeeming(true);
    void api("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token: magicToken }),
    })
      .then(async () => {
        if (cancelled) return;
        await refresh();
        navigate(backTarget, { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "验证失败，请重新获取验证信",
        );
        setRedeeming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [magicToken, viewer.authenticated, refresh, navigate, backTarget]);

  async function requestEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/auth/email", {
        method: "POST",
        body: JSON.stringify({ email, from: backTarget }),
      });
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "发送失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      await refresh();
      navigate(backTarget, { replace: true });
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? err.message : "验证失败，请重新获取验证信",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="login-heading" className="mx-auto max-w-xl py-8">
      <Card role="article" aria-labelledby="login-heading">
        <Card.Header>
          <Card.Title id="login-heading">普通用户登录</Card.Title>
          <Card.Description>
            大多数访问者是游客，课程、教师和公开评价可直接浏览。投稿或认可需要先用校学生邮箱完成验证；管理员后台使用单独的口令登录。
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {ready && viewer.authenticated ? (
            <Alert status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>当前已登录</Alert.Title>
                <Alert.Description>
                  你已完成校学生邮箱验证，可以继续浏览；如需退出，请使用导航中的账号菜单。
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : redeeming ? (
            <p className="m-0 flex items-center gap-2 text-sm text-muted">
              <Spinner color="current" size="sm" />
              正在完成登录…
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {error ? (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>无法完成登录</Alert.Title>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}
              {sent ? (
                <Alert status="accent">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>请查收验证信</Alert.Title>
                    <Alert.Description>{SENT_HINT}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}
              <Form className="flex flex-col gap-4" onSubmit={requestEmail}>
                <TextField
                  isRequired
                  name="email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                >
                  <Label>校学生邮箱</Label>
                  <Input placeholder="学号@stu.jxufe.edu.cn" />
                  <Description>
                    仅接受精确的 @stu.jxufe.edu.cn 地址。
                  </Description>
                  <FieldError />
                </TextField>
                <Button isDisabled={busy} type="submit">
                  {busy ? "发送中…" : "发送验证信"}
                </Button>
              </Form>
              <Form className="flex flex-col gap-4" onSubmit={verifyCode}>
                <TextField
                  isRequired
                  name="code"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={setCode}
                >
                  <Label>验证码</Label>
                  <Input inputMode="numeric" placeholder="6 位验证码" />
                  <Description>也可以直接打开邮件里的登录链接。</Description>
                  <FieldError />
                </TextField>
                <Button isDisabled={busy} type="submit">
                  {busy ? "登录中…" : "登录"}
                </Button>
              </Form>
            </div>
          )}
        </Card.Content>
        <Card.Footer>
          <RouterAriaLink to={backTarget}>返回继续浏览</RouterAriaLink>
        </Card.Footer>
      </Card>
    </section>
  );
}
