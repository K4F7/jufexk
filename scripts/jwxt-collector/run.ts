import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectJwxt, type CollectorCheckpoint } from "./collector";
import {
  JwxtAuthAdapter,
  JwxtCookieAuthAdapter,
  UnsupportedJwxtAuthenticationError,
} from "./auth-adapter";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const mode = argument("--mode");
const output = argument("--output");
const checkpointPath = argument("--checkpoint") || ".local-data/jwxt-sync/collector-checkpoint.json";
if (!mode || !["pilot", "incremental", "full", "resume"].includes(mode) || !output) {
  throw new Error("usage: run.ts --mode pilot|incremental|full|resume --output PATH");
}
const username = process.env.JWXT_USERNAME;
const password = process.env.JWXT_PASSWORD;
const cookie = process.env.JWXT_COOKIE;
if (!cookie && (!username || !password)) {
  throw new Error("JWXT credentials are not configured");
}

try {
  let resume: CollectorCheckpoint | undefined;
  if (mode === "resume") {
    resume = JSON.parse(await readFile(resolve(checkpointPath), "utf8")) as CollectorCheckpoint;
  }
  const saveCheckpoint = async (checkpoint: CollectorCheckpoint) => {
    const target = resolve(checkpointPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(checkpoint)}\n`, { mode: 0o600 });
  };
  const capture = await collectJwxt(
    cookie
      ? new JwxtCookieAuthAdapter(cookie)
      : new JwxtAuthAdapter(username!, password!),
    mode as "pilot" | "incremental" | "full" | "resume",
    undefined,
    { resume, save: saveCheckpoint },
  );
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(capture, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: "captured", mode, rowCount: capture.offerings.length })}\n`);
} catch (error) {
  const status = error instanceof UnsupportedJwxtAuthenticationError ? "unsupported" : "failed";
  const reason = error instanceof Error ? error.message : "unknown";
  process.stderr.write(`${JSON.stringify({ status, reason })}\n`);
  process.exitCode = 1;
}
