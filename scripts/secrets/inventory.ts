export const INFISICAL_ENVIRONMENTS = ["dev", "prod"] as const;
export const WORKER_SECRET_PATH = "/worker";
export const CI_SECRET_PATH = "/ci";

export const WORKER_SECRETS = [
  "ADMIN_PASSWORD",
  "IP_HASH_SECRET",
  "TURNSTILE_SECRET",
] as const;

export const REQUIRED_WORKER_SECRETS = [
  "IP_HASH_SECRET",
  "TURNSTILE_SECRET",
] as const;

export const PENDING_WORKER_SECRETS = ["ADMIN_PASSWORD"] as const;

export const CI_SECRETS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
] as const;

export const PUBLIC_WRANGLER_VARS = [
  "SITE_NAME",
  "UNIVERSITY_NAME",
  "TURNSTILE_SITE_KEY",
  "HISTORICAL_IMPORT_ARTIFACT_SHA256",
  "HISTORICAL_IMPORT_MANIFEST_SHA256",
] as const;

export const PUBLIC_REPO_CONFIG = [
  ...PUBLIC_WRANGLER_VARS,
  "database_id",
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
    const value = secrets[key];
    if (value) vars[key] = value;
  }
  return {
    vars,
    missing: WORKER_SECRETS.filter((key) => vars[key] === undefined),
    missingRequired: REQUIRED_WORKER_SECRETS.filter((key) => vars[key] === undefined),
    extra: Object.keys(secrets).filter(
      (key) => !(WORKER_SECRETS as readonly string[]).includes(key),
    ),
  };
}

export function mergeWorkerDevVars(
  fromInfisical: Partial<Record<WorkerSecretName, string>>,
  existing: Partial<Record<WorkerSecretName, string>>,
) {
  const vars: Partial<Record<WorkerSecretName, string>> = { ...fromInfisical };
  for (const key of PENDING_WORKER_SECRETS) {
    if (!vars[key] && existing[key]) vars[key] = existing[key];
  }
  return vars;
}

export function formatDevVars(vars: Partial<Record<WorkerSecretName, string>>) {
  const missingRequired = REQUIRED_WORKER_SECRETS.filter((key) => !vars[key]);
  if (missingRequired.length > 0) {
    throw new Error(`缺少 Worker 密钥: ${missingRequired.join(", ")}`);
  }
  return `${WORKER_SECRETS.filter((key) => vars[key])
    .map((key) => `${key}=${escapeDotenvValue(vars[key]!)}`)
    .join("\n")}\n`;
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

function escapeDotenvValue(value: string) {
  if (!/[\s#"']/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
