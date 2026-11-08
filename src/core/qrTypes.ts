import type { FieldDef, FormValues, QrCategoryId, QrTypeDef, Tx } from "./types";

// ---------- Helpers ----------
const E = {
  required: ["This field is required", "هذا الحقل مطلوب"] as Tx,
  url: ["Enter a valid link (https://…)", "أدخل رابطاً صحيحاً (https://…)"] as Tx,
  httpsOnly: ["Only http/https links are allowed", "يُسمح بروابط http/https فقط"] as Tx,
  phone: ["Enter a valid phone number (with country code)", "أدخل رقم هاتف صحيحاً (مع رمز الدولة)"] as Tx,
  email: ["Enter a valid email address", "أدخل بريداً إلكترونياً صحيحاً"] as Tx,
  user: ["Invalid username format for this platform", "صيغة اسم المستخدم غير صحيحة لهذه المنصة"] as Tx,
  long: ["Text is too long", "النص طويل جداً"] as Tx,
  number: ["Enter a valid number", "أدخل رقماً صحيحاً"] as Tx,
  blocked: ["This link scheme is not allowed for safety", "نوع الرابط هذا غير مسموح لأسباب أمنية"] as Tx,
  host: ["The link must belong to the selected service", "يجب أن يتبع الرابط الخدمة المحددة"] as Tx,
};

const BLOCKED_SCHEMES = ["javascript", "data", "vbscript", "file", "blob", "about", "chrome", "view-source"];

export const trim = (v: FormValues, k: string) => (v[k] ?? "").trim();

export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/\s]+:\d+(\/|$)/.test(s)) return s;
  return "https://" + s.replace(/^\/\//, "");
}

export function parseHttpUrl(input: string): URL | null {
  try {
    const u = new URL(normalizeUrl(input));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u;
  } catch {
    return null;
  }
}

const digitsOf = (s: string) => s.replace(/\D/g, "");
const isPhone = (s: string) => /^\+?[0-9\s\-().]{5,22}$/.test(s) && digitsOf(s).length >= 5 && digitsOf(s).length <= 15;
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
const cleanPhone = (s: string) => (s.trim().startsWith("+") ? "+" : "") + digitsOf(s);

/** Extract a handle from "@name", "name" or a profile URL. */
export function handleOf(input: string): string {
  let s = input.trim();
  if (/^(https?:\/\/|www\.)/i.test(s) || /[a-z0-9-]+\.[a-z]{2,}\//i.test(s)) {
    try {
      const u = new URL(normalizeUrl(s));
      const seg = u.pathname.split("/").filter(Boolean);
      s = seg.length ? seg[seg.length - 1] : "";
    } catch {
      /* keep raw */
    }
  }
  return s.replace(/^@+/, "").replace(/\/+$/, "");
}

const escVcard = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const escWifi = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");

function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const re = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const val = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of val) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

// ---------- Field factories ----------
const f = (key: string, kind: FieldDef["kind"], label: Tx, extra: Partial<FieldDef> = {}): FieldDef => ({ key, kind, label, ...extra });
const visible = (fields: FieldDef[], v: FormValues) => fields.filter((fd) => !fd.showIf || fd.showIf[1].includes(v[fd.showIf[0]] ?? ""));

/** Generic validation: required + maxLength + kind checks, only for visible fields. */
function baseValidate(fields: FieldDef[], v: FormValues): Record<string, Tx> {
  const errs: Record<string, Tx> = {};
  for (const fd of visible(fields, v)) {
    const val = (v[fd.key] ?? "").trim();
    if (!val) {
      if (fd.required) errs[fd.key] = E.required;
      continue;
    }
    if (fd.maxLength && val.length > fd.maxLength) errs[fd.key] = E.long;
    else if (fd.kind === "tel" && !isPhone(val)) errs[fd.key] = E.phone;
    else if (fd.kind === "email" && !isEmail(val)) errs[fd.key] = E.email;
    else if (fd.kind === "url" && !parseHttpUrl(val)) errs[fd.key] = E.url;
    else if (fd.kind === "number" && !isFinite(Number(val))) errs[fd.key] = E.number;
  }
  return errs;
}

function def(
  id: string,
  category: QrCategoryId | "hidden",
  title: Tx,
  desc: Tx,
  icon: string,
  fields: FieldDef[],
  build: (v: FormValues) => string,
  extraValidate?: (v: FormValues, errs: Record<string, Tx>) => void,
  sensitive = false,
): QrTypeDef {
  return {
    id,
    category,
    title,
    desc,
    icon,
    fields,
    build,
    sensitive,
    validate: (v) => {
      const errs = baseValidate(fields, v);
      if (extraValidate) extraValidate(v, errs);
      return errs;
    },
  };
}

// ---------- Social platforms ----------
interface HandleSpec {
  id: string;
  title: Tx;
  desc: Tx;
  re: RegExp;
  url: (h: string) => string;
  placeholder: string;
  hint: Tx;
}

