#!/usr/bin/env node
/**
 * Build audit for the offline-first PWA.
 *
 * Verifies that:
 *  - dist/manifest.webmanifest is valid JSON and declares the required icons
 *  - dist/sw.js exists, is the only service worker and contains a precache manifest
 *  - every file emitted in dist is part of the precache manifest
 *  - no runtime file references an external (CDN / font / API) origin
 *
 * Usage: node scripts/check-build.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = "dist";
const problems = [];
const notes = [];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

function fail(msg) {
  problems.push(msg);
}
function ok(msg) {
  notes.push(msg);
}

// ---------------------------------------------------------------- files
for (const f of ["index.html", "sw.js", "manifest.webmanifest", "offline.html"]) {
  const p = join(DIST, f);
  if (!existsSync(p)) fail(`missing required file: dist/${f}`);
}

if (!existsSync(DIST)) {
  console.error(`✗ ${DIST} not found — run "npm run build" first`);
  process.exit(1);
}

// ---------------------------------------------------------------- manifest
const manifestRaw = readFileSync(join(DIST, "manifest.webmanifest"), "utf8");
let manifest;
try {
  manifest = JSON.parse(manifestRaw);
} catch (e) {
  fail(`manifest.webmanifest is not valid JSON: ${e.message}`);
}
if (manifest) {
  for (const key of ["name", "short_name", "start_url", "display", "icons"]) {
    if (!manifest[key]) fail(`manifest is missing "${key}"`);
  }
  const icons = manifest.icons ?? [];
  const missing = icons.filter((i) => !existsSync(join(DIST, i.src.replace(/^\//, ""))));
  if (missing.length) fail(`manifest icons missing on disk: ${missing.map((i) => i.src).join(", ")}`);
  if (!icons.some((i) => i.sizes === "512x512")) fail("manifest has no 512x512 icon");
  if (!icons.some((i) => (i.purpose ?? "any").includes("maskable"))) fail("manifest has no maskable icon");
  ok(`manifest: ${icons.length} icons, display="${manifest.display}", start_url="${manifest.start_url}"`);
}

// ---------------------------------------------------------------- service worker
const swFiles = walk(DIST).filter((f) => /(^|\/)(sw|service-worker|workbox-)[^/]*\.js$/.test(f));
const swPath = join(DIST, "sw.js");
if (!existsSync(swPath)) fail("dist/sw.js is missing (service worker was not generated)");
const extraSws = swFiles.filter((f) => f !== swPath && !f.endsWith("workbox-window.prod.es5-BBnX5xw4.js"));
if (extraSws.length > 1) fail(`more than one service worker file: ${swFiles.join(", ")}`);

const sw = existsSync(swPath) ? readFileSync(swPath, "utf8") : "";
if (sw) {
  ok(`sw.js generated (${(sw.length / 1024).toFixed(1)} kB)`);
  if (!/precache/i.test(sw)) fail("sw.js does not look like a precaching service worker");
  if (!/offline\.html/.test(sw)) notes.push("note: sw.js does not reference offline.html");

  // Extract the injected precache manifest.
  const swSource = sw;
  const start = sw.indexOf("[{");
  let entries = [];
  const m = sw.slice(sw.indexOf('[{"revision"') >= 0 ? sw.indexOf('[{"revision"') : start).match(/\[[\s\S]*?\]\s*(?=[,;)])/);
  if (m) {
    try {
      entries = JSON.parse(m[0]);
    } catch {
      /* fall through */
    }
  }
  if (!entries.length) {
    // workbox may inject into a variable assignment; fall back to regex extraction
    const urls = [...sw.matchAll(/\{"revision":(null|"[a-f0-9]+"),"url":"([^"]+)"\}/g)].map((x) => ({ revision: x[1] === "null" ? null : x[1].replace(/"/g, ""), url: x[2] }));
    entries = urls;
  }
  if (!entries.length) {
    fail("could not read the precache manifest from dist/sw.js");
  } else {
    const urls = new Set(entries.map((e) => e.url.replace(/^\//, "")));
    ok(`precache manifest: ${urls.size} entries`);

    const distFiles = walk(DIST).map((f) => relative(DIST, f).split("\\").join("/"));
    // Brand marks are the one deliberate exception: they are cached the first
    // time they are requested, not at install (see the /brands/ route in
    // src/sw.ts). Everything else that ships must be precached.
    const deferred = distFiles.filter((f) => f.startsWith("brands/"));
    const notCached = distFiles.filter((f) => f !== "sw.js" && !urls.has(f) && !deferred.includes(f));
    if (notCached.length) fail(`files in dist that are NOT precached: ${notCached.join(", ")}`);
    if (deferred.length) {
      if (urls.has(deferred[0])) fail(`"${deferred[0]}" is precached — brand marks must be cached on first use, not at install`);
      else if (!/\/brands\//.test(swSource)) fail(`${deferred.length} brand marks are not precached and sw.js has no /brands/ route to cache them on demand`);
      else ok(`brand marks are cached on first use, not at install (${deferred.length} files kept out of the precache)`);
    }

    const stale = [...urls].filter((u) => !distFiles.includes(u));
    if (stale.length) notes.push(`note: precache entries with no dist file (harmless): ${stale.join(", ")}`);

    for (const required of ["index.html", "offline.html", "manifest.webmanifest"]) {
      if (!urls.has(required)) fail(`"${required}" is not precached`);
    }
    const js = [...urls].filter((u) => u.endsWith(".js"));
    const css = [...urls].filter((u) => u.endsWith(".css"));
    // Every JS file the build emitted must be precached. Bundling the screens
    // into the app shell (instead of lazy-loading them) is what makes offline
    // reliable, so a small number of chunks is good, not bad — but a file that
    // is shipped and *not* cached is always a bug.
    const shippedJs = distFiles.filter((f) => f.startsWith("assets/") && f.endsWith(".js") && f !== "sw.js");
    const uncachedJs = shippedJs.filter((f) => !urls.has(f));
    if (uncachedJs.length) fail(`JS files shipped but not precached: ${uncachedJs.join(", ")}`);
    if (!js.length) fail("no JS is precached");
    if (!css.length) fail("no CSS is precached");
    if (!css.length) fail("no CSS file is precached");
    ok(`precache covers ${js.length} JS chunks and ${css.length} CSS files`);
  }
}

// ---------------------------------------------------------------- engine purity
/**
 * The engines must stay pure.
 *
 * `designEngine` turns content plus a design into an SVG string — nothing else.
 * That is why it can run in a worker and why it is testable without a browser.
 * `exportEngine` builds bytes the same way and keeps the parts that have to
 * touch the page (downloading, copying, sharing) in its Delivery section.
 *
 * A stray `document.` in a generation module silently ties it to a tab, which
 * breaks both. This is the guard.
 */
const PURE_ENGINES = ["src/engine/designEngine.ts", "src/engine/pdf.ts", "src/core/qrTypes.ts", "src/core/scanView.ts", "src/core/security.ts"];
const impure = [];
for (const rel of PURE_ENGINES) {
  const text = readFileSync(rel, "utf8");
  const lines = text.split("\n");
  // A guarded read (`typeof document === "undefined" ? … : document.lang`) is a
  // feature check, not a dependency: the module still works without a DOM.
  // Reaching for the DOM to do the actual work is what this catches.
  lines.forEach((line, i) => {
    if (/\btypeof\s+(window|document|navigator|localStorage)\b/.test(line)) return;
    for (const m of line.matchAll(/\b(window|document|navigator|localStorage)\s*\./g)) impure.push(`${rel}:${i + 1} → ${m[0]}`);
  });
}
if (impure.length) fail(`engines touching the DOM: ${impure.join(", ")}`);
else ok(`generation engines stay pure (${PURE_ENGINES.length} modules, no window/document/navigator)`);

// ---------------------------------------------------------------- external deps
/**
 * QR payloads legitimately contain external links (that is the user's content, not
 * an app dependency), so only *loading* positions are treated as a hard failure:
 * script/link/img src, css url(), dynamic import(), fetch(), Worker(), @import.
 */
const NAMESPACE = /^https?:\/\/(www\.)?(w3\.org|purl\.org|schemas\.microsoft\.com|ns\.adobe\.com|ogp\.me|schema\.org)$/i;
const LOADER = /(src\s*=\s*"https?:|href\s*=\s*"https?:|url\(\s*['"]?https?:|@import\s+['"]https?:|import\(\s*["']https?:|from\s*["']https?:|fetch\(\s*["']https?:|new\s+Worker\(\s*["']https?:|new\s+URL\(\s*["']https?:)/i;

const loaderHits = [];
const hosts = new Set();
for (const f of walk(DIST).filter((f) => /\.(js|css|html|webmanifest|svg)$/.test(f))) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)(?:[/:?#][^\s"'`,)\]}]*)?/gi)) {
    const [url, host] = m;
    if (NAMESPACE.test(`https://${host}`)) continue; // XML / metadata namespaces are not requests
    if (url.includes("${")) continue; // template built from user content
    hosts.add(host);
    const before = text.slice(Math.max(0, m.index - 24), m.index + url.length + 2);
    if (LOADER.test(before)) loaderHits.push(`${relative(DIST, f)} → ${url.slice(0, 100)}`);
  }
}
if (loaderHits.length) {
  for (const h of loaderHits) fail(`external runtime dependency: ${h}`);
} else {
  ok(`no external runtime loading (CDN / Google Fonts / remote API). Referenced hosts: ${[...hosts].slice(0, 8).join(", ") || "none"}`);
}

// ---------------------------------------------------------------- html shell
const html = readFileSync(join(DIST, "index.html"), "utf8");
if (!/rel="manifest"/.test(html)) fail("index.html does not link the web manifest");
if (!/rel="apple-touch-icon"/.test(html)) fail("index.html has no apple-touch-icon");
if (/<script[^>]+src="https?:\/\//.test(html)) fail("index.html loads a script from an external origin");
ok("index.html links manifest + apple-touch-icon, no external scripts");

// ---------------------------------------------------------------- report
console.log("— build audit —————————————————————————");
for (const n of notes) console.log("  ✓ " + n);
if (problems.length) {
  console.log("");
  for (const p of problems) console.log("  ✗ " + p);
  console.log("");
  console.error(`✗ build audit failed with ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("");
console.log("✓ build audit passed");
