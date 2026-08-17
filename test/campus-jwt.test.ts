import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  buildAuthBridgeLoginUrl,
  campusJwtLive,
  verifyCampusJwtHs256,
} from "../src/campus-jwt";

const origin = "https://example.com";

const toBase64Url = (bytes: ArrayBuffer | Uint8Array | string) => {
  const raw =
    typeof bytes === "string"
      ? bytes
      : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};

async function signHs256(
  payload: Record<string, unknown>,
  secret: string,
  alg = "HS256",
) {
  const header = toBase64Url(JSON.stringify({ alg, typ: "JWT" }));
  const body = toBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = toBase64Url(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${header}.${body}`),
    ),
  );
  return `${header}.${body}.${signature}`;
}

describe("campus AuthBridge placeholder", () => {
  it("builds the AuthBridge login URL without calling the school", () => {
    expect(
      buildAuthBridgeLoginUrl({
        baseUrl: "https://authbridge.example.test/authbridge",
        appId: "jufexk",
        callbackUrl: "https://xk.sein.moe/api/auth/callback",
      }),
    ).toBe(
      "https://authbridge.example.test/authbridge/login?appid=jufexk&mode=callback&callback=https%3A%2F%2Fxk.sein.moe%2Fapi%2Fauth%2Fcallback",
    );
    expect(campusJwtLive({ CAMPUS_JWT_ENABLED: "1" })).toBe(false);
  });

  it("verifies a local HS256 token and rejects a bad signature", async () => {
    const secret = "local-only-test-key";
    const token = await signHs256(
      {
        sub: "campus-user-1",
        aud: "jufexk",
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      secret,
    );
    await expect(verifyCampusJwtHs256(token, secret, "jufexk")).resolves.toMatchObject({
      sub: "campus-user-1",
      aud: "jufexk",
    });
    await expect(verifyCampusJwtHs256(token, "other-key", "jufexk")).resolves.toBeNull();
  });

  it("exposes the closed campus auth contract", async () => {
    const response = await SELF.fetch(`${origin}/api/auth/campus`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: false,
      reason: "not_whitelisted",
      loginPath: "/login",
      logoutPath: "/logout",
      callbackPath: "/api/auth/callback",
      contract: {
        provider: "authbridge",
        mode: "callback",
        tokenField: "token",
        algorithm: "HS256",
        claims: ["sub", "exp", "aud", "enc"],
      },
    });
  });

  it("accepts the AuthBridge form field but does not establish a session", async () => {
    const response = await SELF.fetch(`${origin}/api/auth/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "token=header.payload.signature",
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "普通用户认证尚未开放接入",
      reason: "not_whitelisted",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
