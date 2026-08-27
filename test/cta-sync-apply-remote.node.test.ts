import { describe, expect, it } from "vitest";
import {
  avatarInsertSql,
  chunkStatements,
  homepageUpdateStatements,
} from "../scripts/cta-sync/apply-remote";
import { ctaHomepageUrl } from "../src/cta-teacher-homepage";

describe("CTA remote D1 apply SQL", () => {
  it("updates unique homepage rows without touching locked teachers", () => {
    const sql = homepageUpdateStatements([
      {
        teacherId: 9,
        name: "张曦凤",
        department: "会计学院",
        match: "unique",
        homepageUrl: ctaHomepageUrl(19699165),
        ctaUid: 19699165,
        avatarSha256: "abc",
        skippedDefaultAvatar: false,
        avatarBytes: 12,
        contentType: "image/webp",
      },
      {
        teacherId: 10,
        name: "张强",
        department: null,
        match: "ambiguous",
        homepageUrl: null,
        ctaUid: null,
        avatarSha256: null,
        skippedDefaultAvatar: false,
        avatarBytes: null,
        contentType: null,
      },
    ]);
    expect(sql[0]).toContain("homepage_match='unique'");
    expect(sql[0]).toContain("homepage_locked,0)=0");
    expect(sql[0]).not.toContain("avatar_sha256");
    expect(sql[1]).toContain("avatar_sha256='abc'");
    expect(sql[1]).toContain("image_locked,0)=0");
    expect(sql[2]).toContain("homepage_match='ambiguous'");
    expect(sql[2]).toContain("NOT IN ('unique','manual')");
  });

  it("inserts WebP bytes as a hex blob only when the photo is not locked", () => {
    const sql = avatarInsertSql(
      967,
      "cfa89ccd",
      Uint8Array.from([0x52, 0x49, 0x46, 0x46]),
      ctaHomepageUrl(20004314),
    );
    expect(sql).toContain("X'52494646'");
    expect(sql).toContain("'image/webp'");
    expect(sql).toContain("SELECT 967,");
    expect(sql).toContain("image_locked,0)=0");
    expect(sql).toContain("ON CONFLICT(teacher_id) DO UPDATE");
  });

  it("packs statements under the D1 execute size budget", () => {
    const chunks = chunkStatements(["AAAA", "BBBB", "CCCC"], 12);
    expect(chunks).toEqual(["AAAA;BBBB", "CCCC"]);
  });
});
