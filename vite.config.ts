import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/** Ignore a directory next to this config. Absolute paths work on Windows.
 *  A recursive glob that starts with star-star slash .worktree would also
 *  match this worktree's own src and silently kill HMR when prototype
 *  runs from .worktree/<issue>/ (#152). */
function ignoreDir(name: string): string {
  return path.join(repoRoot, name);
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Let the browser discover entry dependencies after the stylesheet. The
    // generated modulepreload list eagerly fetched route/shared chunks before
    // the render-blocking CSS on mobile connections.
    modulePreload: false,
  },
  // UI Prototype / client HMR: open this origin, proxy /api to wrangler.
  // `pnpm dev` (wrangler) serves production dist — use `pnpm prototype` for Gallery.
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        ignoreDir(".worktree"),
        ignoreDir(".worktrees"),
        ignoreDir(".wrangler"),
        ignoreDir(".local-data"),
        ignoreDir(".scratch"),
        ignoreDir(".playwright-cli"),
        ignoreDir("test-results"),
        ignoreDir("output"),
      ],
    },
    proxy: {
      "/api": {
        // Preview Origin is :5173; wrangler URL is :8787. originOk allows
        // this loopback pair so CAS login is not rejected as 来源校验失败.
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
