import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("offerings", () => {
  it("applies every production migration on a clean database", async () => {
    const tables = (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('offerings','offering_teachers','admin_sessions','rate_limit_counters','review_dedupe')",
      ).all<{ name: string }>()
    ).results.map((row) => row.name);
    expect(tables.sort()).toEqual(
      [
        "admin_sessions",
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
       VALUES(1,1,1,'major',5,'public review','2026','private-ip-hash','approved','private note',CURRENT_TIMESTAMP)`,
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

  it("returns the dedicated public-elective dimensions", async () => {
    const course = await env.DB.prepare(
      "INSERT INTO courses(code,name,category,department) VALUES('GE001','General elective','general','Center')",
    ).run();
    const courseId = Number(course.meta.last_row_id);
    await env.DB.prepare(
      `INSERT INTO reviews(course_id,teacher_id,category,overall,interest,practicality,workload_score,fairness,organization,status,submitter_hash)
       VALUES(?,1,'general',4,5,4,2,5,4,'approved','private')`,
    )
      .bind(courseId)
      .run();
    const response = await SELF.fetch(
      `https://example.com/api/courses/${courseId}`,
    );
    const body = await response.json<{
      reviews: Array<Record<string, unknown>>;
    }>();
    expect(body.reviews[0]).toMatchObject({
      interest: 5,
      practicality: 4,
      workload_score: 2,
      fairness: 5,
      organization: 4,
    });
    await env.DB.prepare("DELETE FROM reviews WHERE course_id=?")
      .bind(courseId)
      .run();
    await env.DB.prepare("DELETE FROM courses WHERE id=?").bind(courseId).run();
  });

  it("provides the complete lightweight course option list", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/courses/options",
    );
    expect(response.status).toBe(200);
    const rows = await response.json<Array<{ id: number; name: string }>>();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toHaveProperty("name");
  });

  it("backfills one legacy offering per seeded course", async () => {
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM courses) courses,(SELECT COUNT(*) FROM offerings) offerings",
    ).first<{ courses: number; offerings: number }>();
    expect(counts?.offerings).toBe(counts?.courses);
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
