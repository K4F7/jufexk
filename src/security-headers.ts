import { STATUS_PAGE_URL } from "./lib/site-links";

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** Official beacon host for Cloudflare Web Analytics. */
export const CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN =
  "https://static.cloudflareinsights.com";

/** Official beacon ingest host used by the analytics script. */
export const CLOUDFLARE_WEB_ANALYTICS_CONNECT_ORIGIN =
  "https://cloudflareinsights.com";

/** Official HeroUI v3 avatar placeholder host. */
export const HEROUI_AVATAR_ASSETS_ORIGIN =
  "https://heroui-assets.nyc3.cdn.digitaloceanspaces.com";

/** SHA-256 allowlist for the tiny /latest request bootstrap in index.html. */
export const LATEST_REQUEST_BOOTSTRAP_CSP_HASH =
  "'sha256-jDLvLWbYDqWjMW2IZsxLca0ML0NT6SdAK9WHa6ngFz8='";

export const ASSET_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${LATEST_REQUEST_BOOTSTRAP_CSP_HASH} ${TURNSTILE_ORIGIN} ${CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN}`,
  `frame-src ${TURNSTILE_ORIGIN} ${STATUS_PAGE_URL}`,
  `connect-src 'self' ${TURNSTILE_ORIGIN} ${CLOUDFLARE_WEB_ANALYTICS_CONNECT_ORIGIN}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${HEROUI_AVATAR_ASSETS_ORIGIN}`,
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export const API_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${TURNSTILE_ORIGIN}`,
  `frame-src ${TURNSTILE_ORIGIN}`,
  `connect-src 'self' ${TURNSTILE_ORIGIN}`,
  "style-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");
