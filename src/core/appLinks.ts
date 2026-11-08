/**
 * Web URL → the app that owns it.
 *
 * Every phone can already open a YouTube link in YouTube, but only when the
 * link is handed to the operating system in a form it can resolve. Doing that
 * naively — firing `vnd.youtube:ID` and hoping — has a nasty failure mode: when
 * the app is not installed the OS has nothing to do with the URL, so on Android
 * it puts "no app can open this link" on the screen, and on iOS the tap is
 * simply swallowed.
 *
 * So the two platforms are handled the way each one intends:
 *
 * - **Android** gets an `intent:` URI naming the package *and* a
 *   `S.browser_fallback_url`. The OS resolves it in one step: the app if it is
 *   installed, the browser if it is not. There is no window in which Android can
 *   complain, and nothing for us to time.
 * - **iOS** gets the app's own scheme, and we keep the safety net: if the page
 *   is still visible a moment later, the app was not there, so we open the same
 *   URL in the browser (where Universal Links take over).
 */

type Builder = (u: URL) => string | null;

/** The pieces of an `intent:` URI: `intent://<rest>#Intent;scheme=<scheme>…`. */
interface AndroidPart {
  scheme: string;
  rest: string;
}

interface Rule {
  host: RegExp;
  /** Android package that owns the link */
  pkg?: string;
  /** deep-link path for the Android intent (null → hand it the https URL) */
  android?: (u: URL) => AndroidPart | null;
  /** deep-link URL for iOS */
  ios?: Builder;
  /** one scheme that works on both platforms */
  both?: (u: URL) => AndroidPart | null;
}

const host = (re: string) => new RegExp(`(^|\\.)${re}$`, "i");

/** First meaningful path segment: `/@handle/video/1` → `@handle`. */
const seg = (u: URL, i = 0) => u.pathname.split("/").filter(Boolean)[i] ?? "";

const q = (v: string) => encodeURIComponent(v);

/** `;` would end the key inside `#Intent;…;end`, so it has to be escaped. */
const intentSafe = (v: string) => encodeURIComponent(v).replace(/;/g, "%3B");

