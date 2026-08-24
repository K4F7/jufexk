import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDotenv } from "../secrets/inventory";
import { normalizeCasUsername } from "../../src/lib/jxufe-cas";

/**
 * Bootstrap administrator student-ID bindings without the retired password.
 * Prints INSERT SQL (hashes only). With --apply, runs wrangler d1 execute.
 *
 *   pnpm exec tsx scripts/admin/bind-student-ids.ts 2021001234 2021005678
 *   pnpm exec tsx scripts/admin/bind-student-ids.ts --remote --apply 2021001234
 */
const args = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("-")));
const remote = flags.has("--remote");
const apply = flags.has("--apply");

function identitySecretFrom(env: NodeJS.Dict<string>) {
  const secret = env.CAMPUS_IDENTITY_SECRET;
  if (!secret) throw new Error("缺少 CAMPUS_IDENTITY_SECRET");
  return secret;
}

const envCandidates = [
  resolve(process.cwd(), ".dev.vars"),
  resolve(import.meta.dirname, "../../.dev.vars"),
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

const usernames = args.map((raw) => {
  const username = normalizeCasUsername(raw);
  if (!username) throw new Error("学号格式不正确");
  return username;
});
if (!usernames.length) {
  throw new Error("请至少提供一个学号");
}

const secret = identitySecretFrom({ ...fileEnv, ...process.env });
const hashes = usernames.map((username) =>
  createHmac("sha256", secret).update(`cas-username:${username}`).digest("hex"),
);
const sql = hashes
  .map(
    (hash) =>
      `INSERT OR IGNORE INTO admin_student_bindings(subject_hash) VALUES('${hash}');`,
  )
  .join("\n");

if (!apply) {
  console.log(sql);
  process.exit(0);
}

const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const exec = promisify(execFile);
const wranglerArgs = [
  "d1",
  "execute",
  "jufexk",
  remote ? "--remote" : "--local",
  "--command",
  sql,
];
const result = await exec("pnpm", ["exec", "wrangler", ...wranglerArgs], {
  cwd: process.cwd(),
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
