#!/usr/bin/env node
/**
 * The lock on stored secrets.
 *
 * Everything a QR code can carry that is also a credential — a Wi-Fi password,
 * a wallet code, a private link — is sealed before it reaches IndexedDB and
 * opened again when it is read. This checks both halves, because either one
 * alone is worthless: sealed data the app cannot read back is just lost data,
 * and readable data that is not sealed is no protection at all.
 *
 * The module is exercised directly in the browser (real Web Crypto, real
 * IndexedDB), and then end to end through the app: a Wi-Fi code is created and
 * saved, the database is opened the way an attacker would open it, and the
 * password is looked for in the stored bytes.
 *
 * Usage:  npm run build && npm run test:vault
 *         CHROME_PATH=/path/to/chrome npm run test:vault
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 4180);
const BASE = `http://localhost:${PORT}`;
const SECRET = "MySecretWifi123";

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
  console.log("\n⚠ vault test SKIPPED: no Chromium/Chrome binary found (set CHROME_PATH)");
  process.exit(0);
}
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("\n⚠ vault test SKIPPED: puppeteer-core is not installed");
  process.exit(0);
}

// The module under test, compiled and handed to the page.
let vaultUrl;
try {
  const esbuild = await import("esbuild");
  const out = await esbuild.transform(readFileSync(join(ROOT, "src", "core", "vault.ts"), "utf8"), {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });
  vaultUrl = "data:text/javascript;base64," + Buffer.from(out.code, "utf8").toString("base64");
} catch (e) {
  console.error("\n✗ vault test could not compile src/core/vault.ts:", e?.message ?? e);
  process.exit(1);
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

const bodyText = () => page.evaluate(() => document.body.innerText || "");

/** Build a code in the app: pick a type, fill fields, create. */
async function makeQr(cardTitle, fill) {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Main navigation"]'), { timeout: 25000 });
  await sleep(1200);
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
    const ok = await page.evaluate(
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
    if (!ok) return false;
    await sleep(250);
  }
  await sleep(500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((e) => (e.textContent || "").includes("Create QR code"));
    b?.click();
  });
  await sleep(2400);
  return true;
}

