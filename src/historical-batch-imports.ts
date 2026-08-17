export const ISSUE111_FREEZE_CONTRACT = "legacy-issue111-historical-freeze-v1";
export const ISSUE111_SOURCE_CONTRACT = "legacy-historical-approved-package-v1";
export const ISSUE111_RECORD_SCHEMA = "legacy-approved-review-v1";
export const ISSUE111_IMPORTABLE_COUNT = 164;
export const APPROVED_HISTORICAL_MANIFEST_SHA256 =
  "edcf142cbd0380e734da0cde1923ee976ea9e25ab48147d0b78e218a64bb51af";
export const APPROVED_CATALOG_CONTENT_SHA256 =
  "1c761d5e52dff1dc11ba019773184cc2c07f529d9dbe4ecbd906bd56eae20588";

export class HistoricalBatchImportError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

export type HistoricalBatchImportResult = {
  offset: number;
  total: number;
  created: number;
  existing: number;
};

const REQUIRED_FIELDS = new Set([
  "catalog_course_code",
  "catalog_teacher_label",
  "category",
  "comment",
  "decision_basis",
  "duplicate_group",
  "proposed_teacher_label",
  "review_id",
  "schema_version",
  "source_column",
  "source_evaluation_id",
  "source_row",
  "worksheet",
]);

const digest = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const clean = (value: unknown, limit = 500) =>
  typeof value === "string" ? value.trim().slice(0, limit) : "";

type Issue111Manifest = {
  contractVersion?: unknown;
  contentSha256?: unknown;
  status?: unknown;
  counts?: { importable?: unknown };
  files?: Record<string, { rows?: unknown; sha256?: unknown }>;
  schemas?: Record<string, unknown>;
  lineage?: {
    approvedCatalogContentSha256?: unknown;
    approvedPackageManifestSha256?: unknown;
    approvedPackageContract?: unknown;
  };
};