const HANDLE_PLATFORMS: HandleSpec[] = [
  { id: "instagram", title: ["Instagram", "إنستغرام"], desc: ["Open your profile", "افتح حسابك الشخصي"], re: /^[A-Za-z0-9._]{1,30}$/, url: (h) => `https://www.instagram.com/${h}/`, placeholder: "username", hint: ["Letters, numbers, dots and underscores", "حروف وأرقام ونقاط وشرطة سفلية"] },
  { id: "facebook", title: ["Facebook", "فيسبوك"], desc: ["Page or profile", "صفحة أو حساب"], re: /^[A-Za-z0-9.\-]{5,50}$/, url: (h) => `https://www.facebook.com/${h}`, placeholder: "page.name", hint: ["Page username (5+ characters) or profile link", "اسم الصفحة (5 أحرف فأكثر) أو رابط الحساب"] },
  { id: "tiktok", title: ["TikTok", "تيك توك"], desc: ["Open your account", "افتح حسابك"], re: /^[A-Za-z0-9._]{2,24}$/, url: (h) => `https://www.tiktok.com/@${h}`, placeholder: "username", hint: ["2–24 characters", "من 2 إلى 24 حرفاً"] },
  { id: "x", title: ["X (Twitter)", "إكس (تويتر)"], desc: ["Open your profile", "افتح حسابك"], re: /^[A-Za-z0-9_]{1,15}$/, url: (h) => `https://x.com/${h}`, placeholder: "username", hint: ["Up to 15 letters, numbers or _", "حتى 15 حرفاً أو رقماً أو _"] },
  { id: "snapchat", title: ["Snapchat", "سناب شات"], desc: ["Add friend link", "رابط إضافة صديق"], re: /^[A-Za-z][A-Za-z0-9._-]{2,14}$/, url: (h) => `https://www.snapchat.com/add/${h}`, placeholder: "username", hint: ["3–15 characters, starts with a letter", "من 3 إلى 15 حرفاً ويبدأ بحرف"] },
  { id: "telegram", title: ["Telegram", "تيليجرام"], desc: ["User, group or channel", "مستخدم أو مجموعة أو قناة"], re: /^[A-Za-z][A-Za-z0-9_]{4,31}$/, url: (h) => `https://t.me/${h}`, placeholder: "username", hint: ["5–32 characters", "من 5 إلى 32 حرفاً"] },
  { id: "pinterest", title: ["Pinterest", "بنترست"], desc: ["Open your profile", "افتح حسابك"], re: /^[A-Za-z0-9_]{3,30}$/, url: (h) => `https://www.pinterest.com/${h}/`, placeholder: "username", hint: ["3–30 characters", "من 3 إلى 30 حرفاً"] },
  { id: "threads", title: ["Threads", "ثريدز"], desc: ["Open your profile", "افتح حسابك"], re: /^[A-Za-z0-9._]{1,30}$/, url: (h) => `https://www.threads.net/@${h}`, placeholder: "username", hint: ["Same as your Instagram name", "مثل اسمك في إنستغرام"] },
  { id: "discord", title: ["Discord", "ديسكورد"], desc: ["Server invite", "دعوة إلى خادم"], re: /^[A-Za-z0-9-]{2,32}$/, url: (h) => `https://discord.gg/${h}`, placeholder: "invite-code", hint: ["Invite code or discord.gg link", "رمز الدعوة أو رابط discord.gg"] },
];

const handleTypes: QrTypeDef[] = HANDLE_PLATFORMS.map((p) => {
  const fields = [f("handle", "text", ["Username", "اسم المستخدم"], { required: true, placeholder: p.placeholder, prefix: p.id === "discord" ? "" : "@", hint: p.hint, dir: "ltr", maxLength: 200 })];
  return def(p.id, "social", p.title, p.desc, p.id, fields, (v) => p.url(handleOf(trim(v, "handle"))), (v, errs) => {
    const h = handleOf(trim(v, "handle"));
    if (h && !p.re.test(h)) errs.handle = E.user;
  });
});

const whatsapp = def(
  "whatsapp", "social", ["WhatsApp", "واتساب"], ["Chat with a ready message", "محادثة مباشرة برسالة جاهزة"], "whatsapp",
  [
    f("phone", "tel", ["Phone number", "رقم الهاتف"], { required: true, placeholder: "+966 5x xxx xxxx", hint: ["Include the country code", "أدخل رمز الدولة"], dir: "ltr" }),
    f("message", "textarea", ["Message (optional)", "الرسالة (اختياري)"], { maxLength: 500 }),
  ],
  (v) => `https://wa.me/${digitsOf(trim(v, "phone"))}${trim(v, "message") ? "?text=" + encodeURIComponent(trim(v, "message")) : ""}`,
);

const youtube = def(
  "youtube", "social", ["YouTube", "يوتيوب"], ["Channel, video or playlist", "قناة أو فيديو أو قائمة تشغيل"], "youtube",
  [f("link", "text", ["Channel @handle or link", "معرّف القناة @ أو الرابط"], { required: true, placeholder: "@channel  |  https://youtu.be/…", dir: "ltr", maxLength: 500 })],
  (v) => {
    const s = trim(v, "link");
    return /^[a-z]+:\/\//i.test(s) || /^(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/i.test(s) ? normalizeUrl(s) : `https://www.youtube.com/@${s.replace(/^@/, "")}`;
  },
  (v, errs) => {
    const s = trim(v, "link");
    if (!s) return;
    if (/^[a-z]+:\/\//i.test(s) || /\./.test(s)) {
      const u = parseHttpUrl(s);
      if (!u || !/(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname)) errs.link = E.host;
    } else if (!/^@?[A-Za-z0-9._-]{3,30}$/.test(s)) errs.link = E.user;
  },
);

