import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  catalogTeacherFromApi,
  downloadAvatar,
  shouldDownloadAvatar,
} from "../scripts/cta-sync/download";
import type { CtaTeacherCandidate } from "../src/cta-teacher-homepage";
import type { CtaTeacherClient } from "../src/cta-teacher-sync";

const REAL_PHOTO_ID = "fc558c61ffb76f65b78e8f142265bf83";

function candidate(
  overrides: Partial<CtaTeacherCandidate> = {},
): CtaTeacherCandidate {
  return {
    uid: 19699165,
    realname: "张曦凤",
    photo: REAL_PHOTO_ID,
    deptName: "区域国别研究院",
    ...overrides,
  };
}

function client(overrides: Partial<CtaTeacherClient> = {}): CtaTeacherClient {
  return {
    async searchTeachers() {
      return { candidates: [], total: 0, truncated: false };
    },
    async fetchTeacherPhotoId() {
      return null;
    },
    async fetchPhoto() {
      return null;
    },
    ...overrides,
  };
}

describe("shouldDownloadAvatar", () => {
  it("skips catalog teachers that already have avatar_url", () => {
    expect(
      shouldDownloadAvatar({ avatar_url: "/api/teachers/9/avatar" }),
    ).toBe(false);
    expect(
      shouldDownloadAvatar({ avatarUrl: "/api/teachers/9/avatar" }),
    ).toBe(false);
    expect(shouldDownloadAvatar({ avatar_url: "  " })).toBe(true);
    expect(shouldDownloadAvatar({ avatarUrl: null })).toBe(true);
    expect(shouldDownloadAvatar({})).toBe(true);
  });

  it("reads avatar_url from the public teachers catalog payload", () => {
    expect(
      catalogTeacherFromApi({
        id: 9,
        name: "张曦凤",
        department: "会计学院",
        avatar_url: "/api/teachers/9/avatar",
      }).avatarUrl,
    ).toBe("/api/teachers/9/avatar");
    expect(
      catalogTeacherFromApi({
        id: 10,
        name: "张强",
        avatar_url: null,
      }).avatarUrl,
    ).toBeNull();
  });
});

describe("downloadAvatar", () => {
  it("treats fetchPhoto null on a real URL as retryable, not a default skip", async () => {
    const result = await downloadAvatar(
      client({
        async fetchPhoto() {
          return null;
        },
      }),
      candidate(),
    );
    expect(result).toMatchObject({
      sha256: null,
      skippedDefaultAvatar: false,
      retryable: true,
      bytes: null,
    });
  });

  it("permanently skips a missing photo id without calling it a default silhouette", async () => {
    const result = await downloadAvatar(
      client({
        async fetchTeacherPhotoId() {
          return null;
        },
      }),
      candidate({ photo: null }),
    );
    expect(result).toMatchObject({
      sha256: null,
      skippedDefaultAvatar: false,
      retryable: false,
    });
  });

  it("permanently skips confirmed defaulticon photos", async () => {
    const result = await downloadAvatar(
      client({
        async fetchTeacherPhotoId() {
          return "defaulticon";
        },
        async fetchPhoto() {
          throw new Error("should not fetch defaulticon");
        },
      }),
      candidate({ photo: "defaulticon" }),
    );
    expect(result).toMatchObject({
      sha256: null,
      skippedDefaultAvatar: true,
      retryable: false,
    });
  });

  it("marks a thrown fetch as retryable", async () => {
    const result = await downloadAvatar(
      client({
        async fetchPhoto() {
          throw new TypeError("fetch failed");
        },
      }),
      candidate(),
    );
    expect(result).toMatchObject({
      sha256: null,
      skippedDefaultAvatar: false,
      retryable: true,
    });
  });

  it("stores sha256 and bytes on a successful download", async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const result = await downloadAvatar(
      client({
        async fetchPhoto(url) {
          return { bytes, contentType: "image/png", url };
        },
      }),
      candidate(),
    );
    expect(result.retryable).toBe(false);
    expect(result.skippedDefaultAvatar).toBe(false);
    expect(result.contentType).toBe("image/png");
    expect(result.bytes).toEqual(bytes);
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
