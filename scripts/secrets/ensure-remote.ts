import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  SECRETS_STORE_ID,
  parseSecretStoreList,
} from "./inventory";

const NAME = "CAS_CHALLENGE_SECRET";

const listed = runWrangler([
  "secrets-store",
  "secret",
  "list",
  SECRETS_STORE_ID,
  "--remote",
  "--per-page",
  "50",
]);
if (parseSecretStoreList(listed).has(NAME)) {
  process.stdout.write(`${NAME} already present in remote Secrets Store\n`);
  process.exit(0);
}

const value = randomBytes(32).toString("hex");
runWrangler([
  "secrets-store",
  "secret",
  "create",
  SECRETS_STORE_ID,
  "--name",
  NAME,
  "--scopes",
  "workers",
  "--value",
  value,
  "--remote",
]);
process.stdout.write(`created ${NAME} in remote Secrets Store\n`);

function runWrangler(args: string[]) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.status !== 0) {
    throw new Error(text.trim() || "wrangler failed");
  }
  return text;
}