const linkedin = def(
  "linkedin", "social", ["LinkedIn", "لينكدإن"], ["Profile or company page", "حساب شخصي أو صفحة شركة"], "linkedin",
  [
    f("kind", "select", ["Account type", "نوع الحساب"], { options: [{ value: "in", label: ["Personal profile", "حساب شخصي"] }, { value: "company", label: ["Company page", "صفحة شركة"] }], defaultValue: "in" }),
    f("slug", "text", ["Profile name or link", "اسم الحساب أو الرابط"], { required: true, placeholder: "john-smith", dir: "ltr", maxLength: 300 }),
  ],
  (v) => `https://www.linkedin.com/${trim(v, "kind") === "company" ? "company" : "in"}/${handleOf(trim(v, "slug"))}`,
  (v, errs) => {
    const h = handleOf(trim(v, "slug"));
    if (h && !/^[A-Za-z0-9\-_%.\u00C0-\u024F]{3,100}$/.test(h)) errs.slug = E.user;
  },
);

// ---------- Links ----------
const urlType = def(
  "url", "links", ["Website", "موقع إلكتروني"], ["Link to any web page", "رابط لأي صفحة ويب"], "globe",
  [f("url", "url", ["Website link", "رابط الموقع"], { required: true, placeholder: "https://example.com", dir: "ltr", maxLength: 2000 })],
  (v) => parseHttpUrl(trim(v, "url"))?.href ?? normalizeUrl(trim(v, "url")),
);

const customLink = def(
  "custom", "links", ["Custom link", "رابط مخصص"], ["Any link or app scheme", "أي رابط أو بروتوكول تطبيق"], "link",
  [f("link", "text", ["Link / URI", "الرابط / URI"], { required: true, placeholder: "https://… | myapp://open", dir: "ltr", maxLength: 2000 })],
  (v) => normalizeUrl(trim(v, "link")),
  (v, errs) => {
    const s = trim(v, "link");
    if (!s) return;
    const n = normalizeUrl(s);
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(n);
    if (!m) errs.link = E.url;
    else if (BLOCKED_SCHEMES.includes(m[1].toLowerCase())) errs.link = E.blocked;
    else if (/^https?$/i.test(m[1]) && !parseHttpUrl(n)) errs.link = E.url;
  },
);

const appLink = def(
  "app", "links", ["App link", "رابط تطبيق"], ["Google Play or App Store", "متجر Google Play أو App Store"], "appstore",
  [
    f("store", "select", ["Store", "المتجر"], { options: [{ value: "android", label: ["Google Play (Android)", "Google Play (أندرويد)"] }, { value: "ios", label: ["App Store (iOS)", "App Store (آيفون)"] }, { value: "other", label: ["Other link", "رابط آخر"] }], defaultValue: "android" }),
    f("pkg", "text", ["Package name", "اسم الحزمة"], { required: true, placeholder: "com.company.app", dir: "ltr", showIf: ["store", ["android"]], maxLength: 200 }),
    f("iosId", "text", ["App ID (numbers)", "معرّف التطبيق (أرقام)"], { required: true, placeholder: "123456789", dir: "ltr", showIf: ["store", ["ios"]], maxLength: 20 }),
    f("url", "url", ["App link", "رابط التطبيق"], { required: true, placeholder: "https://…", dir: "ltr", showIf: ["store", ["other"]], maxLength: 2000 }),
  ],
  (v) => {
    const s = trim(v, "store");
    if (s === "ios") return `https://apps.apple.com/app/id${digitsOf(trim(v, "iosId"))}`;
    if (s === "other") return parseHttpUrl(trim(v, "url"))?.href ?? trim(v, "url");
    return `https://play.google.com/store/apps/details?id=${encodeURIComponent(trim(v, "pkg"))}`;
  },
  (v, errs) => {
    const s = trim(v, "store") || "android";
    if (s === "android" && trim(v, "pkg") && !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(trim(v, "pkg"))) errs.pkg = ["Invalid package name (e.g. com.company.app)", "اسم حزمة غير صحيح (مثال: com.company.app)"];
    if (s === "ios" && trim(v, "iosId") && !/^\d{5,15}$/.test(trim(v, "iosId"))) errs.iosId = E.number;
  },
);

const location = def(
  "location", "links", ["Location (GPS)", "موقع جغرافي (GPS)"], ["Coordinates that open maps", "إحداثيات تفتح الخريطة"], "googlemaps",
  [
    f("lat", "number", ["Latitude", "خط العرض"], { required: true, placeholder: "24.7136", half: true, dir: "ltr" }),
    f("lng", "number", ["Longitude", "خط الطول"], { required: true, placeholder: "46.6753", half: true, dir: "ltr" }),
    f("format", "select", ["Format", "الصيغة"], { options: [{ value: "geo", label: ["geo: (any maps app)", "geo: (أي تطبيق خرائط)"] }, { value: "gmaps", label: ["Google Maps link", "رابط Google Maps"] }], defaultValue: "geo" }),
  ],
  (v) => (trim(v, "format") === "gmaps" ? `https://www.google.com/maps?q=${trim(v, "lat")},${trim(v, "lng")}` : `geo:${trim(v, "lat")},${trim(v, "lng")}`),
  (v, errs) => {
    const la = Number(trim(v, "lat"));
    const lo = Number(trim(v, "lng"));
    if (trim(v, "lat") && !(la >= -90 && la <= 90)) errs.lat = ["Latitude must be between -90 and 90", "خط العرض بين -90 و 90"];
    if (trim(v, "lng") && !(lo >= -180 && lo <= 180)) errs.lng = ["Longitude must be between -180 and 180", "خط الطول بين -180 و 180"];
  },
);

