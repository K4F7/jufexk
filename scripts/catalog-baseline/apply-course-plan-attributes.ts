import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDotenv, resolveAdminPassword } from "../secrets/inventory";

const origin = (process.env.JUFEXK_BASE_URL || "https://xk.sein.moe").replace(
  /\/$/,
  "",
);
const payloadPath = resolve(
  process.env.JUFEXK_COURSE_PLAN_OUT ||
    resolve(
      import.meta.dirname,
      "../../../scripts/catalog-baseline/captures/qxkb-22-26-v2/course-plan-attributes.json",
    ),
);
const chunkSize = Number(process.env.JUFEXK_COURSE_PLAN_CHUNK || 80);

const envCandidates = [
  resolve(import.meta.dirname, "../../.dev.vars"),
  resolve(import.meta.dirname, "../../../.dev.vars"),
];
let fileEnv: Record<string, string> = {};
for (const envPath of envCandidates) {
  try {
    fileEnv = parseDotenv(await readFile(envPath, "utf8"));
    break;
  } catch {
    /* try the next dotenv path */
  }
}
const password = resolveAdminPassword({ ...fileEnv, ...process.env });

type Payload = {
  items: Array<Record<string, unknown>>;
};

const payload = JSON.parse(await readFile(payloadPath, "utf8")) as Payload;
if (!Array.isArray(payload.items) || !payload.items.length)
  throw new Error("课程方案属性文件为空");

const cookies = new Map<string, string>();
let csrf = "";
const rememberCookies = (headers: Headers) => {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.() ?? [headers.get("set-cookie") || ""];
  for (const value of values) {
    const match = /^([^=;,]+)=([^;]*)/.exec(value);
    if (match) cookies.set(match[1], match[2]);
  }
};
const api = async (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Origin", origin);
  if (cookies.size)
    headers.set(
      "Cookie",
      [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  if (csrf && init.method && init.method !== "GET")
    headers.set("X-CSRF-Token", csrf);
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  rememberCookies(response.headers);
  const text = await response.text();
  let body: { error?: string };
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!response.ok)
    throw new Error(
      `${init.method || "GET"} ${path}: ${body.error || response.status}`,
    );
  return body;
};

const login = await api("/api/admin/login", {
  method: "POST",
  body: JSON.stringify({ password }),
});
csrf = String((login as { csrfToken?: string }).csrfToken || "");
if (!csrf) throw new Error("管理员登录未返回 CSRF");

let updated = 0;
const missing: string[] = [];
for (let offset = 0; offset < payload.items.length; offset += chunkSize) {
  const items = payload.items.slice(offset, offset + chunkSize);
  const result = (await api("/api/admin/import/course-plan-attributes", {
    method: "POST",
    body: JSON.stringify({ items }),
  })) as { updated?: number; missing?: string[] };
  updated += Number(result.updated || 0);
  missing.push(...(result.missing || []));
  console.log(
    JSON.stringify({
      phase: "apply",
      offset,
      chunk: items.length,
      updated,
      missing: missing.length,
    }),
  );
}

console.log(
  JSON.stringify({
    ok: true,
    received: payload.items.length,
    updated,
    missing: missing.length,
  }),
);
