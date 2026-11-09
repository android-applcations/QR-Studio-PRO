#!/usr/bin/env node
/**
 * Audit for the polish pass: the create grid, the Sham Cash template, undo and
 * redo from the keyboard, the calendar-event panel, silent link protection and
 * light mode.
 *
 * These are the things a person notices rather than the things a unit test
 * catches, so each check looks at what is actually on screen.
 *
 * Usage:  npm run build && npm run test:polish
 *         CHROME_PATH=/path/to/chrome npm run test:polish
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4178);
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
  console.log("\n⚠ polish test SKIPPED: no Chromium/Chrome binary found (set CHROME_PATH)");
  process.exit(0);
}
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("\n⚠ polish test SKIPPED: puppeteer-core is not installed");
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
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

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

const bodyText = () => page.evaluate(() => document.body.innerText || "");

const gotoSection = async (i) => {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1000);
  await page.evaluate((i) => {
    const navs = document.querySelectorAll('nav[aria-label="Main navigation"]');
    navs[navs.length - 1].querySelectorAll("button")[i].click();
  }, i);
  await sleep(1100);
};

/** Build a QR in the app: pick a type, fill fields, create, snapshot. */
async function makeQr(cardTitle, fill, file) {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1100);
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
    await sleep(200);
  }
  await sleep(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes("Create QR code"));
    b?.click();
  });
  await sleep(2400);
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

