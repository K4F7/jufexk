import { describe, expect, it } from "vitest";
import {
  DEV_ATLAS_PARAM,
  DEV_PREVIEW_PARAM,
  previewUnreadNotificationCount,
  resolveDevAtlasSession,
  resolveDevPreview,
} from "../src/lib/dev-preview";

describe("DEV preview guards", () => {
  it("ignores preview and atlas in production-like builds", () => {
    const search = new URLSearchParams({
      [DEV_PREVIEW_PARAM]: "mfa",
      [DEV_ATLAS_PARAM]: "1",
    });
    expect(resolveDevPreview(false, search)).toBeNull();
    expect(resolveDevAtlasSession(false, search)).toBe(false);
  });

  it("reads preview and atlas only when DEV", () => {
    expect(
      resolveDevPreview(true, new URLSearchParams(`${DEV_PREVIEW_PARAM}=empty`)),
    ).toBe("empty");
    expect(
      resolveDevAtlasSession(true, new URLSearchParams(`${DEV_ATLAS_PARAM}=1`)),
    ).toBe(true);
    expect(
      resolveDevAtlasSession(true, new URLSearchParams(`${DEV_PREVIEW_PARAM}=error`)),
    ).toBe(true);
    expect(resolveDevAtlasSession(true, new URLSearchParams())).toBe(false);
  });

  it("reuses filled/empty notice mocks for the header unread badge", () => {
    expect(previewUnreadNotificationCount(null)).toBeNull();
    expect(previewUnreadNotificationCount("error")).toBeNull();
    expect(previewUnreadNotificationCount("empty")).toBe(0);
    expect(previewUnreadNotificationCount("filled")).toBe(2);
  });
});