// ---------- Business ----------
function vcardOf(v: FormValues): string {
  const first = trim(v, "first");
  const last = trim(v, "last");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${escVcard(last)};${escVcard(first)};;;`, `FN:${escVcard((first + " " + last).trim())}`];
  if (trim(v, "org")) lines.push(`ORG:${escVcard(trim(v, "org"))}`);
  if (trim(v, "job")) lines.push(`TITLE:${escVcard(trim(v, "job"))}`);
  if (trim(v, "phone")) lines.push(`TEL;TYPE=CELL:${cleanPhone(trim(v, "phone"))}`);
  if (trim(v, "work")) lines.push(`TEL;TYPE=WORK:${cleanPhone(trim(v, "work"))}`);
  if (trim(v, "email")) lines.push(`EMAIL:${trim(v, "email")}`);
  if (trim(v, "website")) lines.push(`URL:${normalizeUrl(trim(v, "website"))}`);
  if (trim(v, "address")) lines.push(`ADR;TYPE=WORK:;;${escVcard(trim(v, "address"))};;;;`);
  if (trim(v, "note")) lines.push(`NOTE:${escVcard(trim(v, "note"))}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

const nameFields = [
  f("first", "text", ["First name", "الاسم الأول"], { required: true, half: true, maxLength: 60 }),
  f("last", "text", ["Last name", "اسم العائلة"], { half: true, maxLength: 60 }),
];

const vcard = def(
  "vcard", "business", ["Business card", "بطاقة أعمال"], ["vCard with company and title", "بطاقة اتصال بالشركة والمسمى"], "briefcase",
  [
    ...nameFields,
    f("org", "text", ["Company", "الشركة"], { half: true, maxLength: 100 }),
    f("job", "text", ["Job title", "المسمى الوظيفي"], { half: true, maxLength: 100 }),
    f("phone", "tel", ["Mobile", "الجوال"], { half: true, dir: "ltr" }),
    f("work", "tel", ["Work phone", "هاتف العمل"], { half: true, dir: "ltr" }),
    f("email", "email", ["Email", "البريد الإلكتروني"], { dir: "ltr" }),
    f("website", "url", ["Website", "الموقع"], { dir: "ltr", placeholder: "https://" }),
    f("address", "text", ["Address", "العنوان"], { maxLength: 200 }),
    f("note", "textarea", ["Note", "ملاحظة"], { maxLength: 300 }),
  ],
  vcardOf,
);

const fmtDt = (s: string) => s.replace(/[-:]/g, "").replace("T", "T").slice(0, 15).padEnd(15, "0");
const event = def(
  "event", "business", ["Calendar event", "موعد في التقويم"], ["Adds an event to the calendar", "يضيف موعداً إلى التقويم"], "calendar",
  [
    f("title", "text", ["Event title", "عنوان الموعد"], { required: true, maxLength: 120 }),
    f("start", "datetime", ["Starts", "البداية"], { required: true, half: true }),
    f("end", "datetime", ["Ends", "النهاية"], { required: true, half: true }),
    f("where", "text", ["Location", "المكان"], { maxLength: 150 }),
    f("desc", "textarea", ["Description", "الوصف"], { maxLength: 400 }),
  ],
  (v) => {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `SUMMARY:${escVcard(trim(v, "title"))}`, `DTSTART:${fmtDt(trim(v, "start"))}`, `DTEND:${fmtDt(trim(v, "end"))}`];
    if (trim(v, "where")) lines.push(`LOCATION:${escVcard(trim(v, "where"))}`);
    if (trim(v, "desc")) lines.push(`DESCRIPTION:${escVcard(trim(v, "desc"))}`);
    lines.push("END:VEVENT", "END:VCALENDAR");
    return lines.join("\n");
  },
  (v, errs) => {
    if (trim(v, "start") && trim(v, "end") && trim(v, "end") <= trim(v, "start")) errs.end = ["End must be after the start", "يجب أن تكون النهاية بعد البداية"];
  },
);

const product = def(
  "product", "business", ["Product info", "معلومات منتج"], ["Name, price, code and link", "الاسم والسعر والرمز والرابط"], "package",
  [
    f("name", "text", ["Product name", "اسم المنتج"], { required: true, maxLength: 120 }),
    f("price", "number", ["Price", "السعر"], { half: true, dir: "ltr" }),
    f("currency", "text", ["Currency", "العملة"], { half: true, placeholder: "USD", maxLength: 6, dir: "ltr" }),
    f("sku", "text", ["SKU / code", "رمز المنتج"], { maxLength: 60, dir: "ltr" }),
    f("url", "url", ["Product page", "صفحة المنتج"], { dir: "ltr", placeholder: "https://" }),
    f("desc", "textarea", ["Description", "الوصف"], { maxLength: 400 }),
  ],
  (v) => {
    const l = [trim(v, "name")];
    if (trim(v, "price")) l.push(`${trim(v, "price")} ${trim(v, "currency")}`.trim());
    if (trim(v, "sku")) l.push(`SKU: ${trim(v, "sku")}`);
    if (trim(v, "desc")) l.push(trim(v, "desc"));
    if (trim(v, "url")) l.push(normalizeUrl(trim(v, "url")));
    return l.join("\n");
  },
);

// ---------- Telecom ----------
const phone = def(
  "phone", "telecom", ["Phone call", "اتصال هاتفي"], ["Dial a number instantly", "اتصل برقم مباشرة"], "phone",
  [f("phone", "tel", ["Phone number", "رقم الهاتف"], { required: true, placeholder: "+966 5x xxx xxxx", dir: "ltr" })],
  (v) => `tel:${cleanPhone(trim(v, "phone"))}`,
);

