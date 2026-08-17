import type { Context } from "hono";
import { getCookie } from "hono/cookie";

/**
 * AuthBridge contract we will implement after the school whitelist.
 * Do not fetch or redirect to AuthBridge until that happens.
 * @see https://github.com/Mine-JUFE/AuthBridge
 */
export const CAMPUS_JWT_COOKIE = "jufexk_campus_jwt";
export const CAMPUS_AUTH_CALLBACK_PATH = "/api/auth/callback";
export const CAMPUS_AUTH_STATUS_PATH = "/api/auth/campus";
export const AUTHBRIDGE_LOGIN_PATH = "/login";
export const AUTHBRIDGE_CALLBACK_MODE = "callback";
export const AUTHBRIDGE_TOKEN_FIELD = "token";
export const AUTHBRIDGE_ALGORITHM = "HS256";

export type CampusAuthStatus = {
  enabled: false;
  reason: "not_whitelisted";
  loginPath: string;
  logoutPath: string;
  callbackPath: string;
  contract: {
    provider: "authbridge";
    mode: typeof AUTHBRIDGE_CALLBACK_MODE;
    tokenField: typeof AUTHBRIDGE_TOKEN_FIELD;
    algorithm: typeof AUTHBRIDGE_ALGORITHM;
    claims: readonly ["sub", "exp", "aud", "enc"];
  };
};

export function campusJwtLive(_env: { CAMPUS_JWT_ENABLED?: string } | undefined) {
  return false;
}

export function campusAuthStatus(): CampusAuthStatus {
  return {
    enabled: false,
    reason: "not_whitelisted",
    loginPath: "/login",
    logoutPath: "/logout",
    callbackPath: CAMPUS_AUTH_CALLBACK_PATH,
    contract: {
      provider: "authbridge",
      mode: AUTHBRIDGE_CALLBACK_MODE,
      tokenField: AUTHBRIDGE_TOKEN_FIELD,
      algorithm: AUTHBRIDGE_ALGORITHM,
      claims: ["sub", "exp", "aud", "enc"],
    },
  };
}

export function buildAuthBridgeLoginUrl(input: {
  baseUrl: string;
  appId: string;
  callbackUrl: string;
}) {
  const base = input.baseUrl.endsWith("/") ? input.baseUrl : `${input.baseUrl}/`;
  const url = new URL(AUTHBRIDGE_LOGIN_PATH.replace(/^\//, ""), base);
  url.searchParams.set("appid", input.appId);
  url.searchParams.set("mode", AUTHBRIDGE_CALLBACK_MODE);
  url.searchParams.set("callback", input.callbackUrl);
  return url.toString();
}

export function readCampusJwt(c: Context) {
  const header = c.req.header("Authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return getCookie(c, CAMPUS_JWT_COOKIE) || "";
}

export async function readAuthBridgeCallbackToken(c: Context) {
  const contentType = c.req.header("Content-Type") || "";
  if (contentType.includes("application/json")) {
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}) as Record<string, unknown>);
    return typeof body.token === "string" ? body.token.trim() : "";
  }
  const body = await c.req.parseBody();
  return typeof body.token === "string" ? body.token.trim() : "";
}

const textEncoder = new TextEncoder();

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");

const fromBase64Url = (value: string) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const timingSafeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
};

export type CampusJwtClaims = {
  sub: string;
  exp: number;
  aud?: string;
  enc?: string;
  iv?: string;
  tag?: string;
};

const fromStandardBase64 = (value: string) => {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
};

const hexToBytes = (value: string) => {
  const hex = value.trim();
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export async function decryptAuthBridgeAesSubject(
  claims: CampusJwtClaims,
  aesKeyHex: string,
): Promise<string | null> {
  if (claims.enc !== "aes" || !claims.iv || !claims.tag || !aesKeyHex) return null;
  const keyBytes = hexToBytes(aesKeyHex);
  if (!keyBytes || ![16, 24, 32].includes(keyBytes.length)) return null;
  const iv = fromStandardBase64(claims.iv);
  const ciphertext = fromStandardBase64(claims.sub);
  const tag = fromStandardBase64(claims.tag);
  if (!iv || !ciphertext || !tag || tag.length !== 16) return null;
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      combined,
    );
    const campusHandle = new TextDecoder().decode(plain).trim();
    return /^[A-Za-z0-9_-]{4,32}$/.test(campusHandle) ? campusHandle : null;
  } catch {
    return null;
  }
}

export async function verifyCampusJwtHs256(
  token: string,
  secret: string,
  audience?: string,
): Promise<CampusJwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || !secret) return null;
  const [rawHeader, rawPayload, rawSignature] = parts;
  let header: { alg?: string; typ?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(rawHeader)));
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(rawPayload)));
  } catch {
    return null;
  }
  if (header.alg !== AUTHBRIDGE_ALGORITHM) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = toBase64Url(
    await crypto.subtle.sign(
      "HMAC",
      key,
      textEncoder.encode(`${rawHeader}.${rawPayload}`),
    ),
  );
  if (!timingSafeEqual(expected, rawSignature)) return null;
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const exp = typeof payload.exp === "number" ? payload.exp : NaN;
  const nbf = typeof payload.nbf === "number" ? payload.nbf : null;
  if (!sub || !Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;
  if (nbf !== null && (!Number.isFinite(nbf) || nbf * 1000 > Date.now()))
    return null;
  if (audience && payload.aud !== audience) return null;
  return {
    sub,
    exp,
    aud: typeof payload.aud === "string" ? payload.aud : undefined,
    enc: typeof payload.enc === "string" ? payload.enc : undefined,
    iv: typeof payload.iv === "string" ? payload.iv : undefined,
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
  };
}

export async function handleCampusAuthStatus(c: Context) {
  return c.json(campusAuthStatus());
}

export async function handleCampusAuthCallback(c: Context) {
  await readAuthBridgeCallbackToken(c);
  return c.json(
    {
      error: "普通用户认证尚未开放接入",
      reason: "not_whitelisted",
    },
    503,
  );
}
