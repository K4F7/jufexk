import { describe, expect, it } from "vitest";
import {
  CI_SECRETS,
  PUBLIC_REPO_CONFIG,
  PUBLIC_WRANGLER_VARS,
  WORKER_SECRETS,
  formatDevVars,
  mergeWorkerDevVars,
  parseDotenv,
  resolveAdminPassword,
  selectWorkerDevVars,
} from "./inventory";

describe("secret inventory", () => {
  it("hosts the required worker and CI keys and keeps public wrangler vars out", () => {
    expect([...WORKER_SECRETS]).toEqual([
      "ADMIN_PASSWORD",
      "IP_HASH_SECRET",
      "TURNSTILE_SECRET",
    ]);
    expect([...CI_SECRETS]).toEqual([
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
    ]);
    expect([...PUBLIC_WRANGLER_VARS]).not.toContain("ADMIN_PASSWORD");
    expect([...PUBLIC_WRANGLER_VARS]).toContain("TURNSTILE_SITE_KEY");
    expect([...PUBLIC_REPO_CONFIG]).toContain("database_id");
  });

  it("accepts ADMIN_PASSWORD as the ops password alias", () => {
    expect(resolveAdminPassword({ ADMIN_PASSWORD: "from-infisical" })).toBe(
      "from-infisical",
    );
    expect(
      resolveAdminPassword({
        JUFEXK_ADMIN_PASSWORD: "legacy-name",
        ADMIN_PASSWORD: "from-infisical",
      }),
    ).toBe("legacy-name");
    expect(() => resolveAdminPassword({})).toThrow(
      /ADMIN_PASSWORD 或 JUFEXK_ADMIN_PASSWORD/,
    );
  });

  it("writes only worker keys into .dev.vars and reports extras", () => {
    const selected = selectWorkerDevVars({
      ADMIN_PASSWORD: "admin",
      IP_HASH_SECRET: "ip",
      TURNSTILE_SECRET: "turnstile",
      CLOUDFLARE_API_TOKEN: "must-not-land-in-dev-vars",
    });
    expect(selected.extra).toEqual(["CLOUDFLARE_API_TOKEN"]);
    expect(formatDevVars(selected.vars)).toBe(
      "ADMIN_PASSWORD=admin\nIP_HASH_SECRET=ip\nTURNSTILE_SECRET=turnstile\n",
    );
  });

  it("writes .dev.vars without ADMIN_PASSWORD while that key is pending rotation", () => {
    const selected = selectWorkerDevVars({
      ADMIN_PASSWORD: "",
      IP_HASH_SECRET: "ip",
      TURNSTILE_SECRET: "turnstile",
    });
    expect(selected.missing).toEqual(["ADMIN_PASSWORD"]);
    expect(selected.missingRequired).toEqual([]);
    expect(formatDevVars(selected.vars)).toBe(
      "IP_HASH_SECRET=ip\nTURNSTILE_SECRET=turnstile\n",
    );
  });

  it("keeps an existing local ADMIN_PASSWORD until Infisical receives the rotated value", () => {
    const selected = selectWorkerDevVars({
      IP_HASH_SECRET: "ip",
      TURNSTILE_SECRET: "turnstile",
    });
    expect(
      formatDevVars(mergeWorkerDevVars(selected.vars, { ADMIN_PASSWORD: "local" })),
    ).toBe(
      "ADMIN_PASSWORD=local\nIP_HASH_SECRET=ip\nTURNSTILE_SECRET=turnstile\n",
    );
  });

  it("parses quoted dotenv without treating comments as values", () => {
    expect(
      parseDotenv(`# comment\nADMIN_PASSWORD="a b"\nIP_HASH_SECRET=ip\n`),
    ).toEqual({
      ADMIN_PASSWORD: "a b",
      IP_HASH_SECRET: "ip",
    });
  });
});
