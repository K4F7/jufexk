import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { looksLikeForbidden } from "../../src/lib/jwxt-offering";
import type {
  JwxtSyncMode,
  JwxtSyncStagedRow,
} from "../../src/jwxt-sync-publication";

const sourceOfferingSchema = z.object({
  courseCode: z.string(),
  courseName: z.string(),
  section: z.string().default(""),
  teacherName: z.string(),
  termId: z.string(),
  campus: z.string().default(""),
  weekText: z.string().default(""),
  timeText: z.string().default(""),
  place: z.string().default(""),
});

const captureSchema = z.object({
  capturedAt: z.string().datetime(),
  complete: z.boolean(),
  offerings: z.array(sourceOfferingSchema),
});

export type JwxtSyncManifest = {
  schemaVersion: 1;
  generationId: string;
  mode: JwxtSyncMode;
  complete: boolean;
  capturedAt: string;
  rowCount: number;
  contentSha256: string;
  compressedSha256: string;
};

export type JwxtSyncBundle = {
  manifest: JwxtSyncManifest;
  compressedRows: Buffer;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function rowFromSource(source: z.infer<typeof sourceOfferingSchema>): JwxtSyncStagedRow {
  const publicFields = {
    courseCode: clean(source.courseCode),
    courseName: clean(source.courseName),
    teacherSourceLabel: clean(source.teacherName),
    termId: clean(source.termId),
    campus: clean(source.campus),
    weekText: clean(source.weekText),
    timeText: clean(source.timeText),
    place: clean(source.place),
    classNumber: clean(source.section),
  };
  if (
    !publicFields.courseCode ||
    !publicFields.courseName ||
    !publicFields.teacherSourceLabel ||
    !publicFields.termId
  ) {
    throw new Error("教务开课班缺少课程、教师或学期身份");
  }
  if (looksLikeForbidden(Object.values(publicFields).join(" "))) {
    throw new Error("教务开课班包含敏感字段，已拒绝打包");
  }
  const sourceKey = sha256(
    JSON.stringify([
      publicFields.termId,
      publicFields.courseCode,
      publicFields.classNumber || [
        publicFields.campus,
        publicFields.weekText,
        publicFields.timeText,
        publicFields.place,
      ].join("|"),
      publicFields.teacherSourceLabel,
    ]),
  );
  return {
    sourceKey,
    sourceRowSha256: sha256(JSON.stringify(publicFields)),
    ...publicFields,
  };
}

export function buildJwxtSyncBundle(source: unknown, mode: JwxtSyncMode): JwxtSyncBundle {
  const capture = captureSchema.parse(source);
  const rows = capture.offerings
    .map(rowFromSource)
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  if (new Set(rows.map((row) => row.sourceKey)).size !== rows.length) {
    throw new Error("教务开课班存在重复来源身份");
  }
  const ndjson = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  const contentSha256 = sha256(ndjson);
  const generationHash = sha256(JSON.stringify({ mode, complete: capture.complete, contentSha256 }));
  const compressedRows = gzipSync(Buffer.from(ndjson, "utf8"), { level: 9 });
  return {
    manifest: {
      schemaVersion: 1,
      generationId: `jwxt-${generationHash.slice(0, 24)}`,
      mode,
      complete: capture.complete,
      capturedAt: capture.capturedAt,
      rowCount: rows.length,
      contentSha256,
      compressedSha256: sha256(compressedRows),
    },
    compressedRows,
  };
}

export function validateJwxtSyncBundle(
  manifest: JwxtSyncManifest,
  compressedRows: Uint8Array,
): JwxtSyncStagedRow[] {
  if (manifest.schemaVersion !== 1) throw new Error("不支持的 JWXT 同步包版本");
  if (sha256(compressedRows) !== manifest.compressedSha256) {
    throw new Error("JWXT 同步压缩包校验失败");
  }
  const ndjson = gunzipSync(compressedRows).toString("utf8");
  if (sha256(ndjson) !== manifest.contentSha256) {
    throw new Error("JWXT 同步内容校验失败");
  }
  if (/capacity|selected|available/i.test(ndjson) || looksLikeForbidden(ndjson)) {
    throw new Error("JWXT 同步包包含禁止字段");
  }
  const rows = ndjson
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JwxtSyncStagedRow);
  if (rows.length !== manifest.rowCount) throw new Error("JWXT 同步包行数校验失败");
  return rows;
}
