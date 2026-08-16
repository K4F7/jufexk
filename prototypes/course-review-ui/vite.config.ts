import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tailwindcss()],
  server: {
    host: "127.0.0.1",
  },
  build: {
    outDir: fileURLToPath(new URL("../../.prototype-dist/course-review-ui", import.meta.url)),
    emptyOutDir: true,
  },
});
