import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { writeBiEvent } from "../src/bi";
import { adminAuth } from "./admin-session";

const origin = "https://example.com";

describe("product analytics", () => {
  it("writeBiEvent no-ops without a binding and skips short dwell", () => {
    const points: unknown[] = [];
    writeBiEvent(undefined, "login_view", { actor: "guest" });
    writeBiEvent({ BI: { writeDataPoint: (point) => points.push(point) } }, "review_dwell", {
      actor: "guest",
      courseId: 1,
      teacherId: 2,
      durationMs: 200,
    });
    expect(points).toEqual([]);
  });

  it("writeBiEvent stores enum blobs without identity fields", () => {
    const points: AnalyticsEngineDataPoint[] = [];
    writeBiEvent({ BI: { writeDataPoint: (point) => points.push(point) } }, "review_view", {
      actor: "guest",
      courseId: 8,
      teacherId: 3,
    });
    expect(points).toEqual([
      {
        blobs: ["review_view", "guest", "8", "3", ""],
        doubles: [1, 0],
      },
    ]);
    expect(JSON.stringify(points[0])).not.toMatch(/subject|student|email|@/);
  });

  it("rejects beacon without origin and invalid events", async () => {
    const missing = await SELF.fetch(`${origin}/api/bi/beacon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "login_view" }),
    });
    expect(missing.status).toBe(403);

    const invalid = await SELF.fetch(`${origin}/api/bi/beacon`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "login_success" }),
    });
    expect(invalid.status).toBe(400);
  });

  it("accepts a login_view beacon", async () => {
    const response = await SELF.fetch(`${origin}/api/bi/beacon`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "login_view" }),
    });
    expect(response.status).toBe(204);
  });

  it("returns registration growth to admins without an Analytics Engine token", async () => {
    await env.DB.prepare(
      `INSERT INTO users(id,status,public_code,created_at)
       VALUES('bi-user-1','active',2,'2026-08-01 10:00:00')`,
    ).run();
    const anonymous = await SELF.fetch(`${origin}/api/admin/bi`);
    expect(anonymous.status).toBe(401);

    const auth = await adminAuth();
    const response = await SELF.fetch(`${origin}/api/admin/bi`, {
      headers: { Cookie: auth.cookie },
    });
    expect(response.status).toBe(200);
    const body = await response.json<{
      total_users: number;
      days: Array<{ day: string; new_users: number }>;
      events: { configured: boolean };
    }>();
    expect(body.total_users).toBeGreaterThanOrEqual(1);
    expect(body.days.some((row) => row.new_users >= 1)).toBe(true);
    expect(body.events.configured).toBe(false);
  });

  it("records a failed CAS password attempt", async () => {
    const points: AnalyticsEngineDataPoint[] = [];
    const previous = env.BI;
    env.BI = { writeDataPoint: (point) => points.push(point) };
    try {
      const response = await SELF.fetch(`${origin}/api/auth/cas`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "", password: "" }),
      });
      expect(response.status).toBe(401);
      expect(points.some((point) => point.blobs?.[0] === "login_fail")).toBe(true);
      expect(JSON.stringify(points)).not.toMatch(/cas-username|stu\.jxufe|CASTGC|@/);
    } finally {
      env.BI = previous;
    }
  });
});
