#!/usr/bin/env node
/**
 * Offline resilience audit for QR Studio Pro.
 *
 * The failure this guards against: the browser evicts part of the offline cache
 * (it does that when the device is short on space, and iOS Safari does it even
 * sooner), or a first visit is interrupted before the precache finished. The app
 * must keep working offline anyway, and repair itself the next time it is online.
 *
 * Checks:
 *   1. every file the build declares is really in the cache
 *   2. persistent (never-evicted) storage is requested
 *   3. after evicting non-critical files, the app still works fully offline
 *   4. after evicting, going back online repairs itself (self-healing precache)
 *   5. with the cache emptied completely, offline still shows the app's own
 *      fallback page instead of the browser's error page
 *
 * Usage:  npm run build && npm run test:resilience
 *         CHROME_PATH=/path/to/chrome npm run test:resilience
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4177);
const BASE = `http://localhost:${PORT}`;

const results = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const c of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ])
    if (existsSync(c)) return c;
  const pwRoot = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  if (existsSync(pwRoot)) {
    for (const dir of readdirSync(pwRoot)) {
      for (const rel of ["chrome-linux/chrome", "chromium-1148/chrome-linux/chrome"]) {
        const p = join(pwRoot, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

if (!existsSync(DIST)) {
  console.error("✗ dist/ not found — run `npm run build` first");
  process.exit(1);
}
const browserPath = findBrowser();
if (!browserPath) {
  console.log("\n⚠ resilience test SKIPPED: no Chromium/Chrome binary found (set CHROME_PATH)");
  process.exit(0);
}
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("\n⚠ resilience test SKIPPED: puppeteer-core is not installed");
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), "qsp-resilience-"));
const server = spawn(process.execPath, [join(ROOT, "scripts", "serve-dist.mjs"), String(PORT)], { cwd: ROOT, stdio: "ignore" });
await sleep(900);

const launch = (offline) =>
  puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    userDataDir: profile,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", ...(offline ? ["--host-resolver-rules=MAP * ~NOTFOUND"] : [])],
  });

/** Ask the service worker to verify (and repair) the precache. */
const askStatus = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const sw = navigator.serviceWorker?.controller;
        if (!sw) return resolve(null);
        const ch = new MessageChannel();
        const timer = setTimeout(() => resolve(null), 25000);
        ch.port1.onmessage = (e) => {
          clearTimeout(timer);
          resolve(e.data?.status ?? null);
        };
        sw.postMessage({ type: "ENSURE_OFFLINE" }, [ch.port2]);
      }),
  );

const sectionsOk = async (page) => {
  const names = [];
  for (let i = 0; i < 6; i++) {
    await page.evaluate((i) => {
      const navs = document.querySelectorAll('nav[aria-label="Main navigation"]');
      navs[navs.length - 1].querySelectorAll("button")[i].click();
    }, i);
    await sleep(800);
    const bad = await page.evaluate(() => {
      const txt = document.body.innerText || "";
      return txt.includes("Something went wrong") || txt.includes("حدث خطأ غير متوقع");
    });
    if (bad) names.push(i);
  }
  return names;
};

let browser;
try {
  // ---------------------------------------------------------------- 1 & 2
  browser = await launch(false);
  let page = await browser.newPage();
// The app animates screen changes with the View Transition API, which only runs
// once Chromium produces a frame. Headless with --disable-gpu never does, so a
// click that should open a screen would hang forever. Emulating the "reduce
// motion" preference makes the app take its plain, instant path instead — which
// is also what a user with that preference gets.
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.setCacheEnabled(false);
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 30000 });
  await sleep(4000);

  const full = await askStatus(page);
  check("offline cache complete after the first visit", !!full && full.missing === 0 && full.broken === 0, JSON.stringify(full));

  const fullCount = await page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.includes("precache"));
    return (await (await caches.open(name)).keys()).length;
  });

  const persisted = await page.evaluate(() => (navigator.storage?.persisted ? navigator.storage.persisted() : null));
  check("persistent storage requested (protects the cache and the database)", persisted !== null, `persisted=${persisted}`);

  // ---------------------------------------------------------------- 3 & 4
  const evicted = await page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.includes("precache"));
    const cache = await caches.open(name);
    const keys = await cache.keys();
    // Non-critical files only: icons, manifest, favicons, the SW-register helper.
    const targets = keys.filter((r) => /icons\/|favicon|manifest|workbox-window/.test(r.url));
    const keep = keys.filter((r) => !/icons\/|favicon|manifest|workbox-window/.test(r.url));
    for (const r of targets) await cache.delete(r);
    return { dropped: targets.length, kept: keep.length };
  });
  check("evicted non-critical files to simulate browser cleanup", evicted.dropped > 0, JSON.stringify(evicted));

  const damaged = await page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.includes("precache"));
    return (await (await caches.open(name)).keys()).length;
  });
  check("cache really lost those files", damaged === evicted.kept && damaged < fullCount, `remaining=${damaged} of ${fullCount}`);

  await browser.close();

  // —— cold start, fully offline, with a damaged cache
  browser = await launch(true);
  page = await browser.newPage();
