import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

declare const TEST_D1_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];

beforeAll(async () => {
  await applyD1Migrations(env.DB, TEST_D1_MIGRATIONS);
  // Production migrations ship no sample rows, so tests own their fixtures:
  // a course and teacher at id 1 that the suites bind reviews and offerings to.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO teachers(id,name,department,title) VALUES(1,'测试教师','测试学院','讲师')",
    ),
    env.DB.prepare(
      "INSERT INTO courses(id,code,name,category,department,credits) VALUES(1,'TEST101','测试课程','major','测试学院',3)",
    ),
    env.DB.prepare(
      "INSERT INTO courses(id,code,name,category,department,credits) VALUES(2,'TEST102','测试体育课','pe','测试学院',1)",
    ),
    env.DB.prepare(
      "INSERT INTO courses(id,code,name,category,department,credits) VALUES(3,'TEST103','测试公共选修','general','测试学院',2)",
    ),
    // Course 2 is deliberately left unbound: suites use it to assert that a
    // teacher without a relation to the course is rejected.
    env.DB.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(1,1)"),
    env.DB.prepare("INSERT INTO course_teachers(course_id,teacher_id) VALUES(3,1)"),
  ]);
  // Mirror the 0003 backfill, which only reached courses that existed when it ran.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO offerings(id,course_id,term,section,status) VALUES(1,1,'','历史数据','active'),(2,3,'','历史数据','active')",
    ),
    env.DB.prepare(
      "INSERT INTO offering_teachers(offering_id,teacher_id) SELECT o.id,ct.teacher_id FROM offerings o JOIN course_teachers ct ON ct.course_id=o.course_id WHERE o.section='历史数据'",
    ),
  ]);
});