const sms = def(
  "sms", "telecom", ["SMS message", "رسالة SMS"], ["Pre-filled text message", "رسالة نصية جاهزة"], "message-square",
  [
    f("phone", "tel", ["Phone number", "رقم الهاتف"], { required: true, dir: "ltr" }),
    f("message", "textarea", ["Message", "الرسالة"], { maxLength: 500 }),
  ],
  (v) => `SMSTO:${cleanPhone(trim(v, "phone"))}:${trim(v, "message")}`,
);

const email = def(
  "email", "telecom", ["Email", "بريد إلكتروني"], ["Compose a ready email", "إنشاء رسالة بريد جاهزة"], "mail",
  [
    f("to", "email", ["Recipient", "المستلم"], { required: true, dir: "ltr" }),
    f("subject", "text", ["Subject", "الموضوع"], { maxLength: 150 }),
    f("body", "textarea", ["Message", "نص الرسالة"], { maxLength: 800 }),
  ],
  (v) => {
    const q: string[] = [];
    if (trim(v, "subject")) q.push("subject=" + encodeURIComponent(trim(v, "subject")));
    if (trim(v, "body")) q.push("body=" + encodeURIComponent(trim(v, "body")));
    return `mailto:${trim(v, "to")}${q.length ? "?" + q.join("&") : ""}`;
  },
);

// ---------- Network ----------
const wifi = def(
  "wifi", "network", ["Wi-Fi", "شبكة Wi-Fi"], ["Join a network by scanning", "الاتصال بالشبكة بالمسح"], "wifi",
  [
    f("ssid", "text", ["Network name (SSID)", "اسم الشبكة (SSID)"], { required: true, maxLength: 32 }),
    f("security", "select", ["Security", "الحماية"], { options: [{ value: "WPA", label: ["WPA/WPA2/WPA3", "WPA/WPA2/WPA3"] }, { value: "WEP", label: ["WEP", "WEP"] }, { value: "nopass", label: ["No password", "بدون كلمة مرور"] }], defaultValue: "WPA" }),
    f("password", "password", ["Password", "كلمة المرور"], { showIf: ["security", ["WPA", "WEP"]], maxLength: 63, required: true }),
    f("hidden", "checkbox", ["Hidden network", "شبكة مخفية"]),
  ],
  (v) => {
    const sec = trim(v, "security") || "WPA";
    return `WIFI:T:${sec};S:${escWifi(trim(v, "ssid"))};${sec === "nopass" ? "" : `P:${escWifi(v.password ?? "")};`}${v.hidden === "1" ? "H:true;" : ""};`;
  },
  (v, errs) => {
    const sec = trim(v, "security") || "WPA";
    const pw = v.password ?? "";
    if (sec === "WPA" && pw && (pw.length < 8 || pw.length > 63)) errs.password = ["WPA password must be 8–63 characters", "كلمة مرور WPA من 8 إلى 63 حرفاً"];
  },
  true,
);

// ---------- Personal ----------
const contact = def(
  "contact", "personal", ["Contact details", "بيانات اتصال شخصية"], ["Save you as a contact", "حفظك كجهة اتصال"], "user",
  [
    ...nameFields,
    f("phone", "tel", ["Mobile", "الجوال"], { dir: "ltr" }),
    f("email", "email", ["Email", "البريد الإلكتروني"], { dir: "ltr" }),
    f("address", "text", ["Address", "العنوان"], { maxLength: 200 }),
  ],
  vcardOf,
);

const text = def(
  "text", "personal", ["Plain text", "نص عادي"], ["Any text, Arabic supported", "أي نص مع دعم العربية"], "type",
  [f("text", "textarea", ["Text", "النص"], { required: true, maxLength: 1500, hint: ["Long text creates a denser code", "النص الطويل ينتج رمزاً أكثر كثافة"] })],
  (v) => trim(v, "text"),
);

const multitext = def(
  "multitext", "personal", ["Multilingual text", "نص متعدد اللغات"], ["Arabic, English and more", "عربي وإنجليزي وغيرهما"], "languages",
  [
    f("ar", "textarea", ["Arabic", "العربية"], { maxLength: 500 }),
    f("en", "textarea", ["English", "الإنجليزية"], { maxLength: 500, dir: "ltr" }),
    f("other", "textarea", ["Other language", "لغة أخرى"], { maxLength: 500 }),
  ],
  (v) => [trim(v, "ar"), trim(v, "en"), trim(v, "other")].filter(Boolean).join("\n\n"),
  (v, errs) => {
    if (!trim(v, "ar") && !trim(v, "en") && !trim(v, "other")) errs.ar = E.required;
  },
);

// ---------- Payment ----------
const paypal = def(
  "paypal", "payment", ["PayPal", "باي بال"], ["PayPal.me payment link", "رابط دفع PayPal.me"], "paypal",
  [
    f("user", "text", ["PayPal.me name", "اسم PayPal.me"], { required: true, dir: "ltr", maxLength: 40 }),
    f("amount", "number", ["Amount (optional)", "المبلغ (اختياري)"], { half: true, dir: "ltr" }),
    f("currency", "select", ["Currency", "العملة"], { half: true, defaultValue: "USD", options: ["USD", "EUR", "GBP", "SAR", "AED", "CAD", "AUD"].map((c) => ({ value: c, label: [c, c] as Tx })) }),
  ],
  (v) => `https://www.paypal.me/${handleOf(trim(v, "user"))}${trim(v, "amount") ? "/" + trim(v, "amount") + (trim(v, "currency") || "USD") : ""}`,
  (v, errs) => {
    const h = handleOf(trim(v, "user"));
    if (h && !/^[A-Za-z0-9]{1,20}$/.test(h)) errs.user = E.user;
    if (trim(v, "amount") && Number(trim(v, "amount")) <= 0) errs.amount = E.number;
  },
);

