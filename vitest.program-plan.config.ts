import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/program-plan/**/*.test.ts"],
  },
});
