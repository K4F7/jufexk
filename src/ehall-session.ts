import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  EMAIL_LOGIN_COOKIE,
  ORDINARY_USER_SESSION_TTL_SECONDS,
  hmacHex,
  resolveOrdinaryUser,
} from "./ordinary-user-authentication";
import {
  EHALL_SESSION_COOKIE,
  EHALL_SESSION_COOKIE_PATH,
} from "./ordinary-user-session";
import {
  ORDINARY_USER_CSRF_COOKIE,
  isOrdinaryUserAuthenticated,
  ordinaryUserCsrfOk,
  originOk,
} from "./ordinary-user-write-authorization";
import {
  completePreparedEhallLogin,
  establishEhallSession,
  launchJwxtFromEhall,
  type EhallLoginPreparation,
  type EhallUpstreamSession,
} from "./lib/jxufe-ehall";
import type { CasSsoGrant } from "./lib/jxufe-cas";
import { readSecret } from "./secrets";

export { EHALL_SESSION_COOKIE } from "./ordinary-user-session";
export const EHALL_SESSION_PATH = "/api/ehall/session";
export const EHALL_LAUNCH_PATH = "/api/ehall/launch";
const EHALL_LAUNCH_BODY_MAX_BYTES = 1_024;

type RuntimeSecret = string | { get(): Promise<string> };
type EhallEnv = { DB: D1Database; EHALL_SESSION_SECRET?: RuntimeSecret };
type SealedEhallSession = EhallUpstreamSession & {
  version: 1;
  expiresAt: number;
};

