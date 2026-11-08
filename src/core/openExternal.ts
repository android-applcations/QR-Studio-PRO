/**
 * Hand a URL to the operating system instead of the app.
 *
 * Why this exists: inside an installed PWA (standalone window) the usual ways of
 * following a link behave differently from a browser tab, and `target="_self"`
 * silently does nothing for the links people scan most — Instagram, WhatsApp,
 * Telegram and friends:
 *
 *   - an https URL opened with `_self` stays trapped in the standalone window,
 *     so Android App Links / iOS Universal Links never get a chance to hand it
 *     to the native app;
 *   - a custom scheme (`instagram://…`) opened with `_self` is dropped outright,
 *     because a standalone window only navigates http(s).
 *
 * `target="_blank"` is the one thing an installed PWA reliably hands to the OS:
 * Android opens a Chrome Custom Tab that resolves App Links and intents
 * (instagram.com → Instagram, wa.me → WhatsApp), iOS opens Safari, and a plain
 * browser tab just behaves like a browser tab.
 */

import { appHandoff } from "./appLinks";

/** Result of a hand-off attempt. */
export type OpenHandoff = "handed-off" | "blocked" | "refused";

/** Schemes that must never leave the app. */
const UNSAFE = new Set(["javascript", "data", "vbscript", "file", "blob", "about", "view-source"]);

/** Schemes the OS answers directly, with no browsing context of its own. */
const NATIVE = new Set(["tel", "mailto", "sms", "smsto", "geo"]);

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return (
    standalone ||
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: fullscreen)").matches === true
  );
}

function schemeOf(href: string): string {
  try {
    return new URL(href).protocol.replace(/:$/, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Follow a link through a real anchor.
 *
 * The anchor is rendered but invisible (browsers may ignore a click on a
 * `display: none` element) and stays in the document until the navigation has
 * started, because removing it too early can cancel the navigation.
 */
function anchorNavigate(href: string, target: string): boolean {
  try {
    const a = document.createElement("a");
    a.href = href;
    a.target = target;
    a.rel = "noopener noreferrer";
    a.tabIndex = -1;
    a.setAttribute("aria-hidden", "true");
    a.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => a.remove(), 1000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a URL outside the app.
 *
 * Safe to call from a click handler; never throws and never opens anything
 * dangerous.
 */
export function openExternal(rawHref: string): OpenHandoff {
  const href = (rawHref ?? "").trim();
  if (!href) return "refused";

  const scheme = schemeOf(href);
  if (!scheme || UNSAFE.has(scheme)) return "refused";

  // tel:, mailto:, sms:, geo: — these are intents, not documents. They behave
  // like an ordinary link click: the OS picks them up and the app stays put.
  if (NATIVE.has(scheme)) {
    return anchorNavigate(href, "_self") ? "handed-off" : "blocked";
  }

  // https links and app deep links alike: let the device decide.
  if (anchorNavigate(href, "_blank")) return "handed-off";

  // Nothing else worked (popup blocked, or a very locked-down web view).
  try {
    window.location.href = href;
    return "handed-off";
  } catch {
    return "blocked";
  }
}

/**
 * Open a web URL in the app that owns it, and in the browser when it is not
 * installed.
 *
 * The app's own deep link is fired first; if nothing on the device answers it
 * the page never loses visibility, and we then open the same URL in the browser.
 * So a YouTube link opens YouTube, and on a phone without YouTube it opens the
 * default browser at exactly the same video.
 */
export function openInAppOrBrowser(webUrl: string): OpenHandoff {
  const app = appHandoff(webUrl);
  if (!app) return openExternal(webUrl);

  const result = openExternal(app.url);
  if (result !== "handed-off") return result === "refused" ? openExternal(webUrl) : result;

  // An Android intent carries its own fallback URL, so the OS has already
  // decided where this goes. Opening the browser ourselves on top of it is what
  // used to put a browser tab in front of the app that was still starting.
  if (!app.atomic) watchHandoff(1500, () => openExternal(webUrl));
  return result;
}

/**
 * Wait a moment and report whether the hand-off actually moved the user out of
 * the app. Used for app deep links, where a device with no matching app simply
 * does nothing and the user is left staring at the screen.
 */
export function watchHandoff(ms: number, onStayed: () => void): () => void {
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", done);
    window.removeEventListener("blur", onBlur);
    window.clearTimeout(timer);
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") done();
  };
  // A custom tab or the system UI taking focus counts as a successful hand-off.
  const onBlur = () => done();
  const timer = window.setTimeout(() => {
    done();
    if (document.visibilityState !== "hidden") onStayed();
  }, ms);

  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", done);
  window.addEventListener("blur", onBlur);
  return done;
}
