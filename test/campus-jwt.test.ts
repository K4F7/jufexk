import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  buildAuthBridgeLoginUrl,
  campusJwtLive,
  decryptAuthBridgeAesSubject,
  normalizeCampusJwtSecret,
  safeCampusReturnPath,
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
  secretBytes?: Uint8Array,
) {
  const header = toBase64Url(JSON.stringify({ alg, typ: "JWT" }));
  const body = toBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes || new TextEncoder().encode(secret),
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
        callbackUrl: "https://courses.sein.moe/api/auth/callback",
      }),
    ).toBe(
      "https://authbridge.example.test/authbridge/login?appid=jufexk&mode=callback&callback=https%3A%2F%2Fcourses.sein.moe%2Fapi%2Fauth%2Fcallback",
    );
    expect(campusJwtLive(undefined)).toBe(false);
    expect(campusJwtLive({})).toBe(false);
    expect(campusJwtLive({ CAMPUS_JWT_ENABLED: "1" })).toBe(false);
    expect(safeCampusReturnPath("/courses/1")).toBe("/courses/1");
    expect(safeCampusReturnPath("//evil.example")).toBe("/");
    expect(safeCampusReturnPath("https://evil.example")).toBe("/");
  });

  it("verifies AuthBridge hex jwt_key as raw HMAC bytes and accepts missing aud", async () => {
    const hexSecret =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    const token = await signHs256(
      {
        sub: "campus-user-1",
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      hexSecret,
      "HS256",
      normalizeCampusJwtSecret(hexSecret),
    );
    await expect(verifyCampusJwtHs256(token, hexSecret, "jufexk")).resolves.toMatchObject({
      sub: "campus-user-1",
    });
    await expect(
      verifyCampusJwtHs256(token, "test-campus-jwt-secret", "jufexk"),
    ).resolves.toBeNull();
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
      reason: "abandoned",
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

  it("rejects expired tokens and future nbf", async () => {
    const secret = "local-only-test-key";
    const expired = await signHs256(
      { sub: "campus-user-1", aud: "jufexk", exp: Math.floor(Date.now() / 1000) - 30 },
      secret,
    );
    const notYet = await signHs256(
      {
        sub: "campus-user-1",
        aud: "jufexk",
        nbf: Math.floor(Date.now() / 1000) + 600,
        exp: Math.floor(Date.now() / 1000) + 1200,
      },
      secret,
    );
    await expect(verifyCampusJwtHs256(expired, secret, "jufexk")).resolves.toBeNull();
    await expect(verifyCampusJwtHs256(notYet, secret, "jufexk")).resolves.toBeNull();
  });

  it("decrypts an AuthBridge AES-wrapped campus handle", async () => {
    const keyHex =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    const keyBytes = Uint8Array.from(
      keyHex.match(/../g)!.map((part) => Number.parseInt(part, 16)),
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
      "encrypt",
    ]);
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode("20230001"),
      ),
    );
    const toB64 = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes));
    await expect(
      decryptAuthBridgeAesSubject(
        {
          sub: toB64(encrypted.slice(0, -16)),
          exp: Math.floor(Date.now() / 1000) + 60,
          enc: "aes",
          iv: toB64(iv),
          tag: toB64(encrypted.slice(-16)),
        },
        keyHex,
      ),
    ).resolves.toBe("20230001");
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
      reason: "abandoned",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
