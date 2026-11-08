import type { Tx } from "./types";

/**
 * Turn raw scanned content into an ordered list of labelled fields.
 *
 * A QR code stores one flat string, and printing that string is what made the
 * Wi-Fi result look like noise: `WIFI:T:WPA;S:Home;P:••••;;`. Every type now
 * gets the same treatment — its string is parsed back into the fields the user
 * actually cares about and rendered as a tidy list. Types with no structure
 * (plain text and friends) simply get one "Content" row, so the layout stays
 * identical everywhere.
 */

export interface ScanField {
  /** bilingual label, rendered muted */
  label: Tx;
  /** plain value, shown as-is */
  value?: string;
  /** translated value — use this when the value itself needs localising */
  valueTx?: Tx;
  /** render left-to-right: numbers, ids, addresses, URLs */
  ltr?: boolean;
  /** hidden behind the reveal toggle (passwords) */
  secret?: boolean;
  /** may wrap over several lines */
  multiline?: boolean;
}

const L = {
  network: ["Network name (SSID)", "اسم الشبكة (SSID)"],
  password: ["Password", "كلمة المرور"],
  security: ["Security", "الحماية"],
  hidden: ["Hidden network", "شبكة مخفية"],
  name: ["Name", "الاسم"],
  company: ["Company", "الشركة"],
  job: ["Job title", "المسمى الوظيفي"],
  phone: ["Phone", "الهاتف"],
  mobile: ["Mobile", "الجوال"],
  work: ["Work", "العمل"],
  email: ["Email", "البريد الإلكتروني"],
  website: ["Website", "الموقع"],
  address: ["Address", "العنوان"],
  note: ["Note", "ملاحظة"],
  event: ["Event", "المناسبة"],
  starts: ["Starts", "البداية"],
  ends: ["Ends", "النهاية"],
  location: ["Location", "الموقع"],
  coordinates: ["Coordinates", "الإحداثيات"],
  link: ["Link", "الرابط"],
  to: ["To", "إلى"],
  subject: ["Subject", "الموضوع"],
  message: ["Message", "الرسالة"],
  number: ["Number", "الرقم"],
  amount: ["Amount", "المبلغ"],
  currency: ["Currency", "العملة"],
  addressWallet: ["Wallet address", "عنوان المحفظة"],
  upiId: ["UPI ID", "معرّف UPI"],
  payee: ["Payee", "المستفيد"],
  reference: ["Reference", "المرجع"],
  beneficiary: ["Beneficiary", "اسم المستفيد"],
  iban: ["IBAN", "رقم الآيبان"],
  content: ["Content", "المحتوى"],
  uri: ["Link / URI", "الرابط / URI"],
  platform: ["Platform", "المنصة"],
  username: ["Username", "اسم المستخدم"],
  page: ["Page", "الصفحة"],
  post: ["Post", "المنشور"],
  video: ["Video", "الفيديو"],
  channel: ["Channel", "القناة"],
  invite: ["Invite code", "رمز الدعوة"],
  walletCode: ["Wallet code", "رمز المحفظة"],
  accountNumber: ["Account number", "رقم الحساب"],
  identifier: ["Identifier", "المعرّف"],
} satisfies Record<string, Tx>;

const SECURITY: Record<string, Tx> = {
  WPA: ["WPA / WPA2 / WPA3", "WPA / WPA2 / WPA3"],
  WEP: ["WEP", "WEP"],
  nopass: ["No password", "بدون كلمة مرور"],
};

const YES: Tx = ["Yes", "نعم"];
const NO: Tx = ["No", "لا"];

