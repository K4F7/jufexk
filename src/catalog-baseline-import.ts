import { createHash } from "node:crypto";

export const APPROVED_MANIFEST_SCHEMA = "catalog-baseline-approved-manifest/v1";
export const APPROVED_RECORD_SCHEMA = "catalog-baseline-approved-record/v1";
export const MAX_BASELINE_CHUNK_BYTES = 750_000;
export const MAX_BASELINE_CHUNK_RECORDS = 100;
const MAX_BASELINE_CHUNK_STATEMENTS = 1_000;

export interface ApprovedManifestInput {
  schemaVersion: string;
  status: string;
  sourceCaptureManifestContentSha256: string;
  derivationContentSha256: string;
  qualityManifestContentSha256: string;
  decisionsSha256: string;
  boundaryFixtureContentSha256: string;
  counts: { courses: number; teachers: number; relations: number; totalRecords: number };
  artifact: { path: string; records: number; bytes: number; sha256: string };
  contentSha256: string;
}

export interface ApprovedCourseValue {
  schemaVersion: "catalog-baseline-course/v1";
  courseCode: string;
  currentName: string;
  normalizedCurrentName: string;
  category: "general" | "sports";
  sourceCategoryTexts: string[];
  nameVariants: Array<{ rawName: string; normalizedName: string; firstSemester: string; lastSemester: string; occurrences: number }>;
}
export interface ApprovedTeacherValue { schemaVersion: "catalog-baseline-teacher/v1"; sourceTeacherLabel: string; normalizedTeacherLabel: string }
export interface ApprovedRelationValue {
  schemaVersion: "catalog-baseline-relation/v2";
  courseCode: string;
  sourceTeacherLabel: string;
  provenance: Array<{ queryId: string; page: number; row: number; semester: string; educationLevel: string; grade: string }>;
}
export type ApprovedRecord =
  | { schemaVersion: typeof APPROVED_RECORD_SCHEMA; recordType: "course"; value: ApprovedCourseValue }
  | { schemaVersion: typeof APPROVED_RECORD_SCHEMA; recordType: "teacher"; value: ApprovedTeacherValue }
  | { schemaVersion: typeof APPROVED_RECORD_SCHEMA; recordType: "relation"; value: ApprovedRelationValue };

function compareText(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0 }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value) }
function isSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) }
function isCount(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 }
function requiredText(value: unknown, max = 500) { return typeof value === "string" && value.length > 0 && value.length <= max }

export async function sha256Text(value: string) { return createHash("sha256").update(value).digest("hex") }

export async function validateApprovedManifest(value: unknown): Promise<ApprovedManifestInput> {
  if (!isObject(value) || !isObject(value.counts) || !isObject(value.artifact)) throw new Error("批准包 manifest 结构无效");
  if (value.schemaVersion !== APPROVED_MANIFEST_SCHEMA || value.status !== "package_ready") throw new Error("只接受 package_ready 的 approved manifest v1");
  for (const field of ["sourceCaptureManifestContentSha256", "derivationContentSha256", "qualityManifestContentSha256", "decisionsSha256", "boundaryFixtureContentSha256", "contentSha256"] as const) if (!isSha(value[field])) throw new Error(`manifest ${field} 无效`);
  const counts = value.counts;
  if (![counts.courses, counts.teachers, counts.relations, counts.totalRecords].every(isCount) || counts.totalRecords !== Number(counts.courses) + Number(counts.teachers) + Number(counts.relations)) throw new Error("manifest 记录计数无效");
  const artifact = value.artifact;
  if (artifact.path !== "catalog-baseline.jsonl" || !isCount(artifact.records) || !isCount(artifact.bytes) || !isSha(artifact.sha256) || artifact.records !== counts.totalRecords) throw new Error("manifest artifact 声明无效");
  const { contentSha256, ...content } = value;
  if (await sha256Text(stableJson(content)) !== contentSha256) throw new Error("approved manifest content hash 不匹配");
  return {
    schemaVersion: String(value.schemaVersion),
    status: String(value.status),
    sourceCaptureManifestContentSha256: String(value.sourceCaptureManifestContentSha256),
    derivationContentSha256: String(value.derivationContentSha256),
    qualityManifestContentSha256: String(value.qualityManifestContentSha256),
    decisionsSha256: String(value.decisionsSha256),
    boundaryFixtureContentSha256: String(value.boundaryFixtureContentSha256),
    counts: { courses: Number(counts.courses), teachers: Number(counts.teachers), relations: Number(counts.relations), totalRecords: Number(counts.totalRecords) },
    artifact: { path: String(artifact.path), records: Number(artifact.records), bytes: Number(artifact.bytes), sha256: String(artifact.sha256) },
    contentSha256,
  };
}

