import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAdminPassword } from "../secrets/inventory";
import { parseIssue111ImportArguments } from "./issue111-arguments";
import { createProductionD1ExportCommand } from "./production-wrangler";

const exec = promisify(execFile);
const { apply, root } = parseIssue111ImportArguments(process.argv.slice(2));
const baseUrl = (process.env.JUFEXK_BASE_URL || "https://xk.sein.moe").replace(
  /\/$/,
  "",
);
const password = resolveAdminPassword(process.env);
const backupPath = resolve(
  process.env.JUFEXK_BACKUP_PATH ||
    `.local-data/issue111-historical-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`,
);
const expectedCatalog = "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588";
const expectedCatalogArtifact = "aab562b8ff5cbe8159128769749616f6285fa0b8a9fab9bb6a49d6e70e72504a";
const expectedPackage = "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af";
const expectedImportable = 164;
const expectedBeforeReviews = 522;
const expectedAfterReviews = 686;
const expectedCatalogCounts = { courses: 3740, teachers: 1951, relations: 11543 };
const target = {
  worker: "jufexk",
  d1: "jufexk",
  databaseId: "7bd119f3-b8a2-4c9d-9e70-2809396ee26c",
  environment: process.env.JUFEXK_ENVIRONMENT || "production",
};
const operator = process.env.JUFEXK_OPERATOR || "unspecified";

const manifestText = await readFile(resolve(root, "manifest.json"), "utf8");
const artifact = await readFile(resolve(root, "importable-legacy-reviews.jsonl"));
const artifactText = artifact.toString("utf8");
const rows = artifactText.trimEnd().split("\n").filter(Boolean);
const packageHash = createHash("sha256").update(manifestText).digest("hex");
const artifactHash = createHash("sha256").update(artifact).digest("hex");
const manifest = JSON.parse(manifestText);
if (
  manifest.contractVersion !== "legacy-issue111-historical-freeze-v1" ||
  manifest.status !== "package_ready" ||
  manifest.counts?.importable !== expectedImportable ||
  manifest.lineage?.approvedPackageManifestSha256 !== expectedPackage ||
  manifest.lineage?.approvedCatalogContentSha256 !== expectedCatalog ||
  manifest.lineage?.approvedCatalogArtifactSha256 !== expectedCatalogArtifact ||
  manifest.files?.["importable-legacy-reviews.jsonl"]?.sha256 !== artifactHash ||
  manifest.files?.["importable-legacy-reviews.jsonl"]?.rows !== expectedImportable
)
  throw new Error("issue111 冻结包契约或哈希不匹配");
if (rows.length !== expectedImportable)
  throw new Error(`导入行数不匹配: ${rows.length}`);

await mkdir(dirname(backupPath), { recursive: true });
if (apply && (await readFile(backupPath).then(() => true).catch(() => false)))
  throw new Error(`备份路径已存在，拒绝覆盖旧备份: ${backupPath}`);
if (apply) {
  const command = createProductionD1ExportCommand(backupPath);
  await access(command.wranglerCli);
  await exec(command.executable, command.args);
}
const backup = await readFile(backupPath).catch(() => {
  throw new Error(`找不到备份文件: ${backupPath}`);
});
const backupSha256 = createHash("sha256").update(backup).digest("hex");

const cookies = new Map<string, string>();
let csrf = "";
function remember(headers: Headers) {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  for (const value of h.getSetCookie?.() ?? [headers.get("set-cookie") || ""]) {
    const match = /^([^=;,]+)=([^;]*)/.exec(value);
    if (match) cookies.set(match[1], match[2]);
  }
}
async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Origin", baseUrl);
  if (cookies.size)
    headers.set(
      "Cookie",
      [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    );
  if (csrf && init.method && init.method !== "GET")
    headers.set("X-CSRF-Token", csrf);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  remember(response.headers);
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`${init.method || "GET"} ${path}: ${body.error || response.status}`);
  return body;
}

const login = await api("/api/admin/login", {
  method: "POST",
  body: JSON.stringify({ password }),
});
csrf = login.csrfToken;
const before = await api("/api/admin/historical-review-status");
if (
  !before.marker ||
  before.marker.approved_manifest_content_sha256 !== expectedCatalog ||
  before.marker.artifact_sha256 !== expectedCatalogArtifact ||
  before.catalog?.courses !== expectedCatalogCounts.courses ||
  before.catalog?.teachers !== expectedCatalogCounts.teachers ||
  before.catalog?.relations !== expectedCatalogCounts.relations ||
  before.historicalReviews !== expectedBeforeReviews
)
  throw new Error("生产目录 marker、现场计数或既有 522 条历史评价不匹配");
if (!apply) {
  console.log(
    JSON.stringify({
      mode: "preview",
      packageManifestSha256: packageHash,
      backupPath,
      backupSha256,
      before,
    }),
  );
  process.exit(2);
}

for (let offset = 0; offset < rows.length; offset += 50)
  await api("/api/admin/historical-review-batch-imports", {
    method: "POST",
    body: JSON.stringify({ manifest: manifestText, artifact: artifactText, offset }),
  });
let replayExisting = 0;
for (let offset = 0; offset < rows.length; offset += 50) {
  const replay = await api("/api/admin/historical-review-batch-imports", {
    method: "POST",
    body: JSON.stringify({ manifest: manifestText, artifact: artifactText, offset }),
  });
  replayExisting += Number(replay.existing || 0);
}
const after = await api("/api/admin/historical-review-status");
if (
  after.historicalReviews !== expectedAfterReviews ||
  replayExisting !== expectedImportable ||
  JSON.stringify(after.marker) !== JSON.stringify(before.marker) ||
  JSON.stringify(after.catalog) !== JSON.stringify(before.catalog)
)
  throw new Error("issue111 导入计数、幂等复核或目录计数不一致");

console.log(
  JSON.stringify({
    completedAt: new Date().toISOString(),
    operator,
    target,
    packageManifestSha256: packageHash,
    catalogContentSha256: expectedCatalog,
    imported: expectedImportable,
    replayExisting,
    backupPath,
    backupSha256,
    before,
    after,
    publicUiChecks: "manual-production-window-required",
  }),
);