async function scan(file) {
  await page.goto(`${BASE}/?section=scan`, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1300);
  const input = await page.$('input[type="file"]');
  if (!input) return false;
  await input.uploadFile(file);
  return page
    .waitForFunction(() => (document.body.innerText || "").includes("Code detected"), { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
}

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

try {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1400);

  // ------------------------------------------------------------ the create grid
  // Social platforms had square tiles and every other category had a wide list
  // row, so half the screen looked like a different app. One grid for all of it.
  const grid = await page.evaluate(() =>
    [...document.querySelectorAll("section[aria-label]")].map((s) => {
      const box = s.querySelector("div[class*='grid']");
      const tiles = box ? [...box.querySelectorAll(":scope > button")] : [];
      const r0 = tiles[0]?.getBoundingClientRect();
      return {
        title: s.getAttribute("aria-label") || "",
        cols: box ? /grid-cols-(\d+)/.exec(box.className)?.[1] ?? "" : "",
        tiles: tiles.length,
        square: !!r0 && r0.width > 0 && Math.abs(r0.width - r0.height) < 2,
      };
    }),
  );
  check("create: every category is listed", grid.length >= 8, JSON.stringify(grid.map((g) => g.title)));
  check(
    "create: every category uses the same tile grid",
    grid.length > 0 && grid.every((g) => g.cols === "3" && g.tiles > 0),
    JSON.stringify(grid),
  );
  check(
    "create: the tiles are square",
    grid.every((g) => g.square),
    JSON.stringify(grid.map((g) => `${g.title}:${g.square}`)),
  );

  // ------------------------------------------------------------ light mode
  const themes = await page.evaluate(async () => {
    const read = () => {
      const b = getComputedStyle(document.body).backgroundColor;
      const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(b);
      return m ? +m[1] + +m[2] + +m[3] : -1;
    };
    document.documentElement.dataset.theme = "light";
    await new Promise((r) => setTimeout(r, 250));
    const light = { bg: read(), image: getComputedStyle(document.body).backgroundImage };
    document.documentElement.dataset.theme = "dark";
    await new Promise((r) => setTimeout(r, 250));
    const dark = { bg: read(), image: getComputedStyle(document.body).backgroundImage };
    return { light, dark };
  });
  check("light mode really is light", themes.light.bg > 600 && themes.dark.bg < 200, JSON.stringify(themes));
  check("light mode paints an ambient wash behind the page", /gradient/.test(themes.light.image) && !/gradient/.test(themes.dark.image), themes.light.image.slice(0, 70));

  // ------------------------------------------------------------ the calendar event
  // A date you have to decode is not a date. And the length of the event is the
  // thing you usually came for after "when does it start".
  const evFile = join(tmpdir(), "qr-polish-event.png");
  const madeEv = await makeQr(
    "Calendar event",
    [
      ["#f-event-title", "Team meeting"],
      ["#f-event-start", "2026-11-08T10:00"],
      ["#f-event-end", "2026-11-08T11:30"],
      ["#f-event-where", "Damascus"],
    ],
    evFile,
  );
  check("create: built a calendar event QR", madeEv);
  if (madeEv) {
    check("scan: the event code was detected", await scan(evFile));
    const r = await rows();
    const starts = r.find((x) => /Starts|البداية/i.test(x.label))?.value ?? "";
    check("event: the start reads as a date, not a machine string", /2026/.test(starts) && !/^2026\/\d\d\/\d\d/.test(starts), JSON.stringify(starts));
    check("event: a weekday is shown", /sun|mon|tue|wed|thu|fri|sat|أحد|إثنين|ثلاثاء|أربعاء|خميس|جمعة|سبت/i.test(starts), JSON.stringify(starts));
    check(
      "event: the length is shown",
      r.some((x) => /Duration|المدة/i.test(x.label) && /1h\s*30min|1h 30min|90min/i.test(x.value)),
      JSON.stringify(r),
    );
  }

  // -------------------------------------------------------- silent protection
  // Protection says nothing about itself. The app judges the address, changes
  // what it is willing to do, and shows the person the address itself so they
  // can judge too. What must be true on screen: the whole host is there, and
  // not one word of verdict, alarm or advice is written anywhere.
  const SECURITY_WORDS =
    /warning|warned|dangerous|unsafe|suspicious|phishing|scam|fraud|malicious|blocked|borrows the name|تحذير|حذر|خطر|غير آمن|مشبوه|تصيد|احتيال|احذر/i;
  const phishFile = join(tmpdir(), "qr-polish-phish.png");
  const madePhish = await makeQr("Website", [["#f-url-url", "https://paypal.com.login-verify.net/signin"]], phishFile);
  check("create: built a look-alike link QR", madePhish);
  if (madePhish) {
    check("scan: the look-alike code was detected", await scan(phishFile));
    const text = await bodyText();
    check(
      "the full address of a look-alike is shown as it is",
      /paypal\.com\.login-verify\.net/.test(text),
      text.slice(0, 200).replace(/\n+/g, " | "),
    );
    check("nothing is written about it", !SECURITY_WORDS.test(text), (text.match(SECURITY_WORDS) ?? [""])[0]);
  }
  // …and an honest address is treated as ordinary: shown, and equally silent.
  const okFile = join(tmpdir(), "qr-polish-ok.png");
  const madeOk = await makeQr("Website", [["#f-url-url", "https://www.paypal.com/signin"]], okFile);
  if (madeOk) {
    check("scan: the honest code was detected", await scan(okFile));
    const honest = await bodyText();
    check("an honest address is shown too", /paypal\.com/.test(honest));
    check("nothing is written about the honest one either", !SECURITY_WORDS.test(honest), (honest.match(SECURITY_WORDS) ?? [""])[0]);
  }

  // ------------------------------------------------------------ the Sham Cash template
  await gotoSection(5); // Templates
  const tpl = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("aria-label") || "").startsWith("Templates") || (b.getAttribute("aria-label") || "").startsWith("القوالب"));
    const names = cards.map((b) => (b.getAttribute("aria-label") || "").replace(/^[^:]+:\s*/, ""));
    const sham = cards.find((b) => /Sham Cash|شام كاش/i.test(b.getAttribute("aria-label") || ""));
    const img = sham?.querySelector("img");
    return {
      total: cards.length,
      names: names.slice(0, 4),
      found: !!sham,
      logo: img ? { src: img.getAttribute("src") || "", loaded: img.naturalWidth > 0 } : null,
    };
  });
  check("templates: a Sham Cash template is offered", tpl.found, JSON.stringify(tpl.names));
  check("templates: it previews the official mark", tpl.logo?.loaded === true && /shamcash/.test(tpl.logo?.src ?? ""), JSON.stringify(tpl.logo));

  const applied = await page.evaluate(async () => {
    const cards = [...document.querySelectorAll("button")].filter((b) => (b.getAttribute("aria-label") || "").startsWith("Templates") || (b.getAttribute("aria-label") || "").startsWith("القوالب"));
    const sham = cards.find((b) => /Sham Cash|شام كاش/i.test(b.getAttribute("aria-label") || ""));
    if (!sham) return { ok: false };
    sham.click();
    await new Promise((r) => setTimeout(r, 900));
    const use = [...document.querySelectorAll("button")].find((b) => /Use template|استخدام القالب/i.test(b.textContent || ""));
    use?.click();
    await new Promise((r) => setTimeout(r, 1600));
    return { ok: true, text: document.body.innerText || "" };
  });
  check("templates: applying it opens the design screen", applied.ok && /Design|التصميم/i.test(applied.text ?? ""), (applied.text ?? "").slice(0, 90).replace(/\n+/g, " | "));
  check(
    "templates: it switches the project to Sham Cash",
    /Sham Cash|شام كاش/.test(applied.text ?? ""),
    (applied.text ?? "").slice(0, 160).replace(/\n+/g, " | "),
  );

  // ------------------------------------------------------------ undo / redo
  // Ctrl+Z is muscle memory. The buttons were there; the shortcut was not.
  // Dot shapes live on their own tab.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[role="tab"]')].find((e) => /^Shapes$|^الأشكال$/.test((e.textContent || "").trim()));
    b?.click();
  });
  await sleep(900);

  const pressed = (label) =>
    page.evaluate(
      (label) =>
        [...document.querySelectorAll("button")]
          .filter((b) => (b.getAttribute("aria-label") || "").trim() === label)
          .map((b) => b.getAttribute("aria-pressed")),
      label,
    );

  const pickedDots = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => /^Dots$|^دوائر$/.test((e.getAttribute("aria-label") || "").trim()));
    if (!b) return false;
    b.click();
    return true;
  });
  await sleep(800);
  check("design: a dot style can be chosen", pickedDots && (await pressed("Dots")).includes("true"), JSON.stringify(await pressed("Dots")));

  await page.keyboard.down("Control");
  await page.keyboard.press("KeyZ");
  await page.keyboard.up("Control");
  await sleep(800);
  const afterUndo = await pressed("Dots");
  check("Ctrl+Z undoes the change", afterUndo.length > 0 && !afterUndo.includes("true"), JSON.stringify(afterUndo));

  await page.keyboard.down("Control");
  await page.keyboard.press("KeyY");
  await page.keyboard.up("Control");
  await sleep(800);
  const afterRedo = await pressed("Dots");
  check("Ctrl+Y redoes it", afterRedo.includes("true"), JSON.stringify(afterRedo));

  // Inside a text field the shortcut belongs to the field, not to the design.
  // The frame caption is the one free-text control on this screen.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[role="tab"]')].find((e) => /^Frame$|^الإطار$/.test((e.textContent || "").trim()));
    b?.click();
  });
  await sleep(900);
  const guard = await page.evaluate(() => {
    const el = [...document.querySelectorAll("input")].find((i) => i.maxLength === 40 && !i.disabled);
    if (!el) return null;
    const fire = () => {
      const ev = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
      (document.activeElement ?? document.body).dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    el.focus();
    const inField = fire();
    el.blur();
    const outside = fire();
    return { inField, outside, focused: true };
  });
  check("design: a text field can take focus", guard?.focused === true, JSON.stringify(guard));
  // `preventDefault` is how the app claims the shortcut; leaving it alone is how
  // it hands the key back to the field the user is typing in.
  check(
    "typing keeps Ctrl+Z for the field, not the design",
    guard?.inField === false && guard?.outside === true,
    JSON.stringify(guard),
  );

  check("polish audit completed", true);
} catch (e) {
  check("polish audit completed", false, String(e).slice(0, 300));
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
console.log(`✓ all checks passed (${results.length} passed)`);