function validateProvenance(value: unknown): value is ApprovedRelationValue["provenance"] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isObject(item) && requiredText(item.queryId, 120) && Number.isInteger(item.page) && Number(item.page) >= 1 && Number.isInteger(item.row) && Number(item.row) >= 1 && requiredText(item.semester, 40) && requiredText(item.educationLevel, 80) && requiredText(item.grade, 40));
}

export function parseApprovedChunk(content: string): ApprovedRecord[] {
  if (new TextEncoder().encode(content).byteLength > MAX_BASELINE_CHUNK_BYTES) throw new Error("分块超过字节上限");
  if (!content.endsWith("\n")) throw new Error("分块必须在完整 JSONL 行边界结束");
  const lines = content.slice(0, -1).split("\n");
  if (lines.length > MAX_BASELINE_CHUNK_RECORDS) throw new Error("分块记录数超过上限");
  if (lines.some((line) => !line)) throw new Error("分块包含空 JSONL 行");
  return lines.map((line, index) => {
    let record: unknown;
    try { record = JSON.parse(line) } catch { throw new Error(`分块第 ${index + 1} 行不是有效 JSON`) }
    if (!isObject(record) || record.schemaVersion !== APPROVED_RECORD_SCHEMA || !["course", "teacher", "relation"].includes(String(record.recordType)) || !isObject(record.value)) throw new Error(`分块第 ${index + 1} 行不是 approved record v1`);
    const value = record.value;
    if (record.recordType === "course") {
      if (value.schemaVersion !== "catalog-baseline-course/v1" || !requiredText(value.courseCode, 100) || !requiredText(value.currentName) || !requiredText(value.normalizedCurrentName) || !["general", "sports"].includes(String(value.category)) || !Array.isArray(value.sourceCategoryTexts) || value.sourceCategoryTexts.some((text) => typeof text !== "string" || text.length > 500) || !Array.isArray(value.nameVariants) || value.nameVariants.length > 100 || value.nameVariants.some((variant) => !isObject(variant) || !requiredText(variant.rawName) || !requiredText(variant.normalizedName))) throw new Error(`分块第 ${index + 1} 行课程无效`);
    } else if (record.recordType === "teacher") {
      if (value.schemaVersion !== "catalog-baseline-teacher/v1" || !requiredText(value.sourceTeacherLabel) || !requiredText(value.normalizedTeacherLabel)) throw new Error(`分块第 ${index + 1} 行教师无效`);
    } else if (value.schemaVersion !== "catalog-baseline-relation/v2" || !requiredText(value.courseCode, 100) || !requiredText(value.sourceTeacherLabel) || !validateProvenance(value.provenance)) throw new Error(`分块第 ${index + 1} 行关系无效`);
    return record as ApprovedRecord;
  });
}

export function createArtifactHasher() { return createHash("sha256") }

export class BaselineImportError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 413 | 422 = 400) { super(message) }
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.body) throw new BaselineImportError("请求体不能为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BaselineImportError("请求体超过字节上限", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BaselineImportError("请求体不是有效 JSON");
  }
}

interface UploadRow {
  batch_id: string;
  approved_manifest_content_sha256: string;
  artifact_sha256: string;
  artifact_bytes: number;
  artifact_records: number;
  chunk_count: number;
  expected_courses: number;
  expected_teachers: number;
  expected_relations: number;
  status: "uploading" | "staged" | "published";
}
const getUpload = (db: D1Database, batchId: string) => db.prepare("SELECT * FROM catalog_baseline_uploads WHERE batch_id=?").bind(batchId).first<UploadRow>();
function batchIdFrom(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) throw new BaselineImportError("batchId 格式无效");
  return value;
}
function objectInput(value: unknown) {
  if (!isObject(value)) throw new BaselineImportError("请求结构无效");
  return value;
}

