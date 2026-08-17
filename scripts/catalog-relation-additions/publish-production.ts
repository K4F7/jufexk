import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAdminPassword } from "../secrets/inventory";
import { createProductionD1ExportCommand } from "../historical-import/production-wrangler";
import { parseRelationAdditionArguments } from "./production-arguments";

const exec = promisify(execFile);
const { apply, root, viaPairs } = parseRelationAdditionArguments(
  process.argv.slice(2),
);
const baseUrl = (process.env.JUFEXK_BASE_URL || "https://xk.sein.moe").replace(
  /\/$/,
  "",
);
const password = resolveAdminPassword(process.env);
const backupPath = resolve(
  process.env.JUFEXK_BACKUP_PATH ||
    `.local-data/issue111-relations-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`,
);
const expectedCatalog = "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588";
const expectedCatalogArtifact = "aab562b8ff5cbe8159128769749616f6285fa0b8a9fab9bb6a49d6e70e72504a";
const expectedManifest =
  "edb9c07dc31990de02fb3d22c5a4c9141e931a7b49d68fa64eb8ae55dd0ae34b";
const expectedRequests =
  "3f8032219a8dc74d5669e8c37ddf716f55fab56a018d9970716efbcbc1b4b647";
const expectedBefore = { courses: 3740, teachers: 1951, relations: 11482 };
const expectedAfter = { courses: 3740, teachers: 1951, relations: 11543 };
const target = {
  worker: "jufexk",
  d1: "jufexk",
  databaseId: "7bd119f3-b8a2-4c9d-9e70-2809396ee26c",
  environment: process.env.JUFEXK_ENVIRONMENT || "production",
};
const operator = process.env.JUFEXK_OPERATOR || "unspecified";

const manifestText = await readFile(resolve(root, "manifest.json"), "utf8");
const artifactText = await readFile(
  resolve(root, "catalog-addition-requests.jsonl"),
  "utf8",
);
const manifest = JSON.parse(manifestText);
const packageHash = createHash("sha256").update(manifestText).digest("hex");
const artifactHash = createHash("sha256").update(artifactText).digest("hex");
if (
  packageHash !== expectedManifest ||
  artifactHash !== expectedRequests ||
  manifest.contract_version !== "legacy-issue111-relation-addition-v1" ||
  manifest.counts?.relations !== 61
)
  throw new Error("任课关系候选包契约或哈希不匹配");

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
  before.catalog?.courses !== expectedBefore.courses ||
  before.catalog?.teachers !== expectedBefore.teachers ||
  before.catalog?.relations !== expectedBefore.relations ||
  before.historicalReviews !== 522
)
  throw new Error("生产目录 marker、现场计数或 522 条历史评价不匹配");

const officialBody = { manifest: manifestText, artifact: artifactText };
const pairs = artifactText
  .trimEnd()
  .split("\n")
  .map((line) => {
    const row = JSON.parse(line) as {
      catalog_course_code: string;
      catalog_teacher_label: string;
    };
    return {
      courseCode: row.catalog_course_code,
      sourceTeacherLabel: row.catalog_teacher_label,
    };
  });
const previewPath = viaPairs
  ? "/api/admin/import/relations/preview"
  : "/api/admin/catalog-relation-additions/preview";
const applyPath = viaPairs
  ? "/api/admin/import/relations"
  : "/api/admin/catalog-relation-additions";
const payload = viaPairs ? { pairs } : officialBody;
const preview = await api(previewPath, {
  method: "POST",
  body: JSON.stringify(payload),
});
if (
  preview.pairs !== 61 ||
  preview.failures?.length ||
  preview.relationsAbsent !== 61 ||
  preview.coursesPresent !== 61 ||
  preview.teachersPresent !== 61
)
  throw new Error("任课关系预检失败：61 对必须全部课在、师在、关系不在");
if (!apply) {
  console.log(
    JSON.stringify({
      mode: "preview",
      viaPairs,
      packageManifestSha256: packageHash,
      backupPath,
      backupSha256,
      before,
      preview,
    }),
  );
  process.exit(2);
}

const written = await api(applyPath, {
  method: "POST",
  body: JSON.stringify(payload),
});
const replay = await api(applyPath, {
  method: "POST",
  body: JSON.stringify(payload),
});
const after = await api("/api/admin/historical-review-status");
if (
  written.created !== 61 ||
  replay.existing !== 61 ||
  replay.created !== 0 ||
  after.catalog?.courses !== expectedAfter.courses ||
  after.catalog?.teachers !== expectedAfter.teachers ||
  after.catalog?.relations !== expectedAfter.relations ||
  after.historicalReviews !== 522 ||
  JSON.stringify(after.marker) !== JSON.stringify(before.marker)
)
  throw new Error("任课关系写入计数、幂等复核、现场计数或 marker 不一致");

console.log(
  JSON.stringify({
    completedAt: new Date().toISOString(),
    operator,
    target,
    viaPairs,
    packageManifestSha256: packageHash,
    created: written.created,
    replayExisting: replay.existing,
    backupPath,
    backupSha256,
    before,
    after,
  }),
);
