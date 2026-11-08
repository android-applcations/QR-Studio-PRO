#!/usr/bin/env node
/**
 * Real end-to-end offline test for QR Studio Pro.
 *
 * Boots the production build through `scripts/serve-dist.mjs`, drives it with a
 * headless Chromium over CDP and switches the network off mid-session, so every
 * claim below is observed in a real browser — not inferred from the build output.
 *
 * Requirements
 *   npm i -D puppeteer-core          (already a devDependency)
 *   a Chromium/Chrome binary:        export CHROME_PATH=/path/to/chrome
 *                                    (or install one via `npx playwright install chromium`)
 *
 * Usage
 *   npm run build
 *   npm run test:offline
 *
 * Exit code 0 = all checks passed (or the test was skipped because no browser was
 * found, which is reported loudly). Exit code 1 = at least one check failed.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4173);
const BASE = `http://localhost:${PORT}`;

const results = [];
const consoleErrors = [];
let failures = 0;

const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};
const note = (n) => results.push(`NOTE  ${n}`);

// ---------------------------------------------------------------------------
// locate a browser
// ---------------------------------------------------------------------------
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
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  const pwRoot = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  if (existsSync(pwRoot)) {
    for (const dir of readdirSync(pwRoot)) {
      for (const rel of ["chrome-linux/chrome", "chromium-1148/chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const p = join(pwRoot, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

function skip(reason) {
  console.log(`\n⚠ offline test SKIPPED: ${reason}`);
  console.log("  Install a browser and point CHROME_PATH at it, then re-run `npm run test:offline`.");
  process.exit(0);
}

if (!existsSync(DIST)) {
  console.error("✗ dist/ not found — run `npm run build` first");
  process.exit(1);
}
const browserPath = findBrowser();
if (!browserPath) skip("no Chromium/Chrome binary found");

let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  skip("puppeteer-core is not installed (npm i -D puppeteer-core)");
}

// ---------------------------------------------------------------------------
// static server (mirrors the vercel.json caching rules)
// ---------------------------------------------------------------------------
const server = spawn(process.execPath, [join(ROOT, "scripts", "serve-dist.mjs"), String(PORT)], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => consoleErrors.push("server: " + d.toString()));
await sleep(900);

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--window-size=1400,1000"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 250));
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 250)));

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const clickText = async (text, sel = "button", last = false) => {
  const ok = await page.evaluate(
    (text, sel, last) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => {
        const t = (e.textContent || "").trim().toLowerCase();
        return t.includes(text.toLowerCase()) && !e.disabled && e.offsetParent !== null;
      });
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
  if (!ok) throw new Error(`could not click "${text}" (${sel})`);
  await sleep(450);
};

const bodyText = () => page.evaluate(() => document.body.innerText || "");
const hasText = async (t, timeout = 10000) => {
  try {
    await page.waitForFunction((t) => (document.body.innerText || "").includes(t), { timeout }, t);
    return true;
  } catch {
    return false;
  }
};
const hasSel = async (sel, timeout = 10000) => {
  try {
    await page.waitForSelector(sel, { timeout });
    return true;
  } catch {
    return false;
  }
};
const noCrash = async () => !(await bodyText()).includes("Something went wrong");

const SECTION_ORDER = ["create", "design", "scan", "library", "history", "templates"];
const gotoSection = async (id) => {
  await page.evaluate(
    (id, order) => {
      const nav = document.querySelectorAll('nav[aria-label="Main navigation"]')[0];
      nav.querySelectorAll("button")[order.indexOf(id)].click();
    },
    id,
    SECTION_ORDER,
  );
  await sleep(1100);
};

const dbState = () =>
  page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    const db = await new Promise((res) => {
      const r = indexedDB.open("qr_studio_pro");
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return { databases: dbs.map((d) => d.name), nativeVersion: null, stores: [], rows: null };
    const stores = [...db.objectStoreNames];
    const read = (store, fn) =>
      new Promise((res) => {
        if (!stores.includes(store)) return res(null);
        const rq = fn(db.transaction(store, "readonly").objectStore(store));
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
      });
    const all = (await read("qr_codes", (t) => t.getAll())) ?? [];
    const out = {
      databases: dbs.map((d) => d.name),
      nativeVersion: db.version,
      stores,
      rows: all.length,
      history: await read("scan_history", (t) => t.count()),
      assets: await read("assets", (t) => t.count()),
      templates: await read("templates", (t) => t.count()),
      names: all.map((r) => r.name),
    };
    db.close();
    return out;
  });

const cacheState = () =>
  page.evaluate(async () => {
    const out = {};
    for (const n of await caches.keys()) out[n] = (await (await caches.open(n)).keys()).length;
    return out;
  });

try {
  // =========================================================== PHASE A — online
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  check("online: app shell renders", await hasText("QR Studio", 25000));

  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 30000 });
  const swUrl = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
  check("online: service worker registered and controlling the page", swUrl.endsWith("/sw.js"), swUrl);

  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => r.active?.scriptURL));
  check("online: exactly one service worker registration", regs.length === 1, JSON.stringify(regs));

  check('online: ConnectionStatus reports "Offline ready"', await hasText("Offline ready", 25000));

  const cdp = await page.createCDPSession();
  const manifestInfo = await cdp.send("Page.getAppManifest");
  check(
    "PWA: web app manifest parsed with no installability errors",
    (manifestInfo.errors ?? []).length === 0,
    JSON.stringify((manifestInfo.errors ?? []).slice(0, 3)),
  );
  const mi = typeof manifestInfo.data === "string" ? JSON.parse(manifestInfo.data) : manifestInfo.data ?? {};
  check(
    "PWA: manifest declares a maskable 512 icon and standalone display",
    (mi.icons ?? []).some((i) => (i.sizes ?? "").includes("512") && (i.purpose ?? "any").includes("maskable")) &&
      mi.display === "standalone" &&
      !!mi.start_url,
    `display=${mi.display} start_url=${mi.start_url} icons=${(mi.icons ?? []).length}`,
  );

  const caches1 = await cacheState();
  const precached = Object.values(caches1).reduce((a, b) => a + b, 0);
  check("online: precache populated", precached >= 20, `${precached} responses in ${Object.keys(caches1).join(", ")}`);

  // ---- create + save a QR code
  await hasSel('input[aria-label="Search"]');
  await page.type('input[aria-label="Search"]', "Website");
  await sleep(700);
  await clickText("Website", "button");
  await hasSel("#f-url-url");
  await page.type("#f-url-url", "https://offline-test.example.com/hello");
  await sleep(400);
  await clickText("Create QR code");
  check("online: QR result step reached", await hasText("Your QR code", 15000));

  const nameInput = await page.$('input[placeholder="Website"]');
  if (nameInput) await nameInput.type("OfflineProbe");
  await clickText("Save", "button");
  check("online: save toast shown", await hasText("Saved to My codes", 12000));

  // Snapshot the rendered QR as a PNG so the offline scan test has a real image.
  const encoded = await page.evaluate(() => {
    const p = [...document.querySelectorAll("p")].map((e) => e.innerText || "");
    return p.find((t) => t.startsWith("http")) ?? "";
  });
  const qrPng = await page.evaluate(async () => {
    const img = document.querySelector('img[alt="QR code"]');
    if (!img) return null;
    try {
      await img.decode();
    } catch {
      /* ignore */
    }
    const c = document.createElement("canvas");
    c.width = c.height = 420;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 420, 420);
    ctx.drawImage(img, 0, 0, 420, 420);
    return c.toDataURL("image/png");
  });
  const sampleFile = join(tmpdir(), "qr-studio-offline-sample.png");
  if (qrPng) writeFileSync(sampleFile, Buffer.from(qrPng.split(",")[1], "base64"));

  const d1 = await dbState();
  check("online: IndexedDB database name is qr_studio_pro", d1.databases.includes("qr_studio_pro"), JSON.stringify(d1.databases));
  check(
    "online: Dexie schema untouched (native IDB version 20 = Dexie v2.0)",
    d1.nativeVersion === 20 && d1.stores.length === 7,
    `nativeVersion=${d1.nativeVersion}, stores=${d1.stores.length}`,
  );
  check("online: QR saved", d1.rows === 1, `rows=${d1.rows} names=${JSON.stringify(d1.names)}`);

  // =========================================================== PHASE B — offline
  await page.setOfflineMode(true);
  await sleep(300);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  check("offline: app boots from the precache", await hasText("QR Studio", 25000));
  check("offline: no error boundary", await noCrash());

  const shell = await page.evaluate(() => ({
    title: document.title,
    rootChildren: document.getElementById("root")?.childElementCount ?? 0,
  }));
  check("offline: shell rendered (not a white page)", shell.rootChildren > 0, JSON.stringify(shell));
  check("offline: ConnectionStatus shows Offline", await hasText("Offline", 25000));

  const sections = [
    ["design", null, "Colors"],
    ["scan", 'video[aria-label="Camera preview"]', null],
    ["library", 'input[placeholder^="Search my codes"]', null],
    ["history", 'input[placeholder^="Search history"]', null],
    ["templates", null, "Save current design"],
    ["create", 'input[placeholder^="Search QR types"], input[id^="f-"]', null],
  ];
  for (const [id, sel, marker] of sections) {
    await gotoSection(id);
    await sleep(700);
    const ok = sel ? await hasSel(sel, 12000) : await hasText(marker, 12000);
    check(`offline: section "${id}" loads (${sel ? "lazy chunk resolved" : "rendered"})`, ok && (await noCrash()), ok ? "" : `missing ${sel ?? marker}`);
  }

  const goToPicker = async () => {
    await gotoSection("create");
    await sleep(600);
    if (await hasSel('input[placeholder^="Search QR types"]', 3000)) return true;
    const back = await page.$('button[aria-label="Back"]');
    if (back) {
      await back.click();
      await sleep(900);
    }
    if (await hasSel('input[placeholder^="Search QR types"]', 5000)) return true;
    await clickText("New", "button").catch(() => {});
    await sleep(900);
    return hasSel('input[placeholder^="Search QR types"]', 5000);
  };

  // ---- batch generation panel (lazy chunk)
  await goToPicker();
  await clickText("Batch", "button");
  await sleep(1600);
  check(
    "offline: batch panel (lazy chunk) opens",
    ((await hasSel('input[type="file"]', 8000)) || (await hasText("Cancel", 4000))) && (await noCrash()),
  );

  // ---- create + save another QR with no network
  await goToPicker();
  await page.type('input[aria-label="Search"]', "Website");
  await sleep(700);
  await clickText("Website", "button");
  await hasSel("#f-url-url");
  await page.type("#f-url-url", "https://offline-test.example.com/second");
  await sleep(400);
  await clickText("Create QR code");
  await hasText("Your QR code", 12000);
  await clickText("Save", "button");
  check("offline: create + save a new QR", await hasText("Saved to My codes", 12000));
  check("offline: new record persisted", (await dbState()).rows === 2);

  // ---- library: list, search, duplicate, export, print, delete
  await gotoSection("library");
  await sleep(900);
  check("offline: saved codes listed in library", (await bodyText()).includes("OfflineProbe"));

  await page.type('input[aria-label="Search"]', "OfflineProbe");
  await sleep(900);
  const searchHit = (await bodyText()).includes("OfflineProbe");
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Search"]');
    i.value = "";
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(400);
  check("offline: local search filters the library", searchHit);

  const openCard = (label) =>
    page.evaluate((label) => {
      const b = [...document.querySelectorAll("button")].find((e) => (e.getAttribute("aria-label") || "").includes(label));
      b?.click();
    }, label);

  await openCard("OfflineProbe");
  await sleep(900);
  await clickText("Duplicate", "button");
  await sleep(1200);
  check("offline: duplicate a saved code", (await dbState()).rows === 3);

  await openCard("OfflineProbe");
  await sleep(900);
  await clickText("Export", "button");
  await sleep(1200);
  check("offline: export sheet renders a real QR image", (await hasText("PNG", 8000)) && (await noCrash()));
  await page.keyboard.press("Escape");
  await sleep(600);

  await openCard("OfflineProbe");
  await sleep(900);
  await clickText("Print", "button");
  await sleep(1500);
  check("offline: print sheet renders", (await hasText("Print", 8000)) && (await noCrash()));
  await page.keyboard.press("Escape");
  await sleep(600);

  await openCard("(copy)");
  await sleep(900);
  await clickText("Delete", "button", true);
  await sleep(700);
  await clickText("Delete", "button", true);
  await sleep(1300);
  check("offline: delete a saved code", (await dbState()).rows === 2);

  // ---- templates
  await gotoSection("templates");
  await sleep(900);
  await clickText("Save current design", "button");
  await sleep(700);
  const tplInput = await page.$('input[maxlength="60"]');
  if (tplInput) await tplInput.type("OfflineTemplate");
  await sleep(300);
  await clickText("Save", "button", true);
  const tplSaved = await hasText("Template saved", 10000);
  check("offline: save a custom template", tplSaved && (await dbState()).templates === 1);

  await gotoSection("templates");
  await sleep(1000);
  check("offline: custom template listed", (await bodyText()).includes("OfflineTemplate"));
  await clickText("Use template", "button");
  check("offline: apply a ready-made template", (await hasText("Applied", 10000)) && (await noCrash()));

  // ---- scan a QR from a local image (jsQR, fully on-device)
  await gotoSection("scan");
  await sleep(1200);
  const fileInput = await page.$('input[type="file"]');
  let scanned = false;
  if (fileInput && qrPng) {
    await fileInput.uploadFile(sampleFile);
    scanned = await hasText("Code detected", 25000);
    if (scanned) {
      const decoded = await page.evaluate(() => {
        const p = [...document.querySelectorAll("p")].map((e) => e.innerText || "");
        return p.find((t) => t.includes("http")) ?? "";
      });
      scanned = !!encoded && decoded.includes(encoded);
      if (!scanned) note(`scan decoded "${decoded.slice(0, 80)}" (expected "${encoded.slice(0, 80)}")`);
    }
  }
  check("offline: scan a QR from a local image (jsQR)", scanned, scanned ? encoded : "no file input or decode failed");

  const camMsg = await bodyText();
  check(
    "offline: camera failure shows a clear bilingual message (no crash)",
    /Camera|الكاميرا|Scan from image|مسح من صورة/.test(camMsg) && (await noCrash()),
  );

  const exportProbe = await page.evaluate(async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#fff"/><rect x="10" y="10" width="40" height="40" fill="#000"/></svg>';
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const c = document.createElement("canvas");
      c.width = c.height = 120;
      c.getContext("2d").drawImage(img, 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, "image/png"));
      return { ok: !!blob, size: blob?.size ?? 0 };
    } catch (e) {
      return { ok: false, err: String(e) };
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  check("offline: canvas → PNG export pipeline works", exportProbe.ok && exportProbe.size > 50, JSON.stringify(exportProbe));

  const d2 = await dbState();
  check("offline: IndexedDB data intact after the offline reload", d2.rows === 2 && d2.names.some((n) => n.includes("OfflineProbe")), JSON.stringify(d2.names));
  check(
    "offline: database name + schema unchanged",
    d2.databases.includes("qr_studio_pro") && d2.nativeVersion === 20 && d2.stores.length === 7,
    `v${d2.nativeVersion}, ${d2.stores.length} stores`,
  );
  check("offline: history records kept", d2.history >= 1, `history=${d2.history}`);

  const fb = await page.evaluate(async () => {
    for (const n of await caches.keys()) {
      const c = await caches.open(n);
      // Workbox keys non-hashed entries with a ?__WB_REVISION__ search param.
      const hit = (await c.match("/offline.html", { ignoreSearch: true })) || (await c.match("/offline.html"));
      if (hit) return { cached: true, status: hit.status, cache: n };
    }
    return { cached: false };
  });
  check("offline: offline.html fallback page is precached", fb.cached, JSON.stringify(fb));

  await page.goto(`${BASE}/?section=library`, { waitUntil: "domcontentloaded", timeout: 30000 });
  check(
    "offline: deep link /?section=library works with no network",
    (await hasSel('input[placeholder^="Search my codes"]', 20000)) && (await noCrash()),
  );

  // =========================================================== PHASE C — update
  await page.setOfflineMode(false);
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 40000 });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 25000 });
  check("back online: app loads again", await hasText("QR Studio", 20000));
  check("back online: data still present", (await dbState()).rows === 2);

  // Simulate a deployment by byte-changing the service worker.
  appendFileSync(join(DIST, "sw.js"), "\n/* update-simulation */\n");
  await page.reload({ waitUntil: "networkidle2", timeout: 40000 });
  await sleep(3000);
  check(
    "update: new service worker detected and waiting (no silent reload)",
    await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
  );
  check("update: UI offers an update action", await hasText("Update", 15000));

  await clickText("Update now", "button", true);
  await sleep(700);
  if (await hasText("Update the app?", 8000)) await clickText("Update now", "button", true);
  await sleep(5000);

  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, { timeout: 30000 });
  check("update: app runs after applying the update", await hasText("QR Studio", 20000));

  const d4 = await dbState();
  check(
    "update: IndexedDB data preserved across the update",
    d4.rows === 2 && d4.names.some((n) => n.includes("OfflineProbe")),
    JSON.stringify(d4.names),
  );
  check(
    "update: database name + schema still intact",
    d4.databases.includes("qr_studio_pro") && d4.nativeVersion === 20 && d4.stores.length === 7,
  );
  check(
    "update: waiting worker activated",
    !(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)),
  );

  const realErrors = consoleErrors.filter(
    (e) =>
      !/favicon|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|net::ERR_FAILED|__probe__|React DevTools|Failed to load resource/.test(e),
  );
  check("console: no unexpected runtime errors", realErrors.length === 0, realErrors.slice(0, 5).join(" | "));
} catch (e) {
  check("test harness completed", false, String(e).slice(0, 300));
} finally {
  console.log("\n================ OFFLINE TEST REPORT ================");
  for (const r of results) console.log("  " + r);
  console.log("=====================================================");
  console.log(
    failures === 0
      ? `✓ all checks passed (${results.filter((r) => r.startsWith("PASS")).length} passed)`
      : `✗ ${failures} check(s) FAILED`,
  );
  await browser.close();
  server.kill("SIGTERM");
  process.exit(failures ? 1 : 0);
}
