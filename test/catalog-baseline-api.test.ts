import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";
let loginSequence = 210;
async function login() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": `198.51.100.${loginSequence++}` }, body: JSON.stringify({ password: "test-password" }),
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ csrfToken: string }>();
  const cookies = (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie().map((value) => value.split(";", 1)[0]).join("; " );
  return { cookie: cookies, csrf: body.csrfToken };
}
function headers(auth?: { cookie: string; csrf: string }) {
  return { "Content-Type": "application/json", Origin: origin, ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}) };
}

describe("catalog baseline admin API boundary", () => {
  it("requires an authenticated same-origin CSRF-protected administrator", async () => {
    const anonymous = await SELF.fetch(`${origin}/api/admin/catalog-baseline/uploads`, { method: "POST", headers: headers(), body: "{}" });
    expect(anonymous.status).toBe(401);
    const auth = await login();
    const noCsrf = await SELF.fetch(`${origin}/api/admin/catalog-baseline/uploads`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: auth.cookie, Origin: origin }, body: "{}" });
    expect(noCsrf.status).toBe(403);
    const authenticated = await SELF.fetch(`${origin}/api/admin/catalog-baseline/uploads`, { method: "POST", headers: headers(auth), body: "{}" });
    expect(authenticated.status).toBe(400);
  });

  it("disables merge/skip CSV preview and commit before the one-time baseline marker exists", async () => {
    const auth = await login();
    for (const path of ["/api/admin/import/preview", "/api/admin/import"]) {
      const response = await SELF.fetch(`${origin}${path}`, { method: "POST", headers: headers(auth), body: JSON.stringify({ type: "courses", rows: [{ code: "BYPASS", name: "绕过", category: "general" }] }) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("旧式") });
    }
  });

  it("rejects an oversized streamed manifest even without Content-Length", async () => {
    const auth = await login();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"padding":"${"x".repeat(100_001)}"}`));
        controller.close();
      },
    });
    const request = new Request(`${origin}/api/admin/catalog-baseline/uploads`, {
      method: "POST",
      headers: headers(auth),
      body,
    });
    const response = await SELF.fetch(request);
    expect(response.status).toBe(413);
  });

  it("requires post-baseline additions and relation changes to use catalog requests", async () => {
    const hash = "a".repeat(64);
    await env.DB.prepare(`INSERT INTO catalog_baseline_marker(
      singleton,batch_id,approved_schema_version,approved_manifest_content_sha256,artifact_sha256,
      source_capture_manifest_content_sha256,derivation_content_sha256,quality_manifest_content_sha256,
      decisions_sha256,boundary_fixture_content_sha256,courses,teachers,relations
    ) VALUES(1,'published-test','catalog-baseline-approved-manifest/v1',?,?,?,?,?,?,?,1,1,1)`)
      .bind(hash, "b".repeat(64), "c".repeat(64), "d".repeat(64), "e".repeat(64), "f".repeat(64), "0".repeat(64))
      .run();
    const auth = await login();
    const post = (path: string, body: Record<string, unknown>, method = "POST") =>
      SELF.fetch(`${origin}${path}`, { method, headers: headers(auth), body: JSON.stringify(body) });

    expect((await post("/api/admin/courses", { code: "BYPASS", name: "绕过", category: "general" })).status).toBe(409);
    expect((await post("/api/admin/teachers", { sourceTeacherLabel: "绕过教师", name: "绕过教师" })).status).toBe(409);
    expect((await post("/api/admin/courses/1/teachers", { teacherIds: [1] }, "PUT")).status).toBe(409);
    expect((await post("/api/admin/courses", { id: 1, code: "TEST101", name: "允许编辑", category: "general", teacherIds: [1] })).status).toBe(200);
    expect((await post("/api/admin/teachers", { id: 1, sourceTeacherLabel: "测试教师", name: "允许编辑" })).status).toBe(200);
  });
});