const RULES: Rule[] = [
  // ---------------------------------------------------------------- video
  {
    host: host("youtube\\.com"),
    pkg: "com.google.android.youtube",
    ios: (u) => {
      const id = u.searchParams.get("v") ?? (u.pathname.startsWith("/shorts/") ? seg(u, 1) : "");
      return id ? `youtube://watch?v=${id}` : "youtube://";
    },
  },
  {
    host: host("youtu\\.be"),
    pkg: "com.google.android.youtube",
    ios: (u) => `youtube://watch?v=${seg(u)}`,
  },
  {
    host: host("twitch\\.tv"),
    pkg: "tv.twitch.android.app",
    both: (u) => (seg(u) ? { scheme: "twitch", rest: `stream/${seg(u)}` } : null),
  },

  // ---------------------------------------------------------------- social
  {
    host: host("instagram\\.com"),
    pkg: "com.instagram.android",
    both: (u) => {
      const first = seg(u);
      // /p/…, /reel/…, /stories/… have no usable profile path — just open the app.
      if (!first || ["p", "reel", "reels", "stories", "explore", "accounts", "tv"].includes(first.toLowerCase())) return null;
      return { scheme: "instagram", rest: `user?username=${q(first)}` };
    },
  },
  {
    host: host("tiktok\\.com"),
    pkg: "com.zhiliaoapp.musically",
    both: (u) => {
      const first = seg(u);
      // The handle is a path segment, so it goes in as-is (unlike a query value),
      // and only when it is really a handle.
      return first.startsWith("@") ? { scheme: "tiktok", rest: `user/${first}` } : null;
    },
  },
  {
    host: host("(twitter|x)\\.com"),
    pkg: "com.twitter.android",
    both: (u) => {
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.indexOf("status");
      if (i >= 0 && parts[i + 1]) return { scheme: "twitter", rest: `status?id=${q(parts[i + 1])}` };
      if (parts[0] && !["home", "explore", "search", "i", "settings", "messages", "notifications"].includes(parts[0].toLowerCase())) {
        return { scheme: "twitter", rest: `user?screen_name=${q(parts[0])}` };
      }
      return null;
    },
  },
  {
    host: host("facebook\\.com"),
    pkg: "com.facebook.katana",
    // fb://facewebmodal opens the given URL inside the Facebook app, which is the
    // only form that survives every link shape (pages, groups, posts, stories).
    both: (u) => ({ scheme: "fb", rest: `facewebmodal/f?href=${intentSafe(u.toString())}` }),
  },
  {
    host: host("snapchat\\.com"),
    pkg: "com.snapchat.android",
    both: (u) => {
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.indexOf("add");
      return i >= 0 && parts[i + 1] ? { scheme: "snapchat", rest: `add/${q(parts[i + 1])}` } : null;
    },
  },
  {
    host: host("threads\\.net"),
    pkg: "com.instagram.barcelona",
    both: (u) => (seg(u) ? { scheme: "barcelona", rest: `user?username=${q(seg(u))}` } : null),
  },
  {
    host: host("linkedin\\.com"),
    pkg: "com.linkedin.android",
    ios: (u) => `linkedin://${u.pathname.replace(/^\//, "")}${u.search}`,
  },
  { host: host("pinterest\\.com"), pkg: "com.pinterest" },
  { host: host("reddit\\.com"), pkg: "com.reddit.frontpage", ios: (u) => `reddit://${u.pathname.replace(/^\//, "")}` },
  { host: host("discord\\.(com|gg)"), pkg: "com.discord" },

  // ---------------------------------------------------------------- messaging
  {
    host: host("(t|telegram)\\.me"),
    pkg: "org.telegram.messenger",
    both: (u) => {
      const first = seg(u);
      if (!first) return null;
      if (first.toLowerCase() === "joinchat") return { scheme: "tg", rest: `join?invite=${q(seg(u, 1))}` };
      return { scheme: "tg", rest: `resolve?domain=${q(first.startsWith("+") ? first.slice(1) : first)}` };
    },
  },
  {
    host: host("(wa\\.me|whatsapp\\.com|api\\.whatsapp\\.com)"),
    pkg: "com.whatsapp",
    both: (u) => {
      const phone =
        (u.searchParams.get("phone") ?? "").replace(/\D/g, "") ||
        (u.hostname === "wa.me" ? seg(u).replace(/\D/g, "") : "");
      if (!phone) return null;
      const text = u.searchParams.get("text") ?? "";
      // Straight to the chat: the wa.me page is what makes WhatsApp search for
      // the number and then give up.
      return { scheme: "whatsapp", rest: `send?phone=${phone}${text ? `&text=${q(text)}` : ""}` };
    },
  },

  // ---------------------------------------------------------------- media & more
  {
    host: host("open\\.spotify\\.com"),
    pkg: "com.spotify.music",
    ios: (u) => {
      const [type, id] = u.pathname.split("/").filter(Boolean);
      return type && id ? `spotify:${type}:${id.split("?")[0]}` : "spotify://";
    },
  },
  { host: host("soundcloud\\.com"), pkg: "com.soundcloud.android" },
  { host: host("paypal\\.(com|me)"), pkg: "com.paypal.android.p2pmobile" },
];

const isAndroid = () => /android/i.test(navigator.userAgent);
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export interface AppHandoff {
  /** what to open */
  url: string;
  /**
   * Whether the platform already resolves the "app missing" case on its own.
   * Android intents carry their own fallback URL, so we must not add ours on
   * top — doing that is what used to open the browser while the app was still
   * starting in front of it.
   */
  atomic: boolean;
}

/**
 * How to open `webUrl` in the app that owns it, or null when we know of no such
 * app (the caller then just opens the URL in the browser).
 */
export function appHandoff(webUrl: string): AppHandoff | null {
  let u: URL;
  try {
    u = new URL(webUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  for (const rule of RULES) {
    if (!rule.host.test(u.hostname)) continue;
    try {
      if (isAndroid() && rule.pkg) return androidIntent(u, webUrl, rule);

      const shared = rule.both?.(u) ?? null;
      if (shared) return { url: `${shared.scheme}://${shared.rest}`, atomic: false };

      if (isIOS()) {
        const url = rule.ios?.(u) ?? null;
        if (url) return { url, atomic: false };
      }
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

/** One Android intent that names the app and carries its own browser fallback. */
function androidIntent(u: URL, webUrl: string, rule: Rule): AppHandoff {
  const part = (rule.android ?? rule.both)?.(u) ?? null;
  // With no deep link of our own, hand Android the https URL and let the app's
  // own App Link take it; the fallback opens in the browser if it does not.
  const body = part
    ? `${part.rest}#Intent;scheme=${part.scheme};`
    : `${u.hostname}${u.pathname}${u.search}#Intent;scheme=https;`;
  return {
    url: `intent://${body}package=${rule.pkg};S.browser_fallback_url=${intentSafe(webUrl)};end`,
    atomic: true,
  };
}
