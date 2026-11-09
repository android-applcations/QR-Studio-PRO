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

/**
 * Flip a setting by its label. Settings live in a sheet, so open it, flip the
 * switch, and close again — the way a user would.
 */
async function setToggle(labelText, want) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label]')].find((e) => /settings|الإعدادات/i.test(e.getAttribute("aria-label") || ""));
    b?.click();
  });
  await sleep(900);
  const now = await page.evaluate((labelText) => {
    const sw = [...document.querySelectorAll('button[role="switch"]')].find((e) => (e.textContent || "").includes(labelText));
    if (!sw) return null;
    const on = sw.getAttribute("aria-checked") === "true";
    return { on, flipped: on };
  }, labelText);
  if (now && now.on !== want) {
    await page.evaluate((labelText) => {
      const sw = [...document.querySelectorAll('button[role="switch"]')].find((e) => (e.textContent || "").includes(labelText));
      sw?.click();
    }, labelText);
    await sleep(500);
  }
  await page.keyboard.press("Escape");
  await sleep(900);
  return now;
}

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
  // A link that belongs to an app must be handed over in the one form the
  // platform can resolve without ever putting "no app can open this" on screen:
  // an Android intent carrying its own fallback, or the app's scheme on iOS with
  // the browser as a safety net.
  const ANDROID_UA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
  const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  const enc = (v) => encodeURIComponent(v).replace(/;/g, "%3B");

  /** Android: one intent naming the app, the scheme and the browser fallback. */
  const androidCases = [
    { name: "YouTube", value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", body: "www.youtube.com/watch?v=dQw4w9WgXcQ#Intent;scheme=https;", pkg: "com.google.android.youtube" },
    { name: "Instagram", value: "https://www.instagram.com/abuomar/", body: "user?username=abuomar#Intent;scheme=instagram;", pkg: "com.instagram.android" },
    { name: "Telegram", value: "https://t.me/qrstudiopro", body: "resolve?domain=qrstudiopro#Intent;scheme=tg;", pkg: "org.telegram.messenger" },
    { name: "TikTok", value: "https://www.tiktok.com/@abuomar", body: "user/@abuomar#Intent;scheme=tiktok;", pkg: "com.zhiliaoapp.musically" },
    { name: "X", value: "https://x.com/abuomar", body: "user?screen_name=abuomar#Intent;scheme=twitter;", pkg: "com.twitter.android" },
    { name: "Snapchat", value: "https://www.snapchat.com/add/abuomar", body: "add/abuomar#Intent;scheme=snapchat;", pkg: "com.snapchat.android" },
  ];

  for (const c of androidCases) {
    await page.setUserAgent(ANDROID_UA);
    const file = join(tmpdir(), `qr-app-${c.name}.png`);
    const made = await makeQr("Website", c.value, file);
    check(`create: built a QR for ${c.name}`, made);
    if (!made) continue;
    const { events } = await scanAndOpen(file);
    const hrefs = events.map((e) => e.href || "");
    const expected = `intent://${c.body}package=${c.pkg};S.browser_fallback_url=${enc(c.value)};end`;
    check(`${c.name}: one intent names the app and its fallback`, hrefs[0] === expected, JSON.stringify(hrefs));
    check(`${c.name}: nothing else is fired behind the OS's back`, hrefs.length === 1, JSON.stringify(hrefs));
    check(`${c.name}: the intent can fall back to the browser`, hrefs[0]?.includes(`S.browser_fallback_url=${enc(c.value)}`) === true, hrefs[0]);
  }

  // An `intent:` URI is a Chromium feature. On Firefox for Android (and the OEM
  // mini-browsers) it is just an unknown scheme, and the system answers out loud
  // that no app can open it — which is the message this whole design avoids.
  const FIREFOX_ANDROID_UA =
    "Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0";
  await page.setUserAgent(FIREFOX_ANDROID_UA);
  const ffFile = join(tmpdir(), "qr-app-firefox.png");
  if (await makeQr("Website", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", ffFile)) {
    const { events } = await scanAndOpen(ffFile);
    const hrefs = events.map((e) => e.href || "");
    check(
      "Firefox/Android: no intent, the plain https link is handed over",
      hrefs.length === 1 && hrefs[0] === "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      JSON.stringify(hrefs),
    );
  }

  // The switch exists for exactly this: a device that still misbehaves.
  await page.setUserAgent(ANDROID_UA);
  await setToggle("Open in the app when it is installed", false);
  const offFile = join(tmpdir(), "qr-app-off.png");
  if (await makeQr("Website", "https://www.instagram.com/abuomar/", offFile)) {
    const { events } = await scanAndOpen(offFile);
    const hrefs = events.map((e) => e.href || "");
    check(
      "deep links off: every link goes to the browser",
      hrefs.length === 1 && hrefs[0] === "https://www.instagram.com/abuomar/",
      JSON.stringify(hrefs),
    );
  }
  await setToggle("Open in the app when it is installed", true);

  // iOS has no intents: the scheme first, the browser only if nothing answers.
  await page.setUserAgent(IOS_UA);
  const iosFile = join(tmpdir(), "qr-app-ios.png");
  if (await makeQr("Website", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", iosFile)) {
    const { events } = await scanAndOpen(iosFile);
    const hrefs = events.map((e) => e.href || "");
    check("iOS: the app's scheme is tried first", hrefs[0] === "youtube://watch?v=dQw4w9WgXcQ", JSON.stringify(hrefs));
    check("iOS: the browser takes over when no app answers", hrefs.some((h) => h === "https://www.youtube.com/watch?v=dQw4w9WgXcQ"), JSON.stringify(hrefs));
    check("iOS: the browser is only tried once", hrefs.filter((h) => h.startsWith("https://")).length === 1, JSON.stringify(hrefs));
  }

  // On a desktop there is no YouTube app to hand off to — go straight to the web.
  await page.setUserAgent(DESKTOP_UA);
  const ytDesktop = join(tmpdir(), "qr-app-desktop.png");
  if (await makeQr("Website", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", ytDesktop)) {
    const { events } = await scanAndOpen(ytDesktop);
    const hrefs = events.map((e) => e.href || "");
    check("desktop: no app scheme, the browser opens the link", !hrefs.some((h) => /^(intent|vnd\.youtube):/.test(h)) && hrefs.some((h) => h.includes("youtube.com")), JSON.stringify(hrefs));
  }
  await page.setUserAgent(DESKTOP_UA);

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
