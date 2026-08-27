/**
 * 把一次性同步下来的 CTA 原图压成 WebP，再写入站点。
 *
 *   pnpm cta-sync:webp
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { CTA_DEFAULT_AVATAR_SHA256, sha256Hex } from "../../src/cta-teacher-homepage";
import { homepageSql, type SyncRow } from "./shared";

export const AVATAR_WEBP_MAX_EDGE = 384;
export const AVATAR_WEBP_QUALITY = 82;

export async function encodeTeacherAvatarWebp(
  input: Uint8Array,
): Promise<Uint8Array> {
  const encoded = await sharp(input)
    .rotate()
    .resize(AVATAR_WEBP_MAX_EDGE, AVATAR_WEBP_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: AVATAR_WEBP_QUALITY, effort: 4 })
    .toBuffer();
  return new Uint8Array(encoded);
}

export async function compressStoredAvatars(output: string): Promise<{
  converted: number;
  bytesIn: number;
  bytesOut: number;
}> {
  const bindingsPath = resolve(output, "bindings.json");
  const rows = JSON.parse(await readFile(bindingsPath, "utf8")) as SyncRow[];
  const avatarDir = resolve(output, "avatars");
  await mkdir(avatarDir, { recursive: true });

  let converted = 0;
  let bytesIn = 0;
  let bytesOut = 0;
  for (const row of rows) {
    if (!row.avatarSha256) continue;
    const raw = await readFile(resolve(avatarDir, `${row.teacherId}.bin`)).catch(
      () => null,
    );
    if (!raw?.byteLength) continue;
    const webp = await encodeTeacherAvatarWebp(new Uint8Array(raw));
    const sha = await sha256Hex(webp);
    if (sha === CTA_DEFAULT_AVATAR_SHA256) {
      row.avatarSha256 = null;
      row.avatarBytes = null;
      row.contentType = null;
      continue;
    }
    await writeFile(resolve(avatarDir, `${row.teacherId}.webp`), webp);
    bytesIn += raw.byteLength;
    bytesOut += webp.byteLength;
    row.avatarSha256 = sha;
    row.avatarBytes = webp.byteLength;
    row.contentType = "image/webp";
    converted += 1;
  }

  const summaryPath = resolve(output, "summary.json");
  const summary = JSON.parse(await readFile(summaryPath, "utf8")) as Record<
    string,
    unknown
  >;
  summary.avatarsStored = rows.filter((row) => row.avatarSha256).length;
  summary.avatarsWebp = converted;
  summary.avatarBytesIn = bytesIn;
  summary.avatarBytesOut = bytesOut;
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  await writeFile(bindingsPath, JSON.stringify(rows, null, 2));
  await writeFile(resolve(output, "homepage-updates.sql"), homepageSql(rows));
  return { converted, bytesIn, bytesOut };
}

async function main() {
  const { values } = parseArgs({
    options: {
      output: { type: "string", default: ".local-data/cta-sync" },
    },
  });
  const output = resolve(values.output || ".local-data/cta-sync");
  const result = await compressStoredAvatars(output);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
