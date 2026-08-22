import {
  Alert,
  Button,
  Card,
  Description,
  Disclosure,
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

type CasStart =
  | {
      authenticated: boolean;
      csrfToken?: string;
      needsMfa?: false;
    }
  | {
      needsMfa: true;
      challenge: string;
      maskedPhone?: string;
    };

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const backTarget = backTargetFrom(searchParams.get("from"));
  const magicToken = searchParams.get("token") || "";
  const { viewer, ready, refresh } = useViewer();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
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

  async function finishLogin() {
    await refresh();
    navigate(backTarget, { replace: true });
  }

  async function submitCas(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = await api<CasStart>("/api/auth/cas", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setPassword("");
      if (body.needsMfa) {
        setChallenge(body.challenge);
        setMaskedPhone(body.maskedPhone || "");
        return;
      }
      await finishLogin();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "登录失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/auth/cas/mfa", {
        method: "POST",
        body: JSON.stringify({ challenge, code: mfaCode }),
      });
      await finishLogin();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "验证码不正确");
    } finally {
      setBusy(false);
    }
  }

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
      await finishLogin();
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
            大多数访问者是游客，课程、教师和公开评价可直接浏览。投稿或认可需要先用江财统一身份登录；也可以改用校学生邮箱验证。管理员后台使用单独的口令登录。
          </Card.Description>
        </Card.Header>
        <Card.Content>
          {ready && viewer.authenticated ? (
            <Alert status="success">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>当前已登录</Alert.Title>
                <Alert.Description>
                  你已完成普通用户登录，可以继续浏览；如需退出，请使用导航中的账号菜单。
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
              {challenge ? (
                <Form className="flex flex-col gap-4" onSubmit={submitMfa}>
                  <Alert status="accent">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>请输入短信验证码</Alert.Title>
                      <Alert.Description>
                        {maskedPhone
                          ? `验证码已发送到 ${maskedPhone}`
                          : "验证码已发送到安全手机"}
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                  <TextField
                    isRequired
                    name="mfa"
                    autoComplete="one-time-code"
                    value={mfaCode}
                    onChange={setMfaCode}
                  >
                    <Label>短信验证码</Label>
                    <Input inputMode="numeric" placeholder="6 位验证码" />
                    <FieldError />
                  </TextField>
                  <Button isDisabled={busy} type="submit">
                    {busy ? "登录中…" : "完成登录"}
                  </Button>
                </Form>
              ) : (
                <Form className="flex flex-col gap-4" onSubmit={submitCas}>
                  <TextField
                    isRequired
                    name="username"
                    autoComplete="username"
                    value={username}
                    onChange={setUsername}
                  >
                    <Label>学号</Label>
                    <Input placeholder="江财统一身份学号" />
                    <Description>
                      使用江财统一身份认证，本站不保存校园口令。
                    </Description>
                    <FieldError />
                  </TextField>
                  <TextField
                    isRequired
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={setPassword}
                  >
                    <Label>校园密码</Label>
                    <Input placeholder="统一身份认证密码" />
                    <FieldError />
                  </TextField>
                  <Button isDisabled={busy} type="submit">
                    {busy ? "登录中…" : "登录"}
                  </Button>
                </Form>
              )}
              <Disclosure>
                <Disclosure.Heading>
                  <Button slot="trigger" variant="tertiary">
                    使用校学生邮箱验证
                    <Disclosure.Indicator />
                  </Button>
                </Disclosure.Heading>
                <Disclosure.Content>
                  <Disclosure.Body className="flex flex-col gap-4 pt-2">
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
                      <Button isDisabled={busy} type="submit" variant="secondary">
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
                      <Button isDisabled={busy} type="submit" variant="secondary">
                        {busy ? "登录中…" : "用邮箱登录"}
                      </Button>
                    </Form>
                  </Disclosure.Body>
                </Disclosure.Content>
              </Disclosure>
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
