/**
 * Vite hashed files live under /assets/*. SPA not_found_handling would
 * otherwise 200 index.html for a missing chunk; /assets/* immutable cache
 * then poisons that URL and lazy routes white-screen.
 */

export function fingerprintedAssetMissingResponse(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function rejectSpaHtmlForFingerprintedAsset(
  pathname: string,
  assetResponse: Response,
): Response {
  if (!pathname.startsWith("/assets/")) return assetResponse;
  const contentType = assetResponse.headers.get("content-type") ?? "";
  if (!/\btext\/html\b/i.test(contentType)) return assetResponse;
  return fingerprintedAssetMissingResponse();
}
