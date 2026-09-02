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
  const databases = [env.BASELINE_PUBLISH_DB_1, env.BASELINE_PUBLISH_DB_2, env.BASELINE_PUBLISH_DB_3, env.BASELINE_PUBLISH_DB_4, env.BASELINE_PUBLISH_DB_5, env.BASELINE_PUBLISH_DB_6, env.BASELINE_PUBLISH_DB_7, env.BASELINE_PUBLISH_DB_8, env.BASELINE_PUBLISH_DB_9, env.BASELINE_PUBLISH_DB_10];
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

describe("catalog baseline staging and one-time publish", { timeout: 15_000 }, () => {
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

  it("publishes explicit PE mappings, distinguishes umbrella vs direct-name semantics, and does not enqueue unmapped umbrellas after queue freeze", async () => {
    const db = await emptyDb();
    const records = [
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "course", value: { schemaVersion: "catalog-baseline-course/v1", courseCode: "PE-BASKET2", currentName: "篮球2", normalizedCurrentName: "篮球2", category: "sports", sourceCategoryTexts: ["体育课"], nameVariants: [{ rawName: "篮球2", normalizedName: "篮球2", firstSemester: "2026-1", lastSemester: "2026-1", occurrences: 1 }] } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "course", value: { schemaVersion: "catalog-baseline-course/v1", courseCode: "PE-BASKET-TH", currentName: "篮球专项理论与实践1", normalizedCurrentName: "篮球专项理论与实践1", category: "sports", sourceCategoryTexts: ["体育课"], nameVariants: [{ rawName: "篮球专项理论与实践1", normalizedName: "篮球专项理论与实践1", firstSemester: "2026-1", lastSemester: "2026-1", occurrences: 1 }] } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "course", value: { schemaVersion: "catalog-baseline-course/v1", courseCode: "PE-WUSHU", currentName: "武术", normalizedCurrentName: "武术", category: "sports", sourceCategoryTexts: ["体育课"], nameVariants: [{ rawName: "武术", normalizedName: "武术", firstSemester: "2026-1", lastSemester: "2026-1", occurrences: 1 }] } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "course", value: { schemaVersion: "catalog-baseline-course/v1", courseCode: "PE-1", currentName: "体育1", normalizedCurrentName: "体育1", category: "sports", sourceCategoryTexts: ["体育课"], nameVariants: [{ rawName: "体育1", normalizedName: "体育1", firstSemester: "2026-1", lastSemester: "2026-1", occurrences: 1 }] } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "course", value: { schemaVersion: "catalog-baseline-course/v1", courseCode: "PE-2", currentName: "体育2", normalizedCurrentName: "体育2", category: "sports", sourceCategoryTexts: ["体育课"], nameVariants: [{ rawName: "体育2", normalizedName: "体育2", firstSemester: "2026-1", lastSemester: "2026-1", occurrences: 1 }] } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "teacher", value: { schemaVersion: "catalog-baseline-teacher/v1", sourceTeacherLabel: "教师甲", normalizedTeacherLabel: "教师甲" } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "teacher", value: { schemaVersion: "catalog-baseline-teacher/v1", sourceTeacherLabel: "刘春来", normalizedTeacherLabel: "刘春来" } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "teacher", value: { schemaVersion: "catalog-baseline-teacher/v1", sourceTeacherLabel: "黄丽萍", normalizedTeacherLabel: "黄丽萍" } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "relation", value: { schemaVersion: "catalog-baseline-relation/v3", courseCode: "PE-BASKET2", sourceTeacherLabel: "教师甲", provenance, peSpecialization: { sourceKind: "direct_skill", normalizedSpecialization: "篮球", displaySemantics: "keep_source_name", evidence: { kind: "catalog_course_name", sourceCourseCode: "PE-BASKET2", sourceCourseName: "篮球2", sourceTeacherLabel: "教师甲", rawSpecializationName: "篮球2" } } } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "relation", value: { schemaVersion: "catalog-baseline-relation/v3", courseCode: "PE-BASKET-TH", sourceTeacherLabel: "教师甲", provenance, peSpecialization: { sourceKind: "direct_skill", normalizedSpecialization: "篮球", displaySemantics: "keep_source_name", evidence: { kind: "catalog_course_name", sourceCourseCode: "PE-BASKET-TH", sourceCourseName: "篮球专项理论与实践1", sourceTeacherLabel: "教师甲", rawSpecializationName: "篮球专项理论与实践1" } } } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "relation", value: { schemaVersion: "catalog-baseline-relation/v3", courseCode: "PE-WUSHU", sourceTeacherLabel: "刘春来", provenance, peSpecialization: { sourceKind: "direct_skill", normalizedSpecialization: "武术", displaySemantics: "keep_source_name", evidence: { kind: "catalog_course_name", sourceCourseCode: "PE-WUSHU", sourceCourseName: "武术", sourceTeacherLabel: "刘春来", rawSpecializationName: "武术" } } } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "relation", value: { schemaVersion: "catalog-baseline-relation/v3", courseCode: "PE-1", sourceTeacherLabel: "黄丽萍", provenance, peSpecialization: { sourceKind: "umbrella", normalizedSpecialization: "瑜伽", displaySemantics: "umbrella_prefixed", evidence: { kind: "human_decision", sourceCourseCode: "PE-1", sourceCourseName: "体育1", sourceTeacherLabel: "黄丽萍", rawSpecializationName: "瑜伽" } } } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "relation", value: { schemaVersion: "catalog-baseline-relation/v3", courseCode: "PE-2", sourceTeacherLabel: "黄丽萍", provenance, peSpecialization: null } },
    ];
    const invalid = records.map((item) => JSON.stringify(item)).join("\n") + "\n";
    const bad = invalid.replace('"displaySemantics":"umbrella_prefixed"', '"displaySemantics":"keep_source_name"');
    const artifact = invalid;
    const content = {
      schemaVersion: "catalog-baseline-approved-manifest/v1", status: "package_ready",
      sourceCaptureManifestContentSha256: "a".repeat(64), derivationContentSha256: "b".repeat(64), qualityManifestContentSha256: "c".repeat(64), decisionsSha256: "d".repeat(64), boundaryFixtureContentSha256: "e".repeat(64),
      counts: { courses: 5, teachers: 3, relations: 5, totalRecords: 13 },
      artifact: { path: "catalog-baseline.jsonl", records: 13, bytes: Buffer.byteLength(artifact), sha256: sha(artifact) },
    };
    const batchId = "pe-mapping-fresh";
    await createBaselineUpload(db, { batchId, manifest: { ...content, contentSha256: sha(stable(content)) }, chunkCount: 1 });
    await expect(putBaselineChunk(db, batchId, 0, { chunkId: "bad-pe", records: 13, bytes: Buffer.byteLength(bad), sha256: sha(bad), content: bad })).rejects.toMatchObject({ status: 422 });
    await uploadChunk(db, batchId, 0, artifact);
    await finalizeBaselineUpload(db, batchId);
    await publishBaselineUpload(db, batchId);

    const mappings = (await db.prepare(`
      SELECT c.code course_code, t.source_teacher_label, m.source_kind, m.normalized_specialization, m.display_semantics
      FROM catalog_relation_pe_specializations m
      JOIN courses c ON c.id=m.course_id
      JOIN teachers t ON t.id=m.teacher_id
      ORDER BY c.code, t.source_teacher_label
    `).all()).results;
    const queue = (await db.prepare(`
      SELECT course_code, source_teacher_label, reason FROM catalog_pe_specialization_review_queue ORDER BY course_code
    `).all()).results;
    expect(mappings).toEqual([
      { course_code: "PE-1", source_teacher_label: "黄丽萍", source_kind: "umbrella", normalized_specialization: "瑜伽", display_semantics: "umbrella_prefixed" },
      { course_code: "PE-BASKET-TH", source_teacher_label: "教师甲", source_kind: "direct_skill", normalized_specialization: "篮球", display_semantics: "keep_source_name" },
      { course_code: "PE-BASKET2", source_teacher_label: "教师甲", source_kind: "direct_skill", normalized_specialization: "篮球", display_semantics: "keep_source_name" },
      { course_code: "PE-WUSHU", source_teacher_label: "刘春来", source_kind: "direct_skill", normalized_specialization: "武术", display_semantics: "keep_source_name" },
    ]);
    expect(queue).toEqual([]);
    expect(await db.prepare("SELECT COUNT(*) n FROM catalog_relation_pe_specializations WHERE normalized_specialization='瑜伽' AND source_kind='direct_skill'").first()).toEqual({ n: 0 });
    expect((await db.prepare("SELECT virtual_course_id FROM virtual_pe_notification_courses ORDER BY virtual_course_id").all()).results).toEqual([{ virtual_course_id: 800001 }, { virtual_course_id: 800002 }]);
  });

  it("still loads v2 packages, backfills direct skill names, and does not enqueue unmapped umbrellas after queue freeze", async () => {
    const db = await emptyDb();
    const records = [
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "course", value: { schemaVersion: "catalog-baseline-course/v1", courseCode: "PE-BASKET2", currentName: "篮球2", normalizedCurrentName: "篮球2", category: "sports", sourceCategoryTexts: ["体育课"], nameVariants: [{ rawName: "篮球2", normalizedName: "篮球2", firstSemester: "2026-1", lastSemester: "2026-1", occurrences: 1 }] } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "course", value: { schemaVersion: "catalog-baseline-course/v1", courseCode: "PE-AERO", currentName: "健身教练", normalizedCurrentName: "健身教练", category: "sports", sourceCategoryTexts: ["体育课"], nameVariants: [{ rawName: "健身教练", normalizedName: "健身教练", firstSemester: "2026-1", lastSemester: "2026-1", occurrences: 1 }] } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "course", value: { schemaVersion: "catalog-baseline-course/v1", courseCode: "PE-1", currentName: "体育1", normalizedCurrentName: "体育1", category: "sports", sourceCategoryTexts: ["体育课"], nameVariants: [{ rawName: "体育1", normalizedName: "体育1", firstSemester: "2026-1", lastSemester: "2026-1", occurrences: 1 }] } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "teacher", value: { schemaVersion: "catalog-baseline-teacher/v1", sourceTeacherLabel: "教师甲", normalizedTeacherLabel: "教师甲" } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "teacher", value: { schemaVersion: "catalog-baseline-teacher/v1", sourceTeacherLabel: "黄丽萍", normalizedTeacherLabel: "黄丽萍" } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "relation", value: { schemaVersion: "catalog-baseline-relation/v2", courseCode: "PE-BASKET2", sourceTeacherLabel: "教师甲", provenance } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "relation", value: { schemaVersion: "catalog-baseline-relation/v2", courseCode: "PE-AERO", sourceTeacherLabel: "教师甲", provenance } },
      { schemaVersion: "catalog-baseline-approved-record/v1", recordType: "relation", value: { schemaVersion: "catalog-baseline-relation/v2", courseCode: "PE-1", sourceTeacherLabel: "黄丽萍", provenance } },
    ];
    const artifact = records.map((item) => JSON.stringify(item)).join("\n") + "\n";
    const content = {
      schemaVersion: "catalog-baseline-approved-manifest/v1", status: "package_ready",
      sourceCaptureManifestContentSha256: "a".repeat(64), derivationContentSha256: "b".repeat(64), qualityManifestContentSha256: "c".repeat(64), decisionsSha256: "d".repeat(64), boundaryFixtureContentSha256: "e".repeat(64),
      counts: { courses: 3, teachers: 2, relations: 3, totalRecords: 8 },
      artifact: { path: "catalog-baseline.jsonl", records: 8, bytes: Buffer.byteLength(artifact), sha256: sha(artifact) },
    };
    const batchId = "pe-mapping-v2";
    await createBaselineUpload(db, { batchId, manifest: { ...content, contentSha256: sha(stable(content)) }, chunkCount: 1 });
    await uploadChunk(db, batchId, 0, artifact);
    await finalizeBaselineUpload(db, batchId);
    await publishBaselineUpload(db, batchId);
    const mappings = (await db.prepare(`
      SELECT c.name course_name, m.normalized_specialization, m.source_kind, m.display_semantics
      FROM catalog_relation_pe_specializations m JOIN courses c ON c.id=m.course_id ORDER BY c.code
    `).all()).results;
    const queue = (await db.prepare("SELECT course_code, source_teacher_label FROM catalog_pe_specialization_review_queue").all()).results;
    expect(mappings).toEqual([
      { course_name: "健身教练", normalized_specialization: "健美操", source_kind: "direct_skill", display_semantics: "keep_source_name" },
      { course_name: "篮球2", normalized_specialization: "篮球", source_kind: "direct_skill", display_semantics: "keep_source_name" },
    ]);
    expect(queue).toEqual([]);
    expect(await db.prepare("SELECT COUNT(*) n FROM catalog_relation_pe_specializations m JOIN teachers t ON t.id=m.teacher_id WHERE t.source_teacher_label='黄丽萍'").first()).toEqual({ n: 0 });
  });
});
