#!/usr/bin/env node
/**
 * Scan result audit for QR Studio Pro.
 *
 * A scanned code must be shown as tidy, labelled fields — not as the raw string
 * that is stored in the QR (a Wi-Fi code is `WIFI:T:WPA;S:…;P:…;;`, which used to
 * be printed verbatim). Every type gets the same layout, and only a Wi-Fi code
 * offers "Connect to network".
 *
 * Usage:  npm run build && npm run test:scan
 *         CHROME_PATH=/path/to/chrome npm run test:scan
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4166);
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
  console.log("\n⚠ scan result test SKIPPED: no Chromium/Chrome binary found (set CHROME_PATH)");
  process.exit(0);
}
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("\n⚠ scan result test SKIPPED: puppeteer-core is not installed");
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

const setValue = (sel, val) =>
  page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    sel,
    val,
  );

/** Build a QR in the app: pick a type, fill fields, create, snapshot. */
async function makeQr(cardTitle, fill, file) {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1200);
  for (let i = 0; i < 3; i++) {
    const back = await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Back"]');
      if (!b) return false;
      b.click();
      return true;
    });
    if (!back) break;
    await sleep(600);
  }
  await page.evaluate((q) => {
    const i = document.querySelector('input[aria-label="Search"]');
    if (!i) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, q);
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }, cardTitle);
  await sleep(900);
  const picked = await page.evaluate((q) => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim().toLowerCase().startsWith(q.toLowerCase()));
    if (!b) return false;
    b.click();
    return true;
  }, cardTitle);
  if (!picked) return false;
  await sleep(1100);
  for (const [sel, val] of fill) {
    const ok = await setValue(sel, val);
    if (!ok) return false;
    await sleep(220);
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
  if (!png) return false;
  writeFileSync(file, Buffer.from(png.split(",")[1], "base64"));
  return true;
}

