import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCatalogDataCache,
  getCatalogData,
  invalidateCatalogData,
  peekCatalogData,
  prefetchCourseCatalogBrowse,
} from "../src/lib/catalog-data-cache";

afterEach(() => {
  vi.useRealTimers();
  clearCatalogDataCache();
});

describe("peekCatalogData", () => {
  it("returns a stored value for the same canonical URL", async () => {
    await getCatalogData("/api/courses?sort=latest&category=pe", async () => ({
      items: 1,
    }));
    expect(peekCatalogData("/api/courses?category=pe&sort=latest")).toEqual({
      items: 1,
    });
  });

  it("misses before load and while a request is in-flight", async () => {
    const url = "/api/courses?sort=hot";
    expect(peekCatalogData(url)).toBeUndefined();

    let resolveLoad: (value: string) => void = () => undefined;
    const pending = getCatalogData(
      url,
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    expect(peekCatalogData(url)).toBeUndefined();

    resolveLoad("ok");
    await expect(pending).resolves.toBe("ok");
    expect(peekCatalogData(url)).toBe("ok");
  });

  it("misses after the TTL expires", async () => {
    vi.useFakeTimers();
    const url = "/api/courses?sort=latest";
    await getCatalogData(url, async () => "cached", 1);
    expect(peekCatalogData(url)).toBe("cached");
    vi.advanceTimersByTime(2);
    expect(peekCatalogData(url)).toBeUndefined();
  });

  it("misses after invalidateCatalogData(prefix)", async () => {
    await getCatalogData("/api/courses?sort=latest", async () => "cached");
    invalidateCatalogData("/api/courses");
    expect(peekCatalogData("/api/courses?sort=latest")).toBeUndefined();
  });

  it("does not store a failed load", async () => {
    const url = "/api/courses?sort=latest";
    await expect(
      getCatalogData(url, async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");
    expect(peekCatalogData(url)).toBeUndefined();
  });
});

describe("prefetchCourseCatalogBrowse", () => {
  it("is a no-op without navigator so Node tests never hit the network", () => {
    expect(() => prefetchCourseCatalogBrowse()).not.toThrow();
    expect(peekCatalogData("/api/courses?view=relations&page=1")).toBeUndefined();
  });
});
