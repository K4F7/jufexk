import { createHash } from "node:crypto";
import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  BaselineImportError,
  baselineUploadStatus,
  createBaselineUpload,
  finalizeBaselineUpload,
  previewBaselineUpload,
  publishBaselineUpload,
  putBaselineChunk,
} from "../src/catalog-baseline-import";

declare const TEST_D1_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
function sha(value: string) { return createHash("sha256").update(value).digest("hex") }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
const provenance = [{ queryId: "q-1", page: 1, row: 2, semester: "2026-1", educationLevel: "undergraduate", grade: "2025" }];
function approvedPackage() {
  const records = [
    { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "course", value: { schemaVersion: "catalog-baseline-course/v1", courseCode: "C-1", currentName: "新课程名", normalizedCurrentName: "新课程名", category: "general", sourceCategoryTexts: ["必修课", "选修课"], nameVariants: [{ rawName: "旧课程名", normalizedName: "旧课程名", firstSemester: "2025-1", lastSemester: "2025-2", occurrences: 2 }] } },
    { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "teacher", value: { schemaVersion: "catalog-baseline-teacher/v1", sourceTeacherLabel: "张三1", normalizedTeacherLabel: "张三1" } },
    { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "relation", value: { schemaVersion: "catalog-baseline-relation/v2", courseCode: "C-1", sourceTeacherLabel: "张三1", provenance } },
  ];
  const chunks = [records.slice(0, 2), records.slice(2)].map((items) => items.map((item) => JSON.stringify(item)).join("\n") + "\n");
  const artifact = chunks.join("");
  const content = {
    schemaVersion: "catalog-baseline-approved-manifest/v1", status: "package_ready",
    sourceCaptureManifestContentSha256: "a".repeat(64), derivationContentSha256: "b".repeat(64), qualityManifestContentSha256: "c".repeat(64), decisionsSha256: "d".repeat(64), boundaryFixtureContentSha256: "e".repeat(64),
    counts: { courses: 1, teachers: 1, relations: 1, totalRecords: 3 },
    artifact: { path: "catalog-baseline.jsonl", records: 3, bytes: Buffer.byteLength(artifact), sha256: sha(artifact) },
  };
  return { manifest: { ...content, contentSha256: sha(stable(content)) }, chunks };
}
let databaseSequence = 0;
async function emptyDb() {
  const databases = [env.BASELINE_PUBLISH_DB_1, env.BASELINE_PUBLISH_DB_2, env.BASELINE_PUBLISH_DB_3, env.BASELINE_PUBLISH_DB_4, env.BASELINE_PUBLISH_DB_5, env.BASELINE_PUBLISH_DB_6, env.BASELINE_PUBLISH_DB_7, env.BASELINE_PUBLISH_DB_8];
  const db = databases[databaseSequence++];
  if (!db) throw new Error("baseline publish test database pool exhausted");
  await applyD1Migrations(db, TEST_D1_MIGRATIONS);
  return db;
}
async function uploadChunk(db: D1Database, batchId: string, index: number, content: string) {
  return putBaselineChunk(db, batchId, index, { chunkId: `part-${index}`, records: content.trim().split("\n").length, bytes: Buffer.byteLength(content), sha256: sha(content), content });
}
async function stagedDb(batchId = "baseline-1") {
  const db = await emptyDb(), pkg = approvedPackage();
  await createBaselineUpload(db, { batchId, manifest: pkg.manifest, chunkCount: 2 });
  await uploadChunk(db, batchId, 0, pkg.chunks[0]);
  await uploadChunk(db, batchId, 1, pkg.chunks[1]);
  await finalizeBaselineUpload(db, batchId);
  return { db, pkg, batchId };
}
async function formalCounts(db: D1Database) {
  const results = await db.batch([db.prepare("SELECT COUNT(*) n FROM courses"), db.prepare("SELECT COUNT(*) n FROM teachers"), db.prepare("SELECT COUNT(*) n FROM course_teachers"), db.prepare("SELECT COUNT(*) n FROM catalog_baseline_marker")]);
  return results.map((result) => Number((result.results[0] as { n: number }).n));
}