function validCasCookies(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return false;
  const names = new Set<string>();
  for (const cookie of value) {
    if (!cookie || typeof cookie !== "object") return false;
    const { name, value: cookieValue } = cookie as Record<string, unknown>;
    if (
      (name !== "TGC" && name !== "SESSION") ||
      typeof cookieValue !== "string" ||
      !cookieValue ||
      names.has(name)
    ) {
      return false;
    }
    names.add(name);
  }
  return true;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function sessionKey(secret: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`ehall-session-aes:v1:${secret}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function additionalData(userId: string, siteSession: string) {
  return new TextEncoder().encode(`ehall-session:v1:${userId}:${siteSession}`);
}

async function seal(
  secret: string,
  userId: string,
  siteSession: string,
  payload: SealedEhallSession,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(userId, siteSession) },
      await sessionKey(secret),
      new TextEncoder().encode(JSON.stringify(payload)),
    ),
  );
  return `v1.${bytesToHex(iv)}.${bytesToHex(cipher)}`;
}

async function open(
  secret: string,
  userId: string,
  siteSession: string,
  blob: string,
): Promise<SealedEhallSession | null> {
  const [version, ivHex, cipherHex] = blob.split(".");
  const iv = ivHex ? hexToBytes(ivHex) : null;
  const cipher = cipherHex ? hexToBytes(cipherHex) : null;
  if (version !== "v1" || !iv || iv.length !== 12 || !cipher) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(userId, siteSession) },
      await sessionKey(secret),
      cipher,
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as SealedEhallSession;
    if (
      parsed.version !== 1 ||
      !validCasCookies(parsed.casCookies) ||
      !Array.isArray(parsed.ehallCookies) ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearEhallSessionCookie(c: Context) {
  deleteCookie(c, EHALL_SESSION_COOKIE, { path: EHALL_SESSION_COOKIE_PATH });
}

export async function issueEhallSessionCookie(
  c: Context<{ Bindings: EhallEnv }>,
  userId: string,
  siteSession: string,
  grant: CasSsoGrant,
  preparation: EhallLoginPreparation,
) {
  const secret = await readSecret(c.env.EHALL_SESSION_SECRET);
  if (!secret) return;
  const upstream = await completePreparedEhallLogin(preparation, grant);
  if (!upstream.ehallCookies.length) return;
  const expiresAt = Date.now() + ORDINARY_USER_SESSION_TTL_SECONDS * 1000;
  await writeEhallSessionCookie(c, secret, userId, siteSession, {
    version: 1,
    expiresAt,
    ...upstream,
  });
}

async function writeEhallSessionCookie(
  c: Context,
  secret: string,
  userId: string,
  siteSession: string,
  payload: SealedEhallSession,
) {
  const blob = await seal(secret, userId, siteSession, payload);
  const maxAge = Math.max(0, Math.ceil((payload.expiresAt - Date.now()) / 1000));
  setCookie(c, EHALL_SESSION_COOKIE, blob, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: EHALL_SESSION_COOKIE_PATH,
    maxAge,
  });
}

export async function handleEhallSessionStatus(
  c: Context<{ Bindings: EhallEnv }>,
) {
  const user = await resolveOrdinaryUser(c);
  if (!user) return c.json({ available: false }, 401);
  const secret = await readSecret(c.env.EHALL_SESSION_SECRET);
  const siteSession = getCookie(c, EMAIL_LOGIN_COOKIE) || "";
  const blob = getCookie(c, EHALL_SESSION_COOKIE) || "";
  if (!secret || !siteSession || !blob) {
    return c.json({ available: false });
  }
  const session = await open(secret, user.id, siteSession, blob);
  if (!session) {
    clearEhallSessionCookie(c);
    return c.json({ available: false });
  }
  return c.json({
    available: true,
    expiresAt: new Date(session.expiresAt).toISOString(),
  });
}

export async function handleEhallSessionRevoke(
  c: Context<{ Bindings: EhallEnv }>,
) {
  const user = await resolveOrdinaryUser(c);
  if (!user || !isOrdinaryUserAuthenticated(user)) {
    return c.json({ error: "请先登录" }, 401);
  }
  if (!originOk(c) || !ordinaryUserCsrfOk(c)) {
    return c.json({ error: "安全校验失败，请刷新后重试" }, 403);
  }
  clearEhallSessionCookie(c);
  return c.json({ available: false });
}

async function loadEhallSession(
  c: Context<{ Bindings: EhallEnv }>,
  userId: string,
) {
  const [secret, siteSession, blob] = await Promise.all([
    readSecret(c.env.EHALL_SESSION_SECRET),
    Promise.resolve(getCookie(c, EMAIL_LOGIN_COOKIE) || ""),
    Promise.resolve(getCookie(c, EHALL_SESSION_COOKIE) || ""),
  ]);
  if (!secret || !siteSession || !blob) return null;
  const session = await open(secret, userId, siteSession, blob);
  return session ? { session, secret, siteSession, blob } : null;
}

async function acquireLaunchLease(db: D1Database, sessionHash: string) {
  const result = await db
    .prepare(
      `INSERT INTO ehall_session_leases(session_hash,lease_until)
       VALUES(?,unixepoch()+30)
       ON CONFLICT(session_hash) DO UPDATE SET lease_until=excluded.lease_until
       WHERE ehall_session_leases.lease_until<=unixepoch()`,
    )
    .bind(sessionHash)
    .run();
  return (result.meta.changes || 0) === 1;
}

async function releaseLaunchLease(db: D1Database, sessionHash: string) {
  await db
    .prepare("DELETE FROM ehall_session_leases WHERE session_hash=?")
    .bind(sessionHash)
    .run();
}

async function readLaunchCsrf(c: Context) {
  const contentType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") return "";
  const body = c.req.raw.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > EHALL_LAUNCH_BODY_MAX_BYTES) return "";
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const params = new URLSearchParams(new TextDecoder().decode(bytes));
  const values = params.getAll("_csrf");
  return [...params.keys()].length === 1 && values.length === 1 ? values[0] : "";
}

export async function handleEhallLaunch(c: Context<{ Bindings: EhallEnv }>) {
  if (!originOk(c)) return c.json({ error: "来源校验失败" }, 403);
  const user = await resolveOrdinaryUser(c);
  if (!user || !isOrdinaryUserAuthenticated(user)) {
    return c.redirect("/login?from=%2Fschedule", 303);
  }
  const csrf = await readLaunchCsrf(c).catch(() => "");
  if (!csrf || csrf !== getCookie(c, ORDINARY_USER_CSRF_COOKIE)) {
    return c.json({ error: "安全校验失败，请刷新后重试" }, 403);
  }
  const loaded = await loadEhallSession(c, user.id);
  if (!loaded) {
    clearEhallSessionCookie(c);
    return c.redirect(
      "/login?reauth=campus&from=%2Fschedule%3Fehall%3Dretry",
      303,
    );
  }
  const sessionHash = await hmacHex(
    `ehall-launch-lease:v1:${loaded.blob}`,
    loaded.secret,
  );
  if (!(await acquireLaunchLease(c.env.DB, sessionHash))) {
    return c.redirect("/schedule?ehall=busy", 303);
  }
  try {
    let result;
    try {
      result = await launchJwxtFromEhall(loaded.session);
    } catch {
      return c.redirect("/schedule?ehall=unavailable", 303);
    }
    if (result.status !== "redirect") {
      clearEhallSessionCookie(c);
      return c.redirect(
        "/login?reauth=campus&from=%2Fschedule%3Fehall%3Dretry",
        303,
      );
    }
    await writeEhallSessionCookie(
      c,
      loaded.secret,
      user.id,
      loaded.siteSession,
      {
        version: 1,
        expiresAt: loaded.session.expiresAt,
        ...result.session,
      },
    );
    c.header("Location", result.location);
    return c.body(null, 302);
  } finally {
    await releaseLaunchLease(c.env.DB, sessionHash).catch(() => {});
  }
}
