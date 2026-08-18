import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

declare const TEST_D1_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];

const migrationEnv = env as Cloudflare.Env & {
  CATEGORY_MIGRATION_DB: D1Database;
  CATEGORY_CONFLICT_DB: D1Database;
};
const categoryMigration = () => {
  const migration = TEST_D1_MIGRATIONS.find((item) =>
    item.name.includes("course_category_enum"),
  );
  if (!migration) throw new Error("course category migration is missing");
  return migration;
};
const migrationsBeforeCategory = () => {
  const migration = categoryMigration();
  return TEST_D1_MIGRATIONS.slice(0, TEST_D1_MIGRATIONS.indexOf(migration));
};

describe("review template kind migration", () => {
  it("replays from scratch with only general and sports", async () => {
    const schema = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('courses','reviews','legacy_reviews','catalog_requests') ORDER BY name",
    ).all<{ sql: string }>();
    const sql = schema.results.map((row) => row.sql).join("\n");
    const categoryChecks = sql.match(/category TEXT[^,]*CHECK\([^)]+\)/g) ?? [];
    expect(categoryChecks.length).toBeGreaterThan(0);
    for (const check of categoryChecks) {
      expect(check).toContain("'general','sports'");
      expect(check).not.toMatch(/'major'|'pe'|'required'|'elective'/);
    }
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) n FROM (
          SELECT category FROM courses UNION ALL SELECT category FROM reviews
          UNION ALL SELECT category FROM legacy_reviews UNION ALL SELECT category FROM catalog_requests
        ) WHERE category IN ('major','pe','required','elective')`,
      ).first(),
    ).toEqual({ n: 0 });
    expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual(
      [],
    );
  });

  it("maps every legacy non-sports value to general while preserving IDs, relations, and variants", async () => {
    const db = migrationEnv.CATEGORY_MIGRATION_DB;
    await applyD1Migrations(db, migrationsBeforeCategory(), "category_upgrade");
    await db.batch([
      db.prepare(
        "INSERT INTO teachers(id,source_teacher_label,name) VALUES(81,'类别教师','类别教师')",
      ),
      db.prepare(
        `INSERT INTO courses(id,code,name,category) VALUES
          (71,'CAT-REQ','旧必修','major'),
          (72,'CAT-SPORT','旧体育','pe'),
          (73,'CAT-ELECT','旧选修','general')`,
      ),
      db.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(71,81)",
      ),
      db.prepare(
        `INSERT INTO reviews(id,course_id,teacher_id,category,overall) VALUES
          (91,71,81,'major',5),(92,72,81,'pe',4),(93,73,81,'general',3)`,
      ),
      db.prepare(
        `INSERT INTO catalog_requests(id,kind,course_code,course_name,category) VALUES
          (101,'course','CAT-REQ','旧必修','major'),
          (102,'course','CAT-SPORT','旧体育','pe'),
          (103,'course','CAT-ELECT','旧选修','general')`,
      ),
      db.prepare(
        "INSERT INTO legacy_import_batches(id,source_type,source_label,status,row_count) VALUES('category-upgrade','legacy_ocr','测试','imported',3)",
      ),
      db.prepare(
        `INSERT INTO legacy_reviews(id,import_batch_id,source_file,sheet_name,source_row,raw_ocr_text,ocr_confidence,category,comment) VALUES
          (111,'category-upgrade','a','s','1','a',1,'major','a'),
          (112,'category-upgrade','a','s','2','b',1,'pe','b'),
          (113,'category-upgrade','a','s','3','c',1,'general','c')`,
      ),
    ]);

    await applyD1Migrations(db, [categoryMigration()], "category_upgrade");

    for (const table of ["courses", "reviews", "legacy_reviews", "catalog_requests"])
      expect(
        (
          await db.prepare(
            `SELECT GROUP_CONCAT(category,',') categories FROM (SELECT category FROM ${table} WHERE category<>'' ORDER BY category)`,
          ).first<{ categories: string }>()
        )?.categories,
      ).toBe("general,general,sports");
    expect(
      await db.prepare(
        "SELECT course_id,teacher_id FROM course_teachers WHERE course_id=71 AND teacher_id=81",
      ).first(),
    ).toEqual({ course_id: 71, teacher_id: 81 });
    expect(
      await db.prepare(
        "SELECT name FROM course_name_variants WHERE course_id=71",
      ).first(),
    ).toEqual({ name: "旧必修" });
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    await expect(
      db.prepare(
        "INSERT INTO courses(code,name,category) VALUES('OLD-ENUM','旧枚举','major')",
      ).run(),
    ).rejects.toThrow(/CHECK|constraint/i);
    for (const obsolete of ["required", "elective"])
      await expect(
        db.prepare(
          "INSERT INTO courses(code,name,category) VALUES(?,?,?)",
        ).bind(`OLD-${obsolete}`, "旧业务枚举", obsolete).run(),
      ).rejects.toThrow(/CHECK|constraint/i);
  });

  it("maps an unrecognized non-sports legacy value to general", async () => {
    const db = migrationEnv.CATEGORY_CONFLICT_DB;
    await applyD1Migrations(db, migrationsBeforeCategory(), "category_conflict");
    await db.prepare("PRAGMA ignore_check_constraints=ON").run();
    await db.prepare(
      "INSERT INTO courses(code,name,category) VALUES('CAT-UNKNOWN','未知分类','unknown')",
    ).run();
    await db.prepare("PRAGMA ignore_check_constraints=OFF").run();
    await applyD1Migrations(db, [categoryMigration()], "category_conflict");
    expect(
      await db.prepare("SELECT category FROM courses WHERE code='CAT-UNKNOWN'").first(),
    ).toEqual({ category: "general" });
  });
});
