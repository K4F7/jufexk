import type { Context } from "hono";
import {
  AUTH_PROVIDER_CAS,
  CAS_IDENTITY_ISSUER,
  resolveOrCreateIdentityUser,
} from "./ordinary-user-identity";
import {
  hmacHex,
  issueEmailSessionCookie,
  originOk,
  sessionPayloadForUser,
} from "./ordinary-user-session";
import {
  completeCasPasswordLogin,
  normalizeCasPassword,
  normalizeCasUsername,
  startCasPasswordLogin,
  type CasMfaHold,
} from "./lib/jxufe-cas";
import { readSecret } from "./secrets";

export const CAS_LOGIN_PATH = "/api/auth/cas";
export const CAS_MFA_PATH = "/api/auth/cas/mfa";

const CHALLENGE_TTL_SECONDS = 5 * 60;
const REQUEST_RATE_SECONDS = 900;
const REQUEST_RATE_LIMIT = 5;
const MFA_RATE_SECONDS = 900;
const MFA_RATE_LIMIT = 20;

type CasEnv = {
  DB: D1Database;
  IP_HASH_SECRET?: string | { get(): Promise<string> };
  CAMPUS_IDENTITY_SECRET?: string | { get(): Promise<string> };
  CAS_CHALLENGE_SECRET?: string | { get(): Promise<string> };
};

const fail = (c: Context, error: string, status: 400 | 401 | 403 | 429 | 503 = 400) =>
  c.json({ error }, status);

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

async function encryptHold(secret: string, hold: CasMfaHold) {
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

async function decryptHold(secret: string, blob: string): Promise<CasMfaHold | null> {
  const [ivHex, cipherHex] = blob.split(".");
  if (!ivHex || !cipherHex || ivHex.length !== 24) return null;
  try {
    const key = await importChallengeKey(secret);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: hexToBytes(ivHex) },
      key,
      hexToBytes(cipherHex),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as CasMfaHold;
    if (!parsed?.username || !parsed.password || !parsed.gid) return null;
    return parsed;
  } catch {
    return null;
  }
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
  await issueEmailSessionCookie(c, user.id, identitySecret);
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
    return fail(c, "请求过于频繁，请稍后再试", 429);
  }

  const username = normalizeCasUsername(body?.username);
  const password = normalizeCasPassword(body?.password);
  if (!username || !password || !identitySecret) {
    return fail(c, "学号或密码不正确", 401);
  }

  const result = await startCasPasswordLogin(username, password);
  if (result.ok) {
    return issueOrdinarySession(c, username, identitySecret);
  }
  if (result.needsMfa) {
    if (!secret) return fail(c, "登录失败，请稍后重试", 503);
    const id = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await c.env.DB.prepare(
      `INSERT INTO cas_login_challenges(id,blob,expires_at) VALUES(?,?,unixepoch()+?)`,
    )
      .bind(id, await encryptHold(secret, result.hold), CHALLENGE_TTL_SECONDS)
      .run();
    return c.json({
      needsMfa: true,
      challenge: id,
      maskedPhone: result.hold.maskedPhone,
    });
  }
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
    return fail(c, "请求过于频繁，请稍后再试", 429);
  }

  const challenge = typeof body?.challenge === "string" ? body.challenge.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!challenge || !/^\d{4,8}$/.test(code) || !identitySecret || !secret) {
    return fail(c, "验证码不正确", 401);
  }

  const row = await c.env.DB.prepare(
    `SELECT id,blob,expires_at,consumed_at FROM cas_login_challenges WHERE id=?`,
  )
    .bind(challenge)
    .first<{
      id: string;
      blob: string;
      expires_at: number;
      consumed_at: number | null;
    }>();
  if (!row || row.consumed_at != null || row.expires_at <= Math.floor(Date.now() / 1000)) {
    return fail(c, "验证已过期，请重新登录", 401);
  }
  const hold = await decryptHold(secret, row.blob);
  if (!hold) return fail(c, "验证已过期，请重新登录", 401);

  const result = await completeCasPasswordLogin(hold, code);
  if (!result.ok) {
    if (result.needsMfa) return fail(c, "登录失败，请稍后重试");
    return fail(c, result.error, result.status);
  }

  await c.env.DB.prepare(
    `DELETE FROM cas_login_challenges WHERE id=?`,
  )
    .bind(challenge)
    .run();
  return issueOrdinarySession(c, hold.username, identitySecret);
}
