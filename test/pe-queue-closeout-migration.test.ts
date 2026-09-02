import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

declare const TEST_D1_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];

it("adds disposition columns, freezes live enqueue, and does not insert new queue rows", async () => {
  const migrations = [...TEST_D1_MIGRATIONS];
  const later = migrations.filter((migration) =>
    migration.name.includes("0058_pe_direct_skill_family_backfill.sql"),
  );
  const index = migrations.findIndex((migration) =>
    migration.name.includes("0057_pe_specialization_queue_closeout.sql"),
  );
  const [migration] = migrations.splice(index, 1);
  for (const extra of later) {
    const extraIndex = migrations.findIndex((item) => item.name === extra.name);
    if (extraIndex >= 0) migrations.splice(extraIndex, 1);
  }
  expect(migration?.name).toContain("0057_pe_specialization_queue_closeout.sql");
  const db = (env as unknown as { PE_QUEUE_CLOSEOUT_MIGRATION_DB: D1Database })
    .PE_QUEUE_CLOSEOUT_MIGRATION_DB;
  await applyD1Migrations(db, migrations, "pe_queue_closeout_upgrade");
  await db.batch([
    db.prepare(
      "INSERT INTO teachers(id,source_teacher_label,name) VALUES(92001,'黄丽萍','黄丽萍')",
    ),
    db.prepare(
      "INSERT INTO courses(id,code,name,category) VALUES(92011,'PE-1','体育1','sports')",
    ),
    db.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(92011,92001)"),
    db.prepare(
      `INSERT INTO catalog_pe_specialization_review_queue(
         course_id,teacher_id,course_code,course_name,source_teacher_label,reason,evidence_json
       ) VALUES(
         92011,92001,'PE-1','体育1','黄丽萍','umbrella_unmapped',
         '{"sourceCourseCode":"PE-1","sourceCourseName":"体育1","sourceTeacherLabel":"黄丽萍","sourceKind":"umbrella"}'
       )`,
    ),
  ]);
  await applyD1Migrations(db, [migration], "pe_queue_closeout_upgrade");

  const queue = await db
    .prepare(
      "SELECT course_code,disposition,disposition_reason FROM catalog_pe_specialization_review_queue WHERE course_code='PE-1'",
    )
    .first();
  expect(queue).toEqual({
    course_code: "PE-1",
    disposition: null,
    disposition_reason: "",
  });
  expect(
    await db
      .prepare(
        "SELECT live_enqueue_enabled,freeze_reason FROM catalog_pe_specialization_queue_state WHERE singleton=1",
      )
      .first(),
  ).toMatchObject({
    live_enqueue_enabled: 0,
    freeze_reason: expect.stringContaining("#852"),
  });
  expect(
    (
      await db
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type='trigger' AND name IN (
             'public_precompute_dirty_catalog_relation_pe_specializations_delete',
             'public_precompute_dirty_catalog_relation_pe_specializations_insert',
             'public_precompute_dirty_catalog_relation_pe_specializations_update'
           )
           ORDER BY name`,
        )
        .all<{ name: string }>()
    ).results,
  ).toEqual([
    { name: "public_precompute_dirty_catalog_relation_pe_specializations_delete" },
    { name: "public_precompute_dirty_catalog_relation_pe_specializations_insert" },
    { name: "public_precompute_dirty_catalog_relation_pe_specializations_update" },
  ]);
});