export async function createBaselineUpload(db: D1Database, input: unknown) {
  const body = objectInput(input), batchId = batchIdFrom(body.batchId);
  const manifest = await validateApprovedManifest(body.manifest).catch((error) => { throw new BaselineImportError(error instanceof Error ? error.message : "manifest 无效", 422) });
  const chunkCount = Number(body.chunkCount);
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 10_000) throw new BaselineImportError("chunkCount 必须为 1..10000");
  if (await db.prepare("SELECT 1 FROM catalog_baseline_marker WHERE singleton=1").first()) throw new BaselineImportError("目录基线入口已永久关闭", 409);
  const existing = await getUpload(db, batchId);
  if (existing) {
    if (existing.approved_manifest_content_sha256 !== manifest.contentSha256 || existing.chunk_count !== chunkCount) throw new BaselineImportError("batchId 已绑定其他批准包", 409);
    return baselineUploadStatus(db, batchId);
  }
  try {
    await db.prepare(`INSERT INTO catalog_baseline_uploads(
      batch_id,approved_schema_version,approved_manifest_content_sha256,artifact_sha256,artifact_bytes,artifact_records,chunk_count,
      source_capture_manifest_content_sha256,derivation_content_sha256,quality_manifest_content_sha256,decisions_sha256,boundary_fixture_content_sha256,
      expected_courses,expected_teachers,expected_relations
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      batchId, manifest.schemaVersion, manifest.contentSha256, manifest.artifact.sha256, manifest.artifact.bytes, manifest.artifact.records, chunkCount,
      manifest.sourceCaptureManifestContentSha256, manifest.derivationContentSha256, manifest.qualityManifestContentSha256, manifest.decisionsSha256, manifest.boundaryFixtureContentSha256,
      manifest.counts.courses, manifest.counts.teachers, manifest.counts.relations,
    ).run();
  } catch {
    const raced = await getUpload(db, batchId);
    if (!raced || raced.approved_manifest_content_sha256 !== manifest.contentSha256) throw new BaselineImportError("批次创建冲突", 409);
  }
  return baselineUploadStatus(db, batchId);
}

interface ChunkRow { chunk_index: number; chunk_id: string; records: number; bytes: number; sha256: string; content: string }
export async function putBaselineChunk(db: D1Database, batchIdInput: string, chunkIndexInput: number, input: unknown) {
  const batchId = batchIdFrom(batchIdInput), body = objectInput(input), chunkIndex = Number(chunkIndexInput);
  const upload = await getUpload(db, batchId);
  if (!upload) throw new BaselineImportError("上传批次不存在", 404);
  if (upload.status !== "uploading") throw new BaselineImportError("批次已完成 staging，不能替换分块", 409);
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= upload.chunk_count) throw new BaselineImportError("chunk index 超出声明范围");
  const chunkId = typeof body.chunkId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(body.chunkId) ? body.chunkId : "";
  const content = typeof body.content === "string" ? body.content : "";
  const declaredRecords = Number(body.records), declaredBytes = Number(body.bytes), declaredSha = body.sha256;
  if (!chunkId || !Number.isSafeInteger(declaredRecords) || declaredRecords < 0 || !Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || !isSha(declaredSha)) throw new BaselineImportError("分块元数据无效");
  const actualBytes = new TextEncoder().encode(content).byteLength;
  if (actualBytes > MAX_BASELINE_CHUNK_BYTES) throw new BaselineImportError("分块超过字节上限", 413);
  const records = (() => { try { return parseApprovedChunk(content) } catch (error) { throw new BaselineImportError(error instanceof Error ? error.message : "分块无效", 422) } })();
  const stagingStatementCount = 5 + records.reduce((count, record) => count + 1 + (record.recordType === "course" ? new Set([record.value.currentName, ...record.value.nameVariants.map((variant) => variant.rawName)]).size : 0), 0);
  if (stagingStatementCount > MAX_BASELINE_CHUNK_STATEMENTS) throw new BaselineImportError("分块展开后的 staging 语句数超过上限", 413);
  const actualSha = await sha256Text(content);
  if (declaredRecords !== records.length || declaredBytes !== actualBytes || declaredSha !== actualSha) throw new BaselineImportError("分块 records/bytes/SHA-256 不匹配", 422);
  const existing = await db.prepare("SELECT * FROM catalog_baseline_chunks WHERE batch_id=? AND chunk_index=?").bind(batchId, chunkIndex).first<ChunkRow>();
  if (existing && existing.chunk_id === chunkId && existing.records === declaredRecords && existing.bytes === declaredBytes && existing.sha256 === declaredSha && existing.content === content) return { ok: true, idempotent: true, chunkIndex };

  const writableGate = `EXISTS(SELECT 1 FROM catalog_baseline_uploads u WHERE u.batch_id=? AND u.status='uploading')
    AND NOT EXISTS(SELECT 1 FROM catalog_baseline_finalize_locks l WHERE l.batch_id=?)`;
  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM catalog_baseline_staged_relations WHERE batch_id=? AND chunk_index=? AND ${writableGate}`).bind(batchId, chunkIndex, batchId, batchId),
    db.prepare(`DELETE FROM catalog_baseline_staged_course_names WHERE batch_id=? AND chunk_index=? AND ${writableGate}`).bind(batchId, chunkIndex, batchId, batchId),
    db.prepare(`DELETE FROM catalog_baseline_staged_teachers WHERE batch_id=? AND chunk_index=? AND ${writableGate}`).bind(batchId, chunkIndex, batchId, batchId),
    db.prepare(`DELETE FROM catalog_baseline_staged_courses WHERE batch_id=? AND chunk_index=? AND ${writableGate}`).bind(batchId, chunkIndex, batchId, batchId),
    db.prepare(`INSERT INTO catalog_baseline_chunks(batch_id,chunk_index,chunk_id,records,bytes,sha256,content)
      SELECT ?,?,?,?,?,?,? WHERE ${writableGate}
      ON CONFLICT(batch_id,chunk_index) DO UPDATE SET chunk_id=excluded.chunk_id,records=excluded.records,bytes=excluded.bytes,sha256=excluded.sha256,content=excluded.content,uploaded_at=CURRENT_TIMESTAMP
      WHERE EXISTS(SELECT 1 FROM catalog_baseline_uploads u WHERE u.batch_id=catalog_baseline_chunks.batch_id AND u.status='uploading')
        AND NOT EXISTS(SELECT 1 FROM catalog_baseline_finalize_locks l WHERE l.batch_id=catalog_baseline_chunks.batch_id)`).bind(batchId, chunkIndex, chunkId, declaredRecords, declaredBytes, declaredSha, content, batchId, batchId),
  ];
  for (const record of records) {
    const sourceJson = JSON.stringify(record.value);
    if (record.recordType === "course") {
      statements.push(db.prepare(`INSERT INTO catalog_baseline_staged_courses(batch_id,chunk_index,course_code,name,category,source_json)
        SELECT ?,?,?,?,?,? WHERE ${writableGate}`).bind(batchId, chunkIndex, record.value.courseCode, record.value.currentName, record.value.category, sourceJson, batchId, batchId));
      const names = new Set([record.value.currentName, ...record.value.nameVariants.map((variant) => variant.rawName)]);
      for (const name of [...names].sort(compareText)) statements.push(db.prepare(`INSERT INTO catalog_baseline_staged_course_names(batch_id,chunk_index,course_code,name)
        SELECT ?,?,?,? WHERE ${writableGate}`).bind(batchId, chunkIndex, record.value.courseCode, name, batchId, batchId));
    } else if (record.recordType === "teacher") {
      statements.push(db.prepare(`INSERT INTO catalog_baseline_staged_teachers(batch_id,chunk_index,source_teacher_label,display_name,source_json)
        SELECT ?,?,?,?,? WHERE ${writableGate}`).bind(batchId, chunkIndex, record.value.sourceTeacherLabel, record.value.normalizedTeacherLabel, sourceJson, batchId, batchId));
    } else {
      statements.push(db.prepare(`INSERT INTO catalog_baseline_staged_relations(batch_id,chunk_index,course_code,source_teacher_label,provenance_json,source_json)
        SELECT ?,?,?,?,?,? WHERE ${writableGate}`).bind(batchId, chunkIndex, record.value.courseCode, record.value.sourceTeacherLabel, JSON.stringify(record.value.provenance), sourceJson, batchId, batchId));
    }
  }
  let results: D1Result[];
  try { results = await db.batch(statements) } catch { throw new BaselineImportError("分块与其他块存在重复身份或违反 staging 约束", 422) }
  if (!results[4]?.meta.changes) throw new BaselineImportError("批次正在 finalize 或已完成 staging，不能替换分块", 409);
  return { ok: true, idempotent: false, chunkIndex };
}

