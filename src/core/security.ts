import type { Tx } from "./types";

export interface LinkInfo {
  kind: "web" | "app" | "unsafe" | "none";
  href: string;
  host: string;
  https: boolean;
  openable: boolean;
  warnings: Tx[];
}

const UNSAFE = ["javascript", "data", "vbscript", "file", "blob", "about", "view-source"];
const SAFE_APP = ["tel", "mailto", "sms", "smsto", "geo", "bitcoin", "litecoin", "ethereum", "upi", "wifi"];
const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|ow\.ly|cutt\.ly|rb\.gy|shorturl\.at|tiny\.cc|buff\.ly|rebrand\.ly)$/i;

/** Static analysis of scanned content: never executes or opens anything. */
export function analyzeLink(content: string): LinkInfo {
  const s = content.trim();
  const none: LinkInfo = { kind: "none", href: "", host: "", https: false, openable: false, warnings: [] };
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (!m || /\s/.test(s.split(/[\n]/)[0].slice(0, m[0].length + 1))) return none;
  const scheme = m[1].toLowerCase();
  if (UNSAFE.includes(scheme)) {
    return { kind: "unsafe", href: s, host: "", https: false, openable: false, warnings: [["This content uses a dangerous link type and will not be opened.", "هذا المحتوى يستخدم نوع رابط خطير ولن يتم فتحه."]] };
  }
  if (scheme === "http" || scheme === "https") {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return { ...none, kind: "unsafe", warnings: [["Malformed link", "رابط غير صحيح"]] };
    }
    const warnings: Tx[] = [];
    const host = u.hostname.toLowerCase();
    if (scheme === "http") warnings.push(["The connection is not encrypted (http).", "الاتصال غير مشفّر (http)."]);
    if (host.includes("xn--")) warnings.push(["The domain uses look-alike (punycode) characters.", "النطاق يستخدم أحرفاً مشابهة (Punycode) وقد يكون مضللاً."]);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) warnings.push(["The link points to an IP address instead of a domain.", "الرابط يشير إلى عنوان IP بدلاً من نطاق."]);
    if (SHORTENERS.test(host)) warnings.push(["Shortened link: the real destination is hidden.", "رابط مختصر: الوجهة الحقيقية مخفية."]);
    if (u.username || u.password) warnings.push(["The link contains embedded credentials.", "الرابط يحتوي على بيانات دخول مضمّنة."]);
    if (s.length > 400) warnings.push(["Very long link.", "رابط طويل جداً."]);
    return { kind: "web", href: u.href, host: u.host, https: scheme === "https", openable: true, warnings };
  }
  if (SAFE_APP.includes(scheme) && scheme !== "wifi") {
    return { kind: "app", href: s, host: scheme + ":", https: false, openable: true, warnings: [] };
  }
  if (scheme === "wifi") return none;
  return {
    kind: "app", href: s, host: scheme + "://", https: false, openable: /^[a-z][a-z0-9+.-]*:\/\//i.test(s),
    warnings: [["This link opens another app on your device.", "هذا الرابط يفتح تطبيقاً آخر على جهازك."]],
  };
}
