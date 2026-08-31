import type { Context } from "hono";
import {
  AUTH_PROVIDER_CAS,
  CAS_IDENTITY_ISSUER,
  resolveOrCreateIdentityUser,
} from "./ordinary-user-identity";
import {
  hmacHex,
  issueOrdinaryUserSessionCookie,
  ordinaryUserIdentitySecret,
} from "./ordinary-user-authentication";
import { sessionPayloadForUser } from "./ordinary-user-session";
import {
  isDevLoginEnabled,
  isLoopbackWorkerRequest,
  originOk,
} from "./ordinary-user-write-authorization";
import {
  completeCasPasswordLogin,
  CAS_SERVICE_URL,
  normalizeCasPassword,
  normalizeCasUsername,
  pollCasQrLogin,
  startCasPasswordLogin,
  startCasQrLogin,
  type CasMfaHold,
  type CasQrHold,
} from "./lib/jxufe-cas";
import type { CasSsoGrant } from "./lib/jxufe-cas";
import { issueEhallSessionCookie } from "./ehall-session";
import {
  prepareEhallLogin,
  type EhallLoginPreparation,
} from "./lib/jxufe-ehall";
import { trackLogin } from "./bi";
import { readSecret } from "./secrets";

export const CAS_LOGIN_PATH = "/api/auth/cas";
export const CAS_MFA_PATH = "/api/auth/cas/mfa";
export const CAS_QR_PATH = "/api/auth/cas/qr";
export const CAS_QR_STATUS_PATH = "/api/auth/cas/qr/status";
/** Local testing only — never reachable on a production Worker hostname. */
export const DEV_LOGIN_PATH = "/api/auth/dev";
export const DEV_LOGIN_USERNAME = "local-dev";

const CHALLENGE_TTL_SECONDS = 5 * 60;
const REQUEST_RATE_SECONDS = 900;
const REQUEST_RATE_LIMIT = 5;
const MFA_RATE_SECONDS = 900;
const MFA_RATE_LIMIT = 20;
const QR_STATUS_RATE_LIMIT = 200;
/** Looser than per-challenge 200: blocks fabricated status ids on one IP. */
const QR_STATUS_IP_RATE_LIMIT = 2000;

type PreparedMfaHold = {
  kind: "mfa";
  cas: CasMfaHold;
  ehall: EhallLoginPreparation | null;
};
type PreparedQrHold = {
  kind: "qr";
  cas: CasQrHold;
  ehall: EhallLoginPreparation | null;
};
type CasChallengeHold = PreparedMfaHold | PreparedQrHold;

type CasEnv = {
  DB: D1Database;
  BI?: { writeDataPoint(event: AnalyticsEngineDataPoint): void };
  IP_HASH_SECRET?: string | { get(): Promise<string> };
  CAMPUS_IDENTITY_SECRET?: string | { get(): Promise<string> };
  CAS_CHALLENGE_SECRET?: string | { get(): Promise<string> };
  EHALL_SESSION_SECRET?: string | { get(): Promise<string> };
  ALLOW_DEV_LOGIN?: string;
};

const fail = (
  c: Context,
  error: string,
  status: 400 | 401 | 403 | 404 | 429 | 503 = 400,
) => c.json({ error }, status);

const takeRateLimit = async (
  db: D1Database,
  key: string,
  seconds: number,
  limit: number,
) => {
  const result = await db
    .prepare(
      `INSERT INTO rate_limit_counters(key,window_start,count) VALUES(?,unixepoch(),1)
       ON CONFLICT(key) DO UPDATE SET
         count=CASE WHEN rate_limit_counters.window_start<=unixepoch()-? THEN 1 ELSE rate_limit_counters.count+1 END,
         window_start=CASE WHEN rate_limit_counters.window_start<=unixepoch()-? THEN unixepoch() ELSE rate_limit_counters.window_start END
       WHERE rate_limit_counters.window_start<=unixepoch()-? OR rate_limit_counters.count<?`,
    )
    .bind(key, seconds, seconds, seconds, limit)
    .run();
  return (result.meta.changes || 0) === 1;
};

async function clientIpHash(c: Context<{ Bindings: CasEnv }>) {
  const secret = await readSecret(c.env.IP_HASH_SECRET);
  if (!secret) return "";
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  return hmacHex(ip, secret);
}

