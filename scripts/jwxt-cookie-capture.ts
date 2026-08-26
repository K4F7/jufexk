import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type BrowserContext } from "@playwright/test";
import { buildEhallCookieHeader, updateEhallCookieEnv } from "./jwxt-cookie-env";

const ehallUrl = "http://ehall.jxufe.edu.cn/appShow?appId=5853686007071845";
const casUrl = "https://ssl.jxufe.edu.cn";
const output = resolve(process.env.JWXT_COOKIE_ENV || ".env.jwxt-sync");
const deadline = Date.now() + Number(process.env.JWXT_COOKIE_TIMEOUT_MS || 300_000);

async function existingContext() {
  const endpoint = new URL(process.env.JWXT_CDP_URL || "http://127.0.0.1:9222");
  if (!["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) throw new Error("JWXT_CDP_URL must use a loopback address");
  try {
    const browser = await chromium.connectOverCDP(endpoint.toString());
    return browser.contexts()[0] || null;
  } catch {
    return null;
  }
}

async function acquireContext(): Promise<{ context: BrowserContext; owned: boolean }> {
  const connected = await existingContext();
  if (connected) return { context: connected, owned: false };
  const profile = resolve(".local-data/jwxt-cookie-browser");
  await mkdir(profile, { recursive: true });
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return { context: await chromium.launchPersistentContext(profile, { channel, headless: false, viewport: null }), owned: true };
    } catch {
      // Try the next installed browser channel.
    }
  }
  throw new Error("Cannot start Chrome or Edge; install one or expose local CDP port 9222");
}

async function writeEnv(cookieHeader: string) {
  try {
    if ((await lstat(output)).isSymbolicLink()) throw new Error("Refusing to overwrite a symlink");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const existing = await readFile(output, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "# Generated locally; never commit this file.\n";
    throw error;
  });
  const temporary = `${output}.tmp-${process.pid}`;
  await writeFile(temporary, updateEhallCookieEnv(existing, cookieHeader), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, output);
}

const { context, owned } = await acquireContext();
try {
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(ehallUrl, { waitUntil: "domcontentloaded" });
  process.stderr.write("请在打开的浏览器中完成 eHall 登录；脚本会自动保存登录态，不会输出 Cookie。\n");
  while (Date.now() < deadline) {
    const header = buildEhallCookieHeader(await context.cookies(ehallUrl), await context.cookies(casUrl));
    if (header) {
      await writeEnv(header);
      process.stdout.write(`已安全更新 ${output}（Cookie 未打印）。\n`);
      process.exitCode = 0;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (process.exitCode === undefined) throw new Error("登录等待超时；请确认已在 eHall 完成登录");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Cookie capture failed"}\n`);
  process.exitCode = 1;
} finally {
  if (owned) await context.close();
}
