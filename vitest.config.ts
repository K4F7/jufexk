import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    define: { TEST_D1_MIGRATIONS: JSON.stringify(migrations) },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: {
          d1Databases: [
            "MIGRATION_DB",
            "MIGRATION_CONFLICT_DB",
            "CATEGORY_MIGRATION_DB",
            "CATEGORY_CONFLICT_DB",
            "BASELINE_PUBLISH_DB_1",
            "BASELINE_PUBLISH_DB_2",
            "BASELINE_PUBLISH_DB_3",
            "BASELINE_PUBLISH_DB_4",
            "BASELINE_PUBLISH_DB_5",
            "BASELINE_PUBLISH_DB_6",
            "BASELINE_PUBLISH_DB_7",
          ],
          bindings: {
            ADMIN_PASSWORD: "test-password",
            HISTORICAL_IMPORT_ARTIFACT_SHA256: "manifest",
            HISTORICAL_IMPORT_MANIFEST_SHA256: "manifest",
            ISSUE111_RELATION_MANIFEST_SHA256: "manifest",
            ISSUE111_IMPORT_ARTIFACT_SHA256: "manifest",
            ISSUE111_IMPORT_MANIFEST_SHA256: "manifest",
            IP_HASH_SECRET: "test-ip-hash-secret",
            ORDINARY_USER_TEST_AUTH_SECRET: "test-ordinary-user-auth",
            CAMPUS_JWT_SECRET: "test-campus-jwt-secret",
            CAMPUS_JWT_AUD: "jufexk",
            CAMPUS_JWT_AES_KEY:
              "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
            CAMPUS_IDENTITY_SECRET: "test-campus-identity",
            CAMPUS_APP_ID: "jufexk",
            AUTHBRIDGE_BASE_URL: "https://authbridge.example.test/authbridge",
            TURNSTILE_SECRET: "",
            TURNSTILE_SITE_KEY: "",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      exclude: ["test/browser/**"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