async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function challengeSecret(env: CasEnv) {
  return (
    (await readSecret(env.CAS_CHALLENGE_SECRET)) ||
    (await readSecret(env.CAMPUS_IDENTITY_SECRET))
  );
}

async function importChallengeKey(secret: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`cas-challenge-aes:${secret}`),
  );
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function encryptHold(secret: string, hold: CasChallengeHold) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importChallengeKey(secret);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(hold)),
    ),
  );
  return `${bytesToHex(iv)}.${bytesToHex(cipher)}`;
}

function isEhallPreparation(value: unknown): value is EhallLoginPreparation {
  if (!value || typeof value !== "object") return false;
  const preparation = value as Record<string, unknown>;
  return (
    typeof preparation.casLoginUrl === "string" &&
    typeof preparation.casServiceUrl === "string" &&
    Array.isArray(preparation.ehallCookies)
  );
}

function isQrHold(parsed: unknown): parsed is PreparedQrHold {
  if (!parsed || typeof parsed !== "object") return false;
  const hold = parsed as Record<string, unknown>;
  const cas = hold.cas as Record<string, unknown> | undefined;
  return (
    hold.kind === "qr" &&
    cas?.kind === "qr" &&
    cas.cookies != null &&
    typeof cas.cookies === "object" &&
    !Array.isArray(cas.cookies) &&
    typeof cas.serviceUrl === "string" &&
    typeof cas.fpVisitorId === "string" &&
    cas.fpVisitorId.length >= 8 &&
    cas.fpVisitorId.length <= 64 &&
    (hold.ehall === null || isEhallPreparation(hold.ehall))
  );
}

function isMfaHold(parsed: unknown): parsed is PreparedMfaHold {
  if (!parsed || typeof parsed !== "object") return false;
  const hold = parsed as Record<string, unknown>;
  const cas = hold.cas as Record<string, unknown> | undefined;
  return Boolean(
    hold.kind === "mfa" &&
      cas?.username &&
      typeof cas.encryptEnabled === "boolean" &&
      cas.gid &&
      cas.serviceUrl &&
      (hold.ehall === null || isEhallPreparation(hold.ehall)),
  );
}

