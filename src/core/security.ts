/**
 * Reading a scanned link before anything acts on it.
 *
 * The rule this file follows: protection is silent. Nothing computed here is
 * ever written on screen — no banners, no "warning:", no lecturing. The analysis
 * decides what the app is willing to *do* with a link (open it at all, hand it
 * to the app it claims to belong to) and then stays out of the way. A person who
 * wants to check where a link goes can read the address, which is always shown
 * in full.
 */

export interface LinkInfo {
  kind: "web" | "app" | "unsafe" | "none";
  href: string;
  host: string;
  https: boolean;
  openable: boolean;
  /**
   * The address looks like it is pretending to be a service it is not: an
   * unencrypted connection, punycode, a bare IP, a shortener, embedded
   * credentials, or a borrowed brand name.
   *
   * Used to decide, never to announce.
   */
  suspicious: boolean;
}

const UNSAFE = ["javascript", "data", "vbscript", "file", "blob", "about", "view-source"];
const SAFE_APP = ["tel", "mailto", "sms", "smsto", "geo", "bitcoin", "litecoin", "ethereum", "upi", "wifi"];
const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|ow\.ly|cutt\.ly|rb\.gy|shorturl\.at|tiny\.cc|buff\.ly|rebrand\.ly)$/i;

/**
 * Names a fake login page likes to borrow.
 *
 * Short and generic words ("bank", "mtn") are deliberately absent — matching
 * those flags ordinary domains and the signal stops meaning anything.
 */
const BRANDS: Record<string, string[]> = {
  paypal: ["paypal.com", "paypal.me"],
  google: ["google.com"],
  apple: ["apple.com"],
  microsoft: ["microsoft.com", "live.com", "outlook.com"],
  amazon: ["amazon.com", "amazon.co.uk", "amazon.ae", "amazon.sa", "amazon.eg"],
  netflix: ["netflix.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com", "messenger.com"],
  whatsapp: ["whatsapp.com", "wa.me"],
  telegram: ["telegram.me", "telegram.org", "t.me"],
  twitter: ["twitter.com", "x.com"],
  linkedin: ["linkedin.com"],
  snapchat: ["snapchat.com"],
  tiktok: ["tiktok.com"],
  hsbc: ["hsbc.com"],
  westernunion: ["westernunion.com"],
  moneygram: ["moneygram.com"],
  shamcash: ["shamcash.sy", "shamcash.com"],
};

/** `amazon.co.uk` owns three labels, not two — `co.uk` is not the domain. */
const TWO_PART_SUFFIX = /^(co|com|org|net|gov|edu|ac|sch)\.[a-z]{2}$/;

function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length >= 3 && TWO_PART_SUFFIX.test(labels.slice(-2).join("."))) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

/** Leet-speak back to letters, so `paypa1` and `g00gle` are caught too. */
const deLeet = (v: string) =>
  v
    .toLowerCase()
    .replace(/[_-]/g, "")
    .replace(/[013457]/g, (d) => ({ "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t" })[d] ?? d);

/**
 * Does this hostname pretend to be somebody else?
 *
 * The two classic shapes: a trusted name parked in the subdomain
 * (`paypal.com.login-verify.net` — the domain that actually receives you is the
 * one on the right), and a trusted name misspelled into the domain itself
 * (`paypa1.com`, `secure-paypal.com`).
 */
export function impersonation(host: string): boolean {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return false;
  const reg = registrableDomain(host);
  const sub = labels.slice(0, labels.length - reg.split(".").length).join(".");
  const flat = deLeet(reg);
  for (const [brand, own] of Object.entries(BRANDS)) {
    // A trusted name anywhere to the left of the real domain.
    if (sub.includes(brand)) return true;
    // The domain borrows the name but is not one the brand actually owns.
    if ((reg.includes(brand) || flat.includes(brand)) && !own.includes(reg)) return true;
  }
  return false;
}

/** Static analysis of scanned content: never executes or opens anything. */
export function analyzeLink(content: string): LinkInfo {
  const s = content.trim();
  const none: LinkInfo = { kind: "none", href: "", host: "", https: false, openable: false, suspicious: false };
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (!m || /\s/.test(s.split(/[\n]/)[0].slice(0, m[0].length + 1))) return none;
  const scheme = m[1].toLowerCase();

  // Schemes that can only ever hurt are simply not offered: no button, no
  // explanation. The result panel shows the raw text and nothing more.
  if (UNSAFE.includes(scheme)) return { kind: "unsafe", href: s, host: "", https: false, openable: false, suspicious: true };

  if (scheme === "http" || scheme === "https") {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return { ...none, kind: "unsafe", suspicious: true };
    }
    const host = u.hostname.toLowerCase();
    const suspicious =
      scheme === "http" ||
      host.includes("xn--") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      host.includes(":") ||
      SHORTENERS.test(host) ||
      !!u.username ||
      !!u.password ||
      s.length > 400 ||
      impersonation(host);
    return { kind: "web", href: u.href, host: u.host, https: scheme === "https", openable: true, suspicious };
  }

  // tel:, mailto:, sms:, geo:, crypto: — schemes the OS answers directly.
  if (SAFE_APP.includes(scheme) && scheme !== "wifi") {
    return { kind: "app", href: s, host: scheme + ":", https: false, openable: true, suspicious: false };
  }
  if (scheme === "wifi") return none;

  // Anything else is a scheme we do not know, so it only opens when it is
  // written as a full URL — and never gets handed to a native app.
  return {
    kind: "app",
    href: s,
    host: scheme + "://",
    https: false,
    openable: /^[a-z][a-z0-9+.-]*:\/\//i.test(s),
    suspicious: true,
  };
}
