import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  // UI Prototype / client HMR: open this origin, proxy /api to wrangler.
  // `pnpm dev` (wrangler) serves production dist — use `pnpm prototype` for Gallery.
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Issue worktrees copy the full repo. Watching them freezes Vite HMR (#152).
    // Use a root-relative glob — `**/.worktree/**` also matches this worktree's
    // own absolute path (`…/.worktree/dev-preview-atlas/src/…`) and silently
    // disables HMR when `pnpm prototype` runs from the worktree.
    watch: {
      ignored: [".worktree/**"],
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
