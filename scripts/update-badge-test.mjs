#!/usr/bin/env node
/**
 * Update-badge audit for QR Studio Pro.
 *
 * The red "تحديث" pill must only exist when a new version has really finished
 * downloading and is waiting to take over — never as a guess. So this test does
 * not fake the flag: it serves the real build, lets the service worker install,
 * then changes `dist/sw.js` on disk so the browser genuinely finds a newer
 * worker on the next visit, and checks the pill appears on the settings icon and
 * inside Settings, then disappears once the update is installed.
 *
 * Usage:  npm run build && npm run test:update
 *         CHROME_PATH=/path/to/chrome npm run test:update
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4175);
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
  console.log("\n⚠ update badge test SKIPPED: no Chromium/Chrome binary found (set CHROME_PATH)");
  process.exit(0);
}
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("\n⚠ update badge test SKIPPED: puppeteer-core is not installed");
  process.exit(0);
}

const swFile = join(DIST, "sw.js");
if (!existsSync(swFile)) {
  console.log("\n⚠ update badge test SKIPPED: dist/sw.js missing — the build has no service worker");
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

/** Every visible red pill, with the text inside it. */
const badges = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("span")]
      .filter((e) => /تحديث|^Update$/.test((e.textContent || "").trim()) && e.getBoundingClientRect().width > 0)
      .map((e) => ({
        text: (e.textContent || "").trim(),
        bg: getComputedStyle(e).backgroundColor,
        nearSettings: !!e.closest("header"),
        inSheet: !!e.closest('[role="dialog"], [aria-modal="true"]'),
      })),
  );

const settleSw = async () => {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 30000 }).catch(() => false);
  await sleep(1200);
};

try {
  // ------------------------------------------------------------ first visit
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await settleSw();
  check("first visit: a service worker is in control", await page.evaluate(() => !!navigator.serviceWorker?.controller));

  const before = await badges();
  check("no red pill while there is nothing to install", before.length === 0, JSON.stringify(before));

  // ------------------------------------------------------------ ship an update
  // Change the worker by one byte. The browser compares the fetched script, so
  // this is a real update — the same thing a new deploy produces.
  const original = readFileSync(swFile, "utf8");
  writeFileSync(swFile, `${original}\n/* update-badge-audit */\n`);
  let shipped = false;
  try {
    await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("span")].some(
          (e) => /تحديث|^Update$/.test((e.textContent || "").trim()) && e.getBoundingClientRect().width > 0,
        ),
      { timeout: 40000 },
    );
    shipped = true;
  } catch {
    shipped = false;
  }
  check("a newer worker is detected and the red pill appears", shipped);

  if (shipped) {
    const onIcon = await badges();
    const pill = onIcon[0];
    check("the pill reads 'تحديث' / 'Update'", /تحديث|Update/.test(pill?.text ?? ""), JSON.stringify(pill));
    check("the pill is red", /rgb\(\s*(2[0-9]{2}|1[0-9]{2})\s*,/.test(pill?.bg ?? "") || /248|220|239|248/.test(pill?.bg ?? ""), pill?.bg);
    check("the pill sits on the settings icon in the header", onIcon.some((b) => b.nearSettings), JSON.stringify(onIcon));

    // ------------------------------------------------------------ inside Settings
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").includes("Settings"));
      b?.click();
    });
    await sleep(1400);
    const inSheet = await badges();
    check("inside Settings the pill sits beside the update button", inSheet.some((b) => b.inSheet), JSON.stringify(inSheet));
    const sheetText = await page.evaluate(() => {
      const sheets = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
      return (sheets[sheets.length - 1] ?? document.body).innerText || "";
    });
    check("the update button offers to install now", /تحديث الآن|Update now/.test(sheetText), sheetText.slice(0, 120).replace(/\n+/g, " | "));

    // ------------------------------------------------------------ install it
    // Pressing "Update now" must clear the pill, not just hide it.
    // The app asks first, so confirm in the dialog (it renders at the end of the
    // document, hence the last matching button).
    const reloaded = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((e) => /تحديث الآن|Update now/.test((e.textContent || "").trim()));
      b?.click();
    });
    await sleep(1200);
    const confirmed = await page.evaluate(() => {
      const all = [...document.querySelectorAll("button")].filter((e) => /^(Update now|تحديث الآن)$/.test((e.textContent || "").trim()));
      const b = all[all.length - 1];
      if (!b) return false;
      b.click();
      return true;
    });
    check("the app asks before reloading", confirmed);
    // It waits for IndexedDB to go quiet first, so follow the reload itself.
    check("pressing 'Update now' reloads the app with the new version", !!(await reloaded));
    await settleSw();
    await sleep(2000);
    const after = await badges();
    check("the pill is gone once the update is installed", after.length === 0, JSON.stringify(after));
  }

  check("update badge audit completed", true);
} catch (e) {
  check("update badge audit completed", false, String(e).slice(0, 300));
} finally {
  // put the worker back the way the build left it
  try {
    const now = readFileSync(swFile, "utf8");
    writeFileSync(swFile, now.replace(/\n\/\* update-badge-audit \*\/\n$/, "\n"));
  } catch {
    /* the next build regenerates it anyway */
  }
  await browser.close();
  server.kill();
}

console.log("\n============== UPDATE BADGE AUDIT ==============");
for (const r of results) console.log(`  ${r}`);
console.log("================================================");
if (failures) {
  console.log(`✗ ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log(`✓ all checks passed (${results.length} passed)`);
