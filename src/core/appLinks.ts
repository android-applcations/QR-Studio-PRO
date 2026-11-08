/**
 * Web URL → the app that owns it.
 *
 * When a scanned link belongs to YouTube, Instagram, TikTok and friends, people
 * expect the app on their phone to open it — not a browser tab. Modern phones can
 * do that on their own through Android App Links / iOS Universal Links, but only
 * when the URL is handed to the operating system, and not every app verifies
 * them. So we try the app's own deep link first and fall back to the browser
 * when nothing answers.
 */

type Builder = (u: URL) => string | null;

interface Rule {
  host: RegExp;
  /** scheme + path used on Android */
  android?: Builder;
  /** scheme + path used on iOS */
  ios?: Builder;
  /** same deep link on both platforms */
  both?: Builder;
}

const host = (re: string) => new RegExp(`(^|\\.)${re}$`, "i");

/** First meaningful path segment: `/@handle/video/1` → `@handle`. */
const seg = (u: URL, i = 0) => u.pathname.split("/").filter(Boolean)[i] ?? "";

const q = (v: string) => encodeURIComponent(v);

const RULES: Rule[] = [
  // ---------------------------------------------------------------- video
  {
    host: host("youtube\\.com"),
    android: (u) => {
      const id = u.searchParams.get("v");
      if (id) return `vnd.youtube:${id}`;
      if (u.pathname.startsWith("/shorts/")) return `vnd.youtube:${seg(u, 1)}`;
      return "youtube://";
    },
    ios: (u) => {
      const id = u.searchParams.get("v") ?? (u.pathname.startsWith("/shorts/") ? seg(u, 1) : "");
      return id ? `youtube://watch?v=${id}` : "youtube://";
    },
  },
  {
    host: host("youtu\\.be"),
    android: (u) => `vnd.youtube:${seg(u)}`,
    ios: (u) => `youtube://watch?v=${seg(u)}`,
  },
  { host: host("twitch\\.tv"), both: (u) => (seg(u) ? `twitch://stream/${seg(u)}` : "twitch://") },

  // ---------------------------------------------------------------- social
  {
    host: host("instagram\\.com"),
    both: (u) => {
      const first = seg(u);
      // /p/…, /reel/…, /stories/… have no usable app path — just open the app.
      if (!first || ["p", "reel", "reels", "stories", "explore", "accounts", "tv"].includes(first.toLowerCase())) {
        return "instagram://";
      }
      return `instagram://user?username=${q(first)}`;
    },
  },
  {
    host: host("tiktok\\.com"),
    both: (u) => {
      const first = seg(u);
      // The handle is a path segment, so it goes in as-is (unlike a query value).
      return first.startsWith("@") ? `tiktok://user/${first}` : "tiktok://";
    },
  },
  {
    host: host("(twitter|x)\\.com"),
    both: (u) => {
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.indexOf("status");
      if (i >= 0 && parts[i + 1]) return `twitter://status?id=${q(parts[i + 1])}`;
      if (parts[0] && !["home", "explore", "search", "i", "settings", "messages", "notifications"].includes(parts[0].toLowerCase())) {
        return `twitter://user?screen_name=${q(parts[0])}`;
      }
      return "twitter://";
    },
  },
  {
    host: host("facebook\\.com"),
    // fb://facewebmodal opens the given URL inside the Facebook app, which is the
    // only form that survives every link shape (pages, groups, posts, stories).
    both: (u) => `fb://facewebmodal/f?href=${q(u.toString())}`,
  },
  {
    host: host("snapchat\\.com"),
    both: (u) => {
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.indexOf("add");
      return i >= 0 && parts[i + 1] ? `snapchat://add/${q(parts[i + 1])}` : "snapchat://";
    },
  },
  { host: host("threads\\.net"), both: (u) => (seg(u) ? `barcelona://user?username=${q(seg(u))}` : "barcelona://") },
  { host: host("linkedin\\.com"), both: (u) => `linkedin://${u.pathname.replace(/^\//, "")}${u.search}` },
  { host: host("pinterest\\.com"), both: () => "pinterest://" },
  { host: host("reddit\\.com"), both: (u) => `reddit://${u.pathname.replace(/^\//, "")}` },
  { host: host("discord\\.(com|gg)"), both: () => "discord://" },

  // ---------------------------------------------------------------- messaging
  {
    host: host("(t|telegram)\\.me"),
    both: (u) => {
      const first = seg(u);
      if (!first) return "tg://";
      if (first.toLowerCase() === "joinchat") return `tg://join?invite=${q(seg(u, 1))}`;
      const domain = first.startsWith("+") ? first.slice(1) : first;
      return `tg://resolve?domain=${q(domain)}`;
    },
  },
  {
    host: host("(wa\\.me|whatsapp\\.com|api\\.whatsapp\\.com)"),
    both: (u) => {
      const phone =
        (u.searchParams.get("phone") ?? "").replace(/\D/g, "") ||
        (u.hostname === "wa.me" ? seg(u).replace(/\D/g, "") : "");
      const text = u.searchParams.get("text") ?? "";
      if (!phone) return "whatsapp://";
      return `whatsapp://send?phone=${phone}${text ? `&text=${q(text)}` : ""}`;
    },
  },

  // ---------------------------------------------------------------- media & more
  {
    host: host("open\\.spotify\\.com"),
    both: (u) => {
      const [type, id] = u.pathname.split("/").filter(Boolean);
      return type && id ? `spotify:${type}:${id.split("?")[0]}` : "spotify://";
    },
  },
  { host: host("soundcloud\\.com"), both: () => "soundcloud://" },
  { host: host("paypal\\.(com|me)"), both: () => "paypal://" },
];

const isAndroid = () => /android/i.test(navigator.userAgent);
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * The deep link that opens `webUrl` in its own app, or null when we do not know
 * one (the caller then just opens the URL in the browser).
 */
export function nativeAppUrl(webUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(webUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  for (const rule of RULES) {
    if (!rule.host.test(u.hostname)) continue;
    const build = rule.both ?? (isAndroid() ? rule.android : isIOS() ? rule.ios : null);
    if (!build) continue;
    try {
      const url = build(u);
      if (url) return url;
    } catch {
      return null;
    }
  }
  return null;
}
