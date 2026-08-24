import { env } from "cloudflare:test";

export const ADMIN_ORIGIN = "https://example.com";

async function sha256Hex(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

let sequence = 0;

/** Issue an admin cookie without the retired shared-password login. */
export async function adminAuth() {
  sequence += 1;
  const raw = `test-admin-raw-${sequence}-${crypto.randomUUID()}`;
  const csrf = `test-admin-csrf-${sequence}-${crypto.randomUUID().replace(/-/g, "")}`;
  const sessionId = `sess${sequence}${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await env.DB.prepare(
    `INSERT INTO admin_sessions(token_hash,csrf_token,ip_hash,expires_at,session_id)
     VALUES(?,?,?,datetime('now','+24 hours'),?)`,
  )
    .bind(await sha256Hex(raw), csrf, "test-admin-ip", sessionId)
    .run();
  return {
    cookie: `jufexk_admin=${raw}; jufexk_csrf=${csrf}`,
    csrf,
    sessionId,
  };
}

export function adminHeaders(
  auth: { cookie: string; csrf: string },
  origin = ADMIN_ORIGIN,
) {
  return {
    "Content-Type": "application/json",
    Cookie: auth.cookie,
    Origin: origin,
    "X-CSRF-Token": auth.csrf,
  };
}

/** Same as adminAuth; use adminHeaders() for write requests. */
export async function adminLogin() {
  return adminAuth();
}
