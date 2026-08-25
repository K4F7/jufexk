import type { Context } from "hono";
import { backTargetFrom } from "./lib/back-target";
import {
  AUTH_PROVIDER_EMAIL,
  EMAIL_IDENTITY_ISSUER,
  resolveOrCreateIdentityUser,
} from "./ordinary-user-identity";
import {
  hmacHex,
  issueOrdinaryUserSessionCookie,
} from "./ordinary-user-authentication";
import { LOGIN_PATH, sessionPayloadForUser } from "./ordinary-user-session";
import { originOk } from "./ordinary-user-write-authorization";
import { readSecret } from "./secrets";
import { buildVerificationEmail } from "./verification-email";

export const EMAIL_REQUEST_PATH = "/api/auth/email";
export const EMAIL_VERIFY_PATH = "/api/auth/verify";

const EMAIL_DOMAIN = "stu.jxufe.edu.cn";
const CHALLENGE_TTL_SECONDS = 15 * 60;
const REQUEST_RATE_SECONDS = 900;
const REQUEST_RATE_LIMIT = 5;
const VERIFY_RATE_SECONDS = 900;
const VERIFY_RATE_LIMIT = 20;
const SENT_SHAPE = { ok: true } as const;

type MailEnv = {
  DB: D1Database;
  SITE_NAME?: string;
  IP_HASH_SECRET?: string | { get(): Promise<string> };
  CAMPUS_IDENTITY_SECRET?: string | { get(): Promise<string> };
  MAIL_DELIVERY_URL?: string;
  MAIL_FROM?: string;
  MAIL_DELIVERY_TOKEN?: string | { get(): Promise<string> };
};

const fail = (c: Context, error: string, status: 400 | 403 | 429 = 400) =>
  c.json({ error }, status);

export function normalizeStudentEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value || value.length > 254) return null;
  if (/[\s<>,"()]/.test(value)) return null;
  const parts = value.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (domain !== EMAIL_DOMAIN) return null;
  if (!/^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?$/.test(local)) return null;
  return `${local}@${domain}`;
}

const randomDigits = (length: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => (byte % 10).toString()).join("");
};

const randomToken = () =>
  [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

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

async function clientIpHash(c: Context<{ Bindings: MailEnv }>) {
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

function magicLinkUrl(c: Context, token: string, from: string) {
  const url = new URL(LOGIN_PATH, c.req.url);
  url.searchParams.set("token", token);
  if (from && from !== "/courses") url.searchParams.set("from", from);
  return url.toString();
}

async function deliverVerificationEmail(
  env: MailEnv,
  input: { to: string; code: string; magicUrl: string },
) {
  const url = typeof env.MAIL_DELIVERY_URL === "string" ? env.MAIL_DELIVERY_URL.trim() : "";
  const from = typeof env.MAIL_FROM === "string" ? env.MAIL_FROM.trim() : "";
  const token = await readSecret(env.MAIL_DELIVERY_TOKEN);
  if (!url || !from || !token) return;
  const mail = buildVerificationEmail({
    siteName: env.SITE_NAME || "非官方课评@JUFE",
    code: input.code,
    magicUrl: input.magicUrl,
    ttlMinutes: CHALLENGE_TTL_SECONDS / 60,
  });
  await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  }).catch(() => undefined);
}

export async function handleEmailLoginRequest(c: Context<{ Bindings: MailEnv }>) {
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  const ipHash = await clientIpHash(c);
  if (
    ipHash &&
    !(await takeRateLimit(
      c.env.DB,
      `email-login:${ipHash}`,
      REQUEST_RATE_SECONDS,
      REQUEST_RATE_LIMIT,
    ))
  ) {
    return fail(c, "请求过于频繁，请稍后再试", 429);
  }

  const body = await readJsonBody(c);
  const email = normalizeStudentEmail(body?.email);
  const from = backTargetFrom(typeof body?.from === "string" ? body.from : null);
  const identitySecret = await readSecret(c.env.CAMPUS_IDENTITY_SECRET);
  if (!email || !identitySecret) return c.json(SENT_SHAPE);

  const code = randomDigits(6);
  const token = randomToken();
  const subject = await hmacHex(email, identitySecret);
  await c.env.DB.prepare(
    `INSERT INTO email_login_challenges(subject,code_hash,token_hash,expires_at)
     VALUES(?,?,?,unixepoch()+?)
     ON CONFLICT(subject) DO UPDATE SET
       code_hash=excluded.code_hash,
       token_hash=excluded.token_hash,
       expires_at=excluded.expires_at,
       consumed_at=NULL`,
  )
    .bind(
      subject,
      await hmacHex(code, identitySecret),
      await hmacHex(token, identitySecret),
      CHALLENGE_TTL_SECONDS,
    )
    .run();
  await deliverVerificationEmail(c.env, {
    to: email,
    code,
    magicUrl: magicLinkUrl(c, token, from),
  });
  return c.json(SENT_SHAPE);
}

type ChallengeRow = {
  subject: string;
  expires_at: number;
  consumed_at: number | null;
};

async function consumeChallenge(
  db: D1Database,
  row: ChallengeRow | null,
): Promise<string | null> {
  if (!row || row.consumed_at != null) return null;
  if (row.expires_at <= Math.floor(Date.now() / 1000)) return null;
  const consumed = await db
    .prepare(
      `UPDATE email_login_challenges
       SET consumed_at=unixepoch()
       WHERE subject=? AND consumed_at IS NULL AND expires_at>unixepoch()`,
    )
    .bind(row.subject)
    .run();
  return (consumed.meta.changes || 0) === 1 ? row.subject : null;
}

export async function handleEmailLoginVerify(c: Context<{ Bindings: MailEnv }>) {
  if (!originOk(c)) return fail(c, "来源校验失败", 403);
  const ipHash = await clientIpHash(c);
  if (
    ipHash &&
    !(await takeRateLimit(
      c.env.DB,
      `email-verify:${ipHash}`,
      VERIFY_RATE_SECONDS,
      VERIFY_RATE_LIMIT,
    ))
  ) {
    return fail(c, "请求过于频繁，请稍后再试", 429);
  }

  const body = await readJsonBody(c);
  const identitySecret = await readSecret(c.env.CAMPUS_IDENTITY_SECRET);
  if (!body || !identitySecret) return fail(c, "验证失败，请重新获取验证信");

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const email = normalizeStudentEmail(body.email);

  let row: ChallengeRow | null = null;
  if (token) {
    row = await c.env.DB.prepare(
      `SELECT subject,expires_at,consumed_at FROM email_login_challenges
       WHERE token_hash=?`,
    )
      .bind(await hmacHex(token, identitySecret))
      .first<ChallengeRow>();
  } else if (email && code) {
    row = await c.env.DB.prepare(
      `SELECT subject,expires_at,consumed_at FROM email_login_challenges
       WHERE subject=? AND code_hash=?`,
    )
      .bind(await hmacHex(email, identitySecret), await hmacHex(code, identitySecret))
      .first<ChallengeRow>();
  }
  const subject = await consumeChallenge(c.env.DB, row);
  if (!subject) return fail(c, "验证失败，请重新获取验证信");

  const user = await resolveOrCreateIdentityUser(c.env.DB, {
    provider: AUTH_PROVIDER_EMAIL,
    issuer: EMAIL_IDENTITY_ISSUER,
    subject,
  });
  if (!user || user.status === "banned" || user.status === "deleted") {
    return fail(c, "验证失败，请重新获取验证信");
  }

  await issueOrdinaryUserSessionCookie(c, user.id, identitySecret);
  return c.json(sessionPayloadForUser(c, user));
}
