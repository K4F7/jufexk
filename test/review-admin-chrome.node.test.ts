import { afterEach, describe, expect, it } from "vitest";
import {
  readReviewAdminChromeVisible,
  resolveReviewAdminChromeVisible,
  resolveReviewAdminDockVisible,
  REVIEW_ADMIN_CHROME_STORAGE_KEY,
  writeReviewAdminChromeVisible,
} from "../src/lib/review-admin-chrome";

describe("review admin chrome preference", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };

  afterEach(() => store.clear());

  it("defaults off and persists the dock switch in session storage", () => {
    expect(readReviewAdminChromeVisible(storage)).toBe(false);
    expect(
      resolveReviewAdminChromeVisible({ storedOn: false, preview: null }),
    ).toBe(false);

    writeReviewAdminChromeVisible(storage, true);
    expect(storage.getItem(REVIEW_ADMIN_CHROME_STORAGE_KEY)).toBe("1");
    expect(readReviewAdminChromeVisible(storage)).toBe(true);
    expect(
      resolveReviewAdminChromeVisible({ storedOn: true, preview: null }),
    ).toBe(true);

    writeReviewAdminChromeVisible(storage, false);
    expect(storage.getItem(REVIEW_ADMIN_CHROME_STORAGE_KEY)).toBeNull();
    expect(readReviewAdminChromeVisible(storage)).toBe(false);
  });

  it("never shows the dock to non-admins unless preview=admin", () => {
    expect(
      resolveReviewAdminDockVisible({ adminAuthed: false, preview: null }),
    ).toBe(false);
    expect(
      resolveReviewAdminDockVisible({
        adminAuthed: false,
        preview: "review-comments",
      }),
    ).toBe(false);
    expect(
      resolveReviewAdminDockVisible({ adminAuthed: true, preview: null }),
    ).toBe(true);
    expect(
      resolveReviewAdminDockVisible({ adminAuthed: false, preview: "admin" }),
    ).toBe(true);
  });

  it("forces chrome on only for preview=admin", () => {
    expect(
      resolveReviewAdminChromeVisible({
        storedOn: false,
        preview: "review-comments",
      }),
    ).toBe(false);
    expect(
      resolveReviewAdminChromeVisible({ storedOn: false, preview: "admin" }),
    ).toBe(true);
  });
});
