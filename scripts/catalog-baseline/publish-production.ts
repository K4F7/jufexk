import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAdminSession } from "../secrets/inventory";

const approvedRoot = resolve(process.argv[2] || "scripts/catalog-baseline/captures/full-approved-v1");
const shouldPublish = process.argv.includes("--publish");
const origin = (process.env.JUFEXK_BASE_URL || "https://courses.sein.moe").replace(/\/$/, "");
const adminSession = resolveAdminSession(process.env);

const manifest = JSON.parse(readFileSync(resolve(approvedRoot, "manifest.json"), "utf8"));
const artifact = readFileSync(resolve(approvedRoot, manifest.artifact.path));
if (artifact.byteLength !== manifest.artifact.bytes) throw new Error("批准包字节数与 manifest 不一致");
if (createHash("sha256").update(artifact).digest("hex") !== manifest.artifact.sha256) throw new Error("批准包 SHA-256 与 manifest 不一致");

type Chunk = { start: number; end: number; records: number };
const chunks: Chunk[] = [];
let start = 0, records = 0;
for (let offset = 0; offset < artifact.byteLength; offset += 1) {
  if (artifact[offset] !== 10) continue;
  records += 1;
  const bytes = offset + 1 - start;
  if (bytes > 750_000) throw new Error("批准包存在超过 750KB 的分块记录");
  if (records >= 100 || bytes >= 600_000) {
    chunks.push({ start, end: offset + 1, records });
    start = offset + 1;
    records = 0;
  }
}
if (artifact.at(-1) !== 10) throw new Error("批准 JSONL 必须以换行结束");
if (start !== artifact.byteLength) chunks.push({ start, end: artifact.byteLength, records });
if (chunks.reduce((total, chunk) => total + chunk.records, 0) !== manifest.artifact.records) throw new Error("本地分块记录数与 manifest 不一致");

const cookies = new Map<string, string>();
let csrf = "";
function rememberCookies(headers: Headers) {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.() ?? [headers.get("set-cookie") || ""];
  for (const value of values) {
    const match = /^([^=;,]+)=([^;]*)/.exec(value);
    if (match) cookies.set(match[1], match[2]);
  }
}
async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Origin", origin);
  if (cookies.size) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
  if (csrf && init.method && init.method !== "GET") headers.set("X-CSRF-Token", csrf);
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  rememberCookies(response.headers);
  const text = await response.text();
  let body: any;
  try { body = text ? JSON.parse(text) : {} } catch { body = { error: text } }
  if (!response.ok) throw new Error(`${init.method || "GET"} ${path}: ${body.error || response.status}`);
  return body;
}

const batchId = `baseline-${String(manifest.contentSha256).slice(0, 24)}`;
let loggedIn = false;
try {
  for (const part of adminSession.cookie.split(";")) {
    const match = /^([^=]+)=(.*)$/.exec(part.trim());
    if (match) cookies.set(match[1], match[2]);
  }
  csrf = adminSession.csrf;
  loggedIn = true;
  const baseline = await api("/api/admin/catalog-baseline/status");
  if (baseline.published) throw new Error("生产目录基线已发布，入口已关闭");

  const status = await api("/api/admin/catalog-baseline/uploads", {
    method: "POST",
    body: JSON.stringify({ batchId, manifest, chunkCount: chunks.length }),
  });
  const missing = status.missingChunks as number[];
  console.log(JSON.stringify({ phase: "upload", batchId, chunks: chunks.length, missing: missing.length }));
  let uploaded = 0;
  for (const index of missing) {
    const chunk = chunks[index];
    const bytes = artifact.subarray(chunk.start, chunk.end);
    const content = bytes.toString("utf8");
    await api(`/api/admin/catalog-baseline/uploads/${encodeURIComponent(batchId)}/chunks/${index}`, {
      method: "PUT",
      body: JSON.stringify({
        chunkId: `chunk-${index}`,
        records: chunk.records,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        content,
      }),
    });
    uploaded += 1;
    if (uploaded % 10 === 0 || uploaded === missing.length) console.log(JSON.stringify({ phase: "upload", uploaded, total: missing.length }));
  }

  const finalized = await api(`/api/admin/catalog-baseline/uploads/${encodeURIComponent(batchId)}/finalize`, { method: "POST", body: "{}" });
  if (finalized.status !== "staged" || finalized.missingChunks.length) throw new Error("生产 staging 状态异常");
  const previewCounts: Record<string, number> = {};
  for (const type of ["courses", "teachers", "relations"]) {
    const preview = await api(`/api/admin/catalog-baseline/uploads/${encodeURIComponent(batchId)}/preview?type=${type}&page=1&pageSize=1`);
    previewCounts[type] = preview.total;
  }
  if (previewCounts.courses !== manifest.counts.courses || previewCounts.teachers !== manifest.counts.teachers || previewCounts.relations !== manifest.counts.relations) throw new Error("生产 staging 类型计数与 manifest 不一致");
  console.log(JSON.stringify({ phase: "staged", batchId, counts: previewCounts }));
  if (!shouldPublish) process.exitCode = 2;
  else {
    const published = await api(`/api/admin/catalog-baseline/uploads/${encodeURIComponent(batchId)}/publish`, { method: "POST", body: "{}" });
    const marker = published.marker;
    if (marker.approved_manifest_content_sha256 !== manifest.contentSha256 || marker.artifact_sha256 !== manifest.artifact.sha256) throw new Error("生产 marker 与批准包不一致");
    console.log(JSON.stringify({ phase: "published", batchId, counts: { courses: marker.courses, teachers: marker.teachers, relations: marker.relations } }));
  }
} finally {
  if (loggedIn) await api("/api/admin/logout", { method: "POST", body: "{}" }).catch(() => undefined);
}
