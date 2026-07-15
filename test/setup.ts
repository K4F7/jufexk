import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

declare const TEST_D1_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];

beforeAll(async () => {
  await applyD1Migrations(env.DB, TEST_D1_MIGRATIONS);
});
