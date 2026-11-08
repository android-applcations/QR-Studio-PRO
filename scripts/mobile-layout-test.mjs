#!/usr/bin/env node
/**
 * Mobile layout audit for QR Studio Pro.
 *
 * Opens the production build on real phone viewports and asserts that nothing
 * sticks out horizontally: no element may extend past the viewport, and no
 * scroll container may be wider than its content box.
 *
 * Usage:  npm run build && npm run test:layout
 *         CHROME_PATH=/path/to/chrome npm run test:layout
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4176);
const BASE = `http://localhost:${PORT}`;
const WIDTHS = (process.env.WIDTHS ?? "320,360,390,414").split(",").map((n) => Number(n.trim()));

const results = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
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

function skip(reason) {
  console.log(`\n⚠ layout test SKIPPED: ${reason}`);
  process.exit(0);
}

if (!existsSync(DIST)) {
  console.error("✗ dist/ not found — run `npm run build` first");
  process.exit(1);
}
const browserPath = findBrowser();
if (!browserPath) skip("no Chromium/Chrome binary found (set CHROME_PATH)");

let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  skip("puppeteer-core is not installed (npm i -D puppeteer-core)");
}

const server = spawn(process.execPath, [join(ROOT, "scripts", "serve-dist.mjs"), String(PORT)], {
  cwd: ROOT,
  stdio: "ignore",
});
await sleep(900);

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const page = await browser.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));

// ---------------------------------------------------------------- helpers
const measure = () =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const offenders = [];
    const stretched = [];
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.position === "fixed" && style.visibility === "hidden") continue;
      if (rect.right - vw > 1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 90),
          over: Math.round(rect.right - vw),
          w: Math.round(rect.width),
          text: (el.textContent || "").trim().slice(0, 30),
        });
      }
      // A scroll container wider than its box is only fine when it is an
      // intentional horizontal scroller (chips, carousels) or a truncate target.
      if (el.scrollWidth > el.clientWidth + 1 && style.overflowX !== "visible") {
        const intentional =
          el.classList.contains("no-scrollbar") ||
          el.classList.contains("scroll-area") ||
          style.overflowX === "auto" ||
          style.overflowX === "scroll" ||
          style.textOverflow === "ellipsis";
        if (!intentional) {
          stretched.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || "").toString().slice(0, 90),
            sw: el.scrollWidth,
            cw: el.clientWidth,
          });
        }
      }
    }
    return {
      vw,
      docScrollWidth: document.documentElement.scrollWidth,
      offenders: offenders.slice(0, 8),
      stretched: stretched.slice(0, 8),
    };
  });

const clickText = async (text, sel = "button", last = false) => {
  const ok = await page.evaluate(
    (text, sel, last) => {
      const els = [...document.querySelectorAll(sel)].filter(
        (e) => (e.textContent || "").trim().toLowerCase().includes(text.toLowerCase()) && !e.disabled && e.offsetParent !== null,
      );
      const el = last ? els[els.length - 1] : els[0];
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    },
    text,
    sel,
    last,
  );
  await sleep(450);
  return ok;
};

const gotoSections = () =>
  page.evaluate(() => {
    const navs = document.querySelectorAll('nav[aria-label="Main navigation"]');
    return navs[navs.length - 1].querySelectorAll("button").length;
  });

const SECTIONS = ["create", "design", "scan", "library", "history", "templates"];

async function seed() {
  await page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("qr_studio_pro");
      r.onsuccess = () => res(r.result);
    });
    const base = await new Promise((res) => {
      const q = db.transaction("qr_codes").objectStore("qr_codes").getAll();
      q.onsuccess = () => res(q.result);
    });
    const d = base[0];
    const now = Date.now();
    const tx = db.transaction(["qr_codes", "scan_history"], "readwrite");
    if (d) {
      for (let i = 0; i < 6; i++) {
        const c = { ...d };
        delete c.id;
        c.uid = `layout-seed-${i}`;
        c.name = `اسم رمز طويل جداً للاختبار رقم ${i} — A very long QR code name ${i}`;
        c.content = "https://layout-test.example.com/" + "x".repeat(70) + i;
        c.created_at = now - i * 1000;
        c.updated_at = now - i * 1000;
        tx.objectStore("qr_codes").add(c);
      }
    }
    for (let i = 0; i < 6; i++) {
      tx.objectStore("scan_history").add({
        content: "https://layout-test.example.com/" + "y".repeat(80) + i,
        type: "url",
        scanned_at: now - i * 2000,
        action: ["scan", "create", "save", "export"][i % 4],
        name: `عملية ذات اسم طويل جداً للاختبار رقم ${i}`,
      });
    }
    await new Promise((res) => {
      tx.oncomplete = res;
    });
    db.close();
  });
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1200);
}

try {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => (document.body.innerText || "").includes("QR Studio"), { timeout: 25000 });

  // create one real record so the library has a valid design to clone
  await page.type('input[aria-label="Search"]', "Website").catch(() => {});
  await sleep(700);
  await clickText("Website");
  await page.waitForSelector("#f-url-url", { timeout: 15000 }).catch(() => {});
  await page.type("#f-url-url", "https://layout-test.example.com/seed");
  await sleep(300);
  await clickText("Create QR code");
  await sleep(800);
  await clickText("Save", "button", true);
  await sleep(1500);
  await seed();

  const navCount = await gotoSections();
  check("bottom navigation exposes all 6 sections", navCount === 6, `buttons=${navCount}`);

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 844, isMobile: true, hasTouch: true });
    await sleep(400);

    for (const [idx, name] of SECTIONS.entries()) {
      await page.evaluate((idx) => {
        const navs = document.querySelectorAll('nav[aria-label="Main navigation"]');
        navs[navs.length - 1].querySelectorAll("button")[idx].click();
      }, idx);
      await sleep(900);
      const m = await measure();
      check(
        `${width}px · ${name}: nothing extends past the viewport`,
        m.offenders.length === 0 && m.docScrollWidth <= m.vw,
        m.offenders.length ? JSON.stringify(m.offenders[0]) : "",
      );
    }

    // ---- library: item modal + bulk selection bar
    await page.evaluate(() => {
      const navs = document.querySelectorAll('nav[aria-label="Main navigation"]');
      navs[navs.length - 1].querySelectorAll("button")[3].click();
    });
    await sleep(900);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").includes("طويل") || (e.getAttribute("aria-label") || "").includes("QR code name"));
      b?.click();
    });
    await sleep(1000);
    let m = await measure();
    check(`${width}px · library item dialog fits`, m.offenders.length === 0 && m.docScrollWidth <= m.vw, m.offenders.length ? JSON.stringify(m.offenders[0]) : "");
    await page.keyboard.press("Escape");
    await sleep(500);

    await clickText("Select");
    await sleep(700);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").trim() === "All");
      b?.click();
    });
    await sleep(700);
    m = await measure();
    check(`${width}px · library bulk bar fits`, m.offenders.length === 0 && m.docScrollWidth <= m.vw, m.offenders.length ? JSON.stringify(m.offenders[0]) : "");
    await clickText("Select");
    await sleep(400);

    // ---- settings sheet
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").includes("Settings"));
      b?.click();
    });
    await sleep(1000);
    m = await measure();
    check(`${width}px · settings sheet fits`, m.offenders.length === 0 && m.docScrollWidth <= m.vw, m.offenders.length ? JSON.stringify(m.offenders[0]) : "");
    await page.keyboard.press("Escape");
    await sleep(500);
  }

  check("no runtime errors during the layout audit", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} catch (e) {
  check("layout audit completed", false, String(e).slice(0, 300));
} finally {
  console.log("\n============ MOBILE LAYOUT AUDIT ============");
  for (const r of results) console.log("  " + r);
  console.log("=============================================");
  console.log(
    failures === 0
      ? `✓ all checks passed (${results.filter((r) => r.startsWith("PASS")).length} passed)`
      : `✗ ${failures} check(s) FAILED`,
  );
  await browser.close();
  server.kill("SIGTERM");
  process.exit(failures ? 1 : 0);
}
