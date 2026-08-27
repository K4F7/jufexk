import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  AVATAR_WEBP_MAX_EDGE,
  encodeTeacherAvatarWebp,
} from "../scripts/cta-sync/to-webp";

describe("CTA avatar WebP compression", () => {
  it("encodes a PNG into a smaller WebP within the avatar edge", async () => {
    const png = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 48, g: 96, b: 160 },
      },
    })
      .png()
      .toBuffer();
    const webp = await encodeTeacherAvatarWebp(new Uint8Array(png));
    expect(Buffer.from(webp.subarray(8, 12)).toString("ascii")).toBe("WEBP");
    expect(webp.byteLength).toBeLessThan(png.byteLength);
    const info = await sharp(webp).metadata();
    expect(info.format).toBe("webp");
    expect(info.width).toBeLessThanOrEqual(AVATAR_WEBP_MAX_EDGE);
    expect(info.height).toBeLessThanOrEqual(AVATAR_WEBP_MAX_EDGE);
  });
});
