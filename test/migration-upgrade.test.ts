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
    (
      await db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type='table' AND name IN (
             'legacy_reviews','legacy_import_batches','legacy_review_endorsements',
             'legacy_review_challenges','legacy_review_visibility_events',
             'legacy_review_moderation_events'
           )`,
        )
        .all<{ name: string }>()
    ).results,
  ).toEqual([]);
  expect(
    await db.prepare(
      "SELECT created_course_id,created_teacher_id FROM catalog_requests WHERE course_code='PE012'",
    ).first(),
  ).toEqual({ created_course_id: 2, created_teacher_id: 1 });
  expect(
    await db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM course_search_fts) course_fts,
        (SELECT COUNT(*) FROM teacher_search_fts) teacher_fts`,
    ).first(),
  ).toMatchObject({ course_fts: expect.any(Number), teacher_fts: expect.any(Number) });
});

it("backfills existing public search projections when adding FTS5", async () => {
  const db = (env as unknown as { FTS_MIGRATION_DB: D1Database }).FTS_MIGRATION_DB;
  const ftsMigration = TEST_D1_MIGRATIONS.find((migration) =>
    migration.name.startsWith("0047_catalog_fts5_trigram"),
  );
  expect(ftsMigration).toBeTruthy();
  await applyD1Migrations(
    db,
    TEST_D1_MIGRATIONS.filter((migration) => migration !== ftsMigration),
    "fts_upgrade_migrations",
  );
  await db.batch([
    db.prepare(
      "INSERT INTO teachers(id,source_teacher_label,name) VALUES(90471,'迁移教师','迁移教师')",
    ),
    db.prepare(
      "INSERT INTO courses(id,code,name,category) VALUES(90470,'FTS-UPGRADE','迁移课程','general')",
    ),
    db.prepare(
      `INSERT INTO public_course_canonicals(
        course_id,canonical_course_id,search_text,match_text,pinyin_text,teacher_variant_text
      ) VALUES(90470,90470,'迁移课程','迁移课程 FTS-UPGRADE','qianyikecheng','')`,
    ),
    db.prepare(
      `INSERT INTO public_teacher_search(teacher_id,match_text,pinyin_text)
       VALUES(90471,'迁移教师','qianyijiaoshi')`,
    ),
  ]);
  await applyD1Migrations(db, [ftsMigration!], "fts_upgrade_migrations");
  expect(
    await db.prepare(
      "SELECT rowid FROM course_search_fts WHERE course_search_fts MATCH ?",
    )
      .bind('"迁移课程"')
      .first(),
  ).toEqual({ rowid: 90470 });
  expect(
    await db.prepare(
      "SELECT rowid FROM teacher_search_fts WHERE teacher_search_fts MATCH ?",
    )
      .bind('"qianyijiaoshi"')
      .first(),
  ).toEqual({ rowid: 90471 });
});

