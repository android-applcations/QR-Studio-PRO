#!/usr/bin/env node
/**
 * Payment-type audit for QR Studio Pro.
 *
 * Sham Cash (شام كاش) is the Syrian wallet: money arrives through the code the
 * app shows under "Receive" — the 32-character wallet code or the 16-digit
 * account number. That code is all the QR may hold, because Sham Cash's own
 * scanner reads the address and ignores anything wrapped around it. Everything
 * else (name, amount, currency, note) is carried on the printed sheet instead.
 *
 * This checks exactly that: the code goes into the QR alone, wrong codes are
 * rejected, and the details come out on the sheet you print or save as PDF.
 *
 * Usage:  npm run build && npm run test:payment
 *         CHROME_PATH=/path/to/chrome npm run test:payment
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4176);
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
  console.log("\n⚠ payment test SKIPPED: no Chromium/Chrome binary found (set CHROME_PATH)");
  process.exit(0);
}
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("\n⚠ payment test SKIPPED: puppeteer-core is not installed");
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
// once Chromium produces a frame. Headless with --disable-gpu never does.
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

const pickSelect = (sel, val) =>
  page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, val);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    sel,
    val,
  );

const body = () => page.evaluate(() => document.body.innerText || "");

/** Field validation messages only — the field hints read almost the same. */
const alerts = () => page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((e) => (e.textContent || "").trim()));

/** Field errors surface once the form has been submitted, as they do for a user. */
const submit = async () => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes("Create QR code"));
    b?.click();
  });
  await sleep(900);
  return alerts();
};

const WALLET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"; // 32 letters and digits
const ACCOUNT = "1234567890123456"; // 16 digits

try {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1200);

  // ------------------------------------------------------- find the type
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Search"]');
    if (!i) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Sham Cash");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(900);
  const found = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => /Sham Cash/i.test(e.textContent || ""));
    if (!b) return { ok: false, cards: [...document.querySelectorAll("button")].map((e) => (e.textContent || "").trim()).slice(0, 8) };
    b.click();
    return { ok: true };
  });
  check("Sham Cash appears in the QR types", found.ok, JSON.stringify(found.cards ?? []));
  if (!found.ok) throw new Error("Sham Cash type not found");
  await sleep(1200);

  check("the form opens with its fields", await page.evaluate(() => !!document.querySelector("#f-shamcash-code")));

  // ------------------------------------------------------- a valid wallet code
  await setValue("#f-shamcash-code", WALLET);
  await setValue("#f-shamcash-name", "Omar Ahmad");
  await setValue("#f-shamcash-amount", "250000");
  await setValue("#f-shamcash-note", "Monthly support");
  await sleep(900);

  check("a 32-character wallet code is accepted", (await alerts()).length === 0, JSON.stringify(await alerts()));

  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes("Create QR code"));
    b?.click();
  });
  await sleep(2500);

  // Read the "Encoded content" panel: it must be the address, and only it.
  const rawContent = await page.evaluate(() => {
    const ps = [...document.querySelectorAll("p")];
    const i = ps.findIndex((e) => /Encoded content|المحتوى المشفّر/.test(e.textContent || ""));
    return i >= 0 ? (ps[i + 1]?.textContent || "").trim() : "";
  });
  check("the QR holds the wallet code and nothing else", rawContent === WALLET, JSON.stringify(rawContent));
  check("no wrapper scheme is added around the address", !/shamcash:|:|\/\//.test(rawContent), rawContent);

  // ------------------------------------------------------- the printed sheet
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => /^(Print|طباعة)$/.test((e.textContent || "").trim()));
    b?.click();
  });
  await sleep(1500);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button[role="switch"], [role="switch"]')].find((e) => /Show names|إظهار الأسماء/.test((e.parentElement?.textContent || e.textContent || "")));
    el?.click();
  });
  await sleep(2500);

  const frames = page.frames();
  let sheet = "";
  for (const f of frames) {
    const html = await f.content().catch(() => "");
    if (html.includes("<img") && html.includes("QR")) sheet = html;
  }
  const preview = await page.evaluate(() => {
    const ifr = [...document.querySelectorAll("iframe")].find((e) => (e.getAttribute("srcdoc") || "").includes("figcaption") || (e.getAttribute("srcdoc") || "").includes("<img"));
    return ifr?.getAttribute("srcdoc") || "";
  });
  const doc = preview || sheet;
  check("the print sheet is built", doc.length > 0, `frames=${frames.length} preview=${preview.length} sheet=${sheet.length}`);
  check("the sheet carries the account name", /Omar Ahmad/.test(doc));
  check("the sheet carries the wallet code", new RegExp(WALLET).test(doc));
  check("the sheet carries the amount", /250000/.test(doc));
  check("the sheet carries the currency", /Syrian pound|ليرة سورية|SYP/.test(doc));
  check("the sheet carries the note", /Monthly support/.test(doc));
  check("the sheet still prints the code itself", /<img/.test(doc));

  await page.keyboard.press("Escape");
  await sleep(900);

  // ------------------------------------------------------- rejection and the 16-digit form
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });
  await sleep(1200);
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Search"]');
    if (!i) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "Sham Cash");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(900);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => /Sham Cash/i.test(e.textContent || ""));
    b?.click();
  });
  await sleep(1200);

  await setValue("#f-shamcash-code", "12345");
  await setValue("#f-shamcash-name", "Omar Ahmad");
  await sleep(900);
  check("a short code is rejected", (await submit()).some((a) => /32 letters and digits|32 حرفاً/.test(a)), JSON.stringify(await alerts()));

  // The wrong length first: a valid code would move us on to the result screen.
  await pickSelect("#f-shamcash-kind", "account");
  await sleep(700);
  await setValue("#f-shamcash-code", "12345");
  await sleep(900);
  check("the 16-digit rule is enforced", (await submit()).some((a) => /16 digits|16 رقماً/.test(a)), JSON.stringify(await alerts()));

  await setValue("#f-shamcash-code", ACCOUNT);
  await sleep(900);
  check("a 16-digit account number is accepted instead", (await submit()).length === 0, JSON.stringify(await alerts()));

  check("payment type audit completed", true);
} catch (e) {
  check("payment type audit completed", false, String(e).slice(0, 300));
} finally {
  await browser.close();
  server.kill();
}

console.log("\n================ PAYMENT TYPE AUDIT ================");
for (const r of results) console.log(`  ${r}`);
console.log("===================================================");
if (failures) {
  console.log(`✗ ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`✓ all checks passed (${results.length} passed)`);
