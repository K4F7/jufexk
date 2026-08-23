import { describe, expect, it } from "vitest";
import {
  GITHUB_DEPLOY_SECRETS,
  SECRETS_STORE_ID,
  WORKER_SECRETS,
  isSecretAlreadyExistsError,
  parseDotenv,
  parseSecretStoreList,
  resolveAdminSession,
  secretStoreListHasName,
  selectWorkerDevVars,
} from "./inventory";

describe("secret inventory", () => {
  it("keeps worker secrets in Secrets Store and deploy keys on GitHub", () => {
    expect(SECRETS_STORE_ID).toMatch(/^[0-9a-f]{32}$/);
    expect([...WORKER_SECRETS]).toEqual([
      "IP_HASH_SECRET",
      "TURNSTILE_SECRET",
      "CAMPUS_IDENTITY_SECRET",
      "MAIL_DELIVERY_TOKEN",
      "REVIEW_AUTHOR_LOOKUP_TO",
      "CAS_CHALLENGE_SECRET",
    ]);
    expect([...GITHUB_DEPLOY_SECRETS]).toEqual([
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
    ]);
  });

  it("requires an administrator cookie pair for ops scripts", () => {
    expect(
      resolveAdminSession({
        JUFEXK_ADMIN_COOKIE: "jufexk_admin=raw",
        JUFEXK_ADMIN_CSRF: "csrf",
      }),
    ).toEqual({ cookie: "jufexk_admin=raw", csrf: "csrf" });
    expect(() => resolveAdminSession({})).toThrow(/JUFEXK_ADMIN_COOKIE/);
  });

  it("reads worker secret ids from a wrangler store table", () => {
    const ids = parseSecretStoreList(`
| Name | ID | Updated |
| IP_HASH_SECRET | 11111111111111111111111111111111 | yesterday |
| CAS_CHALLENGE_SECRET | aaaabbbbccccddddeeeeffff00001111 | now |
| IGNORE_ME | 22222222222222222222222222222222 | now |
`);
    expect(ids.get("IP_HASH_SECRET")).toBe("11111111111111111111111111111111");
    expect(ids.get("CAS_CHALLENGE_SECRET")).toBe(
      "aaaabbbbccccddddeeeeffff00001111",
    );
    expect(ids.has("IGNORE_ME")).toBe(false);
  });

  it("reads worker secret ids from wrangler unicode tables and UUID ids", () => {
    const ids = parseSecretStoreList(`
🔐 Listing secrets... (store-id: 323163a091874b07aacdf5500bff903e, page: 1, per-page: 50)
┌────────────────────────┬──────────────────────────────────────┬─────────┐
│ Name                   │ ID                                   │ Updated │
├────────────────────────┼──────────────────────────────────────┼─────────┤
│ IP_HASH_SECRET         │ 11111111-1111-4111-8111-111111111111 │ now     │
│ CAS_CHALLENGE_SECRET   │ aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee │ now     │
│ IGNORE_ME              │ 22222222-2222-4222-8222-222222222222 │ now     │
└────────────────────────┴──────────────────────────────────────┴─────────┘
`);
    expect(ids.get("IP_HASH_SECRET")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(ids.get("CAS_CHALLENGE_SECRET")).toBe(
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
    expect(ids.has("IGNORE_ME")).toBe(false);
    expect(
      secretStoreListHasName(
        "│ CAS_CHALLENGE_SECRET │ aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee │",
        "CAS_CHALLENGE_SECRET",
      ),
    ).toBe(true);
    expect(secretStoreListHasName("no secrets here", "CAS_CHALLENGE_SECRET")).toBe(
      false,
    );
  });

  it("reads worker secret ids from ANSI-colored wrangler tables", () => {
    const ids = parseSecretStoreList(
      "\u001b[90m│\u001b[39m CAS_CHALLENGE_SECRET \u001b[90m│\u001b[39m aaaabbbbccccddddeeeeffff00001111 \u001b[90m│\u001b[39m now \u001b[90m│\u001b[39m\n",
    );
    expect(ids.get("CAS_CHALLENGE_SECRET")).toBe(
      "aaaabbbbccccddddeeeeffff00001111",
    );
    expect(
      secretStoreListHasName(
        "\u001b[90m│\u001b[39m CAS_CHALLENGE_SECRET \u001b[90m│\u001b[39m",
        "CAS_CHALLENGE_SECRET",
      ),
    ).toBe(true);
  });

  it("treats Cloudflare already-exists create errors as present", () => {
    const createError = `
✘ [ERROR] A request to the Cloudflare API (/accounts/acct/secrets_store/stores/323163a091874b07aacdf5500bff903e/secrets) failed.

  secret_name_already_exists: CAS_CHALLENGE_SECRET [code: 1003]
`;
    expect(isSecretAlreadyExistsError(createError)).toBe(true);
    expect(
      isSecretAlreadyExistsError(
        "\u001b[31msecret_name_already_exists: CAS_CHALLENGE_SECRET [code: 1003]\u001b[0m",
      ),
    ).toBe(true);
    expect(isSecretAlreadyExistsError("authentication failed")).toBe(false);
  });

  it("selects only worker keys from a dotenv file", () => {
    const selected = selectWorkerDevVars(
      parseDotenv(
        "IP_HASH_SECRET=ip\nTURNSTILE_SECRET=turnstile\nCAMPUS_IDENTITY_SECRET=id\nMAIL_DELIVERY_TOKEN=mail\nREVIEW_AUTHOR_LOOKUP_TO=admin@example.test\nCAS_CHALLENGE_SECRET=cas\nCAMPUS_JWT_SECRET=jwt\nCLOUDFLARE_API_TOKEN=no\n",
      ),
    );
    expect(selected.missing).toEqual([]);
    expect(Object.keys(selected.vars)).toEqual([
      "IP_HASH_SECRET",
      "TURNSTILE_SECRET",
      "CAMPUS_IDENTITY_SECRET",
      "MAIL_DELIVERY_TOKEN",
      "REVIEW_AUTHOR_LOOKUP_TO",
      "CAS_CHALLENGE_SECRET",
    ]);
    expect(selected.vars.IP_HASH_SECRET).toBe("ip");
  });
});
