import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

declare const TEST_D1_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];

it("upgrades from 0008 without losing referenced seed catalog mappings", async () => {
  const db = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  const through0008 = TEST_D1_MIGRATIONS.filter(
    (migration) =>
      Number.parseInt(migration.name.split("_", 1)[0], 10) <= 8 &&
      !migration.name.startsWith("0008a_"),
  );
  await applyD1Migrations(db, through0008, "upgrade_test_migrations");

  await db.batch([
    db.prepare(
      `INSERT INTO legacy_import_batches(id,source_type,source_label,status,row_count,imported_at)
       VALUES('upgrade-legacy','legacy_ocr','腾讯表格历史资料','imported',1,CURRENT_TIMESTAMP)`,
    ),
    db.prepare(
      `INSERT INTO legacy_reviews(
        import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,
        course_id,teacher_id,offering_id,category,comment,status
      ) VALUES('upgrade-legacy','seed.png','主要课程','1','原文',.99,1,1,1,'major','待审历史文字','pending')`,
    ),
    db.prepare(
      `INSERT INTO catalog_requests(
        kind,course_code,course_name,category,teacher_name,department,status,
        created_course_id,created_teacher_id
      ) VALUES('course','PE012','羽毛球','pe','林老师','计算机学院','approved',2,1)`,
    ),
  ]);

  await applyD1Migrations(
    db,
    TEST_D1_MIGRATIONS,
    "upgrade_test_migrations",
  );

  expect(
    await db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM courses WHERE id IN(1,2)) courses,
        (SELECT COUNT(*) FROM teachers WHERE id=1) teachers,
        (SELECT COUNT(*) FROM course_teachers WHERE course_id=1 AND teacher_id=1) relations,
        (SELECT COUNT(*) FROM offerings WHERE id=1 AND course_id=1) offerings`,
    ).first(),
  ).toEqual({ courses: 2, teachers: 1, relations: 1, offerings: 1 });
  expect(
    await db.prepare(
      "SELECT course_id,teacher_id,offering_id FROM legacy_reviews WHERE import_batch_id='upgrade-legacy'",
    ).first(),
  ).toEqual({ course_id: 1, teacher_id: 1, offering_id: 1 });
  expect(
    await db.prepare(
      "SELECT created_course_id,created_teacher_id FROM catalog_requests WHERE course_code='PE012'",
    ).first(),
  ).toEqual({ created_course_id: 2, created_teacher_id: 1 });
});
