import { env } from "cloudflare:test";
import { expect, it } from "vitest";

const sourceTables = [
  "courses",
  "course_name_variants",
  "teachers",
  "course_teachers",
  "reviews",
  "legacy_reviews",
  "public_historical_reviews",
  "offerings",
  "offering_teachers",
] as const;

const triggerNames = sourceTables
  .flatMap((table) =>
    ["insert", "update", "delete"].map(
      (operation) => `public_precompute_dirty_${table}_${operation}`,
    ),
  )
  .sort();

async function expectWriteToMarkDirty(
  label: string,
  statement: D1PreparedStatement,
) {
  const before = await env.DB.prepare(
    "SELECT generation FROM public_precompute_state WHERE id=1",
  ).first<{ generation: number }>();
  await env.DB.prepare(
    `UPDATE public_precompute_state
     SET dirty=0,refresh_token='stale-refresh',refresh_lease_until=unixepoch()+60
     WHERE id=1`,
  ).run();
  await statement.run();
  const state = await env.DB.prepare(
    `SELECT dirty,generation,refresh_token,refresh_lease_until
     FROM public_precompute_state WHERE id=1`,
  ).first<{
    dirty: number;
    generation: number;
    refresh_token: string | null;
    refresh_lease_until: number | null;
  }>();
  expect(state?.dirty, label).toBe(1);
  expect(state?.generation, label).toBeGreaterThan(before?.generation ?? -1);
  expect(state?.refresh_token, label).toBeNull();
  expect(state?.refresh_lease_until, label).toBeNull();
}