/** Wi-Fi values escape `\ ; , : "` with a backslash (see `escWifi`). */
const unescWifi = (s: string) => s.replace(/\\([\\;,:"])/g, "$1");
const unescVcard = (s: string) => s.replace(/\\([\\;,:])/g, "$1").replace(/\\n/gi, "\n");

/** Split `WIFI:T:WPA;S:x;P:y;H:true;;` into its key/value pairs. */
function wifiParts(content: string): Record<string, string> {
  const body = content.replace(/^WIFI:/i, "");
  const out: Record<string, string> = {};
  // A `\` escapes the next character, so it may not end a value.
  for (const m of body.matchAll(/([A-Za-z]+):((?:\\.|[^;])*)(?:;|$)/g)) {
    out[m[1].toUpperCase()] = m[2];
  }
  return out;
}

/** Read one property out of a vCard, keeping every occurrence. */
function vcardProps(content: string, name: string): string[] {
  const out: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const m = new RegExp(`^${name}[^:]*:(.*)$`, "i").exec(line);
    if (m) out.push(unescVcard(m[1]));
  }
  return out.filter(Boolean);
}

/** `ADR;TYPE=WORK:;;street;;;;` → "street". */
function cleanAdr(v: string): string {
  return v
    .split(";")
    .map((p) => unescVcard(p).trim())
    .filter(Boolean)
    .join(", ");
}

/** 20260131T120000 / 20260131 → something a human can read. */
function prettyIcsDate(v: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(v.trim());
  if (!m) return v.trim();
  const [, y, mo, d, h, mi] = m;
  const date = `${y}/${mo}/${d}`;
  return h ? `${date} ${h}:${mi ?? "00"}` : date;
}

function queryOf(uri: string): URLSearchParams {
  const i = uri.indexOf("?");
  return new URLSearchParams(i < 0 ? "" : uri.slice(i + 1));
}

function wifiFields(content: string): ScanField[] {
  const p = wifiParts(content);
  const sec = (p.T || "WPA").toUpperCase();
  const fields: ScanField[] = [
    { label: L.network, value: unescWifi(p.S || ""), ltr: true },
  ];
  if (sec !== "NOPASS") {
    fields.push({ label: L.password, value: unescWifi(p.P || ""), secret: true, ltr: true });
  }
  fields.push({ label: L.security, valueTx: SECURITY[sec] ?? [sec, sec], ltr: true });
  fields.push({ label: L.hidden, valueTx: /^true$/i.test(p.H || "") ? YES : NO, ltr: true });
  return fields;
}

function vcardFields(content: string): ScanField[] {
  const out: ScanField[] = [];
  const name = vcardProps(content, "FN")[0] ?? vcardProps(content, "N")[0];
  if (name) out.push({ label: L.name, value: name });
  const org = vcardProps(content, "ORG")[0];
  if (org) out.push({ label: L.company, value: org });
  const title = vcardProps(content, "TITLE")[0];
  if (title) out.push({ label: L.job, value: title });
  const tels = vcardProps(content, "TEL");
  tels.forEach((tel, i) => out.push({ label: tels.length > 1 ? [`Phone ${i + 1}`, `هاتف ${i + 1}`] : L.phone, value: tel, ltr: true }));
  const emails = vcardProps(content, "EMAIL");
  emails.forEach((e, i) => out.push({ label: emails.length > 1 ? [`Email ${i + 1}`, `بريد ${i + 1}`] : L.email, value: e, ltr: true }));
  const url = vcardProps(content, "URL")[0];
  if (url) out.push({ label: L.website, value: url, ltr: true });
  const adr = vcardProps(content, "ADR")[0];
  if (adr && cleanAdr(adr)) out.push({ label: L.address, value: cleanAdr(adr) });
  const note = vcardProps(content, "NOTE")[0];
  if (note) out.push({ label: L.note, value: note, multiline: true });
  return out;
}

function eventFields(content: string): ScanField[] {
  const out: ScanField[] = [];
  const read = (k: string) => {
    const m = new RegExp(`^${k}[^:]*:(.*)$`, "mi").exec(content);
    return m ? m[1].trim() : "";
  };
  const title = read("SUMMARY");
  if (title) out.push({ label: L.event, value: title });
  const start = read("DTSTART");
  if (start) out.push({ label: L.starts, value: prettyIcsDate(start), ltr: true });
  const end = read("DTEND");
  if (end) out.push({ label: L.ends, value: prettyIcsDate(end), ltr: true });
  const loc = read("LOCATION");
  if (loc) out.push({ label: L.location, value: loc.replace(/\\n/g, " ") });
  const desc = read("DESCRIPTION");
  if (desc) out.push({ label: L.note, value: desc.replace(/\\n/g, " "), multiline: true });
  return out;
}

function emailFields(content: string): ScanField[] {
  // Two shapes: mailto:to?subject=… and MATMSG:TO:x;SUB:y;BODY:z;;
  if (/^MATMSG:/i.test(content)) {
    const out: ScanField[] = [];
    const get = (k: string) => {
      const m = new RegExp(`${k}:((?:\\\\.|[^;])*)(?:;|$)`, "i").exec(content);
      return m ? m[1].replace(/\\([\\;,:])/g, "$1") : "";
    };
    const to = get("TO");
    if (to) out.push({ label: L.to, value: to, ltr: true });
    const sub = get("SUB");
    if (sub) out.push({ label: L.subject, value: sub });
    const body = get("BODY");
    if (body) out.push({ label: L.message, value: body, multiline: true });
    return out;
  }
  const out: ScanField[] = [];
  const i = content.indexOf("?");
  const to = decodeURIComponent(content.slice(0, i < 0 ? undefined : i).replace(/^mailto:/i, ""));
  if (to) out.push({ label: L.to, value: to, ltr: true });
  const q = queryOf(content);
  const subject = q.get("subject");
  if (subject) out.push({ label: L.subject, value: subject });
  const body = q.get("body");
  if (body) out.push({ label: L.message, value: body, multiline: true });
  return out;
}

function smsFields(content: string): ScanField[] {
  // SMSTO:number:body   |   sms:number?body=text
  const m = /^(?:smsto|sms|mms):([^:?]*)(?::([\s\S]*))?$/i.exec(content.trim());
  if (!m) return [];
  const out: ScanField[] = [];
  if (m[1]) out.push({ label: L.number, value: m[1], ltr: true });
  const q = queryOf(content);
  const body = m[2] ?? q.get("body") ?? "";
  if (body) out.push({ label: L.message, value: body, multiline: true });
  return out;
}

function locationFields(content: string): ScanField[] {
  const m = /^geo:([^,;?]+),([^,;?]+)/i.exec(content.trim());
  if (!m) return [];
  return [{ label: L.coordinates, value: `${(+m[1]).toFixed(5)}, ${(+m[2]).toFixed(5)}`, ltr: true }];
}

function cryptoFields(content: string): ScanField[] {
  const m = /^([a-z]+):([^?]+)(\?([\s\S]*))?$/i.exec(content.trim());
  if (!m) return [];
  const out: ScanField[] = [{ label: L.addressWallet, value: m[2], ltr: true }];
  const q = queryOf(content);
  const amount = q.get("amount") ?? q.get("value");
  if (amount) out.push({ label: L.amount, value: amount, ltr: true });
  return out;
}

function upiFields(content: string): ScanField[] {
  const q = queryOf(content);
  const out: ScanField[] = [];
  const pa = q.get("pa");
  if (pa) out.push({ label: L.upiId, value: pa, ltr: true });
  const pn = q.get("pn");
  if (pn) out.push({ label: L.payee, value: pn, ltr: true });
  const am = q.get("am");
  if (am) out.push({ label: L.amount, value: am, ltr: true });
  const tn = q.get("tn");
  if (tn) out.push({ label: L.reference, value: tn });
  return out;
}

/** EPC QR: line-based, `BCD` then version, charset, id, name, iban, amount… */
function epcFields(content: string): ScanField[] {
  const lines = content.split(/\r?\n/);
  const at = (i: number) => (lines[i] ?? "").trim();
  const out: ScanField[] = [];
  if (at(4)) out.push({ label: L.beneficiary, value: at(4) });
  if (at(5)) out.push({ label: L.iban, value: at(5), ltr: true });
  const amount = at(6).replace(/^EUR/, "");
  if (amount) out.push({ label: L.amount, value: `${amount} ${at(7) || "EUR"}`, ltr: true });
  if (at(8)) out.push({ label: L.reference, value: at(8) });
  return out;
}

/**
 * Describe scanned content as an ordered list of fields.
 * Always returns at least one row, so the result view never looks empty.
 */
const firstSeg = (u: URL, i = 0) => u.pathname.split("/").filter(Boolean)[i] ?? "";
const decodeSeg = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

interface PlatformView {
  host: RegExp;
  name: Tx;
  /** the one thing on the page a person recognises, if there is one */
  pick?: (u: URL) => { label: Tx; value: string } | null;
}

/**
 * What a link actually is.
 *
 * Every scanned link used to become a single "Link / URI" row with the raw URL,
 * which is why a code that holds nothing but an address (Sham Cash) told you
 * nothing, and why a profile link looked like gibberish. Now the panel says what
 * you are looking at first, then the part of it that identifies someone, then
 * the link itself — the same three rows, in the same order, everywhere.
 */
const PLATFORMS: PlatformView[] = [
  {
    host: /(^|\.)(twitter|x)\.com$/i,
    name: ["X (Twitter)", "إكس (تويتر)"],
    pick: (u) => {
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.indexOf("status");
      if (i >= 0 && parts[i + 1]) return { label: L.post, value: parts[i + 1] };
      if (parts[0] && !["home", "explore", "search", "i", "settings", "messages", "notifications"].includes(parts[0].toLowerCase()))
        return { label: L.username, value: "@" + parts[0] };
      return null;
    },
  },
  {
    host: /(^|\.)instagram\.com$/i,
    name: ["Instagram", "إنستغرام"],
    pick: (u) => {
      const first = firstSeg(u);
      if (!first || ["p", "reel", "reels", "stories", "explore", "accounts", "tv"].includes(first.toLowerCase())) return null;
      return { label: L.username, value: "@" + first };
    },
  },
  {
    host: /(^|\.)tiktok\.com$/i,
    name: ["TikTok", "تيك توك"],
    pick: (u) => (firstSeg(u).startsWith("@") ? { label: L.username, value: firstSeg(u) } : null),
  },
  {
    host: /(^|\.)facebook\.com$/i,
    name: ["Facebook", "فيسبوك"],
    pick: (u) => (firstSeg(u) ? { label: L.page, value: firstSeg(u) } : null),
  },
  {
    host: /(^|\.)snapchat\.com$/i,
    name: ["Snapchat", "سناب شات"],
    pick: (u) => {
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.indexOf("add");
      return i >= 0 && parts[i + 1] ? { label: L.username, value: "@" + parts[i + 1] } : null;
    },
  },
  {
    host: /(^|\.)(t|telegram)\.me$/i,
    name: ["Telegram", "تيليجرام"],
    pick: (u) => {
      const first = firstSeg(u);
      if (!first) return null;
      if (first.toLowerCase() === "joinchat") return { label: L.invite, value: decodeSeg(firstSeg(u, 1)) };
      return { label: L.username, value: "@" + first };
    },
  },
  {
    host: /(^|\.)(youtube\.com|youtu\.be)$/i,
    name: ["YouTube", "يوتيوب"],
    pick: (u) => {
      const id = u.searchParams.get("v") ?? (u.hostname.endsWith("youtu.be") ? firstSeg(u) : u.pathname.startsWith("/shorts/") ? firstSeg(u, 1) : "");
      if (id) return { label: L.video, value: id };
      const handle = firstSeg(u);
      return handle.startsWith("@") ? { label: L.channel, value: handle } : null;
    },
  },
  {
    host: /(^|\.)linkedin\.com$/i,
    name: ["LinkedIn", "لينكدإن"],
    pick: (u) => {
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.findIndex((p) => p === "in" || p === "company");
      const slug = i >= 0 ? parts[i + 1] : parts[0];
      return slug ? { label: L.username, value: decodeSeg(slug) } : null;
    },
  },
  {
    host: /(^|\.)pinterest\.com$/i,
    name: ["Pinterest", "بنترست"],
    pick: (u) => (firstSeg(u) ? { label: L.username, value: "@" + firstSeg(u) } : null),
  },
  {
    host: /(^|\.)threads\.net$/i,
    name: ["Threads", "ثريدز"],
    pick: (u) => (firstSeg(u) ? { label: L.username, value: "@" + firstSeg(u).replace(/^@/, "") } : null),
  },
  {
    host: /(^|\.)discord\.(gg|com)$/i,
    name: ["Discord", "ديسكورد"],
    pick: (u) => (firstSeg(u) ? { label: L.invite, value: firstSeg(u) } : null),
  },
  {
    host: /(^|\.)(wa\.me|whatsapp\.com|api\.whatsapp\.com)$/i,
    name: ["WhatsApp", "واتساب"],
    pick: (u) => {
      const phone = (u.searchParams.get("phone") ?? "").replace(/\D/g, "") || (u.hostname === "wa.me" ? firstSeg(u).replace(/\D/g, "") : "");
      return phone ? { label: L.number, value: "+" + phone } : null;
    },
  },
  { host: /(^|\.)open\.spotify\.com$/i, name: ["Spotify", "سبوتيفاي"] },
  { host: /(^|\.)soundcloud\.com$/i, name: ["SoundCloud", "ساوند كلاود"] },
  { host: /(^|\.)vimeo\.com$/i, name: ["Vimeo", "فيميو"] },
  { host: /(^|\.)paypal\.(com|me)$/i, name: ["PayPal", "باي بال"] },
];

const SHAMCASH_CODE = /^[A-Za-z0-9]{32}$/;

/** Rows for a Sham Cash code: the address is the whole payload. */
function shamcashFields(s: string): ScanField[] {
  const code = s.trim();
  const fields: ScanField[] = [{ label: L.platform, valueTx: ["Sham Cash", "شام كاش"] }];
  if (SHAMCASH_CODE.test(code)) fields.push({ label: L.walletCode, value: code, ltr: true });
  else if (/^\d{16}$/.test(code)) fields.push({ label: L.accountNumber, value: code, ltr: true });
  else fields.push({ label: L.identifier, value: code, ltr: true });
  return fields;
}

/** Rows for anything that is a link: what it is, who it points at, the link. */
function linkFields(s: string): ScanField[] {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return [];
  }
  const view = PLATFORMS.find((p) => p.host.test(u.hostname));
  const fields: ScanField[] = [];
  if (view) {
    fields.push({ label: L.platform, valueTx: view.name });
    const picked = view.pick?.(u) ?? null;
    if (picked?.value) fields.push({ label: picked.label, value: picked.value, ltr: true });
  } else {
    fields.push({ label: L.platform, value: u.hostname.replace(/^www\./i, ""), ltr: true });
  }
  fields.push({ label: L.link, value: s, ltr: true, multiline: true });
  return fields;
}

export function describeScan(content: string, typeId: string): ScanField[] {
  const s = (content ?? "").trim();
  if (!s) return [{ label: L.content, value: "", multiline: true }];

  let fields: ScanField[] = [];
  try {
    switch (typeId) {
      case "wifi":
        fields = wifiFields(s);
        break;
      case "vcard":
      case "contact":
        fields = vcardFields(s);
        break;
      case "event":
        fields = eventFields(s);
        break;
      case "email":
        fields = emailFields(s);
        break;
      case "phone":
        fields = [{ label: L.number, value: s.replace(/^tel:/i, ""), ltr: true }];
        break;
      case "sms":
        fields = smsFields(s);
        break;
      case "location":
        fields = locationFields(s);
        break;
      case "crypto":
        fields = cryptoFields(s);
        break;
      case "upi":
        fields = upiFields(s);
        break;
      case "epc":
        fields = epcFields(s);
        break;
      case "shamcash":
        fields = shamcashFields(s);
        break;
      default:
        fields = [];
    }
  } catch {
    fields = [];
  }

  // A link is the one kind of content with something to say about itself, so it
  // gets real rows instead of the raw string.
  if (!fields.length && /^https?:\/\//i.test(s)) fields = linkFields(s);

  // Nothing parsed (or the type has no structure): show it as content, so the
  // layout is identical for every type.
  if (!fields.length) {
    fields = [
      {
        label: /^(https?|mailto|tel):/i.test(s) || /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? L.uri : L.content,
        value: s,
        ltr: true,
        multiline: true,
      },
    ];
  }
  return fields;
}

/** Does this scan contain something that should stay hidden until asked? */
export function hasSecretField(fields: ScanField[]): boolean {
  return fields.some((f) => f.secret && (f.value || "").length > 0);
}
