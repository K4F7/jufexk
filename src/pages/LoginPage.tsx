import {
  Alert,
  Button,
  Card,
  FieldError,
  Form,
  Input,
  InputOTP,
  Label,
  Spinner,
  TextField,
} from "@heroui/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DetailLoadingStatus } from "../components/DetailFeedback";
import { useViewer } from "../hooks/useViewer";
import { ApiError, api } from "../lib/api";
import { backTargetFrom } from "../lib/back-target";

function LoginProgressAlert({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Alert aria-live="polite" role="status" status="accent">
      <Alert.Indicator>
        <Spinner color="current" size="sm" />
      </Alert.Indicator>
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>{description}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

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

const RETURN_TO_CREDENTIALS_RE = /请重新登录|学号或密码|用户名或密码/;
const LOCKED_ACCOUNT_RE = /锁定|冻结|禁用/;
const PASSWORD_UPDATE_RE = /过期|初始密码|修改密码/;
const VERIFY_CODE_RE = /验证码/;

function shouldReturnToCredentials(message: string) {
  return RETURN_TO_CREDENTIALS_RE.test(message);
}

function loginErrorTitle(message: string) {
  if (LOCKED_ACCOUNT_RE.test(message)) return "账号暂时无法登录";
  if (PASSWORD_UPDATE_RE.test(message)) return "需要先更新密码";
  if (VERIFY_CODE_RE.test(message)) return "验证码不正确";
  return "无法完成登录";
}

const ALREADY_LOGGED_IN_ALERT = (
  <Alert status="success">
    <Alert.Indicator />
    <Alert.Content>
      <Alert.Title>当前已登录</Alert.Title>
      <Alert.Description>
        你已完成普通用户登录，可以继续浏览；如需退出，请使用导航中的账号菜单。
      </Alert.Description>
    </Alert.Content>
  </Alert>
);

const SESSION_LOADING_STATUS = (
  <DetailLoadingStatus label="正在读取登录状态…" />
);

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const backTarget = backTargetFrom(searchParams.get("from"));
  const magicToken = searchParams.get("token") || "";
  const { viewer, ready, refresh, applySession } = useViewer();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [maskedPhone, setMaskedPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [redeeming, setRedeeming] = useState(Boolean(magicToken));
  const [error, setError] = useState("");
  const loginRequestId = useRef(0);

  useEffect(() => {
    if (!magicToken || viewer.authenticated) {
      setRedeeming(false);
      return;
    }
    let cancelled = false;
    setRedeeming(true);
    void api<{ authenticated?: boolean; csrfToken?: string }>("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ token: magicToken }),
    })
      .then(async (session) => {
        if (cancelled) return;
        if (session.authenticated) applySession(session);
        else await refresh();
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
  }, [magicToken, viewer.authenticated, refresh, applySession, navigate, backTarget]);

  function finishLogin(session?: Partial<CasStart> & { authenticated?: boolean }) {
    if (session?.authenticated) applySession(session);
    navigate(backTarget, { replace: true });
  }

  /** Local testing only — Vite DEV UI; Worker still rejects non-loopback hosts. */
  async function submitDevLogin() {
    const requestId = ++loginRequestId.current;
    setError("");
    setBusy(true);
    try {
      const session = await api<{ authenticated?: boolean; csrfToken?: string }>(
        "/api/auth/dev",
        {
          method: "POST",
          body: "{}",
        },
      );
      if (requestId !== loginRequestId.current) return;
      if (session.authenticated) applySession(session);
      navigate(searchParams.get("from") ? backTarget : "/profile", {
        replace: true,
      });
    } catch (err: unknown) {
      if (requestId !== loginRequestId.current) return;
      setError(err instanceof ApiError ? err.message : "登录失败，请稍后重试");
    } finally {
      if (requestId === loginRequestId.current) setBusy(false);
    }
  }

  const devLoginButton = import.meta.env.DEV ? (
    <Button
      fullWidth
      isPending={busy}
      type="button"
      variant="secondary"
      onPress={() => {
        void submitDevLogin();
      }}
    >
      {({ isPending }) => (
        <>
          {isPending ? <Spinner color="current" size="sm" /> : null}
          {isPending ? "正在完成本地登录…" : "本地测试登录"}
        </>
      )}
    </Button>
  ) : null;

  async function submitCas(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestId = ++loginRequestId.current;
    setError("");
    setBusy(true);
    try {
      const body = await api<CasStart>("/api/auth/cas", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (requestId !== loginRequestId.current) return;
      setPassword("");
      if (body.needsMfa) {
        setError("");
        setChallenge(body.challenge);
        setMaskedPhone(body.maskedPhone || "");
        return;
      }
      await finishLogin(body);
    } catch (err: unknown) {
      if (requestId !== loginRequestId.current) return;
      setError(err instanceof ApiError ? err.message : "登录失败，请稍后重试");
    } finally {
      if (requestId === loginRequestId.current) setBusy(false);
    }
  }

  async function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestId = ++loginRequestId.current;
    setError("");
    setBusy(true);
    try {
      const session = await api<CasStart>("/api/auth/cas/mfa", {
        method: "POST",
        body: JSON.stringify({ challenge, code: mfaCode }),
      });
      if (requestId !== loginRequestId.current) return;
      finishLogin(session);
    } catch (err: unknown) {
      if (requestId !== loginRequestId.current) return;
      const message =
        err instanceof ApiError ? err.message : "验证码不正确";
      setError(message);
      if (shouldReturnToCredentials(message)) {
        setChallenge("");
        setMfaCode("");
        setMaskedPhone("");
      }
    } finally {
      if (requestId === loginRequestId.current) setBusy(false);
    }
  }

  const errorAlert = error ? (
    <Alert status="danger">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{loginErrorTitle(error)}</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
      </Alert.Content>
    </Alert>
  ) : null;

  return (
    <section aria-labelledby="login-heading" className="mx-auto max-w-xl py-8">
      <Card
        className="pb-6"
        role="article"
        aria-labelledby="login-heading"
        variant="secondary"
      >
        <Card.Header>
          <Card.Title className="text-xl" id="login-heading">
            登录
          </Card.Title>
        </Card.Header>
        {ready && viewer.authenticated ? (
          <Card.Content>{ALREADY_LOGGED_IN_ALERT}</Card.Content>
        ) : !ready && !redeeming ? (
          <Card.Content>{SESSION_LOADING_STATUS}</Card.Content>
        ) : redeeming ? (
          <Card.Content>
            <LoginProgressAlert
              title="正在完成登录"
              description="请稍候。"
            />
          </Card.Content>
        ) : challenge ? (
          <Form
            aria-busy={busy}
            aria-labelledby="login-heading"
            onSubmit={submitMfa}
          >
            <Card.Content>
              <div className="flex flex-col gap-4">
                {errorAlert}
                {busy ? (
                  <LoginProgressAlert
                    title="正在确认验证码"
                    description="请稍候。"
                  />
                ) : (
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
                )}
                <div className="flex flex-col gap-2">
                  <Label>验证码</Label>
                  <InputOTP
                    aria-label="验证码"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    isDisabled={busy}
                    maxLength={4}
                    name="mfa"
                    pattern="^[0-9]+$"
                    value={mfaCode}
                    variant="secondary"
                    onChange={setMfaCode}
                  >
                    <InputOTP.Group>
                      <InputOTP.Slot index={0} />
                      <InputOTP.Slot index={1} />
                      <InputOTP.Slot index={2} />
                      <InputOTP.Slot index={3} />
                    </InputOTP.Group>
                  </InputOTP>
                </div>
              </div>
            </Card.Content>
            <Card.Footer className="mt-6 flex flex-col gap-2">
              <Button
                fullWidth
                isDisabled={mfaCode.length !== 4}
                isPending={busy}
                type="submit"
              >
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner color="current" size="sm" /> : null}
                    {isPending ? "正在完成登录…" : "完成登录"}
                  </>
                )}
              </Button>
              {devLoginButton}
            </Card.Footer>
          </Form>
        ) : (
          <Form
            aria-busy={busy}
            aria-labelledby="login-heading"
            onSubmit={submitCas}
          >
            <Card.Content>
              <div className="flex flex-col gap-4">
                {errorAlert}
                {busy ? (
                  <LoginProgressAlert
                    title="正在登录"
                    description="请稍候，通常需要几秒。"
                  />
                ) : null}
                <TextField
                  fullWidth
                  isDisabled={busy}
                  isRequired
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={setUsername}
                >
                  <Label>学号</Label>
                  <Input placeholder="江财统一身份学号" variant="primary" />
                  <FieldError />
                </TextField>
                <TextField
                  fullWidth
                  isDisabled={busy}
                  isRequired
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={setPassword}
                >
                  <Label>校园密码</Label>
                  <Input placeholder="统一身份认证密码" variant="primary" />
                  <FieldError />
                </TextField>
              </div>
            </Card.Content>
            <Card.Footer className="mt-6 flex flex-col gap-2">
              <Button fullWidth isPending={busy} type="submit">
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner color="current" size="sm" /> : null}
                    {isPending ? "正在登录…" : "登录"}
                  </>
                )}
              </Button>
              {devLoginButton}
            </Card.Footer>
          </Form>
        )}
      </Card>
    </section>
  );
}
