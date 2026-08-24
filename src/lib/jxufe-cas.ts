import { encryptCasPassword } from "./cas-rsa";

export const CAS_BASE_URL = "https://ssl.jxufe.edu.cn/cas/";
export const CAS_SERVICE_URL = "http://ehall.jxufe.edu.cn";
export const CAS_ISSUER = "ssl.jxufe.edu.cn";
export const CAS_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

export type CasCookieJar = Record<string, string>;

export type CasMfaHold = {
  cookies: CasCookieJar;
  execution: string;
  password: string;
  username: string;
  fpVisitorId: string;
  mfaState: string;
  attestServerUrl: string;
  gid: string;
  maskedPhone: string;
};

export type CasQrHold = {
  kind: "qr";
  cookies: CasCookieJar;
  fpVisitorId: string;
};

export type CasQrStartOk = {
  ok: true;
  hold: CasQrHold;
  imagePng: Uint8Array;
};
export type CasQrStartResult = CasQrStartOk | CasLoginFail;

export type CasQrPollWaiting = {
  ok: true;
  status: "pending" | "scanned" | "cancelled" | "expired";
};
export type CasQrPollAuthorized = {
  ok: true;
  status: "authorized";
  username: string;
};
export type CasQrPollResult = CasQrPollWaiting | CasQrPollAuthorized | CasLoginFail;

export type CasLoginOk = { ok: true };
export type CasLoginMfa = { ok: false; needsMfa: true; hold: CasMfaHold };
export type CasLoginFail = {
  ok: false;
  needsMfa?: false;
  error: string;
  status: 400 | 401 | 503;
};
export type CasLoginResult = CasLoginOk | CasLoginMfa | CasLoginFail;

export const CAS_MFA_CONSUMED_LOGIN_FAILED =
  "验证码已核销，但学号或密码未通过。请确认后重新登录。";

const LOGIN_URL = `${CAS_BASE_URL}login?service=${encodeURIComponent(CAS_SERVICE_URL)}`;
const PUBLIC_KEY_URL = `${CAS_BASE_URL}jwt/publicKey`;
const MFA_DETECT_URL = `${CAS_BASE_URL}mfa/detect`;
const MFA_INIT_URL = `${CAS_BASE_URL}mfa/initByType/securephone`;
const QR_IMAGE_URL = `${CAS_BASE_URL}qr/qrcode`;
const QR_COMET_URL = `${CAS_BASE_URL}qr/comet`;
const SERVICE_VALIDATE_URL = `${CAS_BASE_URL}p3/serviceValidate`;
const QR_IMAGE_MIN_BYTES = 32;
const QR_IMAGE_MAX_BYTES = 80_000;

export function normalizeCasUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 32) return null;
  if (!/^[A-Za-z0-9._-]{4,32}$/.test(value)) return null;
  return value;
}

export function normalizeCasPassword(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw || raw.length > 128) return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(raw)) return null;
  return raw;
}

export function isAllowedCasUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "ssl.jxufe.edu.cn") return url.protocol === "https:";
  return host === "jxufe.edu.cn" || host.endsWith(".jxufe.edu.cn");
}

function isCasReauthCheckLocation(location: string) {
  if (!/reAuthCheck/i.test(location)) return false;
  if (location.startsWith("/") && !location.startsWith("//")) return true;
  return isAllowedCasUrl(location);
}

/** jufe_cas: 302 即口令通过；同域 `reAuthCheck` 只在 MFA 核销后当作本站探针成功。 */
export function isSuccessfulCasRedirect(
  location: string,
  options: { acceptReauthCheck?: boolean } = {},
): boolean {
  if (!location) return false;
  if (isCasReauthCheckLocation(location)) {
    return Boolean(options.acceptReauthCheck);
  }
  if (/[?&]ticket=/.test(location)) return true;
  return /ehall\.jxufe\.edu\.cn/i.test(location);
}

