import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://example.com";

async function login() {
  const response = await SELF.fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": "198.18.30.1",
    },
    body: JSON.stringify({ password: "test-password" }),
  });
  const body = await response.json<{ csrfToken: string }>();
  const cookie = (response.headers as Headers & { getSetCookie(): string[] })
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return {
    "Content-Type": "application/json",
    Cookie: cookie,
    Origin: origin,
    "X-CSRF-Token": body.csrfToken,
  };
}

describe("review template kind API contract", () => {
  it("offers only the optional sports-only public filter", async () => {
    const response = await SELF.fetch(`${origin}/api/courses?category=sports`);
    const body = await response.json<{ items: Array<{ category: string }> }>();
    expect(response.status).toBe(200);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.category === "sports")).toBe(true);
    for (const obsolete of ["required", "elective", "general", "major", "pe"])
      expect((await SELF.fetch(`${origin}/api/courses?category=${obsolete}`)).status).toBe(400);
  });

  it("accepts all new values and rejects old or missing values on writes", async () => {
    const headers = await login();
    for (const [index, category] of ["general", "sports"].entries()) {
      const response = await SELF.fetch(`${origin}/api/admin/courses`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code: `CATEGORY-${index}`,
          name: `类别课程 ${index}`,
          category,
        }),
      });
      expect(response.status).toBe(200);
    }
    for (const category of ["", "required", "elective", "major", "pe"]) {
      const response = await SELF.fetch(`${origin}/api/admin/courses`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code: `WRITE-${category || "EMPTY"}`,
          name: "写入类别",
          category,
        }),
      });
      expect(response.status).toBe(400);
    }
  });
});
