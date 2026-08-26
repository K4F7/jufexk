import { expect, test } from "@playwright/test";

test("serves robots.txt as a plain-text static asset", async ({ request }) => {
  const response = await request.get("/robots.txt");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain(?:;|$)/);
  expect(await response.text()).toBe("User-agent: *\nAllow: /\n");
});
