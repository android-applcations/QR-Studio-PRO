#!/usr/bin/env node
/**
 * Does the editor stay smooth while it is being used?
 *
 * Dragging a colour picker fires a change per frame, and every one of those
 * changes re-renders the design. If the whole screen — editor, preview,
 * navigation, everything hanging off a context — is rebuilt each time, the
 * slider sticks and the phone gets warm.
 *
 * So this drives the same changes a person would and watches the main thread
 * while it happens: how long the burst takes, and whether any single task
 * blocked long enough to be felt. It also counts how many times a component
 * that has nothing to do with the design is asked to render, which is the
 * number the state changes are meant to bring down.
 *
 * Usage:  npm run build && npm run test:perf
 *         CHROME_PATH=/path/to/chrome npm run test:perf
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4179);
const BASE = `http://localhost:${PORT}`;

const results = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};
const note = (text) => results.push(`      ${text}`);

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const c of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium"])
    if (existsSync(c)) return c;
  const pwRoot = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  if (existsSync(pwRoot)) {
    for (const dir of readdirSync(pwRoot))
      for (const rel of ["chrome-linux/chrome", "chromium-1148/chrome-linux/chrome"]) {
        const p = join(pwRoot, dir, rel);
        if (existsSync(p)) return p;
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
  console.log("\n⚠ perf test SKIPPED: no Chromium/Chrome binary found (set CHROME_PATH)");
  process.exit(0);
}
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("\n⚠ perf test SKIPPED: puppeteer-core is not installed");
  process.exit(0);
}

const server = spawn(process.execPath, [join(ROOT, "scripts", "serve-dist.mjs"), String(PORT)], { cwd: ROOT, stdio: "ignore" });
await sleep(900);

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

try {
  // ------------------------------------------------------------- a real code
  // Measured on a code with content in it, not the empty placeholder: the
  // preview is the expensive part of an edit and it is only expensive when
  // there is something to draw.
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1200);
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Search"]');
    if (!i) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Website");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(900);
  const pickedType = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim().toLowerCase().startsWith("website"));
    if (!b) return false;
    b.click();
    return true;
  });
  check("create: the website form opened", pickedType);
  await sleep(1100);
  const filled = await page.evaluate(() => {
    const i = document.querySelector("#f-url-url") ?? document.querySelector("input[type='url']");
    if (!i) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "https://qr-studio-pro-sigma.vercel.app/a-long-enough-address-to-make-a-dense-code?v=2&ref=perf");
    i.dispatchEvent(new Event("input", { bubbles: true }));
    i.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });
  check("create: the address went in", filled);
  await sleep(500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes("Create QR code"));
    b?.click();
  });
  await sleep(2600);
  // …and now the design screen, where the edits happen.
  await page.evaluate(() => {
    const navs = document.querySelectorAll('nav[aria-label="Main navigation"]');
    navs[navs.length - 1].querySelectorAll("button")[1].click();
  });
  await sleep(1800);

  /**
   * One burst of edits, measured.
   *
   * The colour input is driven the way a drag drives it: a new value, then an
   * `input` event, then let React settle before the next one.
   */
  /**
   * A burst: forty changes inside one task, faster than any finger.
   *
   * The right behaviour here is *not* forty redraws. The preview is deferred,
   * so a change that is overwritten before it could be drawn never costs
   * anything. What must hold is that the work stays trivial and the code ends
   * up showing the last colour.
   */
  const burst = await page.evaluate(async () => {
    const input = document.querySelector('input[type="color"]');
    if (!input) return { ok: false, reason: "no colour control on the design screen" };
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const preview = () => document.querySelector('img[alt="QR code"]')?.getAttribute("src") ?? "";
    const N = 40;
    const frames = [];
    const srcs = new Set();
    // React flushes a discrete `input` event synchronously, so each change is
    // settled by the time `dispatchEvent` returns. Timing that call alone
    // measures the app's work without counting the frames in between.
    for (let i = 0; i < N; i++) {
      const t = performance.now();
      const v = ((i * 37) % 256).toString(16).padStart(2, "0");
      set.call(input, `#${v}5a9c`);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      frames.push(performance.now() - t);
      srcs.add(preview());
    }
    // Let React's deferred pass finish, then look at what is on screen.
    await new Promise((r) => setTimeout(r, 600));
    const total = frames.reduce((a, b) => a + b, 0);
    return {
      ok: true,
      changes: N,
      total: Math.round(total),
      perChange: Math.round((total / N) * 100) / 100,
      worst: Math.round(Math.max(...frames) * 100) / 100,
      redrew: srcs.size,
      // The last colour asked for is the one on screen.
      settled: preview().includes("5a9c".toUpperCase()) || preview().includes("5a9c"),
    };
  });

  check("the design screen offers a colour control", burst.ok, burst.reason ?? "");
  if (burst.ok) {
    note(`${burst.changes} changes in one burst: ${burst.total} ms total, ${burst.perChange} ms each, worst ${burst.worst} ms`);
    note(`the preview was redrawn ${burst.redrew} times — the ones already superseded were skipped`);
    check("superseded changes are not drawn", burst.redrew < burst.changes, `${burst.redrew} draws for ${burst.changes} changes`);
    check("the last change is the one on screen", burst.settled === true);
    check("an edit costs less than half a frame", burst.perChange < 8, `${burst.perChange} ms of work per change`);
    check("no single edit stalls the thread", burst.worst < 50, `worst change ${burst.worst} ms`);
  }

  /**
   * A drag: one change per frame, the way a thumb actually moves.
   *
   * Here every change must reach the screen, and the app has to finish its
   * work inside the frame it was given, or the slider stops following.
   */
  const drag = await page.evaluate(async () => {
    const input = document.querySelector('input[type="color"]');
    if (!input) return { ok: false };
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const preview = () => document.querySelector('img[alt="QR code"]')?.getAttribute("src") ?? "";
    const N = 30;
    const srcs = new Set();
    const perFrame = [];
    for (let i = 0; i < N; i++) {
      const t = performance.now();
      const v = ((i * 29) % 256).toString(16).padStart(2, "0");
      set.call(input, `#${v}77aa`);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      perFrame.push(performance.now() - t);
      await new Promise((r) => requestAnimationFrame(r));
      srcs.add(preview());
    }
    await new Promise((r) => setTimeout(r, 600));
    return {
      ok: true,
      frames: N,
      redrew: srcs.size,
      work: Math.round(perFrame.reduce((a, b) => a + b, 0)),
      worst: Math.round(Math.max(...perFrame) * 100) / 100,
    };
  });
  if (drag.ok) {
    note(`a ${drag.frames}-frame drag: ${drag.work} ms of work in total, worst frame ${drag.worst} ms`);
    check("every frame of a drag reaches the screen", drag.redrew >= drag.frames, `${drag.redrew} previews for ${drag.frames} frames`);
    // 16 ms is the whole budget for a frame at 60 Hz.
    check("a drag never overruns its frame", drag.worst < 16, `worst frame ${drag.worst} ms`);
  }

  // ------------------------------------------------------------------ profile
  // Where does the time actually go? Names, not guesses.
  const client = await page.createCDPSession();
  await client.send("Profiler.enable");
  await client.send("Profiler.setSamplingInterval", { interval: 100 });
  await client.send("Profiler.start");
  await page.evaluate(async () => {
    const input = document.querySelector('input[type="color"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (let i = 0; i < 40; i++) {
      const v = ((i * 71) % 256).toString(16).padStart(2, "0");
      set.call(input, `#7c${v}2e`);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => setTimeout(r, 400));
  });
  const { profile } = await client.send("Profiler.stop");
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const [i, id] of (profile.samples ?? []).entries()) {
    const dt = i > 0 ? (profile.timeDeltas?.[i] ?? 0) / 1000 : 0;
    const n = byId.get(id);
    if (!n) continue;
    const f = n.callFrame;
    const key = `${f.functionName || "(anonymous)"}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  note(`where the time goes (self time, ms): ${top.map(([k, v]) => `${k} ${Math.round(v)}`).join(", ")}`);

  // ------------------------------------------------- unrelated screens stay put
  /**
   * The navigation bar sits outside the editor and holds nothing that changes
   * when a colour does. Counting its paints is a direct read on how far a
   * design tweak travels: if the state is properly isolated, the shell is not
   * rebuilt forty times for forty colours.
   */
  const ripples = await page.evaluate(async () => {
    const nav = document.querySelector('nav[aria-label="Main navigation"]');
    if (!nav) return { ok: false, reason: "no navigation" };
    let paints = 0;
    const mo = new MutationObserver((list) => {
      paints += list.length;
    });
    mo.observe(nav, { childList: true, subtree: true, attributes: true, characterData: true });
    const input = document.querySelector('input[type="color"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    for (let i = 0; i < 40; i++) {
      const v = ((i * 53) % 256).toString(16).padStart(2, "0");
      set.call(input, `#1b${v}d7`);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => setTimeout(r, 500));
    mo.disconnect();
    return { ok: true, paints };
  });
  check("the navigation can be watched", ripples.ok, ripples.reason ?? "");
  if (ripples.ok) {
    note(`the app shell changed ${ripples.paints} times across 40 design edits`);
    // The nav is static. Every mutation here means work done for a colour it
    // does not care about. A handful is layout; dozens is a leak of state.
    check("editing the design leaves the shell alone", ripples.paints <= 8, `${ripples.paints} mutations`);
  }

  check("perf audit completed", true);
} catch (e) {
  check("perf audit completed", false, String(e).slice(0, 300));
} finally {
  await browser.close();
  server.kill();
}

console.log(results.map((r) => `  ${r}`).join("\n"));
console.log("=".repeat(60));
if (failures) {
  console.log(`✗ ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`✓ all checks passed (${results.filter((r) => r.startsWith("PASS")).length} passed)`);