export async function baselineUploadStatus(db: D1Database, batchIdInput: string) {
  const batchId = batchIdFrom(batchIdInput), upload = await getUpload(db, batchId);
  if (!upload) throw new BaselineImportError("上传批次不存在", 404);
  const { results } = await db.prepare("SELECT chunk_index chunkIndex,chunk_id chunkId,records,bytes,sha256 FROM catalog_baseline_chunks WHERE batch_id=? ORDER BY chunk_index").bind(batchId).all();
  const present = new Set(results.map((row) => Number(row.chunkIndex)));
  const missingChunks = Array.from({ length: upload.chunk_count }, (_, index) => index).filter((index) => !present.has(index));
  return { batchId, status: upload.status, expectedChunks: upload.chunk_count, chunks: results, missingChunks };
}

export async function finalizeBaselineUpload(db: D1Database, batchIdInput: string) {
  const batchId = batchIdFrom(batchIdInput), upload = await getUpload(db, batchId);
  if (!upload) throw new BaselineImportError("上传批次不存在", 404);
  if (upload.status === "published") return baselineUploadStatus(db, batchId);
  if (upload.status === "staged") return baselineUploadStatus(db, batchId);
  const lock = await db.prepare(`INSERT INTO catalog_baseline_finalize_locks(batch_id)
    SELECT ? WHERE EXISTS(SELECT 1 FROM catalog_baseline_uploads WHERE batch_id=? AND status='uploading')
      AND NOT EXISTS(SELECT 1 FROM catalog_baseline_finalize_locks WHERE batch_id=?)`).bind(batchId, batchId, batchId).run();
  if (!lock.meta.changes) throw new BaselineImportError("批次正在 finalize 或状态已变化", 409);
  try {
    const { results } = await db.prepare("SELECT chunk_index,records,bytes,content FROM catalog_baseline_chunks WHERE batch_id=? ORDER BY chunk_index").bind(batchId).all<Pick<ChunkRow, "chunk_index" | "records" | "bytes" | "content">>();
    if (results.length !== upload.chunk_count || results.some((chunk, index) => chunk.chunk_index !== index)) throw new BaselineImportError("分块缺失或序号不连续", 422);
    const hasher = createArtifactHasher();
    let bytes = 0, records = 0;
    for (const chunk of results) { hasher.update(chunk.content); bytes += chunk.bytes; records += chunk.records }
    if (hasher.digest("hex") !== upload.artifact_sha256 || bytes !== upload.artifact_bytes || records !== upload.artifact_records) throw new BaselineImportError("整包 records/bytes/SHA-256 不匹配", 422);
    const counts = await db.batch([
      db.prepare("SELECT COUNT(*) n FROM catalog_baseline_staged_courses WHERE batch_id=?").bind(batchId),
      db.prepare("SELECT COUNT(*) n FROM catalog_baseline_staged_teachers WHERE batch_id=?").bind(batchId),
      db.prepare("SELECT COUNT(*) n FROM catalog_baseline_staged_relations WHERE batch_id=?").bind(batchId),
      db.prepare(`SELECT COUNT(*) n FROM catalog_baseline_staged_relations r
        LEFT JOIN catalog_baseline_staged_courses c ON c.batch_id=r.batch_id AND c.course_code=r.course_code
        LEFT JOIN catalog_baseline_staged_teachers t ON t.batch_id=r.batch_id AND t.source_teacher_label=r.source_teacher_label
        WHERE r.batch_id=? AND (c.course_code IS NULL OR t.source_teacher_label IS NULL)`).bind(batchId),
    ]);
    const numbers = counts.map((result) => Number((result.results[0] as { n: number }).n));
    if (numbers[0] !== upload.expected_courses || numbers[1] !== upload.expected_teachers || numbers[2] !== upload.expected_relations || numbers[3] !== 0) throw new BaselineImportError("staging 类型计数或 Relation 引用不匹配", 422);
    const updated = await db.prepare("UPDATE catalog_baseline_uploads SET status='staged',staged_at=CURRENT_TIMESTAMP WHERE batch_id=? AND status='uploading' AND EXISTS(SELECT 1 FROM catalog_baseline_finalize_locks WHERE batch_id=?)").bind(batchId, batchId).run();
    if (!updated.meta.changes) throw new BaselineImportError("批次状态已变化", 409);
    return baselineUploadStatus(db, batchId);
  } catch (error) {
    await db.prepare("DELETE FROM catalog_baseline_finalize_locks WHERE batch_id=? AND EXISTS(SELECT 1 FROM catalog_baseline_uploads WHERE batch_id=? AND status='uploading')").bind(batchId, batchId).run();
    throw error;
  }
}

