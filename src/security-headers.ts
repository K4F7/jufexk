const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** Official beacon host for Cloudflare Web Analytics. */
export const CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN =
  "https://static.cloudflareinsights.com";

/** Official beacon ingest host used by the analytics script. */
export const CLOUDFLARE_WEB_ANALYTICS_CONNECT_ORIGIN =
  "https://cloudflareinsights.com";

export const ASSET_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${TURNSTILE_ORIGIN} ${CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN}`,
  `frame-src ${TURNSTILE_ORIGIN}`,
  `connect-src 'self' ${TURNSTILE_ORIGIN} ${CLOUDFLARE_WEB_ANALYTICS_CONNECT_ORIGIN}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
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
