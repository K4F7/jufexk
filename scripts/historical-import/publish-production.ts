import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const expectedRoot = resolve("D:/19016/Documents/Workload/jufexk-production-inputs/frozen-historical-production-v2");
const root = resolve(process.argv[2] || expectedRoot);
const apply = process.argv.includes("--apply");
const baseUrl = (process.env.JUFEXK_BASE_URL || "https://xk.sein.moe").replace(/\/$/, "");
const password = process.env.JUFEXK_ADMIN_PASSWORD;
const backupPath = resolve(process.env.JUFEXK_BACKUP_PATH || `.local-data/historical-import-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
const expectedCatalog = "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588";
const expectedCatalogArtifact = "aab562b8ff5cbe8159128769749616f6285fa0b8a9fab9bb6a49d6e70e72504a";
const expectedPackage = "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af";
const expectedFreezeManifest = "96035445669d14f19dd469bf51161236f0a1010507c53f20e7f925fae0d82adf";
const expectedImportable = 522;
const expectedRelationUnavailable = 419;
const expectedCatalogCounts = { courses: 3740, teachers: 1951, relations: 11482 };
const target = { worker: "jufexk", d1: "jufexk", databaseId: "7bd119f3-b8a2-4c9d-9e70-2809396ee26c", environment: process.env.JUFEXK_ENVIRONMENT || "production" };
const operator = process.env.JUFEXK_OPERATOR || "unspecified";

if (!password) throw new Error("缺少 JUFEXK_ADMIN_PASSWORD");
if (root !== expectedRoot) throw new Error(`冻结包必须使用固定绝对路径: ${expectedRoot}`);
const manifestText = await readFile(resolve(root, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText);
const artifact = await readFile(resolve(root, "importable-legacy-reviews.jsonl"));
const artifactText = artifact.toString("utf8");
const rows = artifactText.trimEnd().split("\n").filter(Boolean);
const packageHash = createHash("sha256").update(manifestText).digest("hex");
const artifactHash = createHash("sha256").update(artifact).digest("hex");
if (packageHash !== expectedFreezeManifest || manifest.contractVersion !== "legacy-historical-production-freeze-v2" || manifest.status !== "package_ready" || manifest.counts?.importable !== expectedImportable || manifest.counts?.catalogRelationUnavailable !== expectedRelationUnavailable || manifest.lineage?.approvedPackageManifestSha256 !== expectedPackage || manifest.lineage?.approvedCatalogContentSha256 !== expectedCatalog || manifest.lineage?.approvedCatalogArtifactSha256 !== expectedCatalogArtifact || manifest.files?.["importable-legacy-reviews.jsonl"]?.sha256 !== artifactHash || manifest.files?.["importable-legacy-reviews.jsonl"]?.rows !== expectedImportable) throw new Error("冻结包契约或哈希不匹配");
if (rows.length !== expectedImportable) throw new Error(`导入行数不匹配: ${rows.length}`);

await mkdir(dirname(backupPath), { recursive: true });
if (apply && await readFile(backupPath).then(() => true).catch(() => false)) throw new Error(`备份路径已存在，拒绝覆盖旧备份: ${backupPath}`);
if (apply) await exec("pnpm", ["exec", "wrangler", "d1", "export", "jufexk", "--remote", `--output=${backupPath}`, "-y"]);
const backup = await readFile(backupPath).catch(() => { throw new Error(`找不到备份文件: ${backupPath}`); });
const backupSha256 = createHash("sha256").update(backup).digest("hex");

const cookies = new Map<string, string>(); let csrf = "";
function remember(headers: Headers) { const h = headers as Headers & { getSetCookie?: () => string[] }; for (const value of h.getSetCookie?.() ?? [headers.get("set-cookie") || ""]) { const m = /^([^=;,]+)=([^;]*)/.exec(value); if (m) cookies.set(m[1], m[2]); } }
async function api(path: string, init: RequestInit = {}) { const headers = new Headers(init.headers); headers.set("Content-Type", "application/json"); headers.set("Origin", baseUrl); if (cookies.size) headers.set("Cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; ")); if (csrf && init.method && init.method !== "GET") headers.set("X-CSRF-Token", csrf); const response = await fetch(`${baseUrl}${path}`, { ...init, headers }); remember(response.headers); const body: any = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`${init.method || "GET"} ${path}: ${body.error || response.status}`); return body; }
const login = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) }); csrf = login.csrfToken;
const before = await api("/api/admin/historical-review-status");
if (!before.marker || before.marker.approved_manifest_content_sha256 !== expectedCatalog || before.marker.courses !== expectedCatalogCounts.courses || before.marker.teachers !== expectedCatalogCounts.teachers || before.marker.relations !== expectedCatalogCounts.relations) throw new Error("生产目录 marker 缺失、哈希或计数不匹配");
if (!apply) { console.log(JSON.stringify({ mode: "preview", packageManifestSha256: packageHash, backupPath, backupSha256, before })); process.exit(2); }
for (let offset = 0; offset < rows.length; offset += 50) await api("/api/admin/historical-review-imports", { method: "POST", body: JSON.stringify({ manifest: manifestText, artifact: artifactText, offset }) });
let replayExisting = 0;
for (let offset = 0; offset < rows.length; offset += 50) { const replay = await api("/api/admin/historical-review-imports", { method: "POST", body: JSON.stringify({ manifest: manifestText, artifact: artifactText, offset }) }); replayExisting += Number(replay.existing || 0); }
const after = await api("/api/admin/historical-review-status");
if (after.historicalReviews !== expectedImportable || replayExisting !== expectedImportable || JSON.stringify(after.marker) !== JSON.stringify(before.marker)) throw new Error("生产导入计数、幂等复核或目录计数不一致");
const audit = { completedAt: new Date().toISOString(), operator, target, packageManifestSha256: packageHash, catalogContentSha256: expectedCatalog, imported: expectedImportable, replayExisting, backupPath, backupSha256, recovery: { restoreFrom: backupPath, restoreSha256: backupSha256 }, before, after, publicUiChecks: "manual-production-window-required" };
console.log(JSON.stringify(audit));