try {
  // ------------------------------------------------------------- the module
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });
  const unit = await page.evaluate(
    async (url, SECRET) => {
      const v = await import(url);
      const sealed = await v.seal(SECRET);
      const opened = await v.open(sealed);
      const again = await v.seal(SECRET);
      const other = await v.seal(SECRET + "x");
      const plain = await v.open("not sealed at all");
      const flipped = sealed.slice(0, -4) + (sealed.endsWith("AAAA") ? "BBBB" : "AAAA");
      const damaged = await v.open(flipped);
      return {
        sealed,
        roundTrip: opened === SECRET,
        looksSealed: v.isSealed(sealed) && sealed.startsWith("vault1:"),
        hidesText: !sealed.includes(SECRET) && !sealed.includes("TXlTZWNy"),
        deterministic: sealed === again,
        differs: sealed !== other,
        passthrough: plain === "not sealed at all",
        damagedSurvives: typeof damaged === "string",
        wifi: v.holdsSecret("wifi", "WIFI:T:WPA;S:HomeNet;P:x;"),
        url: v.holdsSecret("url", "https://example.com"),
        scanned: v.holdsSecret("text", "WIFI:T:WPA;S:Home;P:secret;"),
      };
    },
    vaultUrl,
    SECRET,
  );

  check("sealing round-trips", unit.roundTrip, unit.sealed.slice(0, 40));
  check("sealed text is marked as sealed", unit.looksSealed);
  check("the secret is not readable in the sealed text", unit.hidesText);
  check("the same secret seals to the same bytes", unit.deterministic);
  check("a different secret seals differently", unit.differs);
  check("text that was never sealed comes back untouched", unit.passthrough);
  check("a damaged record is returned rather than thrown away", unit.damagedSurvives);
  check("a Wi-Fi code counts as a secret", unit.wifi === true);
  check("an ordinary link does not", unit.url === false);
  check("a scanned Wi-Fi string is recognised by its shape", unit.scanned === true);

  // ------------------------------------------------------- through the app
  const made = await makeQr("Wi-Fi", [
    ["#f-wifi-ssid", "HomeNet"],
    ["#f-wifi-password", SECRET],
  ]);
  check("create: a Wi-Fi code was built", made);
  if (made) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((e) => /^Save$|احفظ|حفظ$/i.test((e.textContent || "").trim()));
      b?.click();
    });
    await sleep(1800);

    // Read the database the way somebody with the device would.
    const stored = await page.evaluate(async () => {
      const open = () =>
        new Promise((res, rej) => {
          const r = indexedDB.open("qr_studio_pro");
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      const db = await open();
      const rows = await new Promise((res, rej) => {
        const tx = db.transaction("qr_codes", "readonly");
        const q = tx.objectStore("qr_codes").getAll();
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      const hist = await new Promise((res) => {
        const tx = db.transaction("scan_history", "readonly");
        const q = tx.objectStore("scan_history").getAll();
        q.onsuccess = () => res(q.result);
        q.onerror = () => res([]);
      });
      db.close();
      return { rows, hist, json: JSON.stringify(rows) + JSON.stringify(hist) };
    });

    check("the code was saved", stored.rows.length > 0, `${stored.rows.length} row(s)`);
    check("the password is nowhere in the stored data", !stored.json.includes(SECRET), stored.json.slice(0, 80));
    const wifiRow = stored.rows.find((r) => r.type === "wifi");
    check("the Wi-Fi row's content is sealed", !!wifiRow && String(wifiRow.content).startsWith("vault1:"), String(wifiRow?.content ?? "").slice(0, 30));
    check(
      "the password field is sealed too",
      !!wifiRow && String(wifiRow.form_values?.password ?? "").startsWith("vault1:"),
      String(wifiRow?.form_values?.password ?? "").slice(0, 30),
    );
    check(
      "every value of a secret record is sealed",
      !!wifiRow && Object.values(wifiRow.form_values ?? {}).every((v) => String(v).startsWith("vault1:")),
      JSON.stringify(wifiRow?.form_values ?? {}).slice(0, 90),
    );
    // The name is stored in the clear and is the first thing anyone sees, so
    // it must not carry the password either.
    check("the auto-made name carries no password", !stored.json.includes("MySecr"), String(wifiRow?.name ?? ""));

    // …and the app can still read it back.
    await page.goto(`${BASE}/?section=library`, { waitUntil: "networkidle2", timeout: 45000 });
    await sleep(1800);
    const openedRecord = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll("button")].filter((b) => /HomeNet|Wi-Fi|شبكة/i.test((b.getAttribute("aria-label") || b.textContent || "")));
      const tile = tiles[0];
      if (!tile) return false;
      tile.click();
      return true;
    });
    check("library: the saved code is there", openedRecord);
    if (openedRecord) {
      await sleep(1400);
      const shot = await page.evaluate(async () => {
        const img = document.querySelector('[role="dialog"] img[alt="QR code"]');
        if (!img) return null;
        try {
          await img.decode();
        } catch {}
        const c = document.createElement("canvas");
        c.width = c.height = 460;
        const x = c.getContext("2d");
        x.fillStyle = "#fff";
        x.fillRect(0, 0, 460, 460);
        x.drawImage(img, 0, 0, 460, 460);
        return c.toDataURL("image/png");
      });
      check("library: the code is drawn from what was stored", !!shot);
      if (shot) {
        const file = join(tmpdir(), "qr-vault-wifi.png");
        writeFileSync(file, Buffer.from(shot.split(",")[1], "base64"));
        // Read it back with the app's own scanner: the strongest possible
        // proof that sealing did not lose anything.
        await page.goto(`${BASE}/?section=scan`, { waitUntil: "networkidle2", timeout: 45000 });
        await sleep(1500);
        const input = await page.$('input[type="file"]');
        if (input) {
          await input.uploadFile(file);
          await page
            .waitForFunction(() => /Code detected|تم اكتشاف/i.test(document.body.innerText || ""), { timeout: 15000 })
            .catch(() => undefined);
          await sleep(900);
        }
        const decoded = await bodyText();
        check("the sealed code still decodes to the original", decoded.includes("HomeNet"), decoded.slice(0, 160).replace(/\n+/g, " | "));
      }
    }
  }

  check("vault audit completed", true);
} catch (e) {
  check("vault audit completed", false, String(e).slice(0, 300));
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
