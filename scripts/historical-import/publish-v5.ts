import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveAdminPassword } from "../secrets/inventory";
import { assertV5PreviewOnly, parseV5ImportArguments } from "./v5-arguments";

const { apply, root } = parseV5ImportArguments(process.argv.slice(2));
assertV5PreviewOnly(apply);
const baseUrl = (process.env.JUFEXK_BASE_URL || "https://xk.sein.moe").replace(
  /\/$/,
  "",
);
const password = resolveAdminPassword(process.env);
const backupPath = resolve(
  process.env.JUFEXK_BACKUP_PATH ||
    `.local-data/v5-candidate-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`,
);
const expectedCatalog =
  "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588";
const expectedCatalogArtifact =
  "aab562b8ff5cbe8159128769749616f6285fa0b8a9fab9bb6a49d6e70e72504a";
const expectedEvaluationsSha256 =
  "27ba8bff846bb74b77728ccf23075a193385c9d01157c77fea785d4ee04bdfae";
const expectedFreezeManifest =
  "567fdd8d71f6672c631ff24fdae6002a0da0324fffe9e9cfa095cf23ae2feca2";
const expectedImportable = 195;
const expectedCatalogCounts = { courses: 3740, teachers: 1951 };

const manifestText = await readFile(resolve(root, "manifest.json"), "utf8");
const artifact = await readFile(resolve(root, "importable-legacy-reviews.jsonl"));
const rows = artifact.toString("utf8").trimEnd().split("\n").filter(Boolean);
const packageHash = createHash("sha256").update(manifestText).digest("hex");
const artifactHash = createHash("sha256").update(artifact).digest("hex");
const manifest = JSON.parse(manifestText);
if (
  packageHash !== expectedFreezeManifest ||
  manifest.contractVersion !== "legacy-v5-historical-freeze-v1" ||
  manifest.status !== "package_ready" ||
  manifest.counts?.importable !== expectedImportable ||
  manifest.schemas?.["importable-legacy-reviews.jsonl"] !==
    "legacy-approved-review-v1" ||
  manifest.lineage?.approvedPackageContract !==
    "legacy-review-approved-package-v1" ||
  manifest.lineage?.approvedEvaluationsSha256 !== expectedEvaluationsSha256 ||
  manifest.lineage?.approvedCatalogContentSha256 !== expectedCatalog ||
  manifest.lineage?.approvedCatalogArtifactSha256 !== expectedCatalogArtifact ||
  manifest.safety?.wrote_production_d1 !== false ||
  manifest.safety?.wrote_tencent_or_business_db !== false ||
  manifest.files?.["importable-legacy-reviews.jsonl"]?.sha256 !== artifactHash ||
  manifest.files?.["importable-legacy-reviews.jsonl"]?.rows !== expectedImportable
)
  throw new Error("v5 生产候选冻结包契约或哈希不匹配");
if (rows.length !== expectedImportable)
  throw new Error(`导入行数不匹配: ${rows.length}`);

await mkdir(dirname(backupPath), { recursive: true });
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
  before.catalog?.teachers !== expectedCatalogCounts.teachers
)
  throw new Error("生产目录 marker 或课程/教师计数不匹配");

console.log(
  JSON.stringify({
    mode: "preview",
    packageManifestSha256: packageHash,
    importable: manifest.counts.importable,
    pendingRelations: manifest.counts.pending_relations,
    pendingRelationReviews: manifest.counts.pending_relation_reviews,
    excluded: manifest.counts.excluded,
    excludedIdentities: manifest.counts.excluded_identities,
    backupPath,
    backupSha256,
    expectedCatalogCounts,
    liveCatalog: before.catalog,
    liveHistoricalReviews: before.historicalReviews,
    marker: before.marker,
    catalogCountDelta: {
      courses: before.catalog.courses - expectedCatalogCounts.courses,
      teachers: before.catalog.teachers - expectedCatalogCounts.teachers,
      relations: before.catalog.relations,
      markerRelations: before.marker.relations,
    },
    wroteProductionD1: false,
  }),
);
process.exit(2);
