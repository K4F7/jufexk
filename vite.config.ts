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
    watch: {
      ignored: ["**/.worktree/**"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