const CRYPTO_RE: Record<string, RegExp> = {
  bitcoin: /^(bc1[a-z0-9]{20,80}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/,
  litecoin: /^(ltc1[a-z0-9]{20,80}|[LM3][a-km-zA-HJ-NP-Z1-9]{25,39})$/,
  ethereum: /^0x[a-fA-F0-9]{40}$/,
};
const crypto = def(
  "crypto", "payment", ["Crypto wallet", "محفظة عملات رقمية"], ["Bitcoin, Litecoin, Ethereum", "بيتكوين ولايتكوين وإيثيريوم"], "bitcoin",
  [
    f("coin", "select", ["Coin", "العملة"], { defaultValue: "bitcoin", options: [{ value: "bitcoin", label: ["Bitcoin", "بيتكوين"] }, { value: "litecoin", label: ["Litecoin", "لايتكوين"] }, { value: "ethereum", label: ["Ethereum", "إيثيريوم"] }] }),
    f("address", "text", ["Wallet address", "عنوان المحفظة"], { required: true, dir: "ltr", maxLength: 100 }),
    f("amount", "number", ["Amount (optional)", "المبلغ (اختياري)"], { dir: "ltr", showIf: ["coin", ["bitcoin", "litecoin"]] }),
  ],
  (v) => `${trim(v, "coin") || "bitcoin"}:${trim(v, "address")}${trim(v, "amount") && trim(v, "coin") !== "ethereum" ? "?amount=" + trim(v, "amount") : ""}`,
  (v, errs) => {
    const coin = trim(v, "coin") || "bitcoin";
    if (trim(v, "address") && !CRYPTO_RE[coin].test(trim(v, "address"))) errs.address = ["Invalid wallet address for this coin", "عنوان المحفظة غير صالح لهذه العملة"];
  },
);

const epc = def(
  "epc", "payment", ["SEPA transfer", "تحويل SEPA"], ["Bank transfer in euros (EPC)", "تحويل بنكي باليورو (EPC)"], "landmark",
  [
    f("name", "text", ["Beneficiary", "اسم المستفيد"], { required: true, maxLength: 70 }),
    f("iban", "text", ["IBAN", "IBAN"], { required: true, dir: "ltr", maxLength: 42 }),
    f("bic", "text", ["BIC (optional)", "BIC (اختياري)"], { half: true, dir: "ltr", maxLength: 11 }),
    f("amount", "number", ["Amount (EUR)", "المبلغ (يورو)"], { half: true, dir: "ltr" }),
    f("ref", "text", ["Reference", "المرجع"], { maxLength: 140 }),
  ],
  (v) => ["BCD", "002", "1", "SCT", trim(v, "bic"), trim(v, "name"), trim(v, "iban").replace(/\s+/g, "").toUpperCase(), trim(v, "amount") ? "EUR" + Number(trim(v, "amount")).toFixed(2) : "", "", "", trim(v, "ref")].join("\n"),
  (v, errs) => {
    if (trim(v, "iban") && !ibanValid(trim(v, "iban"))) errs.iban = ["Invalid IBAN", "رقم IBAN غير صحيح"];
    if (trim(v, "amount") && Number(trim(v, "amount")) <= 0) errs.amount = E.number;
  },
  true,
);

const upi = def(
  "upi", "payment", ["UPI payment", "دفع UPI"], ["Instant payment (India)", "دفع فوري (الهند)"], "banknote",
  [
    f("pa", "text", ["UPI ID", "معرّف UPI"], { required: true, placeholder: "name@bank", dir: "ltr", maxLength: 100 }),
    f("pn", "text", ["Payee name", "اسم المستفيد"], { required: true, maxLength: 80 }),
    f("am", "number", ["Amount (optional)", "المبلغ (اختياري)"], { half: true, dir: "ltr" }),
    f("tn", "text", ["Note", "ملاحظة"], { half: true, maxLength: 80 }),
  ],
  (v) => `upi://pay?pa=${encodeURIComponent(trim(v, "pa"))}&pn=${encodeURIComponent(trim(v, "pn"))}${trim(v, "am") ? "&am=" + trim(v, "am") : ""}&cu=INR${trim(v, "tn") ? "&tn=" + encodeURIComponent(trim(v, "tn")) : ""}`,
  (v, errs) => {
    if (trim(v, "pa") && !/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(trim(v, "pa"))) errs.pa = ["UPI ID must look like name@bank", "يجب أن يكون المعرّف بصيغة name@bank"];
  },
);

/**
 * Sham Cash (شام كاش) — the Syrian e-wallet run by Cham Bank, used across Syria
 * for salaries, bills and shop payments.
 *
 * Money moves to a wallet through the code the app shows under "Receive": either
 * the 32-character wallet code or the 16-digit account number. That code is all
 * the QR may hold — Sham Cash's scanner reads the address and nothing else, so
 * the name, amount and note are carried on the printed sheet instead of being
 * packed into the code, where they would make it unreadable.
 */
const SHAMCASH_KINDS = {
  wallet: { re: /^[A-Za-z0-9]{32}$/, err: ["The wallet code is 32 letters and digits", "رمز المحفظة 32 حرفاً ورقماً"] as Tx },
  account: { re: /^\d{16}$/, err: ["The account number is 16 digits", "رقم الحساب 16 رقماً"] as Tx },
};
const shamcash = def(
  "shamcash", "payment", ["Sham Cash", "شام كاش"], ["Receive on a Syrian wallet", "استلام على محفظة سورية"], "shamcash",
  [
    f("kind", "select", ["Identify by", "التعريف بواسطة"], {
      defaultValue: "wallet",
      options: [
        { value: "wallet", label: ["Wallet code", "رمز المحفظة"] },
        { value: "account", label: ["Account number", "رقم الحساب"] },
      ],
    }),
    f("code", "text", ["Wallet code or account number", "رمز المحفظة أو رقم الحساب"], {
      required: true,
      dir: "ltr",
      maxLength: 32,
      placeholder: "32 letters and digits, or 16 digits",
      hint: ["Open Sham Cash → Receive, then copy your wallet code (32 letters and digits) or account number (16 digits).", "افتح شام كاش ← استقبال، ثم انسخ رمز المحفظة (32 حرفاً ورقماً) أو رقم الحساب (16 رقماً)."],
    }),
    f("name", "text", ["Account name", "اسم الحساب"], { required: true, maxLength: 70 }),
    f("phone", "tel", ["Phone (optional)", "الهاتف (اختياري)"], { half: true, dir: "ltr", maxLength: 24 }),
    f("amount", "number", ["Amount (optional)", "المبلغ (اختياري)"], { half: true, dir: "ltr" }),
    f("currency", "select", ["Currency", "العملة"], {
      half: true,
      defaultValue: "SYP",
      options: [
        { value: "SYP", label: ["Syrian pound", "ليرة سورية"] },
        { value: "USD", label: ["US dollar", "دولار أمريكي"] },
        { value: "TRY", label: ["Turkish lira", "ليرة تركية"] },
      ],
    }),
    f("note", "text", ["Note (optional)", "ملاحظة (اختياري)"], { maxLength: 80 }),
  ],
  // Only the address: anything else and Sham Cash cannot read the code.
  (v) => trim(v, "code").replace(/\s+/g, ""),
  (v, errs) => {
    const kind = (trim(v, "kind") || "wallet") as keyof typeof SHAMCASH_KINDS;
    const spec = SHAMCASH_KINDS[kind] ?? SHAMCASH_KINDS.wallet;
    const code = trim(v, "code").replace(/\s+/g, "");
    if (code && !spec.re.test(code)) errs.code = spec.err;
    if (trim(v, "amount") && Number(trim(v, "amount")) <= 0) errs.amount = E.number;
  },
);

// ---------- Media ----------
function hostType(id: string, icon: string, title: Tx, desc: Tx, hosts: RegExp, placeholder: string): QrTypeDef {
  return def(
    id, "media", title, desc, icon,
    [f("url", "url", ["Link", "الرابط"], { required: true, placeholder, dir: "ltr", maxLength: 2000 })],
    (v) => parseHttpUrl(trim(v, "url"))?.href ?? trim(v, "url"),
    (v, errs) => {
      const u = parseHttpUrl(trim(v, "url"));
      if (u && !hosts.test(u.hostname)) errs.url = E.host;
    },
  );
}

const spotify = hostType("spotify", "spotify", ["Spotify", "سبوتيفاي"], ["Track, album or playlist", "أغنية أو ألبوم أو قائمة"], /(^|\.)(spotify\.com|spoti\.fi)$/i, "https://open.spotify.com/…");
const soundcloud = hostType("soundcloud", "soundcloud", ["SoundCloud", "ساوند كلاود"], ["Track or profile", "مقطع صوتي أو حساب"], /(^|\.)soundcloud\.com$/i, "https://soundcloud.com/…");
const vimeo = hostType("vimeo", "vimeo", ["Vimeo", "فيميو"], ["Video link", "رابط فيديو"], /(^|\.)vimeo\.com$/i, "https://vimeo.com/…");

const fileLink = def(
  "file", "media", ["File / PDF link", "رابط ملف / PDF"], ["Document, image or download", "مستند أو صورة أو تنزيل"], "file-text",
  [f("url", "url", ["File link", "رابط الملف"], { required: true, placeholder: "https://example.com/menu.pdf", dir: "ltr", maxLength: 2000 })],
  (v) => parseHttpUrl(trim(v, "url"))?.href ?? trim(v, "url"),
);

const raw = def(
  "raw", "hidden", ["Raw content", "محتوى خام"], ["Reuse scanned content", "إعادة استخدام محتوى ممسوح"], "type",
  [f("text", "textarea", ["Content", "المحتوى"], { required: true, maxLength: 2500, dir: "ltr" })],
  (v) => v.text ?? "",
);

export const QR_TYPES: QrTypeDef[] = [
  ...handleTypes.slice(0, 2),
  handleTypes[2],
  whatsapp,
  handleTypes[5],
  youtube,
  handleTypes[3],
  linkedin,
  handleTypes[4],
  handleTypes[6],
  handleTypes[7],
  handleTypes[8],
  urlType, customLink, appLink, location,
  vcard, event, product,
  phone, sms, email,
  wifi,
  contact, text, multitext,
  paypal, crypto, epc, upi, shamcash,
  spotify, soundcloud, vimeo, fileLink,
  raw,
];

export const TYPE_BY_ID: Record<string, QrTypeDef> = Object.fromEntries(QR_TYPES.map((t) => [t.id, t]));

export interface CategoryDef {
  id: QrCategoryId;
  title: Tx;
  desc: Tx;
  icon: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "social", title: ["Social media", "التواصل الاجتماعي"], desc: ["Profiles, chats and channels", "حسابات ومحادثات وقنوات"], icon: "users" },
  { id: "links", title: ["Sites & links", "المواقع والروابط"], desc: ["Web, apps and maps", "ويب وتطبيقات وخرائط"], icon: "link" },
  { id: "business", title: ["Business", "الأعمال والتجارة"], desc: ["Cards, events, products", "بطاقات ومواعيد ومنتجات"], icon: "briefcase" },
  { id: "telecom", title: ["Communication", "الاتصالات"], desc: ["Call, SMS and email", "اتصال ورسائل وبريد"], icon: "phone" },
  { id: "network", title: ["Network", "الشبكات والإنترنت"], desc: ["Wi-Fi access", "الاتصال بالشبكات"], icon: "wifi" },
  { id: "personal", title: ["Personal", "البيانات الشخصية"], desc: ["Contact and text", "جهات اتصال ونصوص"], icon: "user" },
  { id: "payment", title: ["Payment", "الدفع والخدمات"], desc: ["Wallets and transfers", "محافظ وتحويلات"], icon: "wallet" },
  { id: "media", title: ["Media", "المحتوى والوسائط"], desc: ["Music, video and files", "موسيقى وفيديو وملفات"], icon: "play" },
];

