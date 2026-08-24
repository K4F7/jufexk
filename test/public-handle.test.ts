import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hmacHex } from "../src/ordinary-user-session";
import {
  FIRST_USER_PUBLIC_CODE,
  PUBLIC_CODE_MAX,
  RESERVED_PUBLIC_CODE,
  formatPublicHandle,
  takeNextPublicCode,
} from "../src/public-handle";
import {
  ORDINARY_TEST_AUTH_SECRET,
  WRITE_ORIGIN,
  ordinaryWriteHeaders,
  ordinaryWriteSession,
} from "./ordinary-write-session";

async function stableUserId(userId: string) {
  return hmacHex(`ordinary-test-user:${userId}`, ORDINARY_TEST_AUTH_SECRET);
}

describe("public handle assignment", () => {
  it("assigns sequential public codes from 1 and never stores 0", async () => {
    const first = await ordinaryWriteSession("handle-seq-a");
    const second = await ordinaryWriteSession("handle-seq-b");
    const firstId = await stableUserId(first.userId);
    const secondId = await stableUserId(second.userId);
    const rows = await env.DB.prepare(
      "SELECT id,public_code FROM users WHERE id IN (?,?) ORDER BY public_code",
    )
      .bind(firstId, secondId)
      .all<{ id: string; public_code: number }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0].public_code).toBeGreaterThanOrEqual(
      FIRST_USER_PUBLIC_CODE,
    );
    expect(rows.results[1].public_code).toBe(rows.results[0].public_code + 1);
    expect(rows.results.every((row) => row.public_code !== RESERVED_PUBLIC_CODE)).toBe(
      true,
    );

    const session = await SELF.fetch(`${WRITE_ORIGIN}/api/user/session`, {
      headers: first.auth,
    });
    const body = await session.json<Record<string, unknown>>();
    expect(JSON.stringify(body)).not.toContain(firstId);
    expect(body).not.toHaveProperty("public_code");
    expect(body).not.toHaveProperty("id");
  });

  it("backfills missing codes lazily and keeps created_at order for existing rows", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users(id,status,created_at) VALUES('legacy-later','active','2026-08-24 12:00:00')",
      ),
      env.DB.prepare(
        "INSERT INTO users(id,status,created_at) VALUES('legacy-earlier','active','2026-08-24 11:00:00')",
      ),
    ]);
    const earlier = await env.DB.prepare(
      "SELECT public_code FROM users WHERE id='legacy-earlier'",
    ).first<{ public_code: number | null }>();
    const later = await env.DB.prepare(
      "SELECT public_code FROM users WHERE id='legacy-later'",
    ).first<{ public_code: number | null }>();
    expect(earlier?.public_code).toBeNull();
    expect(later?.public_code).toBeNull();

    const assigned = await env.DB.prepare(
      `SELECT id, public_code FROM users
       WHERE id IN ('legacy-earlier','legacy-later')
       ORDER BY created_at, id`,
    ).all<{ id: string; public_code: number | null }>();
    expect(assigned.results.map((row) => row.id)).toEqual([
      "legacy-earlier",
      "legacy-later",
    ]);
  });

  it("lets the owner change avatar among the five official keys only", async () => {
    const session = await ordinaryWriteSession("handle-avatar-owner");
    const denied = await SELF.fetch(`${WRITE_ORIGIN}/api/user/profile/avatar`, {
      method: "PATCH",
      headers: ordinaryWriteHeaders(session),
      body: JSON.stringify({ avatar_key: 9 }),
    });
    expect(denied.status).toBe(400);

    const ok = await SELF.fetch(`${WRITE_ORIGIN}/api/user/profile/avatar`, {
      method: "PATCH",
      headers: ordinaryWriteHeaders(session),
      body: JSON.stringify({ avatar_key: 3 }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json<{ avatar_key: number; public_code: number; handle: string }>();
    expect(body.avatar_key).toBe(3);
    expect(body.public_code).toBeGreaterThanOrEqual(1);
    expect(body.handle).toBe(formatPublicHandle(body.public_code));
    expect(JSON.stringify(body)).not.toContain(await stableUserId(session.userId));
  });

  it("stops assigning public codes past 999999", async () => {
    const previous = await env.DB.prepare(
      "SELECT next_code FROM user_public_code_seq WHERE id=1",
    ).first<{ next_code: number }>();
    try {
      await env.DB.prepare(
        "UPDATE user_public_code_seq SET next_code=? WHERE id=1",
      )
        .bind(PUBLIC_CODE_MAX)
        .run();
      expect(await takeNextPublicCode(env.DB)).toBe(PUBLIC_CODE_MAX);
      await expect(takeNextPublicCode(env.DB)).rejects.toThrow(
        /public code sequence exhausted/,
      );
      const seq = await env.DB.prepare(
        "SELECT next_code FROM user_public_code_seq WHERE id=1",
      ).first<{ next_code: number }>();
      expect(seq?.next_code).toBe(PUBLIC_CODE_MAX + 1);
      const maxCode = await env.DB.prepare(
        "SELECT MAX(public_code) AS n FROM users",
      ).first<{ n: number | null }>();
      expect(Number(maxCode?.n || 0)).toBeLessThanOrEqual(PUBLIC_CODE_MAX);
    } finally {
      await env.DB.prepare(
        "UPDATE user_public_code_seq SET next_code=? WHERE id=1",
      )
        .bind(previous?.next_code)
        .run();
    }
  });
});
