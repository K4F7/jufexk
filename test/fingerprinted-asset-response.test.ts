import { describe, expect, it } from "vitest";
import worker from "../src/index";

function envWithAssets(assetResponse: Response): Cloudflare.Env {
  return {
    ASSETS: {
      fetch: () => Promise.resolve(assetResponse),
    },
  } as unknown as Cloudflare.Env;
}

describe("fingerprinted asset Worker route", () => {
  it("does not cache SPA HTML as a hashed JavaScript module", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/assets/DetailFeedback-dcFM90zF.js"),
      envWithAssets(
        new Response("<!doctype html>", {
          status: 200,
          headers: {
            "content-type": "text/html",
            "cache-control": "public, max-age=31536000, immutable",
          },
        }),
      ),
      {} as ExecutionContext,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).not.toMatch(/html/i);
  });

  it("returns a real hashed JavaScript chunk", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/assets/CourseDetailPage-yiCQ_A6U.js"),
      envWithAssets(
        new Response("export{}", {
          status: 200,
          headers: {
            "content-type": "text/javascript",
            "cache-control": "public, max-age=31536000, immutable",
          },
        }),
      ),
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await response.text()).toBe("export{}");
  });
});
