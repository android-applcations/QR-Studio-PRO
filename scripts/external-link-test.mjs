#!/usr/bin/env node
/**
 * External link audit for QR Studio Pro.
 *
 * Scanned links and the WhatsApp button must be handed to the operating system,
 * not kept inside the app. Inside an installed PWA a `_self` navigation stays
 * trapped in the standalone window and custom schemes (instagram://…) are
 * dropped silently, so every hand-off has to go through `target="_blank"`.
 *
 * Checks: a website link, an app deep link and the WhatsApp button are all
 * handed off with `target="_blank"` from a rendered anchor, and dangerous
 * content is never opened at all.
 *
 * Usage:  npm run build && npm run test:links
 *         CHROME_PATH=/path/to/chrome npm run test:links
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4171);
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
  console.log("\n⚠ external link test SKIPPED: no Chromium/Chrome binary found (set CHROME_PATH)");
  process.exit(0);
}
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("\n⚠ external link test SKIPPED: puppeteer-core is not installed");
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
// The app animates screen changes with the View Transition API, which only runs
// once Chromium produces a frame. Headless with --disable-gpu never does, so a
// click that should open a screen would hang forever. Emulating the "reduce
// motion" preference makes the app take its plain, instant path instead — which
// is also what a user with that preference gets.
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

// Record every attempt to follow a link, whoever makes it.
await page.evaluateOnNewDocument(() => {
  window.__nav = [];
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    window.__nav.push({
      href: this.href,
      target: this.getAttribute("target") || "",
      rel: this.getAttribute("rel") || "",
      display: getComputedStyle(this).display,
      inDoc: document.contains(this),
    });
    return click.call(this);
  };
  const open = window.open;
  window.open = function (url, target, features) {
    window.__nav.push({ href: String(url), target: "window.open:" + String(target ?? ""), features: String(features ?? "") });
    return open.call(window, url, target, features);
  };
});

const goSection = (i) =>
  page.evaluate((i) => {
    const navs = document.querySelectorAll('nav[aria-label="Main navigation"]');
    navs[navs.length - 1].querySelectorAll("button")[i].click();
  }, i);

/** Build a QR inside the app for `value` and save it as a PNG. */
let lastReason = "";
const reasons = [];

async function makeQr(typeMatches, value, file) {
  const terms = Array.isArray(typeMatches) ? typeMatches : [typeMatches];
  let ok = false;
  reasons.length = 0;
  for (const term of terms) {
    ok = await tryMakeQr(term, value, file);
    if (ok) break;
    reasons.push(lastReason);
  }
  return ok;
}

async function tryMakeQr(typeMatch, value, file) {
  // Start clean. `goto(BASE)` (not reload) drops the `?section=` the app writes
  // into the URL, so CreateScreen mounts freshly and shows the type list again —
  // a reload would restore the form left open by the previous attempt.
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1200);
  // The app remembers the project you were editing, so a form may still be open.
  // Step back to the type grid first.
  for (let i = 0; i < 3; i++) {
    const wentBack = await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Back"]');
      if (!b) return false;
      b.click();
      return true;
    });
    if (!wentBack) break;
    await sleep(700);
  }
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Search"]');
    if (i) {
      i.focus();
      i.value = "";
    }
  });
  await page.evaluate((q) => {
    const i = document.querySelector('input[aria-label="Search"]');
    if (!i) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(i, q);
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }, typeMatch);
  await sleep(900);
  const picked = await page.evaluate((q) => {
    const want = q.toLowerCase();
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim().toLowerCase().startsWith(want));
    if (!b) return { ok: false, why: "no card", cards: [...document.querySelectorAll("button")].map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 10) };
    b.click();
    return { ok: true };
  }, typeMatch);
  if (!picked.ok) {
    lastReason = `${typeMatch}: ${picked.why} :: ${JSON.stringify(picked.cards ?? [])}`;
    return false;
  }
  await sleep(1000);
  const typed = await page.evaluate((val) => {
    const f = document.querySelector('input[id^="f-"], textarea[id^="f-"]');
    if (!f) return false;
    const proto = f.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(f, val);
    f.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, value);
  if (!typed) {
    lastReason = `${typeMatch}: no form field after picking`;
    return false;
  }
  await sleep(500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes("Create QR code"));
    b?.click();
  });
  await sleep(2500);
  const png = await page.evaluate(async () => {
    const img = document.querySelector('img[alt="QR code"]');
    if (!img) return null;
    try {
      await img.decode();
    } catch {}
    const c = document.createElement("canvas");
    c.width = c.height = 420;
    const x = c.getContext("2d");
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 420, 420);
    x.drawImage(img, 0, 0, 420, 420);
    return c.toDataURL("image/png");
  });
  if (!png) {
    lastReason = `${typeMatch}: no QR image rendered`;
    return false;
  }
  writeFileSync(file, Buffer.from(png.split(",")[1], "base64"));
  return true;
}

