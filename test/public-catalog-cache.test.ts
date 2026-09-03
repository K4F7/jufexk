import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_API_CACHE_CONTROL,
  PUBLIC_CATALOG_CACHE_CONTROL,
  PUBLIC_CATALOG_CACHE_TAG,
  PUBLIC_CONFIG_CACHE_CONTROL,
  PUBLIC_CONFIG_CACHE_TAG,
  PUBLIC_DETAIL_CACHE_CONTROL,
  PUBLIC_DETAIL_CACHE_TAG,
  purgePublicCatalogCache,
  isPublicCourseListCacheableRequest,
  matchPublicCatalogCache,
  putPublicCatalogCache,
  setPublicCatalogCacheHeaders,
  shouldUsePublicCatalogCacheApi,
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

const isScopedPublicCache = (
  response: Response,
  control: string,
  tag: string,
) => {
  expect(response.headers.get("Cache-Control")).toBe(control);
  expect(response.headers.get("Cache-Tag")).toBe(tag);
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

  it("short-caches anonymous /api/config", async () => {
    const response = await SELF.fetch(`${origin}/api/config`);
    expect(response.status).toBe(200);
    isScopedPublicCache(response, PUBLIC_CONFIG_CACHE_CONTROL, PUBLIC_CONFIG_CACHE_TAG);
    expect(await response.json()).toMatchObject({ showScheduleNav: false });
  });

  it("shows schedule nav on a loopback Worker host", async () => {
    const response = await SELF.fetch("http://127.0.0.1:8787/api/config");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ showScheduleNav: true });
  });

  it("keeps admin routes uncached", async () => {
    const response = await SELF.fetch(`${origin}/api/admin/session`);
    expect(response.status).toBe(401);
    isNotPublicCatalogCache(response);
  });

  it("publicly caches anonymous course detail", async () => {
    const response = await SELF.fetch(`${origin}/api/courses/1`);
    expect(response.status).toBe(200);
    isScopedPublicCache(response, PUBLIC_DETAIL_CACHE_CONTROL, PUBLIC_DETAIL_CACHE_TAG);
  });

  it("caches a plain course list even with the guest voter marker", async () => {
    const response = await SELF.fetch(`${origin}/api/courses?pageSize=1`, {
      headers: { Cookie: "jufexk_voter=abc" },
    });
    expect(response.status).toBe(200);
    isPublicCatalogCache(response);
    const body = await response.json<Record<string, unknown>>();
    expect(JSON.stringify(body)).not.toContain("viewer_");
    expect(JSON.stringify(body)).not.toContain("admin");
  });

  it("caches relation lists with the guest voter marker", async () => {
    const response = await SELF.fetch(`${origin}/api/courses?view=relations&pageSize=1`, {
      headers: { Cookie: "jufexk_voter=abc" },
    });
    expect(response.status).toBe(200);
    isPublicCatalogCache(response);
    const body = await response.json<Record<string, unknown>>();
    expect(JSON.stringify(body)).not.toContain("viewer_");
  });

  it.each([
    "jufexk_voter=abc",
    "jufexk_user_session=abc",
    "jufexk_admin=abc",
    "jufexk_ehall_session=abc",
  ])("keeps course detail no-store with credential cookie %s", async (cookie) => {
    const response = await SELF.fetch(`${origin}/api/courses/1`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    isNotPublicCatalogCache(response);
  });

  it("publicly caches anonymous course reviews but not voter requests", async () => {
    const anonymous = await SELF.fetch(`${origin}/api/courses/1/reviews?teacherId=1&sort=recognized`);
    expect(anonymous.status).toBe(200);
    isScopedPublicCache(anonymous, PUBLIC_DETAIL_CACHE_CONTROL, PUBLIC_DETAIL_CACHE_TAG);
    const personalized = await SELF.fetch(`${origin}/api/courses/1/reviews?teacherId=1&sort=recognized`, {
      headers: { Cookie: "jufexk_voter=abc" },
    });
    expect(personalized.status).toBe(200);
    isNotPublicCatalogCache(personalized);
  });

  it("caches latest public reviews with the guest voter marker", async () => {
    const response = await SELF.fetch(`${origin}/api/reviews/latest?pageSize=1`, {
      headers: { Cookie: "jufexk_voter=abc" },
    });
    expect(response.status).toBe(200);
    isPublicCatalogCache(response);
    expect(JSON.stringify(await response.json())).not.toContain("viewer_");
  });

  it("caches latest public reviews with anonymous voter and csrf markers", async () => {
    const response = await SELF.fetch(`${origin}/api/reviews/latest?pageSize=1`, {
      headers: { Cookie: "jufexk_voter=abc; jufexk_user_csrf=csrf" },
    });
    expect(response.status).toBe(200);
    isPublicCatalogCache(response);
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

  it("allows only the voter marker for anonymous course-list caching", () => {
    const request = (cookie?: string) => ({
      req: { header: (name: string) => name === "Cookie" ? cookie : undefined },
    });
    expect(isPublicCourseListCacheableRequest(request("jufexk_voter=abc"))).toBe(true);
    expect(isPublicCourseListCacheableRequest(request("jufexk_voter=abc; jufexk_user_session=abc"))).toBe(false);
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

  it("matches a URL-only Cache API key even if the browser sent cookies", async () => {
    const store = new Map<string, Response>();
    const cache = {
      match: async (request: RequestInfo | URL) =>
        store.get(new Request(request).url),
      put: async (request: RequestInfo | URL, response: Response) => {
        store.set(new Request(request).url, response);
      },
    };
    const url = "https://example.com/api/courses?view=relations&page=1";
    await putPublicCatalogCache(
      url,
      new Response('{"total":1}', {
        headers: { "Cache-Control": PUBLIC_CATALOG_CACHE_CONTROL },
      }),
      cache,
    );
    const hit = await matchPublicCatalogCache(url, cache);
    expect(await hit?.text()).toBe('{"total":1}');
    expect(shouldUsePublicCatalogCacheApi({ ORDINARY_USER_TEST_AUTH_SECRET: "x" })).toBe(
      false,
    );
    expect(shouldUsePublicCatalogCacheApi({})).toBe(true);
  });
});