describe("catalog baseline staging and one-time publish", () => {
  it("resumes missing chunks, accepts an identical retransmission, and keeps formal tables isolated", async () => {
    const db = await emptyDb(), pkg = approvedPackage(), batchId = "resume-1";
    await createBaselineUpload(db, { batchId, manifest: pkg.manifest, chunkCount: 2 });
    expect(await uploadChunk(db, batchId, 1, pkg.chunks[1])).toMatchObject({ idempotent: false });
    expect(await uploadChunk(db, batchId, 1, pkg.chunks[1])).toMatchObject({ idempotent: true });
    expect(await baselineUploadStatus(db, batchId)).toMatchObject({ missingChunks: [0] });
    await expect(finalizeBaselineUpload(db, batchId)).rejects.toMatchObject({ status: 422 });
    expect(await db.prepare("SELECT COUNT(*) n FROM catalog_baseline_finalize_locks").first()).toEqual({ n: 0 });
    expect(await formalCounts(db)).toEqual([0, 0, 0, 0]);
    await db.prepare("INSERT INTO catalog_baseline_finalize_locks(batch_id) VALUES(?)").bind(batchId).run();
    await expect(uploadChunk(db, batchId, 0, pkg.chunks[0])).rejects.toMatchObject({ status: 409 });
    expect(await baselineUploadStatus(db, batchId)).toMatchObject({ missingChunks: [0] });
    await db.prepare("DELETE FROM catalog_baseline_finalize_locks WHERE batch_id=?").bind(batchId).run();
    await uploadChunk(db, batchId, 0, pkg.chunks[0]);
    expect(await finalizeBaselineUpload(db, batchId)).toMatchObject({ status: "staged", missingChunks: [] });
    expect(await formalCounts(db)).toEqual([0, 0, 0, 0]);
    const preview = await previewBaselineUpload(db, batchId, "relations", 1, 10);
    expect(preview).toMatchObject({ total: 1, items: [{ courseCode: "C-1", sourceTeacherLabel: "张三1", provenance }] });
  });

  it("blocks corrupted metadata, duplicate identities, and a re-signed wrong whole-package order", async () => {
    const db = await emptyDb(), pkg = approvedPackage(), batchId = "tamper-1";
    await createBaselineUpload(db, { batchId, manifest: pkg.manifest, chunkCount: 2 });
    await expect(putBaselineChunk(db, batchId, 0, { chunkId: "bad", records: 2, bytes: 1, sha256: "0".repeat(64), content: pkg.chunks[0] })).rejects.toMatchObject({ status: 422 });
    const obsolete = pkg.chunks[0].replace('"category":"general"', '"category":"required"');
    await expect(putBaselineChunk(db, batchId, 0, { chunkId: "obsolete", records: 2, bytes: Buffer.byteLength(obsolete), sha256: sha(obsolete), content: obsolete })).rejects.toMatchObject({ status: 422 });
    await uploadChunk(db, batchId, 0, pkg.chunks[1]);
    await uploadChunk(db, batchId, 1, pkg.chunks[0]);
    await expect(finalizeBaselineUpload(db, batchId)).rejects.toMatchObject({ status: 422 });
    expect(await formalCounts(db)).toEqual([0, 0, 0, 0]);
  });

  it("rejects an approved package containing 班会", async () => {
    const db = await emptyDb(), pkg = approvedPackage(), batchId = "excluded-course-1";
    await createBaselineUpload(db, { batchId, manifest: pkg.manifest, chunkCount: 2 });
    const excluded = pkg.chunks[0].replaceAll("新课程名", "班会");
    await expect(putBaselineChunk(db, batchId, 0, {
      chunkId: "excluded",
      records: 2,
      bytes: Buffer.byteLength(excluded),
      sha256: sha(excluded),
      content: excluded,
    })).rejects.toMatchObject({ status: 422 });
  });

  it("publishes Course, name variants, Teacher, Relation, provenance, and marker atomically", async () => {
    const { db, batchId } = await stagedDb("publish-1");
    const marker = await publishBaselineUpload(db, batchId);
    expect(marker).toMatchObject({ batch_id: batchId, courses: 1, teachers: 1, relations: 1 });
    expect(await formalCounts(db)).toEqual([1, 1, 1, 1]);
    expect(await db.prepare("SELECT code,name,category FROM courses").first()).toEqual({ code: "C-1", name: "新课程名", category: "general" });
    expect((await db.prepare("SELECT name FROM course_name_variants ORDER BY name").all()).results).toEqual([{ name: "新课程名" }, { name: "旧课程名" }]);
    expect(await db.prepare("SELECT source_teacher_label,name,department FROM teachers").first()).toEqual({ source_teacher_label: "张三1", name: "张三1", department: null });
    expect(await db.prepare("SELECT query_id,page,row_number,semester,education_level,grade FROM catalog_relation_provenance").first()).toEqual({ query_id: "q-1", page: 1, row_number: 2, semester: "2026-1", education_level: "undergraduate", grade: "2025" });
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    await expect(createBaselineUpload(db, { batchId: "another", manifest: approvedPackage().manifest, chunkCount: 2 })).rejects.toMatchObject({ status: 409 });
    await expect(publishBaselineUpload(db, batchId)).rejects.toMatchObject({ status: 409 });
  });

  it("rolls back marker and every formal table when marker, Course, Teacher, or Relation insertion fails", async () => {
    const { db, batchId } = await stagedDb("rollback-1");
    for (const [name, table] of [["marker", "catalog_baseline_marker"], ["course", "courses"], ["teacher", "teachers"], ["relation", "course_teachers"]] as const) {
      await db.exec(`CREATE TRIGGER fail_baseline_${name} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected ${name} failure'); END`);
      await expect(publishBaselineUpload(db, batchId)).rejects.toThrow();
      expect(await formalCounts(db)).toEqual([0, 0, 0, 0]);
      expect(await baselineUploadStatus(db, batchId)).toMatchObject({ status: "staged" });
      await db.exec(`DROP TRIGGER fail_baseline_${name}`);
    }
  });

  it("carries forward an exact identity subset without changing referenced IDs", async () => {
    const { db, batchId } = await stagedDb("carry-forward-1");
    const course = await db.prepare("INSERT INTO courses(code,name,category) VALUES('C-1','生产旧名称','sports') RETURNING id").first<{ id: number }>();
    const teacher = await db.prepare("INSERT INTO teachers(source_teacher_label,name,department) VALUES('张三1','生产旧显示名','既有院系') RETURNING id").first<{ id: number }>();
    await db.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,?)").bind(course!.id, teacher!.id).run();
    const offering = await db.prepare("INSERT INTO offerings(course_id,term,section) VALUES(?,'2026-1','01') RETURNING id").bind(course!.id).first<{ id: number }>();
    await db.prepare("INSERT INTO offering_teachers(offering_id,teacher_id) VALUES(?,?)").bind(offering!.id, teacher!.id).run();
    await db.prepare("INSERT INTO reviews(course_id,teacher_id,category,overall,offering_id) VALUES(?,?,'sports',5,?)").bind(course!.id, teacher!.id, offering!.id).run();

    await expect(publishBaselineUpload(db, batchId)).resolves.toMatchObject({ batch_id: batchId });
    expect(await formalCounts(db)).toEqual([1, 1, 1, 1]);
    expect(await db.prepare("SELECT id,name,category FROM courses WHERE code='C-1'").first()).toEqual({ id: course!.id, name: "新课程名", category: "general" });
    expect(await db.prepare("SELECT id,name,department FROM teachers WHERE source_teacher_label='张三1'").first()).toEqual({ id: teacher!.id, name: "张三1", department: "既有院系" });
    expect(await db.prepare("SELECT course_id,teacher_id,offering_id FROM reviews").first()).toEqual({ course_id: course!.id, teacher_id: teacher!.id, offering_id: offering!.id });
    expect((await db.prepare("SELECT name FROM course_name_variants ORDER BY name").all()).results).toEqual([{ name: "新课程名" }, { name: "旧课程名" }, { name: "生产旧名称" }]);
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });

  it("rejects identities outside the package and makes concurrent publish single-winner", async () => {
    const { db, batchId } = await stagedDb("non-subset-1");
    await db.prepare("INSERT INTO courses(code,name,category) VALUES('EXISTING','existing','general')").run();
    await expect(publishBaselineUpload(db, batchId)).rejects.toMatchObject({ status: 409 });
    expect(await formalCounts(db)).toEqual([1, 0, 0, 0]);

    const concurrent = await stagedDb("concurrent-1");
    const outcomes = await Promise.allSettled([publishBaselineUpload(concurrent.db, concurrent.batchId), publishBaselineUpload(concurrent.db, concurrent.batchId)]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await formalCounts(concurrent.db)).toEqual([1, 1, 1, 1]);
  });
});