export function typesOfCategory(c: QrCategoryId): QrTypeDef[] {
  return QR_TYPES.filter((t) => t.category === c);
}

export function visibleFields(type: QrTypeDef, v: FormValues): FieldDef[] {
  return visible(type.fields, v);
}

export interface DetailRow {
  label: Tx;
  /** the text as typed (or the raw option value) */
  value: string;
  /** for selects: the option's own label, ready for translation */
  valueTx?: Tx;
}

/**
 * Everything the user filled in, in form order — the sheet that travels with a
 * printed code. It carries the details a code itself cannot hold (Sham Cash's
 * QR, for instance, may only be the wallet address, so the name and amount live
 * here instead).
 */
export function detailRows(type: QrTypeDef, v: FormValues): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const fd of visibleFields(type, v)) {
    const raw = (v[fd.key] ?? "").trim();
    if (!raw) continue;
    const opt = fd.options?.find((o) => o.value === raw);
    rows.push(opt ? { label: fd.label, value: raw, valueTx: opt.label } : { label: fd.label, value: raw });
  }
  return rows;
}

export function defaultValues(type: QrTypeDef): FormValues {
  const v: FormValues = {};
  for (const fd of type.fields) if (fd.defaultValue) v[fd.key] = fd.defaultValue;
  return v;
}