async function decryptHold(secret: string, blob: string): Promise<CasChallengeHold | null> {
  const [ivHex, cipherHex] = blob.split(".");
  if (!ivHex || !cipherHex || ivHex.length !== 24) return null;
  try {
    const key = await importChallengeKey(secret);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: hexToBytes(ivHex) },
      key,
      hexToBytes(cipherHex),
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (isQrHold(parsed)) return parsed;
    if (isMfaHold(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function newChallengeId() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array) {
  const chunk = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function loadChallengeRow(
  db: D1Database,
  challenge: string,
) {
  return db
    .prepare(`SELECT id,blob,expires_at,consumed_at FROM cas_login_challenges WHERE id=?`)
    .bind(challenge)
    .first<{
      id: string;
      blob: string;
      expires_at: number;
      consumed_at: number | null;
    }>();
}

function challengeIdFromBody(body: Record<string, unknown> | null) {
  const challenge = typeof body?.challenge === "string" ? body.challenge.trim() : "";
  return /^[0-9a-f]{32}$/.test(challenge) ? challenge : "";
}

async function purgeExpiredChallenges(db: D1Database) {
  await db
    .prepare("DELETE FROM cas_login_challenges WHERE expires_at<=unixepoch()")
    .run();
}

async function issueOrdinarySession(
  c: Context<{ Bindings: CasEnv }>,
  username: string,
  identitySecret: string,
  sso?: CasSsoGrant,
  ehall?: EhallLoginPreparation | null,
  method = "cas",
  recordSuccess = true,
) {
  const subject = await hmacHex(`cas-username:${username}`, identitySecret);
  const user = await resolveOrCreateIdentityUser(c.env.DB, {
    provider: AUTH_PROVIDER_CAS,
    issuer: CAS_IDENTITY_ISSUER,
    subject,
  });
  if (!user || user.status === "banned" || user.status === "deleted") {
    return fail(c, "登录失败，请稍后重试", 401);
  }
  const siteSession = await issueOrdinaryUserSessionCookie(c, user.id, identitySecret);
  if (sso && ehall) {
    await issueEhallSessionCookie(c, user.id, siteSession, sso, ehall).catch(() => {});
  }
  if (recordSuccess) await trackLogin(c, "login_success", method, "user");
  return c.json(sessionPayloadForUser(c, user));
}

export async function handleCasLogin(c: Context<{ Bindings: CasEnv }>) {
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  c.executionCtx.waitUntil(purgeExpiredChallenges(c.env.DB).catch(() => {}));
  const [body, identitySecret, secret, ipHash] = await Promise.all([
    readJsonBody(c),
    readSecret(c.env.CAMPUS_IDENTITY_SECRET),
    challengeSecret(c.env),
    clientIpHash(c),
  ]);
  if (
    ipHash &&
    !(await takeRateLimit(
      c.env.DB,
      `cas-login:${ipHash}`,
      REQUEST_RATE_SECONDS,
      REQUEST_RATE_LIMIT,
    ))
  ) {
    await trackLogin(c, "login_fail", "rate_limit");
    return fail(c, "请求过于频繁，请稍后再试", 429);
  }

  const username = normalizeCasUsername(body?.username);
  const password = normalizeCasPassword(body?.password);
  if (!username || !password || !identitySecret) {
    await trackLogin(c, "login_fail", "password");
    return fail(c, "学号或密码不正确", 401);
  }

  await trackLogin(c, "login_submit", "cas");
  const ehall = await prepareEhallLogin().catch(() => null);
  const result = await startCasPasswordLogin(
    username,
    password,
    ehall?.casServiceUrl || CAS_SERVICE_URL,
  );
  if (result.ok) {
    return issueOrdinarySession(c, username, identitySecret, result.sso, ehall);
  }
  if (result.needsMfa) {
    if (!secret) return fail(c, "登录失败，请稍后重试", 503);
    const id = newChallengeId();
    await c.env.DB.prepare(
      `INSERT INTO cas_login_challenges(id,blob,expires_at) VALUES(?,?,unixepoch()+?)`,
    )
      .bind(
        id,
        await encryptHold(secret, { kind: "mfa", cas: result.hold, ehall }),
        CHALLENGE_TTL_SECONDS,
      )
      .run();
    return c.json({
      needsMfa: true,
      challenge: id,
      maskedPhone: result.hold.maskedPhone,
    });
  }
  await trackLogin(c, "login_fail", "password");
  return fail(c, result.error, result.status);
}

export async function handleCasMfa(c: Context<{ Bindings: CasEnv }>) {
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  c.executionCtx.waitUntil(purgeExpiredChallenges(c.env.DB).catch(() => {}));
  const [body, identitySecret, secret, ipHash] = await Promise.all([
    readJsonBody(c),
    readSecret(c.env.CAMPUS_IDENTITY_SECRET),
    challengeSecret(c.env),
    clientIpHash(c),
  ]);
  if (
    ipHash &&
    !(await takeRateLimit(
      c.env.DB,
      `cas-mfa:${ipHash}`,
      MFA_RATE_SECONDS,
      MFA_RATE_LIMIT,
    ))
  ) {
    await trackLogin(c, "login_fail", "rate_limit");
    return fail(c, "请求过于频繁，请稍后再试", 429);
  }

  const challenge = typeof body?.challenge === "string" ? body.challenge.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const password = normalizeCasPassword(body?.password);
  if (!challenge || !/^\d{4}$/.test(code) || !password || !identitySecret || !secret) {
    return fail(c, "验证码不正确", 401);
  }

  const row = await loadChallengeRow(c.env.DB, challenge);
  if (!row || row.consumed_at != null || row.expires_at <= Math.floor(Date.now() / 1000)) {
    return fail(c, "验证已过期，请重新登录", 401);
  }
  const hold = await decryptHold(secret, row.blob);
  if (!isMfaHold(hold)) return fail(c, "验证已过期，请重新登录", 401);

  const result = await completeCasPasswordLogin(hold.cas, code, password);
  if (!result.ok) {
    await trackLogin(c, "login_fail", "mfa");
    if (result.needsMfa) return fail(c, "登录失败，请稍后重试");
    return fail(c, result.error, result.status);
  }

  await c.env.DB.prepare(
    `DELETE FROM cas_login_challenges WHERE id=?`,
  )
    .bind(challenge)
    .run();
  return issueOrdinarySession(
    c,
    hold.cas.username,
    identitySecret,
    result.sso,
    hold.ehall,
  );
}

export async function handleCasQrStart(c: Context<{ Bindings: CasEnv }>) {
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  c.executionCtx.waitUntil(purgeExpiredChallenges(c.env.DB).catch(() => {}));
  const [identitySecret, secret, ipHash] = await Promise.all([
    readSecret(c.env.CAMPUS_IDENTITY_SECRET),
    challengeSecret(c.env),
    clientIpHash(c),
  ]);
  if (
    ipHash &&
    !(await takeRateLimit(
      c.env.DB,
      `cas-qr:${ipHash}`,
      REQUEST_RATE_SECONDS,
      REQUEST_RATE_LIMIT,
    ))
  ) {
    await trackLogin(c, "login_fail", "rate_limit");
    return fail(c, "请求过于频繁，请稍后再试", 429);
  }
  if (!identitySecret || !secret) return fail(c, "登录失败，请稍后重试", 503);

  const ehall = await prepareEhallLogin().catch(() => null);
  const result = await startCasQrLogin(ehall?.casServiceUrl || CAS_SERVICE_URL);
  if (!result.ok) {
    await trackLogin(c, "login_fail", "cas_qr");
    return fail(c, result.error, result.status);
  }
  await trackLogin(c, "login_submit", "cas_qr");

  const id = newChallengeId();
  await c.env.DB.prepare(
    `INSERT INTO cas_login_challenges(id,blob,expires_at) VALUES(?,?,unixepoch()+?)`,
  )
    .bind(
      id,
      await encryptHold(secret, { kind: "qr", cas: result.hold, ehall }),
      CHALLENGE_TTL_SECONDS,
    )
    .run();
  return c.json({
    challenge: id,
    image: `data:image/png;base64,${bytesToBase64(result.imagePng)}`,
  });
}

export async function handleCasQrStatus(c: Context<{ Bindings: CasEnv }>) {
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  c.executionCtx.waitUntil(purgeExpiredChallenges(c.env.DB).catch(() => {}));
  const [body, identitySecret, secret, ipHash] = await Promise.all([
    readJsonBody(c),
    readSecret(c.env.CAMPUS_IDENTITY_SECRET),
    challengeSecret(c.env),
    clientIpHash(c),
  ]);
  if (
    ipHash &&
    !(await takeRateLimit(
      c.env.DB,
      `cas-qr-status-ip:${ipHash}`,
      REQUEST_RATE_SECONDS,
      QR_STATUS_IP_RATE_LIMIT,
    ))
  ) {
    return fail(c, "请求过于频繁，请稍后再试", 429);
  }

  if (!identitySecret || !secret) return fail(c, "登录失败，请稍后重试", 503);
  const challenge = challengeIdFromBody(body);
  if (!challenge) return c.json({ status: "expired" });
  if (
    !(await takeRateLimit(
      c.env.DB,
      `cas-qr-status:${challenge}`,
      REQUEST_RATE_SECONDS,
      QR_STATUS_RATE_LIMIT,
    ))
  ) {
    return fail(c, "请求过于频繁，请稍后再试", 429);
  }

  const row = await loadChallengeRow(c.env.DB, challenge);
  if (!row || row.consumed_at != null || row.expires_at <= Math.floor(Date.now() / 1000)) {
    return c.json({ status: "expired" });
  }
  const hold = await decryptHold(secret, row.blob);
  if (!isQrHold(hold)) return c.json({ status: "expired" });

  const result = await pollCasQrLogin(hold.cas);
  if (!result.ok) return fail(c, result.error, result.status);
  if (result.status !== "authorized") return c.json({ status: result.status });

  await c.env.DB.prepare(`DELETE FROM cas_login_challenges WHERE id=?`)
    .bind(challenge)
    .run();
  return issueOrdinarySession(
    c,
    result.username,
    identitySecret,
    result.sso,
    hold.ehall,
    "cas_qr",
  );
}

/**
 * Local testing only: same ordinary-user session as CAS, no campus MFA.
 * Allowed only when the Worker request itself is loopback.
 */
export async function handleDevLogin(c: Context<{ Bindings: CasEnv }>) {
  if (!isDevLoginEnabled(c.env) || !isLoopbackWorkerRequest(c))
    return fail(c, "Not Found", 404);
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  const identitySecret = await ordinaryUserIdentitySecret(c);
  if (!identitySecret) return fail(c, "登录失败，请稍后重试", 503);
  return issueOrdinarySession(
    c,
    DEV_LOGIN_USERNAME,
    identitySecret,
    undefined,
    undefined,
    "cas",
    false,
  );
}
