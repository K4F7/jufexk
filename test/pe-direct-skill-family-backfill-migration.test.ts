import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";
import { buildDirectSkillMappingBackfillSql } from "../src/lib/pe-specialization-mapping";

declare const TEST_D1_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];

it("backfills 跆拳道/游泳/田径 direct skills without mapping 国际标准舞 or umbrellas", async () => {
  const migrations = [...TEST_D1_MIGRATIONS];
  const index = migrations.findIndex((migration) =>
    migration.name.includes("0058_pe_direct_skill_family_backfill.sql"),
  );
  const [migration] = migrations.splice(index, 1);
  expect(migration?.name).toContain("0058_pe_direct_skill_family_backfill.sql");
  expect(buildDirectSkillMappingBackfillSql()).toContain("INSERT OR IGNORE");
  expect(buildDirectSkillMappingBackfillSql()).toContain("THEN '跆拳道'");
  expect(buildDirectSkillMappingBackfillSql()).toContain("THEN '游泳'");
  expect(buildDirectSkillMappingBackfillSql()).toContain("THEN '田径'");

  const db = (env as unknown as { PE_DIRECT_SKILL_BACKFILL_DB: D1Database })
    .PE_DIRECT_SKILL_BACKFILL_DB;
  await applyD1Migrations(db, migrations, "pe_direct_skill_backfill_upgrade");
  await db.batch([
    db.prepare(
      "INSERT INTO teachers(id,source_teacher_label,name) VALUES(93001,'肖舒鹏','肖舒鹏'),(93002,'彭澄升','彭澄升'),(93003,'赵翔','赵翔'),(93004,'陈俊文','陈俊文'),(93005,'严伟','严伟')",
    ),
    db.prepare(
      `INSERT INTO courses(id,code,name,category) VALUES
        (93011,'PE-TKD2','跆拳道2','sports'),
        (93012,'PE-SWIM','游泳','sports'),
        (93013,'PE-TRACK1','田径1（体适能为主）','sports'),
        (93014,'PE-DANCE','国际标准舞I','sports'),
        (93015,'PE-1','体育1','sports')`,
    ),
    db.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(93011,93001),(93012,93002),(93013,93003),(93014,93004),(93015,93005)",
    ),
  ]);
  await applyD1Migrations(db, [migration], "pe_direct_skill_backfill_upgrade");

  const mappings = (
    await db
      .prepare(
        `SELECT c.name course_name, t.source_teacher_label, m.normalized_specialization, m.display_semantics
         FROM catalog_relation_pe_specializations m
         JOIN courses c ON c.id=m.course_id
         JOIN teachers t ON t.id=m.teacher_id
         WHERE c.id IN (93011,93012,93013,93014,93015)
         ORDER BY c.code`,
      )
      .all()
  ).results;
  expect(mappings).toEqual([
    {
      course_name: "游泳",
      source_teacher_label: "彭澄升",
      normalized_specialization: "游泳",
      display_semantics: "keep_source_name",
    },
    {
      course_name: "跆拳道2",
      source_teacher_label: "肖舒鹏",
      normalized_specialization: "跆拳道",
      display_semantics: "keep_source_name",
    },
    {
      course_name: "田径1（体适能为主）",
      source_teacher_label: "赵翔",
      normalized_specialization: "田径",
      display_semantics: "keep_source_name",
    },
  ]);
});
