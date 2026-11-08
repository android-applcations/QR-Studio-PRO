#!/usr/bin/env node
/**
 * Dependency-free static server for the production build (`dist`).
 *
 * Mirrors the caching rules of `vercel.json` and provides the SPA fallback, so
 * the built PWA can be exercised locally (including offline tests) the same way
 * it behaves in production.
 *
 * Usage: node scripts/serve-dist.mjs [port]
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "dist");
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "0.0.0.0";

if (!existsSync(ROOT)) {
  console.error(`✗ ${ROOT} not found — run "npm run build" first`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Vercel rules: never cache the shell or the worker, cache hashed assets forever. */
function cacheControl(path) {
  if (path === "/sw.js" || path === "/index.html" || path === "/offline.html" || path === "/manifest.webmanifest") {
    return "public, max-age=0, must-revalidate";
  }
  if (path.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (path.startsWith("/icons/") || path === "/favicon.svg") return "public, max-age=604800, must-revalidate";
  return "public, max-age=0, must-revalidate";
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = decodeURIComponent(url.pathname);

  // SPA fallback: unknown paths without a file extension serve the app shell.
  // (Static files always win because they exist on disk.)
  let file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (!extname(path)) {
      path = "/index.html";
      file = join(ROOT, "index.html");
    }
  }
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("404 Not Found");
    return;
  }

  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const headers = {
    "Content-Type": type,
    "Cache-Control": cacheControl(path),
    "X-Content-Type-Options": "nosniff",
  };
  if (path === "/sw.js") headers["Service-Worker-Allowed"] = "/";
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`✓ serving dist on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
});
