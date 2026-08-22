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
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RouterAriaLink } from "../components/RouterAriaLink";
import { useViewer } from "../hooks/useViewer";
import { ApiError, api } from "../lib/api";
import { backTargetFrom } from "../lib/back-target";

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

function shouldReturnToCredentials(message: string) {
  return /请重新登录|学号或密码|用户名或密码/.test(message);
}

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
  const [busy, setBusy] = useState(false);
  const [redeeming, setRedeeming] = useState(Boolean(magicToken));
  const [error, setError] = useState("");
  const casRequestId = useRef(0);

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
    const requestId = ++casRequestId.current;
    setError("");
    setBusy(true);
    try {
      const body = await api<CasStart>("/api/auth/cas", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (requestId !== casRequestId.current) return;
      setPassword("");
      if (body.needsMfa) {
        setError("");
        setChallenge(body.challenge);
        setMaskedPhone(body.maskedPhone || "");
        return;
      }
      await finishLogin();
    } catch (err: unknown) {
      if (requestId !== casRequestId.current) return;
      setError(err instanceof ApiError ? err.message : "登录失败，请稍后重试");
    } finally {
      if (requestId === casRequestId.current) setBusy(false);
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
      const message =
        err instanceof ApiError ? err.message : "验证码不正确";
      setError(message);
      if (shouldReturnToCredentials(message)) {
        setChallenge("");
        setMfaCode("");
        setMaskedPhone("");
      }
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
            大多数访问者是游客，课程、教师和公开评价可直接浏览。投稿或认可需要先用江财统一身份登录。管理员后台使用单独的口令登录。
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
                      <Alert.Title>请输入验证码</Alert.Title>
                      <Alert.Description>
                        {maskedPhone
                          ? `学校会把验证码发到企业微信（绑定手机 ${maskedPhone}），不是本站短信。`
                          : "学校会把验证码发到企业微信（统一身份绑定的手机），不是本站短信。"}
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
                    <Label>验证码</Label>
                    <Input inputMode="numeric" placeholder="4–8 位验证码" />
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
