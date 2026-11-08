#!/usr/bin/env node
/**
 * Username audit for QR Studio Pro.
 *
 * Every social type asks for one username and the rule used to be a different
 * character set per platform — Telegram refused dots, X refused them, Discord
 * refused underscores. Real handles broke on types that happily accept them,
 * and the message ("not valid for this platform") blamed the user for a rule
 * that was wrong.
 *
 * There is now one rule: letters, numbers, dots, underscores and hyphens,
 * within the platform's length. A dot is never the reason a name is refused.
 *
 * Usage:  npm run build && npm run test:handles
 *         CHROME_PATH=/path/to/chrome npm run test:handles
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
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
  console.log("\n⚠ handle test SKIPPED: no Chromium/Chrome binary found (set CHROME_PATH)");
  process.exit(0);
}
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("\n⚠ handle test SKIPPED: puppeteer-core is not installed");
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

/** Field validation messages only — the field hints read almost the same. */
const alerts = () => page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((e) => (e.textContent || "").trim()));

/** Field errors surface once the form has been submitted, as they do for a user. */
const submit = async () => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes("Create QR code"));
    b?.click();
  });
  await sleep(800);
  return alerts();
};

/** Back to the create screen, then straight into one type's form. */
const openType = async (name) => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });
  await sleep(900);
  for (let i = 0; i < 3; i++) {
    const gone = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[aria-label="Back"]')];
      if (!b.length) return false;
      b[b.length - 1].click();
      return true;
    });
    if (!gone) break;
    await sleep(600);
  }
  await page.evaluate((name) => {
    const i = document.querySelector('input[aria-label="Search"]');
    if (!i) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, name);
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);
  await sleep(800);
  const opened = await page.evaluate((name) => {
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const b = [...document.querySelectorAll("button")].find((e) => re.test(e.textContent || ""));
    if (!b) return false;
    b.click();
    return true;
  }, name);
  await sleep(1000);
  return opened;
};

const FIELD = (id) => `#f-${id}-handle`;

try {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1200);

  // -------------------------------------------------- dots are legal everywhere
  // Every platform below accepts a dotted name in reality:Telegram usernames,
  // Facebook page names, X handles, Discord invites, Instagram names.
  const DOTTED = [
    { id: "instagram", name: "Instagram", handle: "abu.omar" },
    { id: "facebook", name: "Facebook", handle: "abu.omar.page" },
    { id: "tiktok", name: "TikTok", handle: "abu.omar" },
    { id: "x", name: "X (Twitter)", handle: "abu.omar" },
    { id: "snapchat", name: "Snapchat", handle: "abu.omar" },
    { id: "telegram", name: "Telegram", handle: "abu.omar" },
    { id: "pinterest", name: "Pinterest", handle: "abu.omar" },
    { id: "threads", name: "Threads", handle: "abu.omar" },
    { id: "discord", name: "Discord", handle: "abu.omar" },
  ];

  for (const p of DOTTED) {
    const opened = await openType(p.name);
    check(`${p.name}: the form opens`, opened && (await page.evaluate((s) => !!document.querySelector(s), FIELD(p.id))));
    if (!opened) continue;
    await setValue(FIELD(p.id), p.handle);
    await sleep(500);
    const errs = await submit();
    const complained = errs.filter((a) => /username|اسم المستخدم|Letters, numbers|حروف وأرقام/i.test(a));
    check(`${p.name}: a dotted username is accepted`, complained.length === 0, JSON.stringify(errs));
  }

  // -------------------------------------------------- the rest of the alphabet
  // Underscores and hyphens are as common as dots, and were refused on some
  // types by the same per-platform tables.
  const OTHERS = [
    { id: "telegram", name: "Telegram", handle: "abu_omar" },
    { id: "discord", name: "Discord", handle: "abu-omar" },
    { id: "instagram", name: "Instagram", handle: "abu_omar1" },
  ];
  for (const p of OTHERS) {
    const opened = await openType(p.name);
    if (!opened) {
      check(`${p.name}: the form opens`, false);
      continue;
    }
    await setValue(FIELD(p.id), p.handle);
    await sleep(500);
    const errs = await submit();
    check(`${p.name}: "${p.handle}" is accepted`, errs.filter((a) => /username|اسم المستخدم|Letters, numbers|حروف وأرقام/i.test(a)).length === 0, JSON.stringify(errs));
  }

  // -------------------------------------------------- genuinely bad names still fail
  // Relaxing the charset must not turn the field into a free-text box: a space,
  // a "@" or an emoji can never be part of a handle.
  for (const [bad, why] of [["abu omar", "a space"], ["abu@omar", "an @ sign"], ["ابو عمر", "Arabic letters"]]) {
    const opened = await openType("Telegram");
    check(`Telegram: the form opens for "${bad}"`, opened);
    if (!opened) continue;
    await setValue(FIELD("telegram"), bad);
    await sleep(500);
    const errs = await submit();
    check(`Telegram: a username with ${why} is refused`, errs.some((a) => /Letters, numbers|حروف وأرقام|Username must be|من 5 إلى 32/.test(a)), JSON.stringify(errs));
  }

  // -------------------------------------------------- the length rule stays
  // X really does cap a handle at 15 characters; that limit is worth keeping.
  await openType("X (Twitter)");
  await setValue(FIELD("x"), "abcdefghijklmnopq"); // 17
  await sleep(500);
  const long = await submit();
  check("X: a 17-character handle is refused", long.some((a) => /1–15|من 1 إلى 15/.test(a)), JSON.stringify(long));
  await setValue(FIELD("x"), "abcdefghijklmno"); // 15
  await sleep(500);
  const ok15 = await submit();
  check("X: a 15-character handle is accepted", ok15.length === 0, JSON.stringify(ok15));

  // -------------------------------------------------- the link is built correctly
  // The point of the value is the link it produces: dots and all.
  await openType("Telegram");
  await setValue(FIELD("telegram"), "@abu.omar");
  await sleep(500);
  const built = await submit();
  check("Telegram: the leading @ is stripped, dots kept", built.length === 0, JSON.stringify(built));
  await sleep(1800);
  const encoded = await page.evaluate(() => {
    const ps = [...document.querySelectorAll("p")];
    const i = ps.findIndex((e) => /Encoded content|المحتوى المشفّر/.test(e.textContent || ""));
    return i >= 0 ? (ps[i + 1]?.textContent || "").trim() : "";
  });
  check("Telegram: the code encodes the dotted handle", encoded === "https://t.me/abu.omar", JSON.stringify(encoded));

  await page.keyboard.press("Escape");
  await sleep(600);

  check("username audit completed", true);
} catch (e) {
  check("username audit completed", false, String(e).slice(0, 300));
} finally {
  await browser.close();
  server.kill();
}

console.log(results.map((r) => (r.startsWith("PASS") ? `  ${r}` : `  ${r}`)).join("\n"));
console.log("=".repeat(60));
if (failures) {
  console.log(`✗ ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`✓ all checks passed (${results.length} passed)`);
