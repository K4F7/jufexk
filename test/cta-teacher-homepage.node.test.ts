import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
    expect(publicTeacher).not.toHaveProperty("cta_uid");
    expect(publicTeacher).not.toHaveProperty("avatar_sha256");
    expect(publicTeacher).not.toHaveProperty("image_locked");
  });
});
