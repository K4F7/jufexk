/**
 * 把一次性 CTA 同步产物写入远端 D1。只通过 GHA production 的
 * CLOUDFLARE_API_TOKEN 执行，不在本机要 Cloudflare 登录。
 *
 *   pnpm exec tsx scripts/cta-sync/apply-remote.ts --remote --apply
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { promisify } from "node:util";
import { CTA_FID } from "../../src/cta-teacher-homepage";
import { sqlString, type SyncRow } from "./shared";

const exec = promisify(execFile);
const MAX_SQL_BYTES = 80_000;

export function homepageUpdateStatements(rows: SyncRow[]): string[] {
  const statements: string[] = [];
  for (const row of rows) {
    if (row.match === "unique" && row.homepageUrl && row.ctaUid != null) {
      statements.push(
        `UPDATE teachers SET cta_fid=${CTA_FID},cta_uid=${row.ctaUid},homepage_url=${sqlString(row.homepageUrl)},homepage_match='unique',cta_synced_at=datetime('now') WHERE id=${row.teacherId} AND IFNULL(homepage_locked,0)=0`,
      );
      if (row.avatarSha256) {
        statements.push(
          `UPDATE teachers SET avatar_sha256=${sqlString(row.avatarSha256)} WHERE id=${row.teacherId} AND IFNULL(homepage_locked,0)=0 AND IFNULL(image_locked,0)=0`,
        );
      }
    } else {
      statements.push(
        `UPDATE teachers SET homepage_match=${sqlString(row.match)},cta_synced_at=datetime('now') WHERE id=${row.teacherId} AND IFNULL(homepage_locked,0)=0 AND IFNULL(homepage_match,'none') NOT IN ('unique','manual')`,
      );
    }
  }
  return statements;
}

export function avatarInsertSql(
  teacherId: number,
  sha256: string,
  bytes: Uint8Array,
  homepageUrl: string | null,
): string {
  const hex = Buffer.from(bytes).toString("hex");
  const source = sqlString(homepageUrl || "cta-sync");
  return `INSERT INTO teacher_avatars(teacher_id,content_type,sha256,bytes,source_url,fetched_at) SELECT ${teacherId},'image/webp',${sqlString(sha256)},X'${hex}',${source},datetime('now') WHERE EXISTS (SELECT 1 FROM teachers WHERE id=${teacherId} AND IFNULL(image_locked,0)=0) ON CONFLICT(teacher_id) DO UPDATE SET content_type=excluded.content_type,sha256=excluded.sha256,bytes=excluded.bytes,source_url=excluded.source_url,fetched_at=excluded.fetched_at`;
}

export function chunkStatements(
  statements: string[],
  maxBytes = MAX_SQL_BYTES,
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const statement of statements) {
    const next = current ? `${current};${statement}` : statement;
    if (current && Buffer.byteLength(next) > maxBytes) {
      chunks.push(current);
      current = statement;
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function executeRemoteSql(
  sql: string,
  execImpl: typeof exec = exec,
): Promise<void> {
  const result = await execImpl(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "jufexk", "--remote", "-y", "--command", sql],
    { cwd: process.cwd(), timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function main() {
  const { values } = parseArgs({
    options: {
      remote: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      output: { type: "string", default: ".local-data/cta-sync" },
    },
  });
  if (!values.remote || !values.apply) {
    throw new Error("必须同时传入 --remote --apply。GHA production 才会带 CLOUDFLARE_API_TOKEN。");
  }
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error("缺少 CLOUDFLARE_API_TOKEN。请走 GitHub Actions production 环境，不要在本机登录。");
  }

  const output = resolve(values.output || ".local-data/cta-sync");
  const rows = JSON.parse(
    await readFile(resolve(output, "bindings.json"), "utf8"),
  ) as SyncRow[];
  const homepageChunks = chunkStatements(homepageUpdateStatements(rows));
  console.log("homepage sql chunks", homepageChunks.length);
  for (const [index, sql] of homepageChunks.entries()) {
    console.log(`homepage ${index + 1}/${homepageChunks.length}`);
    await executeRemoteSql(sql);
  }

  const avatarStatements: string[] = [];
  for (const row of rows) {
    if (!row.avatarSha256) continue;
    const webp = await readFile(
      resolve(output, "avatars", `${row.teacherId}.webp`),
    ).catch(() => null);
    if (!webp?.byteLength) continue;
    avatarStatements.push(
      avatarInsertSql(
        row.teacherId,
        row.avatarSha256,
        new Uint8Array(webp),
        row.homepageUrl,
      ),
    );
  }
  const avatarChunks = chunkStatements(avatarStatements);
  console.log("avatar sql chunks", avatarChunks.length, "photos", avatarStatements.length);
  for (const [index, sql] of avatarChunks.entries()) {
    console.log(`avatars ${index + 1}/${avatarChunks.length}`);
    await executeRemoteSql(sql);
  }
  console.log(
    JSON.stringify(
      {
        homepageChunks: homepageChunks.length,
        avatarChunks: avatarChunks.length,
        avatars: avatarStatements.length,
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