export function applySetCookie(jar: CasCookieJar, response: Response) {
  const headers = response.headers as Headers & { getSetCookie?(): string[] };
  const lines = [...(headers.getSetCookie?.() || [])];
  if (lines.length === 0) {
    const single = response.headers.get("set-cookie");
    if (single) lines.push(single);
  }
  for (const raw of lines) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    if (!value || /(?:^|;)\s*max-age=0\b/i.test(raw)) delete jar[name];
    else jar[name] = value;
  }
}

export function cookieHeader(jar: CasCookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function parseLoginPage(html: string): {
  execution: string | null;
  encryptEnabled: boolean;
  captchaRequired: boolean;
} {
  const execution =
    html.match(/name=["']execution["'][^>]*value=["']([^"']+)["']/i)?.[1] ||
    html.match(/value=["']([^"']+)["'][^>]*name=["']execution["']/i)?.[1] ||
    null;
  return {
    execution,
    encryptEnabled: /"encryptEnabled"\s*:\s*"true"/.test(html),
    captchaRequired:
      /\/cas\/captcha/i.test(html) || /id=["']captchaImg/i.test(html),
  };
}

const CAS_TIP_MAX = 80;

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function sanitizeCasErrorTip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = decodeHtmlEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > CAS_TIP_MAX) return null;
  if (/https?:|javascript:|<|>|cas_|CASTGC|execution=/i.test(text)) return null;
  return text;
}

export function parseErrorTip(html: string): string {
  const patterns = [
    /id=["']showErrorTip["'][^>]*>([\s\S]*?)<\/(?:div|span|p|strong)>/i,
    /id=["']msg["'][^>]*>([\s\S]*?)<\/(?:div|span|p|strong)>/i,
    /class=["'][^"']*\berrors\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p|ul|li)>/i,
  ];
  for (const pattern of patterns) {
    const tip = sanitizeCasErrorTip(html.match(pattern)?.[1]);
    if (tip) return tip;
  }
  return "学号或密码不正确";
}

export function parseCasJsonError(
  body: Record<string, unknown> | null,
): string | null {
  if (!body) return null;
  const objects: Record<string, unknown>[] = [body];
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
    objects.push(body.data as Record<string, unknown>);
  }
  for (const object of objects) {
    for (const key of ["msg", "message", "error"]) {
      const tip = sanitizeCasErrorTip(
        typeof object[key] === "string" ? object[key] : null,
      );
      if (tip) return tip;
    }
  }
  return null;
}

function fail(error: string, status: 400 | 401 | 503 = 400): CasLoginFail {
  return { ok: false, error, status };
}

function randomFingerprint() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

async function casFetch(
  url: string,
  jar: CasCookieJar,
  init: {
    method?: string;
    body?: string;
    contentType?: string;
    accept?: string;
    followRedirects?: boolean;
    hops?: number;
  } = {},
): Promise<Response> {
  if (!isAllowedCasUrl(url)) throw new Error("cas_host_blocked");
  const headers = new Headers({
    "user-agent": CAS_USER_AGENT,
    accept: init.accept || "text/html,application/json;q=0.9,*/*;q=0.8",
  });
  const cookie = cookieHeader(jar);
  if (cookie) headers.set("cookie", cookie);
  if (init.method === "POST") headers.set("referer", LOGIN_URL);
  if (init.body !== undefined) {
    headers.set("content-type", init.contentType || "application/x-www-form-urlencoded");
    headers.set("referer", LOGIN_URL);
  }
  const response = await fetch(url, {
    method: init.method || "GET",
    headers,
    body: init.body,
    redirect: "manual",
  });
  applySetCookie(jar, response);
  const location = response.headers.get("location") || "";
  const hops = init.hops ?? 0;
  if (
    init.followRedirects !== false &&
    hops < 5 &&
    location &&
    [301, 302, 303, 307, 308].includes(response.status)
  ) {
    const next = new URL(location, url).toString();
    if (
      /ehall\.jxufe\.edu\.cn/i.test(next) ||
      /[?&]ticket=/.test(next) ||
      isCasReauthCheckLocation(next)
    ) {
      return response;
    }
    return casFetch(next, jar, { followRedirects: true, hops: hops + 1 });
  }
  return response;
}

async function readText(response: Response) {
  return response.text();
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = JSON.parse(await readText(response));
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isRedirectStatus(status: number) {
  return [301, 302, 303, 307, 308].includes(status);
}

function isPasswordishCasError(error: string) {
  return /学号或密码|用户名或密码/.test(error);
}

async function fetchLoginPage(
  jar: CasCookieJar,
  options: { acceptReauthCheck?: boolean } = {},
): Promise<CasLoginOk | { ok: false; page: ReturnType<typeof parseLoginPage> }> {
  const response = await casFetch(LOGIN_URL, jar, { followRedirects: true });
  const location = response.headers.get("location") || "";
  if (
    isRedirectStatus(response.status) &&
    isSuccessfulCasRedirect(location, options)
  ) {
    return { ok: true };
  }
  const html = await readText(response);
  if (/not found in service registry/i.test(html)) {
    throw new Error("cas_service_unregistered");
  }
  const page = parseLoginPage(html);
  if (page.captchaRequired) throw new Error("cas_captcha_required");
  if (!page.execution) throw new Error("cas_execution_missing");
  return { ok: false, page };
}

async function loadLoginPage(jar: CasCookieJar) {
  const loaded = await fetchLoginPage(jar);
  if (loaded.ok) throw new Error("cas_already_authenticated");
  return loaded.page;
}

async function passwordToSend(
  password: string,
  encryptEnabled: boolean,
  jar: CasCookieJar,
) {
  if (!encryptEnabled) return password;
  const keyResponse = await casFetch(PUBLIC_KEY_URL, jar);
  if (!keyResponse.ok) throw new Error("cas_public_key");
  return encryptCasPassword(password, await readText(keyResponse));
}

async function detectMfa(
  jar: CasCookieJar,
  username: string,
  password: string,
  fpVisitorId: string,
) {
  const response = await casFetch(MFA_DETECT_URL, jar, {
    method: "POST",
    body: new URLSearchParams({
      username,
      password,
      fpVisitorId,
    }).toString(),
    followRedirects: false,
  });
  const body = await readJson(response);
  const data =
    body?.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : null;
  return {
    need: body?.code === 0 && data?.need === true,
    state: typeof data?.state === "string" ? data.state : "",
  };
}

async function submitLogin(
  jar: CasCookieJar,
  input: {
    username: string;
    password: string;
    execution: string;
    mfaState: string;
    fpVisitorId: string;
  },
  options: { acceptReauthCheck?: boolean } = {},
): Promise<CasLoginResult> {
  const response = await casFetch(LOGIN_URL, jar, {
    method: "POST",
    body: new URLSearchParams({
      username: input.username,
      password: input.password,
      captcha: "",
      currentMenu: "1",
      failN: "-1",
      mfaState: input.mfaState,
      execution: input.execution,
      _eventId: "submit",
      geolocation: "",
      fpVisitorId: input.fpVisitorId,
      trustAgent: "",
      rememberMe: "on",
    }).toString(),
    followRedirects: false,
  });
  if (
    response.status === 302 &&
    isSuccessfulCasRedirect(response.headers.get("location") || "", options)
  ) {
    return { ok: true };
  }
  const html = await readText(response);
  if (response.status === 401) {
    return fail(parseErrorTip(html), 401);
  }
  // Live CAS often returns 200 login HTML for a rejected password instead of 401.
  if (response.status === 200 && (parseLoginPage(html).execution || /统一身份认证/.test(html))) {
    return fail(parseErrorTip(html), 401);
  }
  return fail("登录失败，请稍后重试", 400);
}

export async function startCasPasswordLogin(
  username: string,
  password: string,
): Promise<CasLoginResult> {
  const jar: CasCookieJar = {};
  try {
    const page = await loadLoginPage(jar);
    const encoded = await passwordToSend(password, page.encryptEnabled, jar);
    const fpVisitorId = randomFingerprint();
    const mfa = await detectMfa(jar, username, encoded, fpVisitorId);
    if (mfa.need) {
      if (!mfa.state) return fail("登录失败，请稍后重试");
      const init = await casFetch(
        `${MFA_INIT_URL}?state=${encodeURIComponent(mfa.state)}`,
        jar,
      );
      const initBody = await readJson(init);
      const data =
        initBody?.data && typeof initBody.data === "object"
          ? (initBody.data as Record<string, unknown>)
          : null;
      const attestServerUrl =
        typeof data?.attestServerUrl === "string" ? data.attestServerUrl : "";
      const gid = typeof data?.gid === "string" ? data.gid : "";
      const maskedPhone =
        typeof data?.securePhone === "string" ? data.securePhone : "";
      if (initBody?.code !== 0 || !attestServerUrl || !gid) {
        return fail("登录失败，请稍后重试");
      }
      const sendUrl = `${attestServerUrl.replace(/\/$/, "")}/api/guard/securephone/send`;
      if (!isAllowedCasUrl(sendUrl)) return fail("登录失败，请稍后重试", 503);
      const sent = await casFetch(sendUrl, jar, {
        method: "POST",
        body: JSON.stringify({ gid }),
        contentType: "application/json; charset=UTF-8",
        followRedirects: false,
      });
      const sentBody = await readJson(sent);
      if (sentBody?.code !== 0) {
        return fail(parseCasJsonError(sentBody) || "验证码发送失败，请稍后重试");
      }
      return {
        ok: false,
        needsMfa: true,
        hold: {
          cookies: jar,
          execution: page.execution || "",
          password: encoded,
          username,
          fpVisitorId,
          mfaState: mfa.state,
          attestServerUrl: attestServerUrl.replace(/\/$/, ""),
          gid,
          maskedPhone,
        },
      };
    }
    return submitLogin(jar, {
      username,
      password: encoded,
      execution: page.execution || "",
      mfaState: "",
      fpVisitorId,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "cas_captcha_required") {
      return fail("登录页要求验证码，请稍后重试", 503);
    }
    if (reason === "cas_host_blocked") {
      return fail("登录失败，请稍后重试", 503);
    }
    return fail("登录失败，请稍后重试");
  }
}

export async function completeCasPasswordLogin(
  hold: CasMfaHold,
  code: string,
): Promise<CasLoginResult> {
  const jar = { ...hold.cookies };
  try {
    const validUrl = `${hold.attestServerUrl}/api/guard/securephone/valid`;
    if (!isAllowedCasUrl(validUrl)) return fail("登录失败，请稍后重试", 503);
    const valid = await casFetch(validUrl, jar, {
      method: "POST",
      body: JSON.stringify({ gid: hold.gid, code }),
      contentType: "application/json; charset=UTF-8",
      followRedirects: false,
    });
    const validBody = await readJson(valid);
    const data =
      validBody?.data && typeof validBody.data === "object"
        ? (validBody.data as Record<string, unknown>)
        : null;
    if (validBody?.code !== 0 || data?.status !== 2) {
      return fail(parseCasJsonError(validBody) || "验证码不正确", 401);
    }
    const first = await submitLogin(
      jar,
      {
        username: hold.username,
        password: hold.password,
        execution: hold.execution,
        mfaState: hold.mfaState,
        fpVisitorId: hold.fpVisitorId,
      },
      { acceptReauthCheck: true },
    );
    if (first.ok) return first;
    if (!first.needsMfa && isPasswordishCasError(first.error)) {
      return fail(CAS_MFA_CONSUMED_LOGIN_FAILED, first.status);
    }
    const mfa = await detectMfa(jar, hold.username, hold.password, hold.fpVisitorId);
    const loaded = await fetchLoginPage(jar, { acceptReauthCheck: true });
    if (loaded.ok) return loaded;
    const result = await submitLogin(
      jar,
      {
        username: hold.username,
        password: hold.password,
        execution: loaded.page.execution || hold.execution,
        mfaState: mfa.state || hold.mfaState,
        fpVisitorId: hold.fpVisitorId,
      },
      { acceptReauthCheck: true },
    );
    if (!result.ok && !result.needsMfa && isPasswordishCasError(result.error)) {
      return fail(CAS_MFA_CONSUMED_LOGIN_FAILED, result.status);
    }
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "cas_captcha_required") {
      return fail("登录页要求验证码，请稍后重试", 503);
    }
    if (reason === "cas_host_blocked") {
      return fail("登录失败，请稍后重试", 503);
    }
    return fail("登录失败，请稍后重试");
  }
}

export function parseQrCometAccounts(raw: unknown): string | null {
  if (typeof raw === "string") return normalizeCasUsername(raw);
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const username = parseQrCometAccounts(item);
      if (username) return username;
    }
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  for (const key of ["username", "account", "userId"]) {
    const username = normalizeCasUsername(record[key]);
    if (username) return username;
  }
  return null;
}

export function parseCasServiceValidateUser(xml: string): string | null {
  const match =
    xml.match(/<cas:user>\s*([^<]+)\s*<\/cas:user>/i) ||
    xml.match(/<(?:[\w-]+:)?user>\s*([^<]+)\s*<\/(?:[\w-]+:)?user>/i);
  return normalizeCasUsername(match?.[1]?.trim());
}

export function extractCasServiceTicket(location: string): string | null {
  if (!location) return null;
  let ticket = "";
  try {
    ticket = new URL(location, CAS_BASE_URL).searchParams.get("ticket") || "";
  } catch {
    ticket = location.match(/[?&]ticket=([^&]+)/i)?.[1] || "";
    try {
      ticket = decodeURIComponent(ticket);
    } catch {
      return null;
    }
  }
  if (!/^ST-[A-Za-z0-9._-]{1,200}$/.test(ticket)) return null;
  return ticket;
}

function cometDataRecord(body: Record<string, unknown> | null) {
  if (!body?.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return null;
  }
  return body.data as Record<string, unknown>;
}

function cometQrCodeRecord(data: Record<string, unknown> | null) {
  if (!data?.qrCode || typeof data.qrCode !== "object" || Array.isArray(data.qrCode)) {
    return null;
  }
  return data.qrCode as Record<string, unknown>;
}

function usernameFromCometData(data: Record<string, unknown> | null) {
  if (!data) return null;
  return (
    parseQrCometAccounts(data.accounts) ||
    parseQrCometAccounts(cometQrCodeRecord(data)?.accounts)
  );
}

function qrWaitStatus(raw: unknown): CasQrPollWaiting["status"] | "authorized" | null {
  const value = String(raw ?? "");
  if (value === "1") return "pending";
  if (value === "2") return "scanned";
  if (value === "3") return "authorized";
  if (value === "4") return "cancelled";
  return null;
}

function isPngImage(bytes: Uint8Array) {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

async function fetchQrImage(jar: CasCookieJar) {
  const response = await casFetch(`${QR_IMAGE_URL}?r=${Date.now()}`, jar, {
    followRedirects: false,
    accept: "image/png,image/*;q=0.8,*/*;q=0.5",
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !/image\/png/i.test(contentType)) {
    throw new Error("cas_qr_image");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.length < QR_IMAGE_MIN_BYTES ||
    bytes.length > QR_IMAGE_MAX_BYTES ||
    !isPngImage(bytes)
  ) {
    throw new Error("cas_qr_image");
  }
  return bytes;
}

async function submitQrLogin(
  jar: CasCookieJar,
  qrCodeKey: string,
  fpVisitorId: string,
): Promise<{ ok: true; ticket: string | null } | CasLoginFail> {
  const response = await casFetch(LOGIN_URL, jar, {
    method: "POST",
    body: new URLSearchParams({
      qrCodeKey,
      currentMenu: "3",
      geolocation: "",
      fpVisitorId,
      trustAgent: "",
      _eventId_success: "Submit",
    }).toString(),
    followRedirects: false,
  });
  const location = response.headers.get("location") || "";
  if (
    isRedirectStatus(response.status) &&
    isSuccessfulCasRedirect(location, { acceptReauthCheck: true })
  ) {
    return { ok: true, ticket: extractCasServiceTicket(location) };
  }
  return fail("登录失败，请稍后重试", 400);
}

async function usernameFromServiceTicket(jar: CasCookieJar, ticket: string) {
  const url = `${SERVICE_VALIDATE_URL}?service=${encodeURIComponent(CAS_SERVICE_URL)}&ticket=${encodeURIComponent(ticket)}`;
  const response = await casFetch(url, jar, { followRedirects: false });
  if (!response.ok) return null;
  return parseCasServiceValidateUser(await readText(response));
}

export async function startCasQrLogin(): Promise<CasQrStartResult> {
  const jar: CasCookieJar = {};
  try {
    const loaded = await fetchLoginPage(jar);
    if (loaded.ok) return fail("登录失败，请稍后重试");
    const imagePng = await fetchQrImage(jar);
    return {
      ok: true,
      hold: {
        kind: "qr",
        cookies: jar,
        fpVisitorId: randomFingerprint(),
      },
      imagePng,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "cas_captcha_required") {
      return fail("登录页要求验证码，请稍后重试", 503);
    }
    if (reason === "cas_host_blocked") {
      return fail("登录失败，请稍后重试", 503);
    }
    return fail("登录失败，请稍后重试");
  }
}

export async function pollCasQrLogin(hold: CasQrHold): Promise<CasQrPollResult> {
  const jar = { ...hold.cookies };
  try {
    const comet = await casFetch(QR_COMET_URL, jar, {
      method: "POST",
      body: "",
      followRedirects: false,
      accept: "application/json,text/plain;q=0.8,*/*;q=0.5",
    });
    const body = await readJson(comet);
    if (!body) return fail("登录失败，请稍后重试");
    if (Number(body.code) === 1) return { ok: true, status: "expired" };
    if (Number(body.code) !== 0) {
      return fail(parseCasJsonError(body) || "登录失败，请稍后重试");
    }
    const data = cometDataRecord(body);
    const status = qrWaitStatus(cometQrCodeRecord(data)?.status);
    if (!status) return fail("登录失败，请稍后重试");
    if (status !== "authorized") return { ok: true, status };
    const qrRecord = cometQrCodeRecord(data);
    const qrCodeKey =
      (typeof data?.stateKey === "string" && data.stateKey) ||
      (typeof qrRecord?.stateKey === "string" && qrRecord.stateKey) ||
      "";
    if (!qrCodeKey) return fail("登录失败，请稍后重试");
    const submitted = await submitQrLogin(jar, qrCodeKey, hold.fpVisitorId);
    if (!submitted.ok) return submitted;
    const username =
      usernameFromCometData(data) ||
      (submitted.ticket ? await usernameFromServiceTicket(jar, submitted.ticket) : null);
    if (!username) return fail("登录失败，请稍后重试", 401);
    return { ok: true, status: "authorized", username };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "cas_captcha_required") {
      return fail("登录页要求验证码，请稍后重试", 503);
    }
    if (reason === "cas_host_blocked") {
      return fail("登录失败，请稍后重试", 503);
    }
    return fail("登录失败，请稍后重试");
  }
}
