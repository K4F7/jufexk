import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(process.argv[2] || "scripts/legacy_ocr/frozen-historical-production-v1");
const apply = process.argv.includes("--apply");
const baseUrl = (process.env.JUFEXK_BASE_URL || "https://xk.sein.moe").replace(/\/$/, "");
const password = process.env.JUFEXK_ADMIN_PASSWORD;
const backupPath = resolve(process.env.JUFEXK_BACKUP_PATH || `.local-data/historical-import-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
const expectedCatalog = "33efc25c965510f7e87aeefc8b14a3ab5ec7c0df81d3485688d4630a4179bf1f";
const expectedPackage = "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af";
const expectedImportable = 941;
const target = { worker: "jufexk", d1: "jufexk", databaseId: "7bd119f3-b8a2-4c9d-9e70-2809396ee26c", environment: process.env.JUFEXK_ENVIRONMENT || "production" };
const operator = process.env.JUFEXK_OPERATOR || "unspecified";

if (!password) throw new Error("缺少 JUFEXK_ADMIN_PASSWORD");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const rows = (await readFile(resolve(root, "importable-legacy-reviews.jsonl"), "utf8"))
  .trimEnd().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const packageHash = createHash("sha256").update(await readFile(resolve(root, "manifest.json"))).digest("hex");
if (manifest.contractVersion !== "legacy-historical-production-freeze-v1" || manifest.status !== "package_ready" || manifest.counts?.importable !== expectedImportable || manifest.lineage?.approvedPackageManifestSha256 !== expectedPackage || manifest.lineage?.approvedCatalogContentSha256 !== expectedCatalog) throw new Error("冻结包契约或哈希不匹配");
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
if (!before.marker || before.marker.approved_manifest_content_sha256 !== expectedCatalog || before.marker.courses == null || before.marker.teachers == null || before.marker.relations == null) throw new Error("生产目录 marker 缺失或不匹配");
if (!apply) { console.log(JSON.stringify({ mode: "preview", packageManifestSha256: packageHash, backupPath, backupSha256, before })); process.exit(2); }
for (let i = 0; i < rows.length; i += 50) { const batch = rows.slice(i, i + 50); await api("/api/admin/historical-review-imports", { method: "POST", body: JSON.stringify({ manifest, records: batch }) }); }
let replayExisting = 0;
for (let i = 0; i < rows.length; i += 50) { const result = await api("/api/admin/historical-review-imports", { method: "POST", body: JSON.stringify({ manifest, records: rows.slice(i, i + 50) }) }); replayExisting += Number(result.existing || 0); }
const after = await api("/api/admin/historical-review-status");
if (after.historicalReviews !== expectedImportable || replayExisting !== expectedImportable || JSON.stringify(after.marker) !== JSON.stringify(before.marker)) throw new Error("生产导入计数、幂等复核或目录计数不一致");
const audit = { completedAt: new Date().toISOString(), operator, target, packageManifestSha256: packageHash, catalogContentSha256: expectedCatalog, imported: expectedImportable, replayExisting, backupPath, backupSha256, recovery: { restoreFrom: backupPath, restoreSha256: backupSha256 }, before, after, publicUiChecks: "manual-production-window-required" };
console.log(JSON.stringify(audit));
