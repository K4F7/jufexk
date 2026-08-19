import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_API_CACHE_CONTROL,
  PUBLIC_CATALOG_CACHE_CONTROL,
  PUBLIC_CATALOG_CACHE_TAG,
  purgePublicCatalogCache,
  setPublicCatalogCacheHeaders,
} from "../src/lib/public-catalog-cache";

const origin = "https://example.com";

const isPublicCatalogCache = (response: Response) => {
  expect(response.headers.get("Cache-Control")).toBe(PUBLIC_CATALOG_CACHE_CONTROL);
  expect(response.headers.get("Cache-Tag")).toBe(PUBLIC_CATALOG_CACHE_TAG);
};

const isNotPublicCatalogCache = (response: Response) => {
  expect(response.headers.get("Cache-Control")).toBe(DEFAULT_API_CACHE_CONTROL);
  expect(response.headers.get("Cache-Tag")).not.toBe(PUBLIC_CATALOG_CACHE_TAG);
};

describe("public catalog cache headers", () => {
  it.each([
    "/api/courses",
    "/api/teachers",
    "/api/courses/options",
    "/api/courses/departments",
  ])("marks %s as a public catalog cache entry", async (path) => {
    const response = await SELF.fetch(`${origin}${path}`);
    expect(response.status).toBe(200);
    isPublicCatalogCache(response);
  });

  it("keeps /api/config uncached", async () => {
    const response = await SELF.fetch(`${origin}/api/config`);
    expect(response.status).toBe(200);
    isNotPublicCatalogCache(response);
  });

  it("keeps admin routes uncached", async () => {
    const response = await SELF.fetch(`${origin}/api/admin/session`);
    expect(response.status).toBe(401);
    isNotPublicCatalogCache(response);
  });

  it("does not publicly cache course detail", async () => {
    const response = await SELF.fetch(`${origin}/api/courses/1`);
    expect(response.status).toBe(200);
    isNotPublicCatalogCache(response);
  });
});

describe("public catalog cache helpers", () => {
  it("sets the public catalog Cache-Control and Cache-Tag", () => {
    const headers = new Map<string, string>();
    setPublicCatalogCacheHeaders({
      header: (name, value) => headers.set(name, value),
    });
    expect(headers.get("Cache-Control")).toBe(PUBLIC_CATALOG_CACHE_CONTROL);
    expect(headers.get("Cache-Tag")).toBe(PUBLIC_CATALOG_CACHE_TAG);
  });

  it("purges the public-catalog tag when the runtime supports it", async () => {
    const purge = vi.fn().mockResolvedValue(undefined);
    await purgePublicCatalogCache({
      executionCtx: { cache: { purge } },
    });
    expect(purge).toHaveBeenCalledWith({ tags: [PUBLIC_CATALOG_CACHE_TAG] });
  });

  it("swallows purge failures so writes can still succeed", async () => {
    await expect(
      purgePublicCatalogCache({
        executionCtx: {
          cache: {
            purge: () => {
              throw new Error("cache purge unavailable");
            },
          },
        },
      }),
    ).resolves.toBeUndefined();
    await expect(purgePublicCatalogCache({})).resolves.toBeUndefined();
  });
});
