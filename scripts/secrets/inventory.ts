export const SECRETS_STORE_ID = "323163a091874b07aacdf5500bff903e";

export const WORKER_SECRETS = [
  "ADMIN_PASSWORD",
  "IP_HASH_SECRET",
  "TURNSTILE_SECRET",
  "CAMPUS_JWT_SECRET",
  "CAMPUS_JWT_AES_KEY",
  "CAMPUS_IDENTITY_SECRET",
  "MAIL_DELIVERY_TOKEN",
] as const;

export const GITHUB_DEPLOY_SECRETS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

export type WorkerSecretName = (typeof WORKER_SECRETS)[number];

export function resolveAdminPassword(env: NodeJS.Dict<string>): string {
  const password = env.JUFEXK_ADMIN_PASSWORD || env.ADMIN_PASSWORD;
  if (!password) throw new Error("缺少 ADMIN_PASSWORD 或 JUFEXK_ADMIN_PASSWORD");
  return password;
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