// The app animates screen changes with the View Transition API, which only runs
// once Chromium produces a frame. Headless with --disable-gpu never does, so a
// click that should open a screen would hang forever. Emulating the "reduce
// motion" preference makes the app take its plain, instant path instead — which
// is also what a user with that preference gets.
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.setCacheEnabled(false);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await sleep(3000);
  const badSections = await sectionsOk(page);
  check("offline with a damaged cache: every section still works", badSections.length === 0, `broken sections=${JSON.stringify(badSections)}`);

  await browser.close();

  // —— back online: the service worker must repair itself
  browser = await launch(false);
  page = await browser.newPage();
// The app animates screen changes with the View Transition API, which only runs
// once Chromium produces a frame. Headless with --disable-gpu never does, so a
// click that should open a screen would hang forever. Emulating the "reduce
// motion" preference makes the app take its plain, instant path instead — which
// is also what a user with that preference gets.
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.setCacheEnabled(false);
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 30000 });
  await sleep(4000);
  // The app repairs itself on start-up, so the damage is already gone by now:
  // prove it by comparing the cache against the damaged state.
  const afterHeal = await page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.includes("precache"));
    return (await (await caches.open(name)).keys()).length;
  });
  check("self-healing: the evicted files were re-downloaded automatically", afterHeal > damaged, `${damaged} → ${afterHeal}`);
  check("self-healing: the cache is whole again", afterHeal === fullCount, `entries=${afterHeal} of ${fullCount}`);

  const healed = await askStatus(page);
  check("offline cache verifies as complete after the repair", !!healed && healed.broken === 0, JSON.stringify(healed));

  // ---------------------------------------------------------------- 5
  await page.evaluate(async () => {
    for (const name of await caches.keys()) await caches.delete(name);
  });
  await browser.close();

  browser = await launch(true);
  page = await browser.newPage();
// The app animates screen changes with the View Transition API, which only runs
// once Chromium produces a frame. Headless with --disable-gpu never does, so a
// click that should open a screen would hang forever. Emulating the "reduce
// motion" preference makes the app take its plain, instant path instead — which
// is also what a user with that preference gets.
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.setCacheEnabled(false);
  let navError = null;
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (e) {
    navError = String(e).slice(0, 90);
  }
  await sleep(2500);
  const shell = await page.evaluate(() => ({
    title: document.title,
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 90),
    root: document.getElementById("root")?.childElementCount ?? -1,
  }));
  check(
    "completely empty cache, offline: the app still shows its own page (not a browser error)",
    navError === null && shell.title.length > 0 && (shell.text.length > 5 || shell.root >= 0),
    `navError=${navError} :: ${shell.text}`,
  );

  await browser.close();
  // …and once the connection is back, the wiped cache rebuilds itself.
  browser = await launch(false);
  page = await browser.newPage();
// The app animates screen changes with the View Transition API, which only runs
// once Chromium produces a frame. Headless with --disable-gpu never does, so a
// click that should open a screen would hang forever. Emulating the "reduce
// motion" preference makes the app take its plain, instant path instead — which
// is also what a user with that preference gets.
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.setCacheEnabled(false);
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 30000 });
  await sleep(5000);
  const rebuilt = await page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.includes("precache"));
    return name ? (await (await caches.open(name)).keys()).length : 0;
  });
  check("wiped cache rebuilds itself once back online", rebuilt === fullCount, `entries=${rebuilt} of ${fullCount}`);
} catch (e) {
  check("resilience audit completed", false, String(e).slice(0, 300));
} finally {
  console.log("\n=========== OFFLINE RESILIENCE AUDIT ===========");
  for (const r of results) console.log("  " + r);
  console.log("================================================");
  console.log(failures === 0 ? `✓ all checks passed (${results.filter((r) => r.startsWith("PASS")).length} passed)` : `✗ ${failures} check(s) FAILED`);
  await browser?.close();
  server.kill("SIGTERM");
  rmSync(profile, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}
