import { describe, expect, it } from "vitest";
import {
  GITHUB_DEPLOY_SECRETS,
  SECRETS_STORE_ID,
  WORKER_SECRETS,
  parseDotenv,
  resolveAdminPassword,
  selectWorkerDevVars,
} from "./inventory";

describe("secret inventory", () => {
  it("keeps worker secrets in Secrets Store and deploy keys on GitHub", () => {
    expect(SECRETS_STORE_ID).toMatch(/^[0-9a-f]{32}$/);
    expect([...WORKER_SECRETS]).toEqual([
      "ADMIN_PASSWORD",
      "IP_HASH_SECRET",
      "TURNSTILE_SECRET",
      "CAMPUS_JWT_SECRET",
      "CAMPUS_JWT_AES_KEY",
      "CAMPUS_IDENTITY_SECRET",
    ]);
    expect([...GITHUB_DEPLOY_SECRETS]).toEqual([
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
    ]);
  });

  it("accepts ADMIN_PASSWORD as the ops password alias", () => {
    expect(resolveAdminPassword({ ADMIN_PASSWORD: "from-store" })).toBe(
      "from-store",
    );
    expect(() => resolveAdminPassword({})).toThrow(
      /ADMIN_PASSWORD 或 JUFEXK_ADMIN_PASSWORD/,
    );
  });

  it("selects only worker keys from a dotenv file", () => {
    const selected = selectWorkerDevVars(
      parseDotenv(
        "ADMIN_PASSWORD=admin\nIP_HASH_SECRET=ip\nTURNSTILE_SECRET=turnstile\nCAMPUS_JWT_SECRET=jwt\nCAMPUS_JWT_AES_KEY=aes\nCAMPUS_IDENTITY_SECRET=id\nCLOUDFLARE_API_TOKEN=no\n",
      ),
    );
    expect(selected.missing).toEqual([]);
    expect(Object.keys(selected.vars)).toEqual([
      "ADMIN_PASSWORD",
      "IP_HASH_SECRET",
      "TURNSTILE_SECRET",
      "CAMPUS_JWT_SECRET",
      "CAMPUS_JWT_AES_KEY",
      "CAMPUS_IDENTITY_SECRET",
    ]);
    expect(selected.vars.ADMIN_PASSWORD).toBe("admin");
  });
});
