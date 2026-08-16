import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("offerings", () => {
  it("applies every production migration on a clean database", async () => {
    const tables = (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('offerings','offering_teachers','admin_sessions','catalog_request_moderation_events','rate_limit_counters','review_dedupe')",
      ).all<{ name: string }>()
    ).results.map((row) => row.name);
    expect(tables.sort()).toEqual(
      [
        "admin_sessions",
        "catalog_request_moderation_events",
        "offering_teachers",
        "offerings",
        "rate_limit_counters",
        "review_dedupe",
      ].sort(),
    );
    const reviewColumns = (
      await env.DB.prepare(
        "SELECT name FROM pragma_table_info('reviews')",
      ).all<{
        name: string;
      }>()
    ).results.map((row) => row.name);
    expect(reviewColumns).toEqual(
      expect.arrayContaining([
        "offering_id",
        "grading_score",
        "interest",
        "practicality",
        "workload_score",
        "fairness",
        "organization",
      ]),
    );
  });

  it("never exposes submitter or moderation metadata publicly", async () => {
    await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,offering_id,category,overall,comment,term,submitter_hash,status,moderator_note,reviewed_at)
       VALUES(1,1,1,'general',5,'public review','2026','private-ip-hash','approved','private note',CURRENT_TIMESTAMP)`,
    ).run();
    const response = await SELF.fetch("https://example.com/api/courses/1");
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).toContain("public review");
    expect(raw).not.toContain("private-ip-hash");
    expect(raw).not.toContain("private note");
    const body = JSON.parse(raw) as { reviews: Array<Record<string, unknown>> };
    expect(body.reviews[0]).not.toHaveProperty("submitter_hash");
    expect(body.reviews[0]).not.toHaveProperty("moderator_note");
    expect(body.reviews[0]).not.toHaveProperty("status");
  });

  it("returns only the anonymous text projection on public details", async () => {
    const course = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES('GE001','General elective','general','Center')",
    ).run();
    const courseId = Number(course.meta.last_row_id);
    await env.DB.prepare(
      "INSERT INTO course_teachers(course_id,teacher_id) VALUES(?,1)",
    )
      .bind(courseId)
      .run();
    await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,category,overall,clarity,knowledge,workload_score,fairness,assessment,teaching,comment,status,submitter_hash)
       VALUES(?,1,'general',4,5,4,2,5,'闭卷考试','讲解清楚','维度投影测试','approved','private')`,
    )
      .bind(courseId)
      .run();
    const response = await SELF.fetch(
      `https://example.com/api/courses/${courseId}`,
    );
    const body = await response.json<{
      reviews: Array<Record<string, unknown>>;
    }>();
    expect(body.reviews[0]).toMatchObject({ comment: "维度投影测试" });
    expect(body.reviews[0]).not.toHaveProperty("clarity");
    expect(body.reviews[0]).not.toHaveProperty("knowledge");
    expect(body.reviews[0]).not.toHaveProperty("workload_score");
    expect(body.reviews[0]).not.toHaveProperty("fairness");
    expect(body.reviews[0]).not.toHaveProperty("assessment");
    expect(body.reviews[0]).not.toHaveProperty("teaching");
    expect(body.reviews[0]).not.toHaveProperty("interest");
    expect(body.reviews[0]).not.toHaveProperty("practicality");
    expect(body.reviews[0]).not.toHaveProperty("organization");
    expect(body.reviews[0]).not.toHaveProperty("rescue");
    await env.DB.prepare("DELETE FROM reviews WHERE course_id=?")
      .bind(courseId)
      .run();
    await env.DB.prepare("DELETE FROM course_teachers WHERE course_id=?")
      .bind(courseId)
      .run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
  });

  it("provides the complete lightweight course option list", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/courses/options?page=1&pageSize=2",
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      items: Array<{ id: number; name: string }>;
      page: number;
      pageSize: number;
      total: number;
      pages: number;
    }>();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.pages).toBe(Math.ceil(body.total / body.pageSize));
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toHaveProperty("name");
  });

  it("gives every legacy-backfilled course exactly one legacy offering", async () => {
    const duplicates = await env.DB.prepare(
      "SELECT COUNT(*) n FROM (SELECT course_id FROM offerings WHERE section='历史数据' GROUP BY course_id HAVING COUNT(*)>1)",
    ).first<{ n: number }>();
    expect(duplicates?.n).toBe(0);
  });

  it("lists active offerings and their teachers", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/offerings?courseId=1",
    );
    expect(response.status).toBe(200);
    const rows = await response.json<Array<{ id: number; teachers: string }>>();
    expect(rows).toHaveLength(1);
    expect(rows[0].teachers).toBeTruthy();

    const detail = await SELF.fetch(
      `https://example.com/api/offerings/${rows[0].id}`,
    );
    expect(detail.status).toBe(200);
    expect(
      (await detail.json<{ teachers: unknown[] }>()).teachers,
    ).toHaveLength(1);
  });

  it("rejects missing courseId", async () => {
    const response = await SELF.fetch("https://example.com/api/offerings");
    expect(response.status).toBe(400);
  });
});

describe("admin protection", () => {
  it("requires a session for offering management", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/admin/offerings",
    );
    expect(response.status).toBe(401);
  });
});
