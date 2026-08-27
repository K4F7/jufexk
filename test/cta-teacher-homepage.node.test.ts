import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createHttpCtaClient,
  fetchCtaTeacherDirectory,
} from "../src/cta-teacher-sync";
import {
  CTA_DEFAULT_AVATAR_SHA256,
  catalogSearchNames,
  chooseCtaMatch,
  ctaHomepageUrl,
  ctaPhotoUrl,
  departmentsCompatible,
  isAllowedCtaHomepageUrl,
  isDefaultCtaAvatarSha256,
  isDefaultCtaAvatarUrl,
  isUsableCtaPhotoId,
  toPublicTeacher,
} from "../src/cta-teacher-homepage";

const defaultIcon = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/cta-defaulticon.png"),
);

describe("CTA default avatar", () => {
  it("pins the CTA defaulticon.png bytes the user identified", () => {
    expect(createHash("sha256").update(defaultIcon).digest("hex")).toBe(
      CTA_DEFAULT_AVATAR_SHA256,
    );
    expect(isDefaultCtaAvatarSha256(CTA_DEFAULT_AVATAR_SHA256)).toBe(true);
    expect(isDefaultCtaAvatarUrl("http://cta.jxufe.edu.cn/_jxcj/images/defaulticon.png")).toBe(
      true,
    );
    expect(isDefaultCtaAvatarUrl("/_jxcj/images/defaulticon.png")).toBe(true);
    expect(
      isDefaultCtaAvatarUrl(
        "https://p.ananas.chaoxing.com/star3/origin/fc558c61ffb76f65b78e8f142265bf83.png",
      ),
    ).toBe(false);
    expect(isUsableCtaPhotoId("defaulticon")).toBe(false);
    expect(ctaPhotoUrl("defaulticon")).toBeNull();
    expect(ctaPhotoUrl("fc558c61ffb76f65b78e8f142265bf83")).toBe(
      "https://p.ananas.chaoxing.com/star3/origin/fc558c61ffb76f65b78e8f142265bf83.png",
    );
  });
});

describe("CTA homepage matching", () => {
  it("keeps catalog duplicate suffixes as a fallback search name", () => {
    expect(catalogSearchNames("张强1")).toEqual(["张强1", "张强"]);
    expect(catalogSearchNames("张强")).toEqual(["张强"]);
  });

  it("binds a unique name, uses department only to break ties, and refuses guesses", () => {
    const unique = chooseCtaMatch(
      { name: "张曦凤", department: "区域国别研究院" },
      [
        {
          uid: 19699165,
          realname: "张曦凤",
          photo: "abc",
          deptName: "区域国别研究院",
        },
      ],
    );
    expect(unique).toEqual({
      kind: "unique",
      candidate: expect.objectContaining({ uid: 19699165 }),
    });
    expect(
      chooseCtaMatch(
        { name: "张曦凤", department: "金融学院" },
        [
          {
            uid: 19699165,
            realname: "张曦凤",
            photo: "abc",
            deptName: "区域国别研究院",
          },
        ],
      ),
    ).toEqual({ kind: "none" });

    const tied = chooseCtaMatch(
      { name: "张强", department: "计算机与人工智能学院" },
      [
        {
          uid: 1,
          realname: "张强",
          photo: "aaa",
          deptName: "计算机与人工智能学院（格里菲斯数智学院）、财经大数据教育部工程研究中心",
        },
        {
          uid: 2,
          realname: "张强",
          photo: "bbb",
          deptName: "金融学院、科技金融研究中心",
        },
      ],
    );
    expect(tied.kind).toBe("unique");
    if (tied.kind === "unique") expect(tied.candidate.uid).toBe(1);

    const ambiguous = chooseCtaMatch(
      { name: "张强", department: "" },
      [
        {
          uid: 1,
          realname: "张强",
          photo: "aaa",
          deptName: "计算机与人工智能学院",
        },
        { uid: 2, realname: "张强", photo: "bbb", deptName: "金融学院" },
      ],
    );
    expect(ambiguous).toEqual({ kind: "ambiguous" });
    expect(
      chooseCtaMatch({ name: "不存在的老师" }, [
        { uid: 1, realname: "张强", photo: "aaa", deptName: "金融学院" },
      ]),
    ).toEqual({ kind: "none" });
  });

  it("treats overlapping college names as compatible and rejects empty sides", () => {
    expect(
      departmentsCompatible(
        "计算机与人工智能学院",
        "计算机与人工智能学院（格里菲斯数智学院）、财经大数据教育部工程研究中心",
      ),
    ).toBe(true);
    expect(departmentsCompatible("", "金融学院")).toBe(false);
  });

  it("only accepts CTA teacher detail URLs", () => {
    expect(
      isAllowedCtaHomepageUrl(ctaHomepageUrl(136660080)),
    ).toBe(true);
    expect(
      isAllowedCtaHomepageUrl("https://example.com/home/teacherInfo/detail?fid=1&uid=2"),
    ).toBe(false);
  });
});

