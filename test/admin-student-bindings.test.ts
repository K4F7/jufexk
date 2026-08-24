import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  casSubjectHash,
  parseBindingUsernames,
} from "../src/admin-student-bindings";
import {
  AUTH_PROVIDER_CAS,
  CAS_IDENTITY_ISSUER,
} from "../src/ordinary-user-identity";
import { hmacHex } from "../src/ordinary-user-session";
import { adminAuth, adminHeaders } from "./admin-session";
import {
  ordinaryWriteHeaders,
  ordinaryWriteSession,
  ORDINARY_TEST_AUTH_SECRET,
} from "./ordinary-write-session";

const origin = "https://example.com";
const identitySecret = "test-campus-identity";

async function attachCasIdentity(rawUserId: string, username: string) {
  const session = await ordinaryWriteSession(rawUserId);
  const stableId = await hmacHex(
    `ordinary-test-user:${rawUserId}`,
    ORDINARY_TEST_AUTH_SECRET,
  );
  const subject = await casSubjectHash(username, identitySecret);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO auth_identities(provider,issuer,subject,user_id)
     VALUES(?,?,?,?)`,
  )
    .bind(AUTH_PROVIDER_CAS, CAS_IDENTITY_ISSUER, subject, stableId)
    .run();
  return { session, subject };
}

describe("parseBindingUsernames", () => {
  it("accepts multiple usernames from text and an array", () => {
    expect(
      parseBindingUsernames({
        text: "2021001234, 2021005678\n2021009999",
        usernames: ["2021000001"],
      }),
    ).toEqual({
      ok: true,
      usernames: ["2021000001", "2021001234", "2021005678", "2021009999"],
    });
  });

  it("rejects empty or illegal student IDs", () => {
    expect(parseBindingUsernames({ text: "" }).ok).toBe(false);
    expect(parseBindingUsernames({ text: "ab" }).ok).toBe(false);
    expect(parseBindingUsernames({ usernames: [1] }).ok).toBe(false);
  });
});

describe("administrator student-ID bindings", () => {
  it("lets a passwordless admin bind multiple IDs and rejects invalid ones", async () => {
    const auth = await adminAuth();
    const created = await SELF.fetch(`${origin}/api/admin/student-bindings`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ text: "2021888001\n2021888002,2021888001" }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ ok: true, added: 2, skipped: 0 });

    const again = await SELF.fetch(`${origin}/api/admin/student-bindings`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ usernames: ["2021888002"] }),
    });
    expect(await again.json()).toEqual({ ok: true, added: 0, skipped: 1 });

    const listed = await SELF.fetch(`${origin}/api/admin/student-bindings`, {
      headers: { Cookie: auth.cookie },
    });
    const body = await listed.json<{ items: Array<{ id: number; created_at: string; subject_hash?: string }> }>();
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(body)).not.toContain("2021888001");
    expect(JSON.stringify(body)).not.toContain("subject_hash");

    const invalid = await SELF.fetch(`${origin}/api/admin/student-bindings`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ text: "!!" }),
    });
    expect(invalid.status).toBe(400);
  });

  it("elevates a bound CAS user and ignores unbound or email-only users", async () => {
    const bound = await attachCasIdentity("bound-admin-cas", "2021777001");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO admin_student_bindings(subject_hash) VALUES(?)`,
    )
      .bind(bound.subject)
      .run();

    const elevated = await SELF.fetch(`${origin}/api/admin/session`, {
      headers: ordinaryWriteHeaders(bound.session),
    });
    expect(elevated.status).toBe(200);
    const elevatedBody = await elevated.json<{
      kind: string;
      source: string;
      csrfToken: string;
    }>();
    expect(elevatedBody).toMatchObject({ kind: "admin", source: "student" });
    expect(elevatedBody.csrfToken).toBeTruthy();

    const adminCookie = (
      elevated.headers as Headers & { getSetCookie(): string[] }
    )
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const write = await SELF.fetch(`${origin}/api/admin/student-bindings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
        Origin: origin,
        "X-CSRF-Token": elevatedBody.csrfToken,
      },
      body: JSON.stringify({ usernames: ["2021777002"] }),
    });
    expect(write.status).toBe(200);

    const unbound = await attachCasIdentity("unbound-cas", "2021777099");
    const denied = await SELF.fetch(`${origin}/api/admin/session`, {
      headers: ordinaryWriteHeaders(unbound.session),
    });
    expect(denied.status).toBe(401);

    const emailOnly = await ordinaryWriteSession("email-only-user");
    const emailDenied = await SELF.fetch(`${origin}/api/admin/session`, {
      headers: ordinaryWriteHeaders(emailOnly),
    });
    expect(emailDenied.status).toBe(401);

    const muted = await attachCasIdentity("muted-admin-cas", "2021777003");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO admin_student_bindings(subject_hash) VALUES(?)`,
    )
      .bind(muted.subject)
      .run();
    await env.DB.prepare(
      `UPDATE users SET muted_until=unixepoch()+3600 WHERE id=?`,
    )
      .bind(
        await hmacHex(
          "ordinary-test-user:muted-admin-cas",
          ORDINARY_TEST_AUTH_SECRET,
        ),
      )
      .run();
    const mutedElevated = await SELF.fetch(`${origin}/api/admin/session`, {
      headers: ordinaryWriteHeaders(muted.session),
    });
    expect(mutedElevated.status).toBe(200);
  });

  it("removes a binding so that student no longer elevates", async () => {
    const auth = await adminAuth();
    const username = "2021666001";
    await SELF.fetch(`${origin}/api/admin/student-bindings`, {
      method: "POST",
      headers: adminHeaders(auth),
      body: JSON.stringify({ usernames: [username] }),
    });
    const listed = await SELF.fetch(`${origin}/api/admin/student-bindings`, {
      headers: { Cookie: auth.cookie },
    });
    const { items } = await listed.json<{ items: Array<{ id: number }> }>();
    const subject = await casSubjectHash(username, identitySecret);
    const row = await env.DB.prepare(
      `SELECT id FROM admin_student_bindings WHERE subject_hash=?`,
    )
      .bind(subject)
      .first<{ id: number }>();
    expect(row?.id).toBeTruthy();
    const removed = await SELF.fetch(
      `${origin}/api/admin/student-bindings/${row!.id}`,
      { method: "DELETE", headers: adminHeaders(auth) },
    );
    expect(removed.status).toBe(200);
    expect(items.some((item) => item.id === row!.id)).toBe(true);

    const user = await attachCasIdentity("removed-admin-cas", username);
    const denied = await SELF.fetch(`${origin}/api/admin/session`, {
      headers: ordinaryWriteHeaders(user.session),
    });
    expect(denied.status).toBe(401);
  });
});