export interface BuildResult {
  content: string;
  errors: Record<string, Tx>;
  valid: boolean;
}

export function buildContent(type: QrTypeDef, v: FormValues): BuildResult {
  const errors = type.validate(v);
  const missing = visible(type.fields, v).some((fd) => fd.required && !(v[fd.key] ?? "").trim());
  const valid = Object.keys(errors).length === 0 && !missing;
  return { content: valid ? type.build(v) : "", errors, valid };
}

// ---------- Content detection (scanner / history) ----------
const HOST_TYPES: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/, "instagram"], [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"], [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, "whatsapp"], [/(^|\.)(t\.me|telegram\.me)$/, "telegram"], [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(x\.com|twitter\.com)$/, "x"], [/(^|\.)linkedin\.com$/, "linkedin"], [/(^|\.)snapchat\.com$/, "snapchat"],
  [/(^|\.)pinterest\.[a-z.]+$/, "pinterest"], [/(^|\.)threads\.(net|com)$/, "threads"], [/(^|\.)(discord\.gg|discord\.com)$/, "discord"],
  [/(^|\.)spotify\.com$/, "spotify"], [/(^|\.)soundcloud\.com$/, "soundcloud"], [/(^|\.)vimeo\.com$/, "vimeo"],
  [/(^|\.)paypal\.(me|com)$/, "paypal"], [/^(play\.google\.com|apps\.apple\.com)$/, "app"],
];

export function detectType(content: string): string {
  const s = content.trim();
  const up = s.slice(0, 12).toUpperCase();
  if (up.startsWith("WIFI:")) return "wifi";
  if (up.startsWith("BEGIN:VCARD")) return "vcard";
  if (up.startsWith("BEGIN:VCALEND") || up.startsWith("BEGIN:VEVENT")) return "event";
  if (up.startsWith("MAILTO:") || up.startsWith("MATMSG:")) return "email";
  if (up.startsWith("TEL:")) return "phone";
  if (up.startsWith("SMS:") || up.startsWith("SMSTO:") || up.startsWith("MMS")) return "sms";
  if (up.startsWith("GEO:")) return "location";
  if (up.startsWith("BITCOIN:") || up.startsWith("ETHEREUM:") || up.startsWith("LITECOIN:")) return "crypto";
  if (up.startsWith("UPI://")) return "upi";
  if (/^BCD\n/i.test(s)) return "epc";
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const host = u.hostname.toLowerCase();
      if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname.startsWith("/maps")) return "location";
      for (const [re, id] of HOST_TYPES) if (re.test(host)) return id;
    } catch {
      /* ignore */
    }
    return "url";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return "custom";
  return "text";
}

/** Redact secrets before writing to the activity log. */
export function redactForLog(typeId: string, content: string): string {
  if (typeId === "wifi") return content.replace(/P:(?:\\.|[^;])*;/, "P:••••;");
  if (typeId === "epc") return "EPC (hidden)";
  return content.length > 1500 ? content.slice(0, 1500) : content;
}
