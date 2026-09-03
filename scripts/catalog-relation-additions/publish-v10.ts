import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAdminSession } from "../secrets/inventory";
import { createProductionD1ExportCommand } from "../historical-import/production-wrangler";
import { parseV10RelationArguments } from "./v10-arguments";
import { jsonErrorMessage } from "../json-error";
import type { RelationAdditionResult } from "../../src/catalog-relation-additions";

const exec = promisify(execFile);
const { apply, root } = parseV10RelationArguments(process.argv.slice(2));
const baseUrl = (process.env.JUFEXK_BASE_URL || "https://courses.sein.moe").replace(
  /\/$/,
  "",
);
const adminSession = resolveAdminSession(process.env);
const backupPath = resolve(
  process.env.JUFEXK_BACKUP_PATH ||
    `.local-data/issue365-relations-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`,
);
const expectedCatalog =
  "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588";
const expectedCatalogArtifact =
  "aab562b8ff5cbe8159128769749616f6285fa0b8a9fab9bb6a49d6e70e72504a";
const expectedManifest =
  "ba9a7562264d65bdbf8f1da21ec3a62d292f6bd84b69512ad26ad52205c37c8d";
const expectedRequests =
  "9a5ff337d4f0008c2d392c7cc5879a46cce589dca89e307f1bc802bbf3d4236d";
const expectedBefore = { courses: 3740, teachers: 1951, relations: 11572 };
const expectedAfter = { courses: 3740, teachers: 1951, relations: 11579 };
const expectedReviews = 1239;
const expectedPairs = 7;
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
  manifest.contract_version !== "legacy-issue365-relation-addition-v1" ||
  manifest.counts?.relations !== expectedPairs
)
  throw new Error("v10 任课关系候选包契约或哈希不匹配");

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
type CatalogCounts = {
  courses: number;
  teachers: number;
  relations: number;
};

type CatalogMarker = {
  approved_manifest_content_sha256: string;
  artifact_sha256: string;
  courses: number;
  teachers: number;
  relations: number;
};

type HistoricalReviewStatus = {
  marker: CatalogMarker | null;
  catalog: CatalogCounts;
  historicalReviews: number;
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`${init.method || "GET"} ${path}: ${jsonErrorMessage(body, response.status)}`);
  return body as T;
}

for (const part of adminSession.cookie.split(";")) {
  const match = /^([^=]+)=(.*)$/.exec(part.trim());
  if (match) cookies.set(match[1], match[2]);
}
csrf = adminSession.csrf;
const before = await api<HistoricalReviewStatus>("/api/admin/historical-review-status");
if (
  !before.marker ||
  before.marker.approved_manifest_content_sha256 !== expectedCatalog ||
  before.marker.artifact_sha256 !== expectedCatalogArtifact ||
  before.catalog?.courses !== expectedBefore.courses ||
  before.catalog?.teachers !== expectedBefore.teachers ||
  before.catalog?.relations !== expectedBefore.relations ||
  before.historicalReviews !== expectedReviews
)
  throw new Error("生产目录 marker、现场计数或 1239 条历史评价不匹配");

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
const payload = { pairs };
const preview = await api<RelationAdditionResult>("/api/admin/import/relations/preview", {
  method: "POST",
  body: JSON.stringify(payload),
});
if (
  preview.pairs !== expectedPairs ||
  preview.failures?.length ||
  preview.relationsAbsent !== expectedPairs ||
  preview.coursesPresent !== expectedPairs ||
  preview.teachersPresent !== expectedPairs
)
  throw new Error("任课关系预检失败：7 对必须全部课在、师在、关系不在");
if (!apply) {
  console.log(
    JSON.stringify({
      mode: "preview",
      packageManifestSha256: packageHash,
      backupPath,
      backupSha256,
      before,
      preview,
    }),
  );
  process.exit(2);
}

const written = await api<RelationAdditionResult>("/api/admin/import/relations", {
  method: "POST",
  body: JSON.stringify(payload),
});
const replay = await api<RelationAdditionResult>("/api/admin/import/relations", {
  method: "POST",
  body: JSON.stringify(payload),
});
const after = await api<HistoricalReviewStatus>("/api/admin/historical-review-status");
if (
  written.created !== expectedPairs ||
  replay.existing !== expectedPairs ||
  replay.created !== 0 ||
  after.catalog?.courses !== expectedAfter.courses ||
  after.catalog?.teachers !== expectedAfter.teachers ||
  after.catalog?.relations !== expectedAfter.relations ||
  after.historicalReviews !== expectedReviews ||
  JSON.stringify(after.marker) !== JSON.stringify(before.marker)
)
  throw new Error("v10 任课关系写入计数、幂等复核、现场计数或 marker 不一致");

console.log(
  JSON.stringify({
    completedAt: new Date().toISOString(),
    operator,
    target,
    packageManifestSha256: packageHash,
    created: written.created,
    replayExisting: replay.existing,
    backupPath,
    backupSha256,
    before,
    after,
  }),
);
