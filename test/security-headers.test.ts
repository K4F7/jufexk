import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  API_CONTENT_SECURITY_POLICY,
  ASSET_CONTENT_SECURITY_POLICY,
  CLOUDFLARE_WEB_ANALYTICS_CONNECT_ORIGIN,
  CLOUDFLARE_WEB_ANALYTICS_SCRIPT_ORIGIN,
  HEROUI_AVATAR_ASSETS_ORIGIN,
} from "../src/security-headers";
import assetHeaders from "../public/_headers?raw";

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

describe("public asset CSP", () => {
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
    ]);
    expect(cspDirectiveSources(policy, "img-src")).toEqual([
      "'self'",
      "data:",
      HEROUI_AVATAR_ASSETS_ORIGIN,
    ]);
  });
});

describe("API CSP", () => {
  it("keeps Turnstile and does not widen script sources for JSON responses", async () => {
    const response = await SELF.fetch(`${origin}/api/config`);
    expect(response.headers.get("Content-Security-Policy")).toBe(
      API_CONTENT_SECURITY_POLICY,
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
});
