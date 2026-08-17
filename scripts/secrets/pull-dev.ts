import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  WORKER_SECRET_PATH,
  WORKER_SECRETS,
  formatDevVars,
  mergeWorkerDevVars,
  parseDotenv,
  selectWorkerDevVars,
} from "./inventory";

const envName = "dev";
const outputPath = resolve(process.argv[2] || ".dev.vars");
const args = [
  "export",
  "--env",
  envName,
  "--path",
  WORKER_SECRET_PATH,
  "--format",
  "dotenv",
  "--silent",
];
if (process.env.INFISICAL_PROJECT_ID) {
  args.push("--projectId", process.env.INFISICAL_PROJECT_ID);
}

const result = spawnSync("infisical", args, { encoding: "utf8" });
if (result.error) throw result.error;
if (result.status !== 0) {
  const detail = (result.stderr || result.stdout || "").trim();
  throw new Error(
    detail || `infisical export 失败 (exit ${result.status ?? "unknown"})`,
  );
}

const selected = selectWorkerDevVars(parseDotenv(result.stdout));
if (selected.missingRequired.length > 0) {
  throw new Error(
    `Infisical ${envName} ${WORKER_SECRET_PATH} 缺少 ${selected.missingRequired.join(", ")}`,
  );
}

let existing: Record<string, string> = {};
try {
  existing = parseDotenv(readFileSync(outputPath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const vars = mergeWorkerDevVars(selected.vars, existing);
writeFileSync(outputPath, formatDevVars(vars), "utf8");
const written = WORKER_SECRETS.filter((key) => vars[key]);
process.stdout.write(`wrote ${outputPath} (${written.join(", ")})\n`);
if (!vars.ADMIN_PASSWORD) {
  process.stdout.write(
    "ADMIN_PASSWORD 尚未写入 Infisical；请先在 Cloudflare 轮换，再把新值加入 Infisical。\n",
  );
}
