import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OFFLINE_PREFIXES = ["scripts/legacy_ocr/", "scripts/legacy_evidence/"];

const SKIP_WEB_PREFIXES = ["docs/", ".agents/", ...OFFLINE_PREFIXES];

function normalize(file) {
  return String(file).replaceAll("\\", "/");
}

function matchesPrefix(file, prefix) {
  const directory = prefix.slice(0, -1);
  return file === directory || file.startsWith(prefix);
}

export function isOfflinePath(file) {
  const normalized = normalize(file);
  return OFFLINE_PREFIXES.some((prefix) => matchesPrefix(normalized, prefix));
}

export function isSkipWebPath(file) {
  const normalized = normalize(file);
  if (normalized.endsWith(".md")) return true;
  return SKIP_WEB_PREFIXES.some((prefix) => matchesPrefix(normalized, prefix));
}

export function classifyChangedPaths(files) {
  if (files.length === 0) {
    return { web: true, offline: false };
  }

  let web = false;
  let offline = false;
  for (const file of files) {
    if (isOfflinePath(file)) offline = true;
    if (!isSkipWebPath(file)) web = true;
  }
  return { web, offline };
}

function readPathLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const stdinFiles = readPathLines(Buffer.concat(chunks).toString("utf8"));
  const argvFiles = process.argv.slice(2);
  const classification = classifyChangedPaths(argvFiles.length > 0 ? argvFiles : stdinFiles);
  const lines = [`web=${classification.web}`, `offline=${classification.offline}`];
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
