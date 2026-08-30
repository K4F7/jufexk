import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  API_CONTENT_SECURITY_POLICY,
  ASSET_CONTENT_SECURITY_POLICY,
  CLOUDFLARE_WEB_ANALYTICS_CONNECT_ORIGIN,
  CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN,
  HEROUI_AVATAR_ASSETS_ORIGIN,
} from "../src/security-headers";
import { STATUS_PAGE_URL } from "../src/lib/site-links";
import assetHeaders from "../public/_headers?raw";
import assetRedirects from "../public/_redirects?raw";

const origin = "https://example.com";

function cspDirectiveSources(policy: string, directive: string): string[] {
  const prefix = `${directive} `;
  const part = policy
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  return part ? part.slice(prefix.length).split(/\s+/).filter(Boolean) : [];
}

function headerValue(file: string, name: string): string {
  const line = file
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}:`));
  return line ? line.slice(name.length + 1).trim() : "";
}

function headerValueForPath(file: string, path: string, name: string): string {
  const lines = file.split(/\r?\n/);
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith("#")) continue;
    if (!/^\s/.test(raw) && line.length > 0) {
      inBlock = line.trim() === path;
      continue;
    }
    if (!inBlock) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith(`${name}:`)) {
      return trimmed.slice(name.length + 1).trim();
    }
  }
  return "";
}

describe("public asset CSP", () => {
  it("pins HSTS on static assets", () => {
    expect(headerValue(assetHeaders, "Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("allows the Cloudflare Web Analytics beacon without extra script hosts", () => {
    const policy = headerValue(assetHeaders, "Content-Security-Policy");
    expect(policy).toBe(ASSET_CONTENT_SECURITY_POLICY);
    expect(cspDirectiveSources(policy, "script-src")).toEqual([
      "'self'",
      "https://challenges.cloudflare.com",
      CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN,
    ]);
    expect(cspDirectiveSources(policy, "connect-src")).toEqual([
      "'self'",
      "https://challenges.cloudflare.com",
      CLOUDFLARE_WEB_ANALYTICS_CONNECT_ORIGIN,
    ]);
    expect(cspDirectiveSources(policy, "frame-src")).toEqual([
      "https://challenges.cloudflare.com",
      STATUS_PAGE_URL,
    ]);
    expect(cspDirectiveSources(policy, "img-src")).toEqual([
      "'self'",
      "data:",
      HEROUI_AVATAR_ASSETS_ORIGIN,
    ]);
  });

  it("gives fingerprinted Vite assets a long immutable cache", () => {
    expect(headerValueForPath(assetHeaders, "/assets/*", "Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("redirects the bare origin to the latest feed before the SPA boots", () => {
    expect(assetRedirects).toMatch(/^\s*\/\s+\/latest\s+302\s*$/m);
  });
});

describe("API CSP", () => {
  it("keeps Turnstile and does not widen script sources for JSON responses", async () => {
    const response = await SELF.fetch(`${origin}/api/config`);
    expect(response.headers.get("Content-Security-Policy")).toBe(
      API_CONTENT_SECURITY_POLICY,
    );
    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(
      cspDirectiveSources(API_CONTENT_SECURITY_POLICY, "script-src"),
    ).toEqual(["'self'", "https://challenges.cloudflare.com"]);
    expect(
      cspDirectiveSources(API_CONTENT_SECURITY_POLICY, "connect-src"),
    ).toEqual(["'self'", "https://challenges.cloudflare.com"]);
    expect(cspDirectiveSources(API_CONTENT_SECURITY_POLICY, "img-src")).toEqual(
      ["'self'", "data:"],
    );
  });

  it("keeps HSTS on API errors and preflight requests", async () => {
    const missingResponse = await SELF.fetch(`${origin}/api/does-not-exist`);
    expect(missingResponse.status).toBeGreaterThanOrEqual(400);
    expect(missingResponse.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );

    const optionsResponse = await SELF.fetch(`${origin}/api/config`, {
      method: "OPTIONS",
    });
    expect(optionsResponse.status).toBeGreaterThanOrEqual(400);
    expect(optionsResponse.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });
});
