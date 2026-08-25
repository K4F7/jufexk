import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  publishJwxtSyncGeneration,
  stageJwxtSyncGeneration,
  type JwxtSyncGenerationInput,
} from "../src/jwxt-sync-publication";

let sequence = 0;

async function catalogIdentity() {
  sequence += 1;
  const code = `SYNC${sequence}`;
  const teacherLabel = `同步教师${sequence}`;
  const course = await env.DB.prepare(
    "INSERT INTO courses(code,name,category,department) VALUES(?,?,'general','同步测试')",
  )
    .bind(code, `同步课程${sequence}`)
    .run();
  const teacher = await env.DB.prepare(
    "INSERT INTO teachers(source_teacher_label,name,department) VALUES(?,?,'同步测试')",
  )
    .bind(teacherLabel, teacherLabel)
    .run();
  return {
    code,
    courseId: Number(course.meta.last_row_id),
    teacherId: Number(teacher.meta.last_row_id),
    teacherLabel,
  };
}

function generation(
  id: string,
  sourceSha256: string,
  identity: Awaited<ReturnType<typeof catalogIdentity>>,
  overrides: Partial<JwxtSyncGenerationInput> = {},
): JwxtSyncGenerationInput {
  return {
    generationId: id,
    mode: "full",
    sourceSha256,
    complete: true,
    capturedAt: "2026-08-26T00:00:00.000Z",
    rows: [
      {
        sourceKey: sourceSha256,
        sourceRowSha256: sourceSha256,
        courseCode: identity.code,
        courseName: `同步课程${sequence}`,
        teacherSourceLabel: identity.teacherLabel,
        termId: "2026-2027-1",
        campus: "麦庐园",
        weekText: "1-16周",
        timeText: "星期一 第1-2节",
        place: "一教101",
        classNumber: "A-01",
      },
    ],
    ...overrides,
  };
}

describe("JWXT periodic mirror", () => {
  it("applies the independent mirror migration", async () => {
    const tables = (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'jwxt_sync_%' ORDER BY name",
      ).all<{ name: string }>()
    ).results.map((row) => row.name);
    expect(tables).toEqual([
      "jwxt_sync_generation_rows",
      "jwxt_sync_generations",
      "jwxt_sync_offerings",
      "jwxt_sync_state",
    ]);
  });

  it("publishes atomically and exposes only the schedule projection", async () => {
    const identity = await catalogIdentity();
    const input = generation(`gen-${sequence}-a`, "a".repeat(64), identity);
    await stageJwxtSyncGeneration(env.DB, input);
    await publishJwxtSyncGeneration(env.DB, input);

    const response = await SELF.fetch(
      `https://example.com/api/schedule-offerings?courseId=${identity.courseId}&term=2026-2027-1`,
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    const rows = JSON.parse(raw) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      courseCode: identity.code,
      teacherName: identity.teacherLabel,
      termId: "2026-2027-1",
      campus: "麦庐园",
      timeText: "星期一 第1-2节",
      catalogCourseId: identity.courseId,
      catalogTeacherId: identity.teacherId,
    });
    expect(rows[0]).toHaveProperty("key");
    expect(raw).not.toMatch(/A-01|class|section|capacity|selected|available/i);
  });

  it("does not switch the active generation when staging quality fails", async () => {
    const identity = await catalogIdentity();
    const good = generation(`gen-${sequence}-good`, "b".repeat(64), identity);
    await stageJwxtSyncGeneration(env.DB, good);
    await publishJwxtSyncGeneration(env.DB, good);

    const bad = generation(`gen-${sequence}-bad`, "c".repeat(64), identity, {
      rows: [],
      expectedRowCount: 1,
    });
    await stageJwxtSyncGeneration(env.DB, bad);
    await expect(publishJwxtSyncGeneration(env.DB, bad)).rejects.toThrow(/row count/i);
    const state = await env.DB.prepare(
      "SELECT active_generation_id FROM jwxt_sync_state WHERE singleton=1",
    ).first<{ active_generation_id: string }>();
    expect(state?.active_generation_id).toBe(good.generationId);
  });

  it("takes two complete full misses to retire a mirrored offering", async () => {
    const identity = await catalogIdentity();
    const sentinelIdentity = await catalogIdentity();
    const targetRow = generation("target", "d".repeat(64), identity).rows[0];
    const sentinelRow = generation("sentinel", "9".repeat(64), sentinelIdentity).rows[0];
    const first = generation(`gen-${sequence}-1`, "7".repeat(64), identity, {
      rows: [targetRow, sentinelRow],
    });
    await stageJwxtSyncGeneration(env.DB, first);
    await publishJwxtSyncGeneration(env.DB, first);

    for (const [suffix, hash] of [["2", "e"], ["3", "f"]] as const) {
      const missing = generation(`gen-${sequence}-${suffix}`, hash.repeat(64), sentinelIdentity, {
        rows: [sentinelRow],
      });
      await stageJwxtSyncGeneration(env.DB, missing);
      await publishJwxtSyncGeneration(env.DB, missing);
      const status = await env.DB.prepare(
        "SELECT status,missing_complete_runs FROM jwxt_sync_offerings WHERE course_code=?",
      )
        .bind(identity.code)
        .first<{ status: string; missing_complete_runs: number }>();
      expect(status?.missing_complete_runs).toBe(Number(suffix) - 1);
      expect(status?.status).toBe(suffix === "2" ? "active" : "offline");
    }
  });

  it("requires both courseId and term", async () => {
    expect((await SELF.fetch("https://example.com/api/schedule-offerings?courseId=1")).status).toBe(400);
    expect((await SELF.fetch("https://example.com/api/schedule-offerings?term=2026-2027-1")).status).toBe(400);
  });
});
