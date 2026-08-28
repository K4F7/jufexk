import { ArrowRotateRight, Check } from "@gravity-ui/icons";
import {
  Alert,
  Button,
  Card,
  Description,
  Form,
  Input,
  InputOTP,
  Label,
  REGEXP_ONLY_DIGITS,
  Skeleton,
  Spinner,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@heroui/react";
import { useEffect, useRef, useState, type FormEvent, type Key } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
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

function shouldReturnToCredentials(message: string) {
  return RETURN_TO_CREDENTIALS_RE.test(message);
}

const SESSION_LOADING_STATUS = (
  <DetailLoadingStatus label="正在读取登录状态…" />
);

const LOGIN_PREVIEW_PARAM = "preview";
const PREVIEW_MFA_CHALLENGE = "preview-mfa";
const PREVIEW_QR_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function LoginPreviewBar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = searchParams.get(LOGIN_PREVIEW_PARAM) || "password";

  return (
    <ToggleButtonGroup
      disallowEmptySelection
      aria-label="登录预览状态"
      className="mb-4"
      selectedKeys={new Set([current])}
      selectionMode="single"
      size="sm"
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (typeof next !== "string") return;
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set(LOGIN_PREVIEW_PARAM, next);
        setSearchParams(nextParams, { replace: true });
      }}
    >
      <ToggleButton id="password">账号密码</ToggleButton>
      <ToggleButton id="mfa">
        <ToggleButtonGroup.Separator />
        验证码
      </ToggleButton>
      <ToggleButton id="mfa-error">
        <ToggleButtonGroup.Separator />
        验证码错误
      </ToggleButton>
      <ToggleButton id="qr">
        <ToggleButtonGroup.Separator />
        扫码加载
      </ToggleButton>
      <ToggleButton id="qr-scanned">
        <ToggleButtonGroup.Separator />
        已扫码
      </ToggleButton>
      <ToggleButton id="qr-expired">
        <ToggleButtonGroup.Separator />
        二维码失效
      </ToggleButton>
      <ToggleButton id="qr-error">
        <ToggleButtonGroup.Separator />
        请求过频
      </ToggleButton>
      <ToggleButton id="qr-fail">
        <ToggleButtonGroup.Separator />
        扫码失败
      </ToggleButton>
      <ToggleButton id="locked">
        <ToggleButtonGroup.Separator />
        账号锁定
      </ToggleButton>
      <ToggleButton id="password-update">
        <ToggleButtonGroup.Separator />
        需改密
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const backTarget = backTargetFrom(searchParams.get("from"));
  const campusReauth = searchParams.get("reauth") === "campus";
  const magicToken = searchParams.get("token") || "";
  const { viewer, ready, refresh, applySession } = useViewer();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [challenge, setChallenge] = useState(() =>
    import.meta.env.DEV &&
    (searchParams.get(LOGIN_PREVIEW_PARAM) === "mfa" ||
      searchParams.get(LOGIN_PREVIEW_PARAM) === "mfa-error")
      ? PREVIEW_MFA_CHALLENGE
      : "",
  );
  const [busy, setBusy] = useState(false);
  const [redeeming, setRedeeming] = useState(Boolean(magicToken));
  const [error, setError] = useState(() => {
    if (!import.meta.env.DEV) return "";
    const preview = searchParams.get(LOGIN_PREVIEW_PARAM);
    if (preview === "qr-error") return "请求过于频繁，请稍后再试";
    if (preview === "qr-fail") return "登录失败，请稍后重试";
    return "";
  });
  const [loginTab, setLoginTab] = useState(() =>
    import.meta.env.DEV &&
    (searchParams.get(LOGIN_PREVIEW_PARAM)?.startsWith("qr") ?? false)
      ? "qr"
      : "password",
  );
  const [qrPhase, setQrPhase] = useState<QrPhase>(() => {
    if (!import.meta.env.DEV) return "idle";
    const preview = searchParams.get(LOGIN_PREVIEW_PARAM);
    if (preview === "qr") return "loading";
    if (preview === "qr-scanned") return "scanned";
    if (preview === "qr-expired") return "expired";
    if (preview === "qr-error" || preview === "qr-fail") return "error";
    return "idle";
  });
  const [qrChallenge, setQrChallenge] = useState("");
  const [qrImage, setQrImage] = useState(() =>
    import.meta.env.DEV && searchParams.get(LOGIN_PREVIEW_PARAM) === "qr-scanned"
      ? PREVIEW_QR_IMAGE
      : "",
  );
  const loginRequestId = useRef(0);
  const authLandingRef = useRef<string | null>(null);
  const qrRequestId = useRef(0);
  const mfaSubmitting = useRef(false);
  const loginPreview = import.meta.env.DEV
    ? searchParams.get(LOGIN_PREVIEW_PARAM)
    : null;

  useEffect(() => {
    if (!import.meta.env.DEV || !loginPreview) return;
    setMfaCode("");
    setBusy(false);
    mfaSubmitting.current = false;
    if (loginPreview === "mfa") {
      setChallenge(PREVIEW_MFA_CHALLENGE);
      setError("");
      setLoginTab("password");
      return;
    }
    if (loginPreview === "mfa-error") {
      setChallenge(PREVIEW_MFA_CHALLENGE);
      setError("验证码不正确");
      setLoginTab("password");
      return;
    }
    if (loginPreview === "qr") {
      setChallenge("");
      setError("");
      setLoginTab("qr");
      resetQr("loading");
      return;
    }
    if (loginPreview === "qr-scanned") {
      setChallenge("");
      setError("");
      setLoginTab("qr");
      qrRequestId.current += 1;
      setQrChallenge("");
      setQrImage(PREVIEW_QR_IMAGE);
      setQrPhase("scanned");
      return;
    }
    if (loginPreview === "qr-expired") {
      setChallenge("");
      setError("");
      setLoginTab("qr");
      resetQr("expired");
      return;
    }
    if (loginPreview === "qr-error") {
      setChallenge("");
      setError("请求过于频繁，请稍后再试");
      setLoginTab("qr");
      resetQr("error");
      return;
    }
    if (loginPreview === "qr-fail") {
      setChallenge("");
      setError("登录失败，请稍后重试");
      setLoginTab("qr");
      resetQr("error");
      return;
    }
    if (loginPreview === "locked") {
      setChallenge("");
      setError("账号已锁定，请稍后再试");
      setLoginTab("password");
      return;
    }
    if (loginPreview === "password-update") {
      setChallenge("");
      setError("密码已过期，请先修改密码");
      setLoginTab("password");
      return;
    }
    setChallenge("");
    setError("");
    setLoginTab("password");
  }, [loginPreview]);

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
    if (loginPreview === "qr") {
      setError("");
      resetQr("loading");
      return;
    }
    if (loginPreview === "qr-scanned") {
      qrRequestId.current += 1;
      setError("");
      setQrChallenge("");
      setQrImage(PREVIEW_QR_IMAGE);
      setQrPhase("scanned");
      return;
    }
    if (loginPreview === "qr-expired") {
      setError("");
      resetQr("expired");
      return;
    }
    if (loginPreview === "qr-error") {
      setError("请求过于频繁，请稍后再试");
      resetQr("error");
      return;
    }
    if (loginPreview === "qr-fail") {
      setError("登录失败，请稍后重试");
      resetQr("error");
      return;
    }
    void startQr();
  }

  /** Local testing only — Vite DEV UI; Worker still rejects unless ALLOW_DEV_LOGIN=1. */
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
      const target = searchParams.get("from") ? backTarget : "/profile";
      // Prefer this over the generic authenticated Navigate (defaults to /courses).
      authLandingRef.current = target;
      if (session.authenticated) applySession(session);
      navigate(target, { replace: true });
    } catch (err: unknown) {
      if (requestId !== loginRequestId.current) return;
      setError(err instanceof ApiError ? err.message : "登录失败，请稍后重试");
    } finally {
      if (requestId === loginRequestId.current) setBusy(false);
    }
  }

  const devLoginButton = import.meta.env.DEV ? (
    <Button
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
      if (body.needsMfa) {
        setError("");
        setChallenge(body.challenge);
        return;
      }
      setPassword("");
      await finishLogin(body);
    } catch (err: unknown) {
      if (requestId !== loginRequestId.current) return;
      setError(err instanceof ApiError ? err.message : "登录失败，请稍后重试");
    } finally {
      if (requestId === loginRequestId.current) setBusy(false);
    }
  }

  async function submitMfaCode(code: string) {
    if (mfaSubmitting.current || code.length !== 4) return;
    mfaSubmitting.current = true;
    const requestId = ++loginRequestId.current;
    setError("");
    setBusy(true);
    try {
      if (import.meta.env.DEV && challenge === PREVIEW_MFA_CHALLENGE) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        if (requestId !== loginRequestId.current) return;
        setError("验证码不正确");
        setMfaCode("");
        return;
      }
      const session = await api<CasStart>("/api/auth/cas/mfa", {
        method: "POST",
        body: JSON.stringify({ challenge, code, password }),
      });
      if (requestId !== loginRequestId.current) return;
      setPassword("");
      finishLogin(session);
    } catch (err: unknown) {
      if (requestId !== loginRequestId.current) return;
      const message =
        err instanceof ApiError ? err.message : "验证码不正确";
      setError(message);
      setMfaCode("");
      if (shouldReturnToCredentials(message)) {
        setPassword("");
        setChallenge("");
      }
    } finally {
      if (requestId === loginRequestId.current) {
        mfaSubmitting.current = false;
        setBusy(false);
      }
    }
  }

  function submitMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMfaCode(mfaCode);
  }

  const passwordInvalid = loginTab === "password" && Boolean(error);
  const mfaError =
    error && !RETURN_TO_CREDENTIALS_RE.test(error) ? error : "";

  return (
    <section
      aria-labelledby="login-heading"
      className="mx-auto w-full max-w-xl py-8"
    >
      {import.meta.env.DEV &&
      (loginPreview || searchParams.get("atlas") === "1") ? (
        <LoginPreviewBar />
      ) : null}
      <Card role="article" aria-labelledby="login-heading">
        <Card.Header>
          <Typography className="m-0 text-lg font-semibold" id="login-heading" type="h1">
            {campusReauth ? "重新验证校园身份" : "登录"}
          </Typography>
        </Card.Header>
        {ready && viewer.authenticated && !campusReauth && !loginPreview ? (
          <Navigate to={authLandingRef.current ?? backTarget} replace />
        ) : !ready && !redeeming && !loginPreview ? (
          <Card.Content>{SESSION_LOADING_STATUS}</Card.Content>
        ) : redeeming && !loginPreview ? (
          <Card.Content>
            <LoginProgressAlert
              title="正在完成登录"
              description="马上就好。"
            />
          </Card.Content>
        ) : challenge ? (
          <Card.Content className="flex flex-col items-center">
            <Form
              aria-busy={busy}
              aria-labelledby="login-heading"
              className="mx-auto flex w-72 flex-col items-center gap-4"
              onSubmit={submitMfa}
            >
              <div className="flex w-full flex-col items-center gap-2 text-center">
                <Label>验证码</Label>
                <Description>输入发送到企业微信的四位验证码</Description>
                <InputOTP
                  aria-describedby={mfaError ? "code-error" : undefined}
                  aria-label="验证码"
                  autoComplete="one-time-code"
                  autoFocus
                  className="w-auto justify-center"
                  inputMode="numeric"
                  isDisabled={busy}
                  isInvalid={Boolean(mfaError)}
                  maxLength={4}
                  name="code"
                  pattern={REGEXP_ONLY_DIGITS}
                  value={mfaCode}
                  variant="secondary"
                  onChange={(value) => {
                    setMfaCode(value);
                    if (error) setError("");
                  }}
                  onComplete={(value) => {
                    setMfaCode(value);
                    void submitMfaCode(value);
                  }}
                >
                  <InputOTP.Group>
                    <InputOTP.Slot className="size-14 text-xl" index={0} />
                    <InputOTP.Slot className="size-14 text-xl" index={1} />
                    <InputOTP.Slot className="size-14 text-xl" index={2} />
                    <InputOTP.Slot className="size-14 text-xl" index={3} />
                  </InputOTP.Group>
                </InputOTP>
                <span
                  className="field-error"
                  data-visible={Boolean(mfaError)}
                  id="code-error"
                >
                  {mfaError}
                </span>
              </div>
              <Button
                className="w-full"
                isDisabled={mfaCode.length !== 4}
                isPending={busy}
                type="submit"
              >
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner color="current" size="sm" /> : null}
                    {isPending ? "正在验证…" : "验证"}
                  </>
                )}
              </Button>
              {devLoginButton}
            </Form>
          </Card.Content>
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
                  onReset={() => {
                    setUsername("");
                    setPassword("");
                    setError("");
                  }}
                  onSubmit={submitCas}
                >
                  <div className="flex flex-col gap-4">
                    <TextField
                      fullWidth
                      isDisabled={busy}
                      isRequired
                      name="username"
                      autoComplete="username"
                      value={username}
                      onChange={(value) => {
                        setUsername(value);
                        if (error) setError("");
                      }}
                    >
                      <Label>学号</Label>
                      <Input
                        aria-describedby={passwordInvalid ? "password-error" : undefined}
                        placeholder="请输入校园卡号"
                        variant="primary"
                      />
                    </TextField>
                    <TextField
                      fullWidth
                      isDisabled={busy}
                      isRequired
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(value) => {
                        setPassword(value);
                        if (error) setError("");
                      }}
                    >
                      <Label>校园密码</Label>
                      <Input
                        aria-describedby={
                          passwordInvalid ? "password-error" : undefined
                        }
                        placeholder="请输入统一身份认证平台登录密码"
                        variant="primary"
                      />
                    </TextField>
                    <span
                      className="field-error"
                      data-visible={passwordInvalid}
                      id="password-error"
                    >
                      {error}
                    </span>
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <Button isPending={busy} type="submit">
                          {({ isPending }) => (
                            <>
                              {isPending ? (
                                <Spinner color="current" size="sm" />
                              ) : (
                                <Check />
                              )}
                              {isPending ? "正在登录…" : "登录"}
                            </>
                          )}
                        </Button>
                        <Button
                          isDisabled={busy}
                          type="reset"
                          variant="secondary"
                        >
                          重置
                        </Button>
                      </div>
                      {devLoginButton}
                    </div>
                  </div>
                </Form>
              </Tabs.Panel>
              <Tabs.Panel className="pt-4" id="qr">
                <div className="flex flex-col gap-4">
                  {qrPhase === "loading" || qrPhase === "idle" ? (
                    <div
                      aria-label="正在获取二维码"
                      className="relative mx-auto size-48"
                      role="status"
                    >
                      <Skeleton className="h-48 w-48" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Spinner size="lg" />
                      </div>
                    </div>
                  ) : null}
                  {qrImage && qrPhase === "pending" ? (
                    <img
                      alt="微信或企业微信登录二维码"
                      className="mx-auto size-48"
                      src={qrImage}
                      onError={() => {
                        setQrImage("");
                        setQrPhase("expired");
                      }}
                    />
                  ) : null}
                  {qrImage && qrPhase === "scanned" ? (
                    <div className="relative mx-auto size-48">
                      <img
                        alt="微信或企业微信登录二维码"
                        className="size-48 opacity-50"
                        src={qrImage}
                      />
                      <div
                        aria-live="polite"
                        className="absolute inset-0 flex size-48 flex-col items-center justify-center whitespace-normal"
                        role="status"
                      >
                        <span className="text-sm font-medium">扫码成功，请在手机上确认</span>
                      </div>
                    </div>
                  ) : null}
                  {qrPhase === "expired" ||
                  qrPhase === "cancelled" ||
                  qrPhase === "error" ? (
                    <div className="relative mx-auto size-48">
                      {qrImage ? (
                        <img
                          alt="微信或企业微信登录二维码"
                          className="size-48 opacity-50"
                          src={qrImage}
                        />
                      ) : (
                        <Skeleton animationType="none" className="h-48 w-48" />
                      )}
                      <Button
                        aria-label="刷新二维码"
                        className="group absolute inset-0 size-48 flex-col gap-1"
                        variant="ghost"
                        onPress={() => {
                          void startQr();
                        }}
                      >
                        {qrPhase === "cancelled" ? (
                          <span className="text-sm font-medium">扫码已取消</span>
                        ) : qrPhase === "expired" ? (
                          <span className="text-sm font-medium">二维码已失效</span>
                        ) : qrPhase === "error" ? (
                          <span className="text-sm font-medium">
                            {error || "登录失败，请稍后重试"}
                          </span>
                        ) : null}
                        <ArrowRotateRight className="size-5 transition-transform group-hover:rotate-180" />
                      </Button>
                    </div>
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
