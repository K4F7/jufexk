import { Hono } from "hono";
import type { AppEnv } from "./app-env";
import {
  DEFAULT_API_CACHE_CONTROL,
  PUBLIC_CATALOG_CACHE_TAG,
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
import { injectLatestShell } from "./latest-ssr";
import type { PublicReviewPage, LatestReview } from "./lib/types";

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
const appFetch = app.fetch.bind(app);
const worker = Object.assign(app, {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/latest") &&
      !url.searchParams.has("preview")
    ) {
      try {
        const htmlCache = caches.default;
        // Root and /latest render the same public document. Normalize their
        // cache key so a warm edge does not run the SSR query twice.
        const cacheKey = new Request(new URL("/latest", request.url), {
          method: "GET",
        });
        const cachedHtml = await htmlCache.match(cacheKey);
        if (cachedHtml) return cachedHtml;

        // The static root asset redirects to /latest. Resolve that redirect
        // inside the Worker so the public entry has one document request.
        const assetRequest =
          url.pathname === "/"
            ? new Request(new URL("/latest", request.url), request)
            : request;
        const asset = await env.ASSETS.fetch(assetRequest);
        if (!asset.ok) return asset;
        const apiRequest = new Request(new URL("/api/reviews/latest?pageSize=10", request.url), {
          headers: { Accept: "application/json" },
        });
        const pageResponse = await appFetch(apiRequest, env, ctx);
        if (!pageResponse.ok) return asset;
        const page = await pageResponse.json();
        const html = injectLatestShell(
          await asset.text(),
          page as PublicReviewPage<LatestReview>,
        );
        const optimizedHtml = html.replace(
          /<link rel="stylesheet"([^>]+)>/,
          '<link rel="preload" as="style"$1 data-app-css>',
        );
        const headers = new Headers(asset.headers);
        headers.set("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
        headers.set("Cache-Tag", PUBLIC_CATALOG_CACHE_TAG);
        const serverTiming = pageResponse.headers.get("Server-Timing");
        if (serverTiming) headers.set("Server-Timing", serverTiming);
        const response = new Response(optimizedHtml, { status: asset.status, headers });
        ctx.waitUntil(htmlCache.put(cacheKey, response.clone()));
        return response;
      } catch {
        return env.ASSETS.fetch(request);
      }
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    return appFetch(request, env, ctx);
  },
  queue: (batch: MessageBatch<AiSummaryQueueMessage>, env: Cloudflare.Env) =>
    consumeAiSummaryQueue(batch, env),
});

export default worker satisfies ExportedHandler<
  Cloudflare.Env,
  AiSummaryQueueMessage
>;