/** Scan a PNG and press Open → confirm. Returns the recorded navigation events. */
async function scanAndOpen(file) {
  await goSection(2); // scan
  await sleep(1400);
  const input = await page.$('input[type="file"]');
  if (!input) return { events: [], detected: false };
  await input.uploadFile(file);
  const detected = await page
    .waitForFunction(() => (document.body.innerText || "").includes("Code detected"), { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (!detected) return { events: [], detected: false };

  await page.evaluate(() => {
    window.__nav = [];
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim().startsWith("Open"));
    b?.click();
  });
  await sleep(1200);
  await page.evaluate(() => {
    const all = [...document.querySelectorAll("button")].filter((e) => /^(Open|فتح)$/.test((e.textContent || "").trim()));
    all[all.length - 1]?.click();
  });
  await sleep(2500);
  return { events: await page.evaluate(() => window.__nav), detected: true };
}

try {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1500);

  // ---------------------------------------------------------------- website
  const webFile = join(tmpdir(), "qr-link-web.png");
  const madeWeb = await makeQr("Website", "https://instagram.com/_u/abuomar", webFile);
  check("create: built a QR for an Instagram profile link", madeWeb);
  if (madeWeb) {
    const { events, detected } = await scanAndOpen(webFile);
    check("scan: the Instagram link was detected", detected);
    const ev = events.find((e) => (e.href || "").includes("instagram.com"));
    check("website link is handed off (a navigation was attempted)", !!ev, JSON.stringify(events));
    check("website link uses target=_blank so the OS can hand it to the app", ev?.target === "_blank", `target="${ev?.target}"`);
    check("the hand-off anchor is rendered, not display:none", !!ev && ev.display !== "none", `display=${ev?.display}`);
    check("the hand-off anchor is in the document when clicked", !!ev?.inDoc, `inDoc=${ev?.inDoc}`);
  }

  // ---------------------------------------------------------------- deep link
  const appFile = join(tmpdir(), "qr-link-app.png");
  const madeApp = await makeQr(["Plain text", "نص عادي"], "instagram://user?username=abuomar", appFile);
  check("create: built a QR for an instagram:// deep link", madeApp, madeApp ? "" : reasons.join(" | "));
  if (madeApp) {
    const { events, detected } = await scanAndOpen(appFile);
    check("scan: the deep link was detected", detected);
    const ev = events.find((e) => (e.href || "").startsWith("instagram://"));
    check("deep link is handed off (a navigation was attempted)", !!ev, JSON.stringify(events));
    // This is the actual bug: `_self` is ignored inside an installed PWA.
    check(
      "deep link uses target=_blank (a _self deep link is dropped in standalone)",
      ev?.target === "_blank",
      `target="${ev?.target}"`,
    );
  }

  // ---------------------------------------------------------------- WhatsApp
  await page.evaluate(() => {
    window.__nav = [];
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").includes("Settings"));
    b?.click();
  });
  await sleep(1300);
  await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find((e) => (e.getAttribute("aria-label") || "").includes("WhatsApp"));
    if (!a) return;
    a.scrollIntoView({ block: "center" });
    a.click();
  });
  await sleep(2500); // the browser fallback fires 1.5s after the app link
  const waEvents = await page.evaluate(() => window.__nav);
  const waApp = waEvents.find((e) => (e.href || "").startsWith("whatsapp://"));
  const waWeb = waEvents.find((e) => (e.href || "").includes("wa.me"));
  check("WhatsApp button opens the chat in WhatsApp itself", /^whatsapp:\/\/send\?phone=447454190643&/.test(waApp?.href || ""), JSON.stringify(waEvents));
  check("WhatsApp button falls back to wa.me in the browser", !!waWeb, JSON.stringify(waEvents.map((e) => e.href)));
  check("WhatsApp button uses target=_blank", waApp?.target === "_blank", `target="${waApp?.target}"`);

  // ---------------------------------------------------------------- deep links
  // A link that belongs to an app must be tried in that app first, and fall back
  // to the browser when the device has no app that answers.
  const ANDROID_UA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
  const DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  const appCases = [
    { name: "YouTube", card: "Website", value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", app: /^vnd\.youtube:dQw4w9WgXcQ$/, web: "youtube.com/watch?v=dQw4w9WgXcQ" },
    { name: "Instagram", card: "Website", value: "https://www.instagram.com/abuomar/", app: /^instagram:\/\/user\?username=abuomar$/, web: "instagram.com/abuomar" },
    { name: "Telegram", card: "Website", value: "https://t.me/qrstudiopro", app: /^tg:\/\/resolve\?domain=qrstudiopro$/, web: "t.me/qrstudiopro" },
    { name: "TikTok", card: "Website", value: "https://www.tiktok.com/@abuomar", app: /^tiktok:\/\/user\/@abuomar$/, web: "tiktok.com/@abuomar" },
    { name: "X", card: "Website", value: "https://x.com/abuomar", app: /^twitter:\/\/user\?screen_name=abuomar$/, web: "x.com/abuomar" },
  ];

  for (const c of appCases) {
    await page.setUserAgent(ANDROID_UA);
    const file = join(tmpdir(), `qr-app-${c.name}.png`);
    const made = await makeQr(c.card, c.value, file);
    check(`create: built a QR for ${c.name}`, made);
    if (!made) continue;
    const { events } = await scanAndOpen(file);
    const hrefs = events.map((e) => e.href || "");
    check(`${c.name}: the app's own link is tried first`, hrefs.some((h) => c.app.test(h)), JSON.stringify(hrefs));
    check(`${c.name}: falls back to the browser when no app answers`, hrefs.some((h) => h.includes(c.web)), JSON.stringify(hrefs));
  }

  // On a desktop there is no YouTube app to hand off to — go straight to the web.
  await page.setUserAgent(DESKTOP_UA);
  const ytDesktop = join(tmpdir(), "qr-app-desktop.png");
  if (await makeQr("Website", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", ytDesktop)) {
    const { events } = await scanAndOpen(ytDesktop);
    const hrefs = events.map((e) => e.href || "");
    check("desktop: no app scheme, the browser opens the link", !hrefs.some((h) => /^vnd\.youtube:/.test(h)) && hrefs.some((h) => h.includes("youtube.com")), JSON.stringify(hrefs));
  }
  await page.setUserAgent(ANDROID_UA);

  // ---------------------------------------------------------------- safety
  await page.keyboard.press("Escape");
  await sleep(600);
  const unsafeFile = join(tmpdir(), "qr-link-unsafe.png");
  const madeUnsafe = await makeQr(["Plain text", "نص عادي"], "javascript:alert(1)", unsafeFile);
  if (madeUnsafe) {
    await goSection(2);
    await sleep(1200);
    const input = await page.$('input[type="file"]');
    if (input) await input.uploadFile(unsafeFile);
    await sleep(4000);
    const state = await page.evaluate(() => ({
      hasOpen: [...document.querySelectorAll("button")].some((e) => (e.textContent || "").trim().startsWith("Open")),
      text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 120),
    }));
    check("dangerous content offers no way to open it", !state.hasOpen, state.text);
  }
} catch (e) {
  check("external link audit completed", false, String(e).slice(0, 300));
} finally {
  console.log("\n============ EXTERNAL LINK AUDIT ============");
  for (const r of results) console.log("  " + r);
  console.log("============================================");
  console.log(failures === 0 ? `✓ all checks passed (${results.filter((r) => r.startsWith("PASS")).length} passed)` : `✗ ${failures} check(s) FAILED`);
  await browser.close();
  server.kill("SIGTERM");
  process.exit(failures ? 1 : 0);
}