describe("public teacher projection", () => {
  it("hides CTA internals and never publishes the default silhouette", () => {
    const publicTeacher = toPublicTeacher({
      id: 9,
      name: "张曦凤",
      cta_fid: 109051,
      cta_uid: 19699165,
      homepage_url: ctaHomepageUrl(19699165),
      homepage_locked: 0,
      homepage_match: "unique",
      image_locked: 0,
      avatar_sha256: CTA_DEFAULT_AVATAR_SHA256,
      cta_synced_at: "2026-08-27",
    });
    expect(publicTeacher).toMatchObject({
      id: 9,
      name: "张曦凤",
      official_homepage_url: ctaHomepageUrl(19699165),
      avatar_url: null,
    });
    expect(
      toPublicTeacher({
        id: 9,
        homepage_url: ctaHomepageUrl(19699165),
        homepage_locked: 1,
        image_locked: 0,
        avatar_sha256: null,
      }).official_homepage_url,
    ).toBe(ctaHomepageUrl(19699165));
    expect(publicTeacher).not.toHaveProperty("cta_uid");
    expect(publicTeacher).not.toHaveProperty("avatar_sha256");
    expect(publicTeacher).not.toHaveProperty("image_locked");
  });
});

describe("CTA photo fetch", () => {
  it("sends Referer and User-Agent so the Chaoxing CDN allows the file", async () => {
    const seen: Record<string, string | null> = {};
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const client = createHttpCtaClient(async (_url, init) => {
      const headers = new Headers(init?.headers);
      seen.referer = headers.get("referer");
      seen.userAgent = headers.get("user-agent");
      return new Response(png, { headers: { "content-type": "image/png" } });
    });
    const photo = await client.fetchPhoto(
      "https://p.ananas.chaoxing.com/star3/origin/abcdef12.png",
    );
    expect(seen.referer).toBe("http://cta.jxufe.edu.cn/");
    expect(seen.userAgent).toMatch(/Mozilla\/5\.0/);
    expect(photo?.bytes.byteLength).toBe(8);
  });
});

describe("CTA directory crawl", () => {
  it("pages through the public index once", async () => {
    const pages = [
      [{ uid: 1, realname: "甲", photo: "aaaaaaaa", deptName: "A" }],
      [{ uid: 2, realname: "乙", photo: "bbbbbbbb", deptName: "B" }],
    ];
    const directory = await fetchCtaTeacherDirectory({
      async searchTeachers(query) {
        const candidates = pages[(query.page ?? 1) - 1] ?? [];
        return { candidates, total: 2, truncated: query.page === 1 };
      },
      async fetchTeacherPhotoId() {
        return null;
      },
      async fetchPhoto() {
        return null;
      },
    });
    expect(directory.map((item) => item.uid)).toEqual([1, 2]);
  });
});
