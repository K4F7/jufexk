import { Hono } from "hono";
import type { AppEnv, Bindings, RuntimeSecret } from "./app-env";
import {
  DEFAULT_API_CACHE_CONTROL,
  purgePublicCatalogCache,
} from "./lib/public-catalog-cache";
import { API_CONTENT_SECURITY_POLICY } from "./security-headers";
import { shouldRefreshPublicListPrecomputes } from "./public-list-precompute";
import {
  consumeAiSummaryQueue,
  type AiSummaryQueueMessage,
} from "./review-summary";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import importRoutes from "./routes/imports";
import ordinaryUserRoutes from "./routes/ordinary-user";
import publicCatalogRoutes from "./routes/public-catalog";
import scheduleOfferingRoutes from "./routes/schedule-offerings";
import { fail } from "./routes/support";
import {
  runJwxtWorkerSync,
  workerSyncErrorReason,
  type WorkerJwxtMode,
} from "./jwxt-sync-worker";

const app = new Hono<AppEnv>();

async function readRuntimeSecret(value: RuntimeSecret | undefined): Promise<string> {
  if (!value) return "";
  return (typeof value === "string" ? value : await value.get()).trim();
}

async function secretMatches(provided: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

app.post("/internal/jwxt-sync/:mode", async (c) => {
  const mode = c.req.param("mode") as WorkerJwxtMode;
  if (!["pilot", "incremental", "full", "resume"].includes(mode)) {
    return c.json({ status: "invalid_mode" }, 400);
  }
  const bindings = c.env as Bindings;
  const triggerSecret = await readRuntimeSecret(bindings.JWXT_SYNC_TRIGGER_SECRET);
  const authorization = c.req.header("authorization") || "";
  if (!triggerSecret || !authorization.startsWith("Bearer ") || !(await secretMatches(authorization.slice(7), triggerSecret))) {
    return c.json({ status: "not_found" }, 404);
  }
  if (mode !== "pilot" && bindings.JWXT_SYNC_ENABLED !== "true") {
    return c.json({ status: "disabled" }, 409);
  }
  try {
    const result = await runJwxtWorkerSync(bindings, mode);
    return c.json({ status: "ok", ...result });
  } catch (error) {
    const reason = workerSyncErrorReason(error);
    console.error(JSON.stringify({ event: "jwxt_sync_failed", mode, reason }));
    return c.json({ status: "failed", reason }, 502);
  }
});

app.use("/api/*", async (c, next) => {
  await next();
  if (
    c.res.status < 400 &&
    (c.get("publicCatalogCacheChanged") === true ||
      shouldRefreshPublicListPrecomputes(c.req.method, c.req.path))
  ) {
    await purgePublicCatalogCache(c);
  }
  if (!c.res.headers.get("Cache-Control")) {
    c.header("Cache-Control", DEFAULT_API_CACHE_CONTROL);
  }
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Content-Security-Policy", API_CONTENT_SECURITY_POLICY);
});

app.route("/", publicCatalogRoutes);
app.route("/", scheduleOfferingRoutes);
app.route("/", authRoutes);
app.route("/", ordinaryUserRoutes);
app.route("/", adminRoutes);
app.route("/", importRoutes);

app.onError((e, c) => {
  if (e instanceof SyntaxError) return fail(c, "请求 JSON 格式错误", 400);
  console.error(
    JSON.stringify({
      event: "request_error",
      message: e.message,
      path: c.req.path,
    }),
  );
  return fail(c, "服务器暂时开小差了", 500);
});
const worker = Object.assign(app, {
  queue: (batch: MessageBatch<AiSummaryQueueMessage>, env: Cloudflare.Env) =>
    consumeAiSummaryQueue(batch, env),
  scheduled: async (event: ScheduledController, env: Cloudflare.Env) => {
    if ((env as Bindings).JWXT_SYNC_ENABLED !== "true") {
      console.log(JSON.stringify({ event: "jwxt_sync_skipped", reason: "disabled" }));
      return;
    }
    const mode: WorkerJwxtMode = event.cron === "37 20 1 * *" ? "full" : "incremental";
    try {
      const result = await runJwxtWorkerSync(env as Bindings, mode);
      console.log(JSON.stringify({ event: "jwxt_sync_complete", ...result }));
    } catch (error) {
      console.error(JSON.stringify({ event: "jwxt_sync_failed", mode, reason: workerSyncErrorReason(error) }));
    }
  },
});

export default worker satisfies ExportedHandler<
  Cloudflare.Env,
  AiSummaryQueueMessage
>;
