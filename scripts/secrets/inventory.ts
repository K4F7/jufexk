export const SECRETS_STORE_ID = "323163a091874b07aacdf5500bff903e";

export const WORKER_SECRETS = [
  "IP_HASH_SECRET",
  "TURNSTILE_SECRET",
  "CAMPUS_IDENTITY_SECRET",
  "CAS_CHALLENGE_SECRET",
] as const;

export const GITHUB_DEPLOY_SECRETS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

export type WorkerSecretName = (typeof WORKER_SECRETS)[number];

export function resolveAdminSession(env: NodeJS.Dict<string>): {
  cookie: string;
  csrf: string;
} {
  const cookie = env.JUFEXK_ADMIN_COOKIE;
  const csrf = env.JUFEXK_ADMIN_CSRF;
  if (!cookie || !csrf) {
    throw new Error(
      "缺少 JUFEXK_ADMIN_COOKIE 与 JUFEXK_ADMIN_CSRF（用已绑定学号登录 /admin 后复制）",
    );
  }
  return { cookie, csrf };
}

export function parseDotenv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`无法解析密钥行: ${line}`);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`非法密钥名: ${key}`);
    values[key] = unquoteDotenvValue(line.slice(separator + 1).trim());
  }
  return values;
}

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;
const TABLE_VERTICAL = /[│┃┊┆]/g;
const SECRET_ID =
  /[0-9a-f]{8}(?:-?[0-9a-f]{4}){3}-?[0-9a-f]{12}|[0-9a-f]{32}/i;

export function stripAnsi(text: string) {
  return text.replace(ANSI_ESCAPE, "");
}

export function normalizeSecretStoreTable(text: string) {
  return stripAnsi(text).replace(TABLE_VERTICAL, "|");
}

export function parseSecretStoreList(text: string) {
  const ids = new Map<string, string>();
  const row = new RegExp(
    `(?:^|\\|)\\s*(${WORKER_SECRETS.join("|")})\\s*\\|\\s*(${SECRET_ID.source})\\b`,
    "gim",
  );
  for (const match of normalizeSecretStoreTable(text).matchAll(row)) {
    ids.set(match[1], match[2]);
  }
  return ids;
}

export function secretStoreListHasName(text: string, name: string) {
  if (parseSecretStoreList(text).has(name)) return true;
  const token = new RegExp(`(?:^|[^A-Z0-9_])${name}(?:[^A-Z0-9_]|$)`);
  return token.test(normalizeSecretStoreTable(text));
}

export function isSecretAlreadyExistsError(text: string) {
  const plain = stripAnsi(text);
  return (
    /secret_name_already_exists/i.test(plain) || /\[code:\s*1003\]/.test(plain)
  );
}

export function selectWorkerDevVars(secrets: Record<string, string>) {
  const vars: Partial<Record<WorkerSecretName, string>> = {};
  for (const key of WORKER_SECRETS) {
    if (secrets[key]) vars[key] = secrets[key];
  }
  return {
    vars,
    missing: WORKER_SECRETS.filter((key) => !vars[key]),
  };
}

function unquoteDotenvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