it("keeps FTS projections synchronized across insert, update, and delete", async () => {
  const db = (env as unknown as { FTS_MIGRATION_DB: D1Database }).FTS_MIGRATION_DB;
  await db.batch([
    db.prepare("INSERT INTO teachers(id,source_teacher_label,name) VALUES(90473,'FTS触发器教师','旧教师词')"),
    db.prepare("INSERT INTO courses(id,code,name,category) VALUES(90472,'FTS-TRIGGER','旧课程词','general')"),
    db.prepare("INSERT INTO public_course_canonicals(course_id,canonical_course_id,search_text,match_text,pinyin_text,teacher_variant_text) VALUES(90472,90472,'旧课程词','oldcourse token','jiukecheng','')"),
    db.prepare("INSERT INTO public_teacher_search(teacher_id,match_text,pinyin_text) VALUES(90473,'oldteacher token','jiulaoshi')"),
  ]);
  expect(await db.prepare("SELECT rowid FROM course_search_fts WHERE course_search_fts MATCH 'oldcourse'").first()).toEqual({ rowid: 90472 });
  expect(await db.prepare("SELECT rowid FROM teacher_search_fts WHERE teacher_search_fts MATCH 'oldteacher'").first()).toEqual({ rowid: 90473 });
  await db.batch([
    db.prepare("UPDATE public_course_canonicals SET match_text='newcourse token' WHERE course_id=90472"),
    db.prepare("UPDATE public_teacher_search SET match_text='newteacher token' WHERE teacher_id=90473"),
  ]);
  expect(await db.prepare("SELECT rowid FROM course_search_fts WHERE course_search_fts MATCH 'oldcourse'").first()).toBeNull();
  expect(await db.prepare("SELECT rowid FROM course_search_fts WHERE course_search_fts MATCH 'newcourse'").first()).toEqual({ rowid: 90472 });
  expect(await db.prepare("SELECT rowid FROM teacher_search_fts WHERE teacher_search_fts MATCH 'oldteacher'").first()).toBeNull();
  expect(await db.prepare("SELECT rowid FROM teacher_search_fts WHERE teacher_search_fts MATCH 'newteacher'").first()).toEqual({ rowid: 90473 });
  await db.batch([
    db.prepare("DELETE FROM public_course_canonicals WHERE course_id=90472"),
    db.prepare("DELETE FROM public_teacher_search WHERE teacher_id=90473"),
  ]);
  expect(await db.prepare("SELECT rowid FROM course_search_fts WHERE course_search_fts MATCH 'newcourse'").first()).toBeNull();
  expect(await db.prepare("SELECT rowid FROM teacher_search_fts WHERE teacher_search_fts MATCH 'newteacher'").first()).toBeNull();
  expect(await db.prepare("PRAGMA foreign_key_check").all()).toEqual({ results: [], success: true, meta: expect.anything() });
});

it("preserves populated review dependencies during the 0051 upgrade", async () => {
  const db = (env as unknown as { MIGRATION_DB: D1Database }).MIGRATION_DB;
  await db.batch([
    db.prepare("INSERT INTO reviews(id,course_id,teacher_id,category,comment,status,overall) VALUES(97001,1,1,'general','保留依赖','approved',0.5)"),
    db.prepare("INSERT INTO review_moderation_events(review_id,action,note) VALUES(97001,'approved','ok')"),
    db.prepare("INSERT INTO review_endorsements(user_id,review_id) VALUES('upgrade-user',97001)"),
    db.prepare("INSERT INTO review_challenges(user_id,review_id) VALUES('challenge-user',97001)"),
    db.prepare("INSERT INTO user_notifications(user_id,type,message,link,event_key,source_review_id) VALUES('upgrade-user','review_endorsed','测试通知','/reviews/97001','upgrade-event',97001)"),
    db.prepare("INSERT INTO catalog_requests(kind,status,created_review_id) VALUES('course','pending',97001)"),
    db.prepare("INSERT INTO review_comments(id,public_id,review_id,author_user_id,body) VALUES(97001,'review:97001',97001,'upgrade-user','父评论')"),
    db.prepare("INSERT INTO review_comments(id,public_id,review_id,parent_comment_id,author_user_id,body) VALUES(97002,'review:97001',97001,97001,'challenge-user','子评论')"),
    db.prepare("INSERT INTO review_comment_endorsements(user_id,comment_id) VALUES('upgrade-user',97002)"),
  ]);
  expect(await db.prepare("SELECT id,overall,comment FROM reviews WHERE id=97001").first()).toEqual({ id: 97001, overall: 0.5, comment: "保留依赖" });
  expect(await db.prepare("SELECT COUNT(*) n FROM review_moderation_events WHERE review_id=97001").first()).toEqual({ n: 1 });
  expect(await db.prepare("SELECT COUNT(*) n FROM review_endorsements WHERE review_id=97001").first()).toEqual({ n: 1 });
  expect(await db.prepare("SELECT COUNT(*) n FROM review_challenges WHERE review_id=97001").first()).toEqual({ n: 1 });
  expect(await db.prepare("SELECT COUNT(*) n FROM user_notifications WHERE event_key='upgrade-event'").first()).toEqual({ n: 1 });
  expect(await db.prepare("SELECT COUNT(*) n FROM review_comments WHERE review_id=97001").first()).toEqual({ n: 2 });
  expect(await db.prepare("SELECT COUNT(*) n FROM review_comment_endorsements WHERE comment_id=97002").first()).toEqual({ n: 1 });
  expect(await db.prepare("PRAGMA foreign_key_check").all()).toMatchObject({ results: [] });
});
