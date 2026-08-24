import {
  Alert,
  Button,
  Card,
  FieldError,
  Form,
  Input,
  InputOTP,
  Label,
  REGEXP_ONLY_DIGITS,
  Skeleton,
  Spinner,
  Tabs,
  TextField,
} from "@heroui/react";
import { useEffect, useRef, useState, type FormEvent, type Key } from "react";
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

type QrPhase = "idle" | "loading" | "pending" | "scanned" | "expired" | "cancelled" | "error";
type QrStart = { challenge: string; image: string };
type QrStatus =
  | { status: "pending" | "scanned" | "cancelled" | "expired"; authenticated?: false }
  | { authenticated: true; csrfToken?: string; status?: undefined };

const QR_POLL_MS = 2000;
const QR_IMAGE_PREFIX = "data:image/png;base64,";

function isQrDataImage(image: string) {
  return image.startsWith(QR_IMAGE_PREFIX) && image.length > QR_IMAGE_PREFIX.length;
}

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

const ALREADY_LOGGED_IN_REDIRECT_MS = 3000;

function AlreadyLoggedInAlert() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      navigate("/courses", { replace: true });
    }, ALREADY_LOGGED_IN_REDIRECT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [navigate]);

  return (
    <Alert status="success">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>已登录</Alert.Title>
      </Alert.Content>
    </Alert>
  );
}

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
  const [loginTab, setLoginTab] = useState("password");
  const [qrPhase, setQrPhase] = useState<QrPhase>("idle");
  const [qrChallenge, setQrChallenge] = useState("");
  const [qrImage, setQrImage] = useState("");
  const loginRequestId = useRef(0);
  const qrRequestId = useRef(0);

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

  useEffect(() => {
    const stop =
      loginTab !== "qr" ||
      !qrChallenge ||
      qrPhase === "expired" ||
      qrPhase === "cancelled" ||
      qrPhase === "error" ||
      qrPhase === "loading" ||
      qrPhase === "idle";
    if (stop) return;
    let cancelled = false;
    let inFlight = false;
    const requestId = qrRequestId.current;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const body = await api<QrStatus>("/api/auth/cas/qr/status", {
          method: "POST",
          body: JSON.stringify({ challenge: qrChallenge }),
        });
        if (cancelled || requestId !== qrRequestId.current) return;
        if (body.authenticated) {
          qrRequestId.current += 1;
          setQrChallenge("");
          finishLogin(body);
          return;
        }
        if (body.status === "pending") setQrPhase("pending");
        else if (body.status === "scanned") setQrPhase("scanned");
        else if (body.status === "expired") setQrPhase("expired");
        else if (body.status === "cancelled") setQrPhase("cancelled");
      } catch (err: unknown) {
        if (cancelled || requestId !== qrRequestId.current) return;
        const message = err instanceof ApiError ? err.message : "登录失败，请稍后重试";
        if (err instanceof ApiError && (err.status === 401 || /过期|失效/.test(message))) {
          setQrPhase("expired");
          return;
        }
        setQrPhase("error");
        setError(message);
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, QR_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loginTab, qrChallenge, qrPhase]);

  function finishLogin(session?: Partial<CasStart> & { authenticated?: boolean }) {
    if (session?.authenticated) applySession(session);
    navigate(backTarget, { replace: true });
  }

  function resetQr(nextPhase: QrPhase = "idle") {
    qrRequestId.current += 1;
    setQrChallenge("");
    setQrImage("");
    setQrPhase(nextPhase);
  }

  async function startQr() {
    const requestId = ++qrRequestId.current;
    setError("");
    setQrChallenge("");
    setQrImage("");
    setQrPhase("loading");
    try {
      const body = await api<QrStart>("/api/auth/cas/qr", {
        method: "POST",
        body: "{}",
      });
      if (requestId !== qrRequestId.current) return;
      if (!body.challenge || !isQrDataImage(body.image)) {
        setQrPhase("error");
        setError("登录失败，请稍后重试");
        return;
      }
      setQrChallenge(body.challenge);
      setQrImage(body.image);
      setQrPhase("pending");
    } catch (err: unknown) {
      if (requestId !== qrRequestId.current) return;
      setQrPhase("error");
      setError(err instanceof ApiError ? err.message : "登录失败，请稍后重试");
    }
  }

  function selectLoginTab(key: Key) {
    const next = String(key);
    setLoginTab(next);
    if (next !== "qr") {
      resetQr();
      return;
    }
    void startQr();
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
        role="article"
        aria-labelledby="login-heading"
        variant="secondary"
      >
        <Card.Header>
          <Card.Title id="login-heading">
            登录
          </Card.Title>
        </Card.Header>
        {ready && viewer.authenticated ? (
          <Card.Content>
            <AlreadyLoggedInAlert />
          </Card.Content>
        ) : !ready && !redeeming ? (
          <Card.Content>{SESSION_LOADING_STATUS}</Card.Content>
        ) : redeeming ? (
          <Card.Content>
            <LoginProgressAlert
              title="正在完成登录"
              description="马上就好。"
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
                    description="马上就好。"
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
                <div className="mx-auto flex w-[280px] flex-col gap-2">
                  <Label>验证码</Label>
                  <InputOTP
                    aria-label="验证码"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    isDisabled={busy}
                    maxLength={4}
                    name="mfa"
                    pattern={REGEXP_ONLY_DIGITS}
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
            <Card.Footer className="mt-4 flex flex-col gap-2">
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
          <Card.Content>
            <Tabs
              selectedKey={loginTab}
              onSelectionChange={selectLoginTab}
            >
              <Tabs.ListContainer>
                <Tabs.List aria-label="登录方式">
                  <Tabs.Tab id="password">
                    账号密码
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="qr">
                    <Tabs.Separator />
                    扫码登录
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel className="pt-4" id="password">
                <Form
                  aria-busy={busy}
                  aria-labelledby="login-heading"
                  onSubmit={submitCas}
                >
                  <div className="flex flex-col gap-4">
                    {loginTab === "password" ? errorAlert : null}
                    {busy ? (
                      <LoginProgressAlert
                        title="正在登录"
                        description="通常只要几秒。"
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
                    <Button fullWidth isPending={busy} type="submit">
                      {({ isPending }) => (
                        <>
                          {isPending ? <Spinner color="current" size="sm" /> : null}
                          {isPending ? "正在登录…" : "登录"}
                        </>
                      )}
                    </Button>
                    {devLoginButton}
                  </div>
                </Form>
              </Tabs.Panel>
              <Tabs.Panel className="pt-4" id="qr">
                <div className="flex flex-col gap-4">
                  {qrPhase === "loading" || qrPhase === "idle" ? (
                    <>
                      <Skeleton className="mx-auto h-48 w-48" />
                      <LoginProgressAlert
                        title="正在获取二维码"
                        description="马上就好。"
                      />
                    </>
                  ) : null}
                  {qrImage && (qrPhase === "pending" || qrPhase === "scanned") ? (
                    <>
                      <Alert status="accent">
                        <Alert.Indicator />
                        <Alert.Content>
                          <Alert.Title>
                            {qrPhase === "scanned" ? "扫码成功，请在手机上确认" : "使用微信或企业微信扫一扫登录"}
                          </Alert.Title>
                        </Alert.Content>
                      </Alert>
                      <img
                        alt="微信或企业微信登录二维码"
                        className="mx-auto size-48"
                        src={qrImage}
                        onError={() => {
                          setQrImage("");
                          setQrPhase("expired");
                        }}
                      />
                    </>
                  ) : null}
                  {qrPhase === "error" ? errorAlert : null}
                  {qrPhase === "expired" || qrPhase === "cancelled" ? (
                    <Alert status="warning">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>
                          {qrPhase === "cancelled" ? "扫码已取消" : "二维码已失效"}
                        </Alert.Title>
                        <Alert.Description>
                          请刷新二维码后重新扫码。
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
                  ) : null}
                  {qrPhase === "expired" ||
                  qrPhase === "cancelled" ||
                  qrPhase === "error" ? (
                    <Button
                      fullWidth
                      onPress={() => {
                        void startQr();
                      }}
                    >
                      刷新二维码
                    </Button>
                  ) : null}
                </div>
              </Tabs.Panel>
            </Tabs>
          </Card.Content>
        )}
      </Card>
    </section>
  );
}
