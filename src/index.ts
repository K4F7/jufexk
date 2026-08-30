import { Hono } from "hono";
import type { AppEnv } from "./app-env";
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
import programPlanRoutes from "./routes/program-plan";
import publicCatalogRoutes from "./routes/public-catalog";
import scheduleOfferingRoutes from "./routes/schedule-offerings";
import { fail } from "./routes/support";

const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
  const startedAt = performance.now();
  await next();
  if (c.res.status < 400) {
    const changed = c.get("publicCatalogCacheChanged") === true;
    const refreshesProjection = shouldRefreshPublicListPrecomputes(
      c.req.method,
      c.req.path,
    );
    if (changed || refreshesProjection) {
      await purgePublicCatalogCache(
        c,
        changed ? c.get("publicCatalogCacheScopes") || ["list", "detail"] : ["list"],
      );
    }
  }
  if (!c.res.headers.get("Cache-Control")) {
    c.header("Cache-Control", DEFAULT_API_CACHE_CONTROL);
  }
  const stages = c.get("serverTiming") || {};
  const stageHeaders = Object.entries(stages).map(
    ([name, duration]) => `${name};dur=${Math.max(0, duration).toFixed(1)}`,
  );
  stageHeaders.push(`app;dur=${Math.max(0, performance.now() - startedAt).toFixed(1)}`);
  c.header("Server-Timing", stageHeaders.join(", "));
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Content-Security-Policy", API_CONTENT_SECURITY_POLICY);
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

app.route("/", publicCatalogRoutes);
app.route("/", scheduleOfferingRoutes);
app.route("/", programPlanRoutes);
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
});

export default worker satisfies ExportedHandler<
  Cloudflare.Env,
  AiSummaryQueueMessage
>;