export async function previewBaselineUpload(db: D1Database, batchIdInput: string, typeInput: string, pageInput: number, pageSizeInput: number) {
  const batchId = batchIdFrom(batchIdInput), upload = await getUpload(db, batchId);
  if (!upload) throw new BaselineImportError("上传批次不存在", 404);
  if (upload.status === "uploading") throw new BaselineImportError("批次尚未完成 staging", 409);
  const type = ["courses", "teachers", "relations"].includes(typeInput) ? typeInput : "courses";
  const page = Math.max(1, Number.isInteger(pageInput) ? pageInput : 1), pageSize = Math.min(100, Math.max(1, Number.isInteger(pageSizeInput) ? pageSizeInput : 50));
  const table = type === "courses" ? "catalog_baseline_staged_courses" : type === "teachers" ? "catalog_baseline_staged_teachers" : "catalog_baseline_staged_relations";
  const order = type === "courses" ? "course_code" : type === "teachers" ? "source_teacher_label" : "course_code,source_teacher_label";
  const total = await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE batch_id=?`).bind(batchId).first<{ n: number }>();
  const { results } = await db.prepare(`SELECT source_json FROM ${table} WHERE batch_id=? ORDER BY ${order} LIMIT ? OFFSET ?`).bind(batchId, pageSize, (page - 1) * pageSize).all<{ source_json: string }>();
  return { batchId, status: upload.status, type, page, pageSize, total: Number(total?.n ?? 0), items: results.map((row) => JSON.parse(row.source_json)) };
}

export async function publishBaselineUpload(db: D1Database, batchIdInput: string) {
  const batchId = batchIdFrom(batchIdInput), upload = await getUpload(db, batchId);
  if (!upload) throw new BaselineImportError("上传批次不存在", 404);
  if (upload.status !== "staged") throw new BaselineImportError(upload.status === "published" ? "目录基线已发布，入口永久关闭" : "批次尚未完成 staging", 409);
  const guard = db.prepare(`INSERT INTO catalog_baseline_marker(singleton,batch_id,approved_schema_version,approved_manifest_content_sha256,artifact_sha256,
    source_capture_manifest_content_sha256,derivation_content_sha256,quality_manifest_content_sha256,decisions_sha256,boundary_fixture_content_sha256,courses,teachers,relations)
    SELECT 1,batch_id,approved_schema_version,approved_manifest_content_sha256,artifact_sha256,source_capture_manifest_content_sha256,derivation_content_sha256,
      quality_manifest_content_sha256,decisions_sha256,boundary_fixture_content_sha256,expected_courses,expected_teachers,expected_relations
    FROM catalog_baseline_uploads WHERE batch_id=? AND status='staged'
      AND NOT EXISTS(SELECT 1 FROM catalog_baseline_marker)
      AND NOT EXISTS(
        SELECT 1 FROM courses c
        LEFT JOIN catalog_baseline_staged_courses s ON s.batch_id=? AND s.course_code=c.code
        WHERE s.course_code IS NULL
      )
      AND NOT EXISTS(
        SELECT 1 FROM teachers t
        LEFT JOIN catalog_baseline_staged_teachers s ON s.batch_id=? AND s.source_teacher_label=t.source_teacher_label
        WHERE s.source_teacher_label IS NULL
      )
      AND NOT EXISTS(
        SELECT 1 FROM course_teachers ct
        JOIN courses c ON c.id=ct.course_id
        JOIN teachers t ON t.id=ct.teacher_id
        LEFT JOIN catalog_baseline_staged_relations s
          ON s.batch_id=? AND s.course_code=c.code AND s.source_teacher_label=t.source_teacher_label
        WHERE s.course_code IS NULL
      )`).bind(batchId, batchId, batchId, batchId);
  const markerGate = "EXISTS(SELECT 1 FROM catalog_baseline_marker WHERE singleton=1 AND batch_id=?)";
  const statements = [
    guard,
    db.prepare(`INSERT INTO courses(code,name,category)
      SELECT s.course_code,s.name,s.category FROM catalog_baseline_staged_courses s
      WHERE s.batch_id=? AND ${markerGate} AND NOT EXISTS(SELECT 1 FROM courses c WHERE c.code=s.course_code)
      ORDER BY s.course_code`).bind(batchId, batchId),
    db.prepare(`UPDATE courses SET
      name=(SELECT s.name FROM catalog_baseline_staged_courses s WHERE s.batch_id=? AND s.course_code=courses.code),
      category=(SELECT s.category FROM catalog_baseline_staged_courses s WHERE s.batch_id=? AND s.course_code=courses.code)
      WHERE ${markerGate} AND EXISTS(SELECT 1 FROM catalog_baseline_staged_courses s WHERE s.batch_id=? AND s.course_code=courses.code)`).bind(batchId, batchId, batchId, batchId),
    db.prepare(`INSERT INTO course_name_variants(course_id,name) SELECT c.id,n.name FROM catalog_baseline_staged_course_names n JOIN courses c ON c.code=n.course_code WHERE n.batch_id=? AND ${markerGate} ORDER BY c.id,n.name ON CONFLICT(course_id,name) DO NOTHING`).bind(batchId, batchId),
    db.prepare(`INSERT INTO teachers(source_teacher_label,name,department)
      SELECT s.source_teacher_label,s.display_name,NULL FROM catalog_baseline_staged_teachers s
      WHERE s.batch_id=? AND ${markerGate} AND NOT EXISTS(SELECT 1 FROM teachers t WHERE t.source_teacher_label=s.source_teacher_label)
      ORDER BY s.source_teacher_label`).bind(batchId, batchId),
    db.prepare(`UPDATE teachers SET name=(SELECT s.display_name FROM catalog_baseline_staged_teachers s WHERE s.batch_id=? AND s.source_teacher_label=teachers.source_teacher_label)
      WHERE ${markerGate} AND EXISTS(SELECT 1 FROM catalog_baseline_staged_teachers s WHERE s.batch_id=? AND s.source_teacher_label=teachers.source_teacher_label)`).bind(batchId, batchId, batchId),
    db.prepare(`INSERT OR IGNORE INTO course_teachers(course_id,teacher_id) SELECT c.id,t.id FROM catalog_baseline_staged_relations r JOIN courses c ON c.code=r.course_code JOIN teachers t ON t.source_teacher_label=r.source_teacher_label WHERE r.batch_id=? AND ${markerGate} ORDER BY c.id,t.id`).bind(batchId, batchId),
    db.prepare(`INSERT INTO catalog_relation_provenance(course_id,teacher_id,query_id,page,row_number,semester,education_level,grade)
      SELECT c.id,t.id,json_extract(p.value,'$.queryId'),json_extract(p.value,'$.page'),json_extract(p.value,'$.row'),json_extract(p.value,'$.semester'),json_extract(p.value,'$.educationLevel'),json_extract(p.value,'$.grade')
      FROM catalog_baseline_staged_relations r JOIN courses c ON c.code=r.course_code JOIN teachers t ON t.source_teacher_label=r.source_teacher_label, json_each(r.provenance_json) p
      WHERE r.batch_id=? AND ${markerGate} ORDER BY c.id,t.id,p.key`).bind(batchId, batchId),
    db.prepare(`UPDATE catalog_baseline_uploads SET status='published',published_at=CURRENT_TIMESTAMP WHERE batch_id=? AND status='staged' AND ${markerGate}`).bind(batchId, batchId),
  ];
  let results: D1Result[];
  try { results = await db.batch(statements) } catch (error) {
    if (await db.prepare("SELECT 1 FROM catalog_baseline_marker WHERE singleton=1").first()) throw new BaselineImportError("目录基线入口已永久关闭", 409);
    throw error;
  }
  if (!results[0]?.meta.changes || !results.at(-1)?.meta.changes) throw new BaselineImportError("正式目录不是批准包的严格身份子集、已有 marker 或发生并发发布", 409);
  return db.prepare("SELECT * FROM catalog_baseline_marker WHERE singleton=1").first();
}
