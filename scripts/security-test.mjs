#!/usr/bin/env node
/**
 * The link check, read on its own.
 *
 * `src/core/security.ts` decides what the app is willing to do with a scanned
 * link and says nothing about it on screen, so there is nothing to look at in
 * the browser — the behaviour lives entirely in the value it returns. This
 * imports the module directly and asks it about every shape of link a QR code
 * can carry.
 *
 * Usage:  npm run test:security
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src", "core", "security.ts");

const results = [];
let failures = 0;
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

// TS → JS in memory, then import it. No build step, no test runner.
let security;
try {
  const esbuild = await import("esbuild");
  const out = await esbuild.transform(readFileSync(SRC, "utf8"), { loader: "ts", format: "esm", target: "es2022" });
  const url = "data:text/javascript;base64," + Buffer.from(out.code, "utf8").toString("base64");
  security = await import(url);
} catch (e) {
  console.error("\n✗ security test could not load src/core/security.ts:", e?.message ?? e);
  process.exit(1);
}

const { analyzeLink, impersonation } = security;

// ---------------------------------------------------------------- the verdict
/** [url, should be considered suspicious] */
const CASES = [
  // ordinary addresses are left completely alone
  ["https://www.paypal.com/signin", false],
  ["https://example.com", false],
  ["https://news.bbc.co.uk/article", false],
  ["https://amazon.co.uk/dp/B09", false],
  ["https://t.me/shamcashapp", false],
  ["https://wa.me/963912345678", false],
  ["https://x.com/abuomar", false],
  ["https://shamcash.sy/pay?c=abc", false],
  ["mailto:someone@example.com", false],
  ["tel:+963912345678", false],
  ["sms:+963912345678", false],
  ["geo:33.5138,36.2765", false],

  // a name that belongs to somebody else
  ["https://paypal.com.login-verify.net/signin", true],
  ["https://secure-paypal.com/signin", true],
  ["https://paypa1.com/signin", true],
  ["https://g00gle.com", true],
  ["https://instagram.com.free-followers.top", true],
  ["https://shamcash-verify.com/login", true],

  // no encryption, or an address that hides where it goes
  ["http://example.com", true],
  ["https://xn--80ak6aa92e.com", true],
  ["https://192.168.1.10/login", true],
  ["https://bit.ly/3xY7", true],
  ["https://t.co/abc123", true],
  ["https://user:pass@example.com", true],
  ["https://example.com/" + "a".repeat(400), true],

  // schemes that can only ever hurt: refused, and never offered as a link
  ["javascript:alert(1)", true],
  ["data:text/html,<script>alert(1)</script>", true],
  ["file:///etc/passwd", true],
];

for (const [url, want] of CASES) {
  const info = analyzeLink(url);
  const shown = url.length > 44 ? url.slice(0, 41) + "…" : url;
  check(`${want ? "distrusted" : "trusted"}: ${shown}`, info.suspicious === want, `suspicious=${info.suspicious} kind=${info.kind}`);
}

// ------------------------------------------------- dangerous schemes are inert
for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "vbscript:msgbox(1)"]) {
  const info = analyzeLink(bad);
  check(`refused outright: ${bad.slice(0, 30)}`, info.kind === "unsafe" && info.openable === false, `kind=${info.kind}`);
}
check("an ordinary web link stays openable", analyzeLink("https://example.com").openable === true);
check("the address is never rewritten", analyzeLink("https://example.com/a?b=1").href === "https://example.com/a?b=1");

// ------------------------------------------------------------------- the host
const host = analyzeLink("https://User:pass@Example.COM:8443/path");
check("the host is reported whole", host.host === "example.com:8443", host.host);
check("a port in the host is itself a reason", host.suspicious === true);

// ------------------------------------------------- protection carries no prose
// The rule the whole file follows: what protects the app is never written in
// it. A string meant for a person would have to be translated, so it would
// arrive as a `[english, arabic]` pair — none may exist here.
const source = readFileSync(SRC, "utf8");
// Anything written for a person is translated, so it carries an Arabic twin —
// and anything written for a person forms sentences. Domain lists do neither.
const arabic = [...source.matchAll(/"[^"\n]*[\u0600-\u06FF][^"\n]*"/g)].map((m) => m[0]);
check("the module holds no translated text", arabic.length === 0, arabic.slice(0, 3).join(" "));
const sentences = [...source.matchAll(/"[^"\n]*"/g)].map((m) => m[0]).filter((lit) => (lit.match(/ /g) ?? []).length >= 3);
check("the module holds no sentences", sentences.length === 0, sentences.slice(0, 3).join(" "));
check("there is no `warnings` field to render", !/\bwarnings\b/.test(source));

// ------------------------------------------------------------------ brand math
for (const [h, want] of [
  ["paypal.com", false], ["www.paypal.com", false], ["paypal.me", false],
  ["amazon.co.uk", false], ["bbc.co.uk", false], ["t.me", false], ["x.com", false],
  ["paypa1.com", true], ["secure-paypal.com", true], ["paypal.com.login-verify.net", true],
]) {
  check(`impersonation(${h}) === ${want}`, impersonation(h) === want);
}

console.log(results.join("\n"));
console.log("=".repeat(60));
if (failures) {
  console.log(`✗ ${failures} check(s) failed (${results.length - failures} passed)`);
  process.exit(1);
}
console.log(`✓ all checks passed (${results.length} passed)`);
