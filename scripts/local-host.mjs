import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHostMiddleware } from "./host-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isDev = process.argv.includes("--dev");
const port = Number(process.env.PORT || 4173);
const host = "127.0.0.1";
const apiMiddleware = createHostMiddleware(root, {
  onShutdown: () => {
    setTimeout(() => {
      void shutdown();
    }, 80);
  },
});

let middleware;
let vite;
if (isDev) {
  const { createServer } = await import("vite");
  vite = await createServer({
    root,
    server: { middlewareMode: true, host, port },
    appType: "spa",
  });
  middleware = vite.middlewares;
} else {
  const dist = path.join(root, "dist");
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
  };
  middleware = async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const candidate = path.resolve(dist, `.${pathname}`);
    if (!candidate.startsWith(dist + path.sep)) return next();
    try {
      const data = await fs.readFile(candidate);
      response.setHeader(
        "Content-Type",
        mime[path.extname(candidate)] ?? "application/octet-stream",
      );
      response.end(data);
    } catch {
      const data = await fs.readFile(path.join(dist, "index.html"));
      response.setHeader("Content-Type", mime[".html"]);
      response.end(data);
    }
  };
}

const server = http.createServer(async (request, response) => {
  await apiMiddleware(request, response, async () => {
    await middleware(request, response, () => {
      response.statusCode = 404;
      response.end("Not found");
    });
  });
});

server.listen(port, host, () => {
  console.log(`Local workflow host: http://${host}:${port}`);
  console.log(`Atomic document directory: ${path.join(root, "documents")}`);
});

async function shutdown() {
  server.close();
  if (vite) await vite.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

