/**
 * The lock on things the app keeps.
 *
 * A QR code is often a credential: a Wi-Fi password, a wallet address with a
 * name attached, a private link. Those sit in IndexedDB in plain text, and
 * IndexedDB is a set of files on the device — anyone who gets the device, or
 * simply opens the browser's storage inspector, reads them.
 *
 * So the secret parts of a record are sealed with AES-GCM before they are
 * written and opened again when they are read. Everything above this file —
 * screens, exports, search — still sees ordinary strings, which is why nothing
 * else in the app had to learn that this exists.
 *
 * Two decisions worth knowing:
 *
 * - **The key never leaves the browser's care.** It is a non-extractable
 *   `CryptoKey` handed to IndexedDB, so the browser stores it in whatever
 *   wrapped form it uses for key material. Something reading the database files
 *   finds an opaque blob, not a key. (Browsers that cannot store a `CryptoKey`
 *   get the fallback below, which keeps working.)
 * - **Sealing the same text twice gives the same bytes.** The nonce is derived
 *   from the text itself (HMAC over the plaintext) rather than being random.
 *   A random nonce is the textbook choice, but the database looks records up by
 *   their content — "have I saved this code before?" — and two encryptions of
 *   one password would then look like two different codes. The leak is narrow
 *   and already there: it reveals that two records hold the same secret, which
 *   is exactly what the duplicate check says out loud.
 *
 * Nothing here is announced in the interface. A lock does not explain itself.
 */

const PREFIX = "vault1:";
const DB_NAME = "qr_studio_vault";
const STORE = "keys";
const KEY_ID = "master";

/** Fields whose value is a credential wherever they appear. */
const SECRET_FIELDS = /^(password|pass|pwd|secret|pin|code|key|token)$/i;

/** Whole shapes that are credentials regardless of which type made them. */
const SECRET_SHAPES = [/^WIFI:/i, /^otpauth:\/\//i, /^bcrypt:/i, /^smsto:[^:]*:/i];

const te = new TextEncoder();
const td = new TextDecoder();

/** A `BufferSource` the DOM libraries accept, whatever the array's backing store. */
const view = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const unb64url = (s: string): Uint8Array => {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

// ---------------------------------------------------------------------------
// Where the key lives.
//
// A store of its own, not the app's Dexie database: `db.ts` is the caller of
// this file, and importing it here would be a circle. It is also right that the
// key is not inside the thing it locks.
// ---------------------------------------------------------------------------
function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("VAULT_UNAVAILABLE"));
  });
}

async function vaultGet(): Promise<unknown> {
  const db = await openVault();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY_ID);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("VAULT_UNAVAILABLE"));
    });
  } finally {
    db.close();
  }
}

async function vaultPut(value: unknown): Promise<void> {
  const db = await openVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("VAULT_UNAVAILABLE"));
      tx.onabort = () => reject(tx.error ?? new Error("VAULT_UNAVAILABLE"));
    });
  } finally {
    db.close();
  }
}

interface KeyPair {
  /** AES-GCM, for the data itself */
  enc: CryptoKey;
  /** HMAC, for the nonce and the integrity tag */
  mac: CryptoKey;
}

let pairPromise: Promise<KeyPair | null> | null = null;

async function derive(master: CryptoKey): Promise<KeyPair> {
  const salt = te.encode("qr-studio-pro/vault");
  const enc = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: te.encode("content") },
    master,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const mac = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: te.encode("nonce") },
    master,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return { enc, mac };
}

async function loadPair(): Promise<KeyPair | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof indexedDB === "undefined") return null;

  const existing = await vaultGet().catch(() => undefined);
  // Preferred shape: two non-extractable keys the browser keeps for us.
  if (existing && typeof existing === "object" && "enc" in existing && "mac" in existing) {
    const p = existing as KeyPair;
    if (p.enc && p.mac) return p;
  }
  // Fallback: browsers that will not store a CryptoKey. The seed is kept
  // instead and the keys are derived from it on each start.
  if (existing instanceof Uint8Array && existing.length === 32) {
    const master = await subtle.importKey("raw", view(existing), "HKDF", false, ["deriveKey", "deriveBits"]);
    return derive(master);
  }

  const seed = crypto.getRandomValues(new Uint8Array(32));
  const master = await subtle.importKey("raw", view(seed), "HKDF", false, ["deriveKey", "deriveBits"]);
  const fresh = await derive(master);
  // Hand the browser the keys themselves; if it refuses, hand it the seed.
  const stored = await vaultPut(fresh).then(
    () => true,
    () => false,
  );
  if (!stored) await vaultPut(seed).catch(() => undefined);
  return fresh;
}

function keys(): Promise<KeyPair | null> {
  pairPromise ??= loadPair().catch(() => null);
  return pairPromise;
}

// ---------------------------------------------------------------------------
// Sealing and opening.
// ---------------------------------------------------------------------------

/** True when this text is already sealed. */
export const isSealed = (v: unknown): v is string => typeof v === "string" && v.startsWith(PREFIX);

async function nonce(mac: CryptoKey, text: string): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign("HMAC", mac, view(te.encode(text)));
  return new Uint8Array(sig.slice(0, 12));
}

/**
 * Seal a string. Returns it unchanged when sealing is impossible (no Web
 * Crypto, no IndexedDB): a code that cannot be stored is worse than one stored
 * in the clear, and the app keeps working either way.
 */
export async function seal(text: string): Promise<string> {
  if (!text) return text;
  const k = await keys();
  if (!k) return text;
  const iv = await nonce(k.mac, text);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: view(iv), tagLength: 128 }, k.enc, view(te.encode(text))));
  // nonce || ciphertext || tag, in that order — see `open`.
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return PREFIX + b64url(out);
}

/**
 * Open a sealed string. Text that was never sealed (records saved before this
 * existed) comes back exactly as it went in.
 */
export async function open(text: string): Promise<string> {
  if (!isSealed(text)) return text;
  const k = await keys();
  if (!k) return text;
  try {
    const body = unb64url(text.slice(PREFIX.length));
    const iv = body.slice(0, 12);
    const ct = body.slice(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: view(iv), tagLength: 128 }, k.enc, view(ct));
    return td.decode(pt);
  } catch {
    // Wrong key, damaged record, a database copied from another device. Hand
    // back the raw text rather than losing the row.
    return text;
  }
}

/** Open every value of a form-values object, in place. */
export async function openValues(values: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    out[key] = typeof value === "string" ? await open(value) : value;
  }
  return out;
}

/** Seal the values that are worth sealing; leave the rest alone. */
export async function sealValues(
  values: Record<string, string>,
  sensitive: boolean,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    out[key] = typeof value === "string" && (sensitive || SECRET_FIELDS.test(key)) ? await seal(value) : value;
  }
  return out;
}

/**
 * Does this record hold something that should not be left lying around?
 *
 * `sensitive` is decided by the type (a Wi-Fi code is a password by
 * definition); the shapes catch the same secrets arriving from a scan or a
 * backup, where the type is only a guess.
 */
export function holdsSecret(typeId: string | undefined, content: string | undefined): boolean {
  if (content && SECRET_SHAPES.some((r) => r.test(content))) return true;
  if (!typeId) return false;
  return SENSITIVE_TYPES.has(typeId);
}

/** Types that are credentials by nature. Kept here so `db.ts` stays a caller. */
const SENSITIVE_TYPES = new Set(["wifi"]);
