import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    define: { TEST_D1_MIGRATIONS: JSON.stringify(migrations) },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          d1Databases: { MIGRATION_DB: "migration-upgrade-test" },
          bindings: {
            ADMIN_PASSWORD: "test-password",
            IP_HASH_SECRET: "test-ip-hash-secret",
            TURNSTILE_SECRET: "",
            TURNSTILE_SITE_KEY: "",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
