import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SECRETS_STORE_ID,
  WORKER_SECRETS,
  parseDotenv,
  selectWorkerDevVars,
} from "./inventory";

const inputPath = resolve(process.argv[2] || ".dev.vars");
const selected = selectWorkerDevVars(parseDotenv(readFileSync(inputPath, "utf8")));
if (selected.missing.length > 0) {
  throw new Error(`${inputPath} 缺少 ${selected.missing.join(", ")}`);
}

const existing = listLocalSecretIds();
for (const name of WORKER_SECRETS) {
  const value = selected.vars[name]!;
  const secretId = existing.get(name);
  if (secretId) {
    runWrangler([
      "secrets-store",
      "secret",
      "update",
      SECRETS_STORE_ID,
      "--secret-id",
      secretId,
      "--scopes",
      "workers",
      "--value",
      value,
    ]);
  } else {
    runWrangler([
      "secrets-store",
      "secret",
      "create",
      SECRETS_STORE_ID,
      "--name",
      name,
      "--scopes",
      "workers",
      "--value",
      value,
    ]);
  }
}

process.stdout.write(
  `synced local Secrets Store ${SECRETS_STORE_ID} (${WORKER_SECRETS.join(", ")})\n`,
);

function runWrangler(args: string[]) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "wrangler failed").trim());
  }
}

function listLocalSecretIds() {
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "secrets-store", "secret", "list", SECRETS_STORE_ID],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  const ids = new Map<string, string>();
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  const row =
    /^\|\s*(ADMIN_PASSWORD|IP_HASH_SECRET|TURNSTILE_SECRET)\s*\|\s*([0-9a-f]{32})\s*\|/gim;
  for (const match of text.matchAll(row)) ids.set(match[1], match[2]);
  return ids;
}
