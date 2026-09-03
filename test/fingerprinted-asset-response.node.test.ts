import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fingerprintedAssetMissingResponse,
  rejectSpaHtmlForFingerprintedAsset,
} from "../src/lib/fingerprinted-asset-response";

function htmlShell(): Response {
  return new Response("<!doctype html><html lang=\"zh-CN\"></html>", {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

function javascriptChunk(): Response {
  return new Response("export{}", {
    status: 200,
    headers: {
      "content-type": "text/javascript",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

describe("fingerprinted asset SPA poison", () => {
  it("404s HTML fallback for a hashed JS URL and does not inherit immutable cache", async () => {
    const response = rejectSpaHtmlForFingerprintedAsset(
      "/assets/DetailFeedback-dcFM90zF.js",
      htmlShell(),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/text\/plain/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("Not found");
  });

  it("passes through a real JavaScript chunk with its immutable cache", async () => {
    const original = javascriptChunk();
    const response = rejectSpaHtmlForFingerprintedAsset(
      "/assets/CourseDetailPage-yiCQ_A6U.js",
      original,
    );
    expect(response).toBe(original);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("does not rewrite HTML served for a page route", () => {
    const original = htmlShell();
    expect(rejectSpaHtmlForFingerprintedAsset("/courses/378", original)).toBe(
      original,
    );
  });

  it("missing hashed assets are no-store 404s", () => {
    const response = fingerprintedAssetMissingResponse();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("runs the Worker first for /assets/* so SPA fallback cannot cache HTML as JS", () => {
    const source = readFileSync(resolve("wrangler.jsonc"), "utf8");
    expect(source).toMatch(
      /"run_worker_first"\s*:\s*\[[^\]]*\/assets\/\*[^\]]*\]/s,
    );
  });
});