/** Upload a QR image on the scan screen and wait for the result panel. */
async function scan(file) {
  await page.goto(`${BASE}/?section=scan`, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1400);
  const input = await page.$('input[type="file"]');
  if (!input) return false;
  await input.uploadFile(file);
  return page
    .waitForFunction(() => (document.body.innerText || "").includes("Code detected"), { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
}

/** The label → value rows of the result panel. */
// The app renders the result panel twice — the second copy is the wide-screen
// variant, hidden with CSS on a phone. Only measure what the user can see.
const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("dl > div")]
      .filter((row) => {
        const r = row.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((row) => ({
        label: (row.querySelector("dt")?.textContent || "").trim(),
        value: (row.querySelector("dd")?.textContent || "").trim(),
      })),
  );

/** Accept the label in either language: the app may boot in Arabic or English. */
const hasButton = (...labels) =>
  page.evaluate(
    (labels) =>
      [...document.querySelectorAll("button")].some((b) => {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return labels.includes((b.textContent || "").trim());
      }),
    labels,
  );

/** Nothing may stick out of a phone screen. */
const overflow = () =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right - vw > 1) bad.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 40)} +${Math.round(r.right - vw)}`);
    }
    return { count: bad.length, first: bad[0] ?? "", doc: document.documentElement.scrollWidth, vw };
  });

try {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1200);

  // ------------------------------------------------------------------ Wi-Fi
  const wifiFile = join(tmpdir(), "qr-scan-wifi.png");
  const madeWifi = await makeQr(
    "Wi-Fi",
    [
      ["#f-wifi-ssid", "Home-Network-5G"],
      ["#f-wifi-password", "mySecretPass123"],
    ],
    wifiFile,
  );
  check("create: built a Wi-Fi QR", madeWifi);
  if (madeWifi) {
    check("scan: the Wi-Fi code was detected", await scan(wifiFile));
    const r = await rows();
    const body = await page.evaluate(() => document.body.innerText || "");
    check("Wi-Fi: shown as labelled rows, not the raw WIFI: string", r.length >= 3 && !/WIFI:/i.test(body), JSON.stringify(r));
    check(
      "Wi-Fi: shows the network name",
      r.some((x) => /شبكة|Network name/i.test(x.label) && x.value === "Home-Network-5G"),
      JSON.stringify(r),
    );
    const pw = r.find((x) => /كلمة المرور|Password/i.test(x.label));
    check("Wi-Fi: the password is hidden by default", pw?.value === "••••••••", JSON.stringify(pw));
    check("Wi-Fi: shows the security type", r.some((x) => /WPA/.test(x.value)), JSON.stringify(r.map((x) => x.value)));
    check("Wi-Fi: shows whether the network is hidden", r.some((x) => /شبكة مخفية|Hidden/i.test(x.label)), JSON.stringify(r.map((x) => x.label)));

    // reveal the password
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((e) => /إظهار كلمة المرور|Show password/.test(e.textContent || ""));
      b?.click();
    });
    await sleep(600);
    const shown = (await rows()).find((x) => /كلمة المرور|Password/i.test(x.label));
    check("Wi-Fi: the reveal button shows the real password", shown?.value === "mySecretPass123", JSON.stringify(shown));

    check("Wi-Fi: offers 'Connect to network'", await hasButton("Connect to network", "الاتصال بالشبكة"));

    // Pressing it must not try to join the network — it says the work is coming.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((e) => /^(Connect to network|الاتصال بالشبكة)$/.test((e.textContent || "").trim()));
      b?.click();
    });
    await sleep(900);
    const wifiBody = await page.evaluate(() => document.body.innerText || "");
    check(
      "Wi-Fi: 'Connect to network' says the feature is under development",
      /جاري تطوير هذه الخاصية|This feature is under development/.test(wifiBody),
      wifiBody.slice(0, 160).replace(/\n+/g, " | "),
    );

    const of = await overflow();
    check("Wi-Fi: the result fits a phone screen", of.count === 0 && of.doc <= of.vw, `${of.count} ${of.first}`);
  }

  // ------------------------------------------------------------------ Settings
  // The offline-file box was removed; the rest of the section must be untouched.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").includes("Settings"));
    b?.click();
  });
  await sleep(1400);
  const settingsText = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
    const host = sheets[sheets.length - 1] ?? document.body;
    return host.innerText || "";
  });
  const settingsFlat = settingsText.slice(0, 400).replace(/\n+/g, " | ");
  check("Settings: the offline-files box is gone", !/Offline files|ملفات دون انترنت|ملفات دون الإنترنت|دون انترنت/i.test(settingsText), settingsFlat);
  check("Settings: the rest of the section is intact", /WhatsApp|واتساب/i.test(settingsText), settingsFlat);
  await page.keyboard.press("Escape");
  await sleep(800);

  // ------------------------------------------------------------------ URL
  const urlFile = join(tmpdir(), "qr-scan-url.png");
  const madeUrl = await makeQr("Website", [["#f-url-url", "https://example.com/hello"]], urlFile);
  check("create: built a website QR", madeUrl);
  if (madeUrl) {
    check("scan: the website code was detected", await scan(urlFile));
    const r = await rows();
    check("URL: shown as a labelled row", r.length >= 1 && r.some((x) => x.value.includes("example.com")), JSON.stringify(r));
    check("URL: no 'Connect to network' button", !(await hasButton("Connect to network", "الاتصال بالشبكة")));
  }

  // ------------------------------------------------------------------ vCard
  const cardFile = join(tmpdir(), "qr-scan-vcard.png");
  const madeCard = await makeQr(
    "Business card",
    [
      ["#f-vcard-first", "Omar"],
      ["#f-vcard-last", "Ahmad"],
      ["#f-vcard-org", "QR Studio"],
      ["#f-vcard-phone", "+31612345678"],
      ["#f-vcard-email", "omar@example.com"],
    ],
    cardFile,
  );
  check("create: built a business card QR", madeCard);
  if (madeCard) {
    check("scan: the business card was detected", await scan(cardFile));
    const r = await rows();
    const body = await page.evaluate(() => document.body.innerText || "");
    check("vCard: parsed into rows, not the raw VCARD text", !/BEGIN:VCARD/i.test(body) && r.length >= 3, JSON.stringify(r));
    check("vCard: shows the name", r.some((x) => x.value.includes("Omar Ahmad")), JSON.stringify(r));
    check("vCard: shows the phone", r.some((x) => x.value.includes("+31612345678")), JSON.stringify(r));
    check("vCard: shows the email", r.some((x) => x.value.includes("omar@example.com")), JSON.stringify(r));
    const of = await overflow();
    check("vCard: the result fits a phone screen", of.count === 0 && of.doc <= of.vw, `${of.count} ${of.first}`);
  }

  // ------------------------------------------------------------------ text
  const textFile = join(tmpdir(), "qr-scan-text.png");
  const madeText = await makeQr("Plain text", [['textarea[id^="f-"]', "Just some plain text"]], textFile);
  check("create: built a plain text QR", madeText);
  if (madeText) {
    check("scan: the plain text code was detected", await scan(textFile));
    const r = await rows();
    check(
      "plain text: uses the same single-row layout",
      r.length === 1 && r[0].value === "Just some plain text",
      JSON.stringify(r),
    );
    check("plain text: no 'Connect to network' button", !(await hasButton("Connect to network", "الاتصال بالشبكة")));
  }
} catch (e) {
  check("scan result audit completed", false, String(e).slice(0, 300));
} finally {
  console.log("\n============= SCAN RESULT AUDIT =============");
  for (const r of results) console.log("  " + r);
  console.log("=============================================");
  console.log(failures === 0 ? `✓ all checks passed (${results.filter((r) => r.startsWith("PASS")).length} passed)` : `✗ ${failures} check(s) FAILED`);
  await browser.close();
  server.kill("SIGTERM");
  process.exit(failures ? 1 : 0);
}
