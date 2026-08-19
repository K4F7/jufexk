import { describe, expect, it } from "vitest";
import { readSecret, turnstileMode } from "../src/secrets";

describe("readSecret", () => {
  it("reads strings used by tests and empty bindings", async () => {
    expect(await readSecret("plain")).toBe("plain");
    expect(await readSecret("")).toBe("");
    expect(await readSecret(undefined)).toBe("");
  });

  it("reads Secrets Store bindings via get()", async () => {
    expect(await readSecret({ get: async () => "from-store" })).toBe("from-store");
  });

  it("treats a missing Secrets Store value as empty", async () => {
    expect(
      await readSecret({
        get: async () => {
          throw new Error('Secret "TURNSTILE_SECRET" not found');
        },
      }),
    ).toBe("");
  });
});

describe("turnstileMode", () => {
  it("treats a binding object as absent until its value is read", () => {
    expect(turnstileMode("site", "")).toBe("site-only");
    expect(turnstileMode("site", "secret")).toBe("enabled");
    expect(turnstileMode("", "secret")).toBe("secret-only");
    expect(turnstileMode("", "")).toBe("disabled");
  });
});