it("marks public projections dirty for raw source-table inserts, updates and deletes", async () => {
  const installed = await env.DB.prepare(
    `SELECT name FROM sqlite_schema
     WHERE type='trigger' AND name LIKE 'public_precompute_dirty_%'
     ORDER BY name`,
  ).all<{ name: string }>();
  expect(installed.results.map((row) => row.name)).toEqual(triggerNames);

  try {
    await expectWriteToMarkDirty(
      "courses INSERT",
      env.DB.prepare(
        `INSERT INTO courses(id,code,name,category,department)
         VALUES(355001,'TRIGGER355C','触发器课程','general','触发器学院')`,
      ),
    );
    await expectWriteToMarkDirty(
      "courses UPDATE",
      env.DB.prepare(
        "UPDATE courses SET department='触发器学院二' WHERE id=355001",
      ),
    );
    await expectWriteToMarkDirty(
      "courses DELETE",
      env.DB.prepare("DELETE FROM courses WHERE id=355001"),
    );

    await expectWriteToMarkDirty(
      "course_name_variants INSERT",
      env.DB.prepare(
        "INSERT INTO course_name_variants(course_id,name) VALUES(1,'触发器课名甲')",
      ),
    );
    await expectWriteToMarkDirty(
      "course_name_variants UPDATE",
      env.DB.prepare(
        "UPDATE course_name_variants SET name='触发器课名乙' WHERE course_id=1 AND name='触发器课名甲'",
      ),
    );
    await expectWriteToMarkDirty(
      "course_name_variants DELETE",
      env.DB.prepare(
        "DELETE FROM course_name_variants WHERE course_id=1 AND name='触发器课名乙'",
      ),
    );

    await expectWriteToMarkDirty(
      "teachers INSERT",
      env.DB.prepare(
        `INSERT INTO teachers(id,source_teacher_label,name,department)
         VALUES(355002,'触发器教师','触发器教师','触发器学院')`,
      ),
    );
    await expectWriteToMarkDirty(
      "teachers UPDATE",
      env.DB.prepare("UPDATE teachers SET title='讲师' WHERE id=355002"),
    );
    await expectWriteToMarkDirty(
      "teachers DELETE",
      env.DB.prepare("DELETE FROM teachers WHERE id=355002"),
    );

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO courses(id,code,name,category)
         VALUES(355003,'TRIGGER355R','触发器关系课程','general')`,
      ),
      env.DB.prepare(
        `INSERT INTO teachers(id,source_teacher_label,name)
         VALUES(355003,'触发器关系教师甲','触发器关系教师甲'),
               (355004,'触发器关系教师乙','触发器关系教师乙')`,
      ),
    ]);
    await expectWriteToMarkDirty(
      "course_teachers INSERT",
      env.DB.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(355003,355003)",
      ),
    );
    await expectWriteToMarkDirty(
      "course_teachers UPDATE",
      env.DB.prepare(
        "UPDATE course_teachers SET teacher_id=355004 WHERE course_id=355003 AND teacher_id=355003",
      ),
    );
    await expectWriteToMarkDirty(
      "course_teachers DELETE",
      env.DB.prepare(
        "DELETE FROM course_teachers WHERE course_id=355003 AND teacher_id=355004",
      ),
    );

    await expectWriteToMarkDirty(
      "reviews INSERT",
      env.DB.prepare(
        `INSERT INTO reviews(id,course_id,teacher_id,category,overall,comment,status)
         VALUES(355005,1,1,'general',4,'触发器评价甲','approved')`,
      ),
    );
    await expectWriteToMarkDirty(
      "reviews UPDATE",
      env.DB.prepare(
        "UPDATE reviews SET comment='触发器评价乙' WHERE id=355005",
      ),
    );
    await expectWriteToMarkDirty(
      "reviews DELETE",
      env.DB.prepare("DELETE FROM reviews WHERE id=355005"),
    );

    await env.DB.prepare(
      `INSERT INTO legacy_import_batches(
         id,source_type,source_label,status,row_count
       ) VALUES('trigger-355','legacy_ocr','触发器测试','imported',1)`,
    ).run();
    await expectWriteToMarkDirty(
      "legacy_reviews INSERT",
      env.DB.prepare(
        `INSERT INTO legacy_reviews(
           id,import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,
           ocr_confidence,course_id,teacher_id,category,comment,status
         ) VALUES(
           355006,'trigger-355','trigger.png','触发器','1','触发器原文',
           1,1,1,'general','触发器历史评价甲','approved'
         )`,
      ),
    );
    await expectWriteToMarkDirty(
      "legacy_reviews UPDATE",
      env.DB.prepare(
        "UPDATE legacy_reviews SET comment='触发器历史评价乙' WHERE id=355006",
      ),
    );
    await expectWriteToMarkDirty(
      "legacy_reviews DELETE",
      env.DB.prepare("DELETE FROM legacy_reviews WHERE id=355006"),
    );

    await expectWriteToMarkDirty(
      "public_historical_reviews INSERT",
      env.DB.prepare(
        `INSERT INTO public_historical_reviews(
           id,course_id,teacher_id,comment,package_contract,
           approved_package_manifest_sha256,approved_catalog_content_sha256
         ) VALUES(
           'trigger-355',1,1,'触发器公开历史评价甲','trigger-contract',
           'trigger-manifest','trigger-catalog'
         )`,
      ),
    );
    await expectWriteToMarkDirty(
      "public_historical_reviews UPDATE",
      env.DB.prepare(
        `UPDATE public_historical_reviews
         SET comment='触发器公开历史评价乙' WHERE id='trigger-355'`,
      ),
    );
    await expectWriteToMarkDirty(
      "public_historical_reviews DELETE",
      env.DB.prepare(
        "DELETE FROM public_historical_reviews WHERE id='trigger-355'",
      ),
    );

    await expectWriteToMarkDirty(
      "offerings INSERT",
      env.DB.prepare(
        `INSERT INTO offerings(id,course_id,term,section,status)
         VALUES(355007,1,'触发器学期','触发器班','active')`,
      ),
    );
    await expectWriteToMarkDirty(
      "offerings UPDATE",
      env.DB.prepare(
        "UPDATE offerings SET campus='蛟桥园' WHERE id=355007",
      ),
    );
    await expectWriteToMarkDirty(
      "offerings DELETE",
      env.DB.prepare("DELETE FROM offerings WHERE id=355007"),
    );

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO teachers(id,source_teacher_label,name)
         VALUES(355008,'触发器开课教师','触发器开课教师')`,
      ),
      env.DB.prepare(
        `INSERT INTO offerings(id,course_id,term,section,status)
         VALUES(355008,1,'触发器学期','触发器教师班','active')`,
      ),
    ]);
    await expectWriteToMarkDirty(
      "offering_teachers INSERT",
      env.DB.prepare(
        "INSERT INTO offering_teachers(offering_id,teacher_id) VALUES(355008,1)",
      ),
    );
    await expectWriteToMarkDirty(
      "offering_teachers UPDATE",
      env.DB.prepare(
        "UPDATE offering_teachers SET teacher_id=355008 WHERE offering_id=355008 AND teacher_id=1",
      ),
    );
    await expectWriteToMarkDirty(
      "offering_teachers DELETE",
      env.DB.prepare(
        "DELETE FROM offering_teachers WHERE offering_id=355008 AND teacher_id=355008",
      ),
    );
  } finally {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM public_historical_reviews WHERE id='trigger-355'"),
      env.DB.prepare("DELETE FROM reviews WHERE id=355005"),
      env.DB.prepare("DELETE FROM legacy_reviews WHERE id=355006"),
      env.DB.prepare("DELETE FROM legacy_import_batches WHERE id='trigger-355'"),
      env.DB.prepare("DELETE FROM offerings WHERE id IN (355007,355008)"),
      env.DB.prepare("DELETE FROM course_teachers WHERE course_id=355003"),
      env.DB.prepare("DELETE FROM courses WHERE id IN (355001,355003)"),
      env.DB.prepare("DELETE FROM teachers WHERE id IN (355002,355003,355004,355008)"),
      env.DB.prepare(
        "DELETE FROM course_name_variants WHERE course_id=1 AND name IN ('触发器课名甲','触发器课名乙')",
      ),
      env.DB.prepare("UPDATE public_precompute_state SET dirty=1 WHERE id=1"),
    ]);
  }
});
