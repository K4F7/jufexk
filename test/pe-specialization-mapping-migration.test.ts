import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

declare const TEST_D1_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];

const takePeMappingMigration = () => {
  const migrations = [...TEST_D1_MIGRATIONS];
  const later = migrations.filter((migration) =>
    migration.name.includes("0057_pe_specialization_queue_closeout.sql"),
  );
  const rest = migrations.filter(
    (migration) =>
      !migration.name.includes("0056_catalog_relation_pe_specializations.sql") &&
      !migration.name.includes("0057_pe_specialization_queue_closeout.sql"),
  );
  const migration = migrations.find((item) =>
    item.name.includes("0056_catalog_relation_pe_specializations.sql"),
  );
  expect(migration?.name).toContain("0056_catalog_relation_pe_specializations.sql");
  expect(later).toHaveLength(1);
  return { migrations: rest, migration: migration! };
};

it("backfills direct PE skill mappings on upgrade and queues umbrella Relations without guessing", async () => {
  const { migrations, migration } = takePeMappingMigration();
  const db = env.PE_MAPPING_MIGRATION_DB;
  await applyD1Migrations(db, migrations, "pe_mapping_upgrade");
  await db.batch([
    db.prepare("INSERT INTO teachers(id,source_teacher_label,name) VALUES(91001,'教师甲','教师甲'),(91002,'黄丽萍','黄丽萍'),(91003,'普通教师','普通教师')"),
    db.prepare("INSERT INTO courses(id,code,name,category) VALUES(91011,'PE-BASKET2','篮球2','sports'),(91012,'PE-AERO','健身教练','sports'),(91013,'PE-WUSHU','武术','sports'),(91014,'PE-1','体育1','sports'),(91015,'GEN-1','高等数学','general')"),
    db.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(91011,91001),(91012,91001),(91013,91001),(91014,91002),(91015,91003)"),
  ]);
  await applyD1Migrations(db, [migration], "pe_mapping_upgrade");

  const mappings = (
    await db.prepare(`
      SELECT c.name course_name, t.source_teacher_label, m.source_kind, m.normalized_specialization, m.display_semantics
      FROM catalog_relation_pe_specializations m
      JOIN courses c ON c.id=m.course_id
      JOIN teachers t ON t.id=m.teacher_id
      ORDER BY c.code
    `).all()
  ).results;
  const queue = (
    await db.prepare(`
      SELECT course_code, source_teacher_label, reason
      FROM catalog_pe_specialization_review_queue
      ORDER BY course_code
    `).all()
  ).results;

  expect(mappings).toEqual([
    { course_name: "健身教练", source_teacher_label: "教师甲", source_kind: "direct_skill", normalized_specialization: "健美操", display_semantics: "keep_source_name" },
    { course_name: "篮球2", source_teacher_label: "教师甲", source_kind: "direct_skill", normalized_specialization: "篮球", display_semantics: "keep_source_name" },
    { course_name: "武术", source_teacher_label: "教师甲", source_kind: "direct_skill", normalized_specialization: "武术", display_semantics: "keep_source_name" },
  ]);
  expect(queue).toEqual([{ course_code: "PE-1", source_teacher_label: "黄丽萍", reason: "umbrella_unmapped" }]);
  expect(await db.prepare("SELECT COUNT(*) n FROM catalog_relation_pe_specializations m JOIN teachers t ON t.id=m.teacher_id WHERE t.source_teacher_label='黄丽萍'").first()).toEqual({ n: 0 });
  expect(await db.prepare("SELECT COUNT(*) n FROM catalog_pe_specialization_review_queue WHERE course_code='GEN-1'").first()).toEqual({ n: 0 });
  expect((await db.prepare("SELECT virtual_course_id,label,teacher_name FROM virtual_pe_notification_courses ORDER BY virtual_course_id").all()).results).toEqual([
    { virtual_course_id: 800001, label: "瑜伽", teacher_name: "黄丽萍" },
    { virtual_course_id: 800002, label: "武术", teacher_name: "刘春来" },
  ]);
});