export async function importIssue111HistoricalBatch(
  db: D1Database,
  body: { manifest?: unknown; artifact?: unknown; offset?: unknown },
  configuredManifestSha256 = "manifest",
  configuredArtifactSha256 = "manifest",
): Promise<HistoricalBatchImportResult> {
  if (typeof body.manifest !== "string")
    throw new HistoricalBatchImportError("历史评价冻结 manifest 缺失");
  if (
    configuredManifestSha256 !== "manifest" &&
    (await digest(body.manifest)) !== configuredManifestSha256
  )
    throw new HistoricalBatchImportError("历史评价冻结 manifest 哈希不匹配");

  let manifest: Issue111Manifest;
  try {
    manifest = JSON.parse(body.manifest) as Issue111Manifest;
  } catch {
    throw new HistoricalBatchImportError("历史评价冻结 manifest 不是有效 JSON");
  }
  if (
    manifest.contractVersion !== ISSUE111_FREEZE_CONTRACT ||
    manifest.status !== "package_ready" ||
    manifest.counts?.importable !== ISSUE111_IMPORTABLE_COUNT ||
    manifest.schemas?.["importable-legacy-reviews.jsonl"] !==
      ISSUE111_RECORD_SCHEMA ||
    manifest.lineage?.approvedPackageContract !== ISSUE111_SOURCE_CONTRACT ||
    manifest.lineage?.approvedPackageManifestSha256 !==
      APPROVED_HISTORICAL_MANIFEST_SHA256 ||
    manifest.lineage?.approvedCatalogContentSha256 !==
      APPROVED_CATALOG_CONTENT_SHA256
  )
    throw new HistoricalBatchImportError(
      "历史评价追加冻结包身份或内容哈希不匹配",
    );
  if (
    typeof manifest.contentSha256 === "string" &&
    manifest.contentSha256 !==
      (await digest(
        canonicalJson({
          "importable-legacy-reviews.jsonl":
            manifest.files?.["importable-legacy-reviews.jsonl"],
        }),
      ))
  )
    throw new HistoricalBatchImportError("历史评价追加冻结包 contentSha256 不匹配");

  const artifactDescriptor = manifest.files?.["importable-legacy-reviews.jsonl"];
  const expectedArtifactSha256 =
    configuredArtifactSha256 === "manifest"
      ? artifactDescriptor?.sha256
      : configuredArtifactSha256;
  if (
    typeof body.artifact !== "string" ||
    !body.artifact.endsWith("\n") ||
    artifactDescriptor?.rows !== ISSUE111_IMPORTABLE_COUNT ||
    typeof expectedArtifactSha256 !== "string" ||
    artifactDescriptor.sha256 !== expectedArtifactSha256 ||
    (await digest(body.artifact)) !== expectedArtifactSha256
  )
    throw new HistoricalBatchImportError(
      "历史评价可导入 artifact 哈希或行数不匹配",
    );

  let records: Record<string, unknown>[];
  try {
    records = body.artifact
      .slice(0, -1)
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    throw new HistoricalBatchImportError("历史评价 artifact 不是有效 JSONL");
  }
  if (records.length !== ISSUE111_IMPORTABLE_COUNT)
    throw new HistoricalBatchImportError("历史评价 artifact 行数不匹配");
  if (
    typeof body.offset !== "number" ||
    !Number.isInteger(body.offset) ||
    body.offset < 0 ||
    body.offset >= ISSUE111_IMPORTABLE_COUNT ||
    body.offset % 50 !== 0
  )
    throw new HistoricalBatchImportError("历史评价批次偏移量不合法");

  const selectedRecords = records.slice(body.offset, body.offset + 50);
  const seen = new Set<string>();
  const pending: Array<{
    reviewId: string;
    courseId: number;
    teacherId: number;
    comment: string;
  }> = [];
  let existingCount = 0;
  for (const record of selectedRecords) {
    if (
      !record ||
      Object.keys(record).length !== REQUIRED_FIELDS.size ||
      Object.keys(record).some((field) => !REQUIRED_FIELDS.has(field)) ||
      record.schema_version !== ISSUE111_RECORD_SCHEMA
    )
      throw new HistoricalBatchImportError("历史评价记录不符合批准包固定 schema");

    const reviewId = clean(record.review_id, 200);
    const courseCode = clean(record.catalog_course_code, 100);
    const teacherLabel = clean(record.catalog_teacher_label, 200);
    const comment = clean(record.comment, 4000);
    if (!reviewId || !courseCode || !teacherLabel || !comment)
      throw new HistoricalBatchImportError(
        "历史评价记录缺少稳定身份、目录身份或正文",
      );
    if (seen.has(reviewId))
      throw new HistoricalBatchImportError("历史评价批次包含重复稳定身份");
    seen.add(reviewId);

    const identity = await db
      .prepare(
        `SELECT c.id course_id,t.id teacher_id,
           EXISTS(
             SELECT 1 FROM course_teachers ct
             WHERE ct.course_id=c.id AND ct.teacher_id=t.id
           ) relation_exists
         FROM courses c CROSS JOIN teachers t
         WHERE c.code=? AND t.source_teacher_label=?`,
      )
      .bind(courseCode, teacherLabel)
      .first<{ course_id: number; teacher_id: number; relation_exists: number }>();
    if (!identity || !identity.relation_exists)
      throw new HistoricalBatchImportError(
        "历史评价引用的课程、教师或任课关系不存在",
      );

    const existing = await db
      .prepare(
        "SELECT course_id,teacher_id,comment FROM public_historical_reviews WHERE id=?",
      )
      .bind(reviewId)
      .first<{ course_id: number; teacher_id: number; comment: string }>();
    if (existing) {
      if (
        existing.course_id !== identity.course_id ||
        existing.teacher_id !== identity.teacher_id ||
        existing.comment !== comment
      )
        throw new HistoricalBatchImportError(
          "稳定评价身份已绑定到不同内容",
          409,
        );
      existingCount += 1;
      continue;
    }
    pending.push({
      reviewId,
      courseId: identity.course_id,
      teacherId: identity.teacher_id,
      comment,
    });
  }

  let createdCount = 0;
  if (pending.length) {
    const insertResults = await db.batch(
      pending.map(({ reviewId, courseId, teacherId, comment }) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO public_historical_reviews(
               id,course_id,teacher_id,comment,package_contract,
               approved_package_manifest_sha256,approved_catalog_content_sha256
             ) VALUES(?,?,?,?,?,?,?)`,
          )
          .bind(
            reviewId,
            courseId,
            teacherId,
            comment,
            ISSUE111_FREEZE_CONTRACT,
            APPROVED_HISTORICAL_MANIFEST_SHA256,
            APPROVED_CATALOG_CONTENT_SHA256,
          ),
      ),
    );
    createdCount = insertResults.reduce(
      (total, result) => total + Number(result.meta.changes ?? 0),
      0,
    );
    existingCount += pending.length - createdCount;
  }
  return {
    offset: body.offset,
    total: selectedRecords.length,
    created: createdCount,
    existing: existingCount,
  };
}
