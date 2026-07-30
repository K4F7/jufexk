import { resolve } from "node:path";

const script = resolve(import.meta.dir, "userscript/jufexk-catalog-collector.user.js");
Bun.serve({
  hostname: "127.0.0.1",
  port: 47831,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/jufexk-catalog-collector.user.js") return new Response("Not found", { status: 404 });
    return new Response(Bun.file(script), { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" } });
  },
});
