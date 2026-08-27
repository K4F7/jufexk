/**
 * 一次性从 CTA 公开索引同步教师主页与真人头像。
 * 默认剪影 defaulticon.png 不下载、不入库。超星图床需要 Referer + UA。
 *
 *   pnpm cta-sync
 *   pnpm cta-sync --catalog-origin=https://courses.sein.moe
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  CTA_DEFAULT_AVATAR_SHA256,
  chooseCtaMatch,
  ctaHomepageUrl,
  ctaPhotoUrl,
  isDefaultCtaAvatarSha256,
  isDefaultCtaAvatarUrl,
  isUsableCtaPhotoId,
  sha256Hex,
  type CtaTeacherCandidate,
} from "../../src/cta-teacher-homepage";
import {
  createHttpCtaClient,
  fetchCtaTeacherDirectory,
} from "../../src/cta-teacher-sync";
import { homepageSql, type SyncRow } from "./shared";
import { compressStoredAvatars } from "./to-webp";

type CatalogTeacher = {
  id: number;
  name: string;
  department: string | null;
};

const PHOTO_CONCURRENCY = 8;

async function fetchCatalogTeachers(origin: string): Promise<CatalogTeacher[]> {
  const first = await fetchJson<{
    items: Array<{ id: number; name: string; department?: string | null }>;
    pages: number;
  }>(`${origin}/api/teachers?page=1&pageSize=50`);
  const items = [...(first.items ?? [])];
  const pages = Math.max(1, Number(first.pages) || 1);
  for (let page = 2; page <= pages; page += 1) {
    const body = await fetchJson<{
      items: Array<{ id: number; name: string; department?: string | null }>;
    }>(`${origin}/api/teachers?page=${page}&pageSize=50`);
    items.push(...(body.items ?? []));
  }
  return items.map((item) => ({
    id: Number(item.id),
    name: String(item.name ?? "").trim(),
    department: item.department ?? null,
  }));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return (await response.json()) as T;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return results;
}

async function downloadAvatar(
  client: ReturnType<typeof createHttpCtaClient>,
  candidate: CtaTeacherCandidate,
): Promise<{
  sha256: string | null;
  skippedDefaultAvatar: boolean;
  bytes: Uint8Array | null;
  contentType: string | null;
}> {
  let photo = candidate.photo;
  if (!isUsableCtaPhotoId(photo)) {
    photo = await client.fetchTeacherPhotoId(candidate.uid);
  }
  const url = ctaPhotoUrl(photo);
  if (!url) {
    return {
      sha256: null,
      skippedDefaultAvatar: Boolean(photo),
      bytes: null,
      contentType: null,
    };
  }
  let downloaded = await client.fetchPhoto(url);
  if (!downloaded) {
    const detailPhoto = await client.fetchTeacherPhotoId(candidate.uid);
    const detailUrl = ctaPhotoUrl(detailPhoto);
    if (detailUrl && detailUrl !== url) {
      downloaded = await client.fetchPhoto(detailUrl);
    }
  }
  if (!downloaded || isDefaultCtaAvatarUrl(downloaded.url)) {
    return {
      sha256: null,
      skippedDefaultAvatar: true,
      bytes: null,
      contentType: null,
    };
  }
  const sha = await sha256Hex(downloaded.bytes);
  if (isDefaultCtaAvatarSha256(sha)) {
    return {
      sha256: null,
      skippedDefaultAvatar: true,
      bytes: null,
      contentType: null,
    };
  }
  return {
    sha256: sha,
    skippedDefaultAvatar: false,
    bytes: downloaded.bytes,
    contentType: downloaded.contentType,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "catalog-origin": {
        type: "string",
        default: "https://courses.sein.moe",
      },
      output: { type: "string", default: ".local-data/cta-sync" },
    },
  });
  const origin = values["catalog-origin"] || "https://courses.sein.moe";
  const output = resolve(values.output || ".local-data/cta-sync");
  await mkdir(output, { recursive: true });

  const client = createHttpCtaClient();
  console.log("fetching catalog teachers from", origin);
  const catalog = await fetchCatalogTeachers(origin);
  console.log("catalog teachers", catalog.length);

  console.log("fetching CTA public index");
  const directory = await fetchCtaTeacherDirectory(client);
  console.log("cta teachers", directory.length);
  await writeFile(
    resolve(output, "cta-index.json"),
    JSON.stringify(directory, null, 2),
  );

  const uniqueMatches: Array<{
    teacher: CatalogTeacher;
    candidate: CtaTeacherCandidate;
  }> = [];
  const rows: SyncRow[] = catalog.map((teacher) => {
    const decision = chooseCtaMatch(teacher, directory);
    if (decision.kind === "unique") {
      uniqueMatches.push({ teacher, candidate: decision.candidate });
      return {
        teacherId: teacher.id,
        name: teacher.name,
        department: teacher.department,
        match: "unique",
        homepageUrl: ctaHomepageUrl(decision.candidate.uid),
        ctaUid: decision.candidate.uid,
        avatarSha256: null,
        skippedDefaultAvatar: false,
        avatarBytes: null,
        contentType: null,
      };
    }
    return {
      teacherId: teacher.id,
      name: teacher.name,
      department: teacher.department,
      match: decision.kind,
      homepageUrl: null,
      ctaUid: null,
      avatarSha256: null,
      skippedDefaultAvatar: false,
      avatarBytes: null,
      contentType: null,
    };
  });

  console.log("unique matches", uniqueMatches.length);
  const avatarDir = resolve(output, "avatars");
  await mkdir(avatarDir, { recursive: true });
  const rowById = new Map(rows.map((row) => [row.teacherId, row]));
  let finished = 0;
  await mapPool(uniqueMatches, PHOTO_CONCURRENCY, async ({ teacher, candidate }) => {
    const row = rowById.get(teacher.id);
    if (!row) return;
    try {
      const avatar = await downloadAvatar(client, candidate);
      row.skippedDefaultAvatar = avatar.skippedDefaultAvatar;
      row.avatarSha256 = avatar.sha256;
      row.avatarBytes = avatar.bytes?.byteLength ?? null;
      row.contentType = avatar.contentType;
      if (avatar.bytes && avatar.sha256) {
        await writeFile(resolve(avatarDir, `${teacher.id}.bin`), avatar.bytes);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("photo failed", teacher.id, teacher.name, message);
    }
    finished += 1;
    if (finished % 25 === 0 || finished === uniqueMatches.length) {
      console.log(`photos ${finished}/${uniqueMatches.length}`);
    }
  });

  const summary = {
    catalogTeachers: catalog.length,
    ctaTeachers: directory.length,
    unique: rows.filter((row) => row.match === "unique").length,
    ambiguous: rows.filter((row) => row.match === "ambiguous").length,
    none: rows.filter((row) => row.match === "none").length,
    avatarsStored: rows.filter((row) => row.avatarSha256).length,
    skippedDefaultAvatar: rows.filter((row) => row.skippedDefaultAvatar).length,
    defaultAvatarSha256: CTA_DEFAULT_AVATAR_SHA256,
  };
  await writeFile(
    resolve(output, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(
    resolve(output, "bindings.json"),
    JSON.stringify(
      rows.map(({ avatarBytes, ...row }) => ({
        ...row,
        avatarBytes,
      })),
      null,
      2,
    ),
  );
  await writeFile(resolve(output, "homepage-updates.sql"), homepageSql(rows));
  const webp = await compressStoredAvatars(output);
  console.log(JSON.stringify({ ...summary, ...webp }, null, 2));
}

await main();
