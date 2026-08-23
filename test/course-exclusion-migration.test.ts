import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";

declare const TEST_D1_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];

it("removes an existing 班会 course and prevents it from returning", async () => {
  const migrations = [...TEST_D1_MIGRATIONS];
  const exclusion = migrations.pop();
  expect(exclusion?.name).toContain("0031_exclude_homeroom_course.sql");

  await applyD1Migrations(env.COURSE_EXCLUSION_MIGRATION_DB, migrations);
  await env.COURSE_EXCLUSION_MIGRATION_DB.prepare(
    "INSERT INTO courses(code,name,category) VALUES('OLD-HOMEROOM',?,'general')",
  ).bind("\u00a0班会\u3000")
    .run();
  await applyD1Migrations(env.COURSE_EXCLUSION_MIGRATION_DB, [exclusion!]);

  expect(await env.COURSE_EXCLUSION_MIGRATION_DB.prepare(
    "SELECT COUNT(*) n FROM courses WHERE code='OLD-HOMEROOM'",
  ).first()).toEqual({ n: 0 });
  await expect(env.COURSE_EXCLUSION_MIGRATION_DB.prepare(
    "INSERT INTO courses(code,name,category) VALUES('NEW-HOMEROOM','班会','general')",
  ).run()).rejects.toThrow(/excluded course name/i);
});

it("fails instead of deleting a 班会 course referenced by a review", async () => {
  const migrations = [...TEST_D1_MIGRATIONS];
  const exclusion = migrations.pop();
  expect(exclusion?.name).toContain("0031_exclude_homeroom_course.sql");

  await applyD1Migrations(env.COURSE_EXCLUSION_CONFLICT_DB, migrations);
  const course = await env.COURSE_EXCLUSION_CONFLICT_DB.prepare(
    "INSERT INTO courses(code,name,category) VALUES('USED-HOMEROOM','班会','general') RETURNING id",
  ).first<{ id: number }>();
  await env.COURSE_EXCLUSION_CONFLICT_DB.prepare(
    "INSERT INTO reviews(course_id,category,overall,status) VALUES(?,'general',5,'approved')",
  ).bind(course!.id).run();

  await expect(applyD1Migrations(env.COURSE_EXCLUSION_CONFLICT_DB, [exclusion!]))
    .rejects.toThrow(/foreign key|constraint/i);
  expect(await env.COURSE_EXCLUSION_CONFLICT_DB.prepare(
    "SELECT name FROM courses WHERE id=?",
  ).bind(course!.id).first()).toEqual({ name: "班会" });
});
