import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

declare const TEST_D1_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];

const migrationEnv = env as Cloudflare.Env & {
  MIGRATION_DB: D1Database;
  MIGRATION_CONFLICT_DB: D1Database;
};
const identityMigration = () => {
  const migration = TEST_D1_MIGRATIONS.find((item) =>
    item.name.includes("catalog_source_identity"),
  );
  if (!migration) throw new Error("catalog source identity migration is missing");
  return migration;
};
const migrationsBeforeIdentity = () => {
  const migration = identityMigration();
  return TEST_D1_MIGRATIONS.slice(0, TEST_D1_MIGRATIONS.indexOf(migration));
};

describe("catalog source identity migration", () => {
  it("replays from scratch with stable identities, nullable departments, variants, and valid foreign keys", async () => {
    const teacherColumns = (
      await env.DB.prepare("PRAGMA table_info(teachers)").all<{
        name: string;
        notnull: number;
      }>()
    ).results;
    const sourceColumn = teacherColumns.find(
      (column) => column.name === "source_teacher_label",
    );
    const departmentColumn = teacherColumns.find(
      (column) => column.name === "department",
    );

    expect(sourceColumn).toBeDefined();
    expect(departmentColumn?.notnull).toBe(0);
    expect(
      (await env.DB.prepare("PRAGMA foreign_key_check").all()).results,
    ).toEqual([]);
    expect(
      await env.DB.prepare(
        "SELECT name FROM course_name_variants WHERE course_id=1",
      ).first(),
    ).toEqual({ name: "测试课程" });
    await expect(
      env.DB.prepare(
        "INSERT INTO courses(code,name,category) VALUES('TEST101','同课号新名','major')",
      ).run(),
    ).rejects.toThrow(/UNIQUE|constraint/i);
    await expect(
      env.DB.prepare(
        "INSERT INTO teachers(source_teacher_label,name) VALUES('测试教师','另一个显示名')",
      ).run(),
    ).rejects.toThrow(/UNIQUE|constraint/i);
    await expect(
      env.DB.prepare(
        "INSERT INTO teachers(source_teacher_label,name) VALUES('   ','空白来源教师')",
      ).run(),
    ).rejects.toThrow(/CHECK|constraint/i);
    await expect(
      env.DB.prepare(
        "INSERT INTO teachers(source_teacher_label,name,department) VALUES('可空院系教师','可空院系教师',NULL)",
      ).run(),
    ).resolves.toBeDefined();
  });

  it("upgrades existing rows without changing stable IDs or relations", async () => {
    const db = migrationEnv.MIGRATION_DB;
    await applyD1Migrations(db, migrationsBeforeIdentity(), "upgrade_migrations");
    await db.batch([
      db.prepare(
        "INSERT INTO teachers(id,name,department,title) VALUES(41,'旧教师1','旧院系','讲师')",
      ),
      db.prepare(
        "INSERT INTO courses(id,code,name,category,department) VALUES(51,'OLD-COURSE','旧课程名','major','旧院系')",
      ),
      db.prepare(
        "INSERT INTO course_teachers(course_id,teacher_id) VALUES(51,41)",
      ),
    ]);

    await applyD1Migrations(db, [identityMigration()], "upgrade_migrations");

    expect(
      await db.prepare(
        `SELECT t.id,t.source_teacher_label,t.department,c.id course_id,c.code
         FROM course_teachers ct JOIN teachers t ON t.id=ct.teacher_id JOIN courses c ON c.id=ct.course_id
         WHERE ct.course_id=51 AND ct.teacher_id=41`,
      ).first(),
    ).toEqual({
      id: 41,
      source_teacher_label: "旧教师1",
      department: "旧院系",
      course_id: 51,
      code: "OLD-COURSE",
    });
    expect(
      await db.prepare(
        "SELECT source_identity FROM catalog_identity_backfill_audit WHERE entity_type='teacher' AND entity_id=41",
      ).first(),
    ).toEqual({ source_identity: "旧教师1" });
    expect((await db.prepare("PRAGMA foreign_key_check").all()).results).toEqual(
      [],
    );
  });

  it("fails an ambiguous teacher backfill instead of guessing by department", async () => {
    const db = migrationEnv.MIGRATION_CONFLICT_DB;
    await applyD1Migrations(db, migrationsBeforeIdentity(), "conflict_migrations");
    await db.batch([
      db.prepare(
        "INSERT INTO teachers(id,name,department) VALUES(61,'重名教师','甲院系')",
      ),
      db.prepare(
        "INSERT INTO teachers(id,name,department) VALUES(62,'重名教师','乙院系')",
      ),
    ]);

    await expect(
      applyD1Migrations(db, [identityMigration()], "conflict_migrations"),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });
});
