import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";

describe("public course catalog", () => {
  it("returns the full list when filter params are present but empty", async () => {
    const response = await SELF.fetch(
      `${origin}/api/courses?q=&category=&department=&teacherId=&page=1`,
    );
    expect(response.status).toBe(200);
    const body = await response.json<{ items: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("returns the same list with and without empty filter params", async () => {
    const bare = await SELF.fetch(`${origin}/api/courses`);
    const filtered = await SELF.fetch(
      `${origin}/api/courses?q=&category=&department=&teacherId=&page=1`,
    );
    const bareBody = await bare.json<{ total: number }>();
    const filteredBody = await filtered.json<{ total: number }>();
    expect(filteredBody.total).toBe(bareBody.total);
  });
});
