/**
 * 一次性从 CTA 公开索引同步教师主页与真人头像。
 * 已有 avatar_url 的教师不重下。默认剪影 defaulticon.png 不下载、不入库。
 * 瞬时下载失败会多轮重试，直到没有可重试项或达到时间上限。
 *
 *   pnpm cta-sync
 *   pnpm cta-sync --catalog-origin=https://courses.sein.moe
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CTA_DEFAULT_AVATAR_SHA256, chooseCtaMatch, ctaHomepageUrl } from "../../src/cta-teacher-homepage";
import {
  createHttpCtaClient,
  fetchCtaTeacherDirectory,
} from "../../src/cta-teacher-sync";
import {
  catalogTeacherFromApi,
  downloadAvatar,
  shouldDownloadAvatar,
  type CatalogTeacher,
} from "./download";
import { homepageSql, type SyncRow } from "./shared";
import { compressStoredAvatars } from "./to-webp";

const PHOTO_CONCURRENCY = 8;
const DEFAULT_DEADLINE_MS = 40 * 60 * 1000;

async function fetchCatalogTeachers(origin: string): Promise<CatalogTeacher[]> {
  const first = await fetchJson<{
    items: Array<{
      id: number;
      name: string;
      department?: string | null;
      avatar_url?: string | null;
    }>;
    pages: number;
  }>(`${origin}/api/teachers?page=1&pageSize=50`);
  const items = [...(first.items ?? [])];
  const pages = Math.max(1, Number(first.pages) || 1);
  for (let page = 2; page <= pages; page += 1) {
    const body = await fetchJson<{
      items: Array<{
        id: number;
        name: string;
        department?: string | null;
        avatar_url?: string | null;
      }>;
    }>(`${origin}/api/teachers?page=${page}&pageSize=50`);
    items.push(...(body.items ?? []));
  }
  return items.map(catalogTeacherFromApi);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function syncRow(teacher: CatalogTeacher, extra: Partial<SyncRow>): SyncRow {
  return {
    teacherId: teacher.id,
    name: teacher.name,
    department: teacher.department,
    match: "none",
    homepageUrl: null,
    ctaUid: null,
    avatarSha256: null,
    skippedDefaultAvatar: false,
    avatarBytes: null,
    contentType: null,
    ...extra,
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
      "deadline-ms": { type: "string", default: String(DEFAULT_DEADLINE_MS) },
    },
  });
  const origin = values["catalog-origin"] || "https://courses.sein.moe";
  const output = resolve(values.output || ".local-data/cta-sync");
  const deadlineMs = Math.max(
    1_000,
    Number(values["deadline-ms"]) || DEFAULT_DEADLINE_MS,
  );
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
    candidate: (typeof directory)[number];
  }> = [];
  const rows: SyncRow[] = catalog.map((teacher) => {
    const decision = chooseCtaMatch(teacher, directory);
    if (decision.kind === "unique") {
      uniqueMatches.push({ teacher, candidate: decision.candidate });
      return syncRow(teacher, {
        match: "unique",
        homepageUrl: ctaHomepageUrl(decision.candidate.uid),
        ctaUid: decision.candidate.uid,
      });
    }
    return syncRow(teacher, { match: decision.kind });
  });

  const pending = uniqueMatches.filter(({ teacher }) =>
    shouldDownloadAvatar(teacher),
  );
  const skippedExistingAvatar = uniqueMatches.length - pending.length;
  console.log(
    "unique matches",
    uniqueMatches.length,
    "already have avatar",
    skippedExistingAvatar,
    "to download",
    pending.length,
  );

  const avatarDir = resolve(output, "avatars");
  await mkdir(avatarDir, { recursive: true });
  const rowById = new Map(rows.map((row) => [row.teacherId, row]));

  let queue = pending;
  let downloadRounds = 0;
  const startedAt = Date.now();
  while (queue.length > 0) {
    downloadRounds += 1;
    console.log(`photo round ${downloadRounds}`, queue.length);
    const retryNext: typeof queue = [];
    let finished = 0;
    await mapPool(queue, PHOTO_CONCURRENCY, async ({ teacher, candidate }) => {
      const row = rowById.get(teacher.id);
      if (!row) return;
      const avatar = await downloadAvatar(client, candidate);
      row.skippedDefaultAvatar = avatar.skippedDefaultAvatar;
      row.avatarSha256 = avatar.sha256;
      row.avatarBytes = avatar.bytes?.byteLength ?? null;
      row.contentType = avatar.contentType;
      if (avatar.bytes && avatar.sha256) {
        await writeFile(resolve(avatarDir, `${teacher.id}.bin`), avatar.bytes);
      } else if (avatar.retryable) {
        console.warn("photo failed", teacher.id, teacher.name, "retryable");
        retryNext.push({ teacher, candidate });
      }
      finished += 1;
      if (finished % 25 === 0 || finished === queue.length) {
        console.log(`photos ${finished}/${queue.length} (round ${downloadRounds})`);
      }
    });
    queue = retryNext;
    if (queue.length === 0) break;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= deadlineMs) {
      console.warn(
        "download deadline reached",
        deadlineMs,
        "ms;",
        queue.length,
        "retryable remaining",
      );
      break;
    }
    const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(downloadRounds - 1, 5));
    console.log(`retrying ${queue.length} after ${delayMs}ms`);
    await sleep(delayMs);
  }

  const retryableRemaining = queue.length;
  if (retryableRemaining) {
    console.warn("retryable photos remaining", retryableRemaining);
  }

  const summary = {
    catalogTeachers: catalog.length,
    ctaTeachers: directory.length,
    unique: rows.filter((row) => row.match === "unique").length,
    ambiguous: rows.filter((row) => row.match === "ambiguous").length,
    none: rows.filter((row) => row.match === "none").length,
    skippedExistingAvatar,
    avatarsStored: rows.filter((row) => row.avatarSha256).length,
    skippedDefaultAvatar: rows.filter((row) => row.skippedDefaultAvatar).length,
    retryableRemaining,
    downloadRounds,
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
