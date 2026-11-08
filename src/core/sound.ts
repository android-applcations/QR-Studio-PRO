/**
 * Interface sounds — light UI feedback only.
 *
 * Everything here is generated at runtime with the Web Audio API (no audio files,
 * so the app stays fully offline and the bundle stays small) and every sound is a
 * single, very short percussive click made from a filtered noise burst.
 *
 * Deliberately SHARIA-SAFE: there is no melody, no musical instrument, no sustained
 * musical tone and no rhythm — only a soft tap, the way a keypad or a UI click
 * sounds. Nothing here resembles music (معازف).
 */

export type SoundName = "tap" | "nav" | "toggle" | "ok" | "err";

interface Recipe {
  /** filter shape of the click */
  type: BiquadFilterType;
  freq: number;
  q: number;
  /** total length in milliseconds — everything is a short transient */
  ms: number;
  gain: number;
}

const RECIPES: Record<SoundName, Recipe> = {
  tap: { type: "bandpass", freq: 1750, q: 1.1, ms: 30, gain: 0.16 },
  nav: { type: "bandpass", freq: 950, q: 0.9, ms: 44, gain: 0.13 },
  toggle: { type: "bandpass", freq: 1300, q: 1.0, ms: 24, gain: 0.12 },
  ok: { type: "bandpass", freq: 2600, q: 1.5, ms: 55, gain: 0.14 },
  err: { type: "lowpass", freq: 430, q: 0.7, ms: 95, gain: 0.17 },
};

type AudioCtor = new () => AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

/** Called by the app whenever the user changes the "Interface sounds" setting. */
export function setSoundEnabled(value: boolean): void {
  enabled = value;
  if (!value && ctx && ctx.state === "running") void ctx.suspend().catch(() => {});
}

export const isSoundEnabled = (): boolean => enabled;

function ensureContext(): AudioContext | null {
  if (!enabled || typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** Plays one short, non-musical UI click. Safe to call anywhere; never throws. */
export function playSound(name: SoundName): void {
  try {
    const c = ensureContext();
    if (!c || !master) return;
    const r = RECIPES[name];
    const now = c.currentTime;
    const dur = r.ms / 1000;

    // One percussive transient: noise with a fast exponential decay.
    const frames = Math.max(1, Math.floor(c.sampleRate * dur));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      const k = 1 - i / frames;
      data[i] = (Math.random() * 2 - 1) * k * k * k;
    }
    const src = c.createBufferSource();
    src.buffer = buffer;

    const filter = c.createBiquadFilter();
    filter.type = r.type;
    filter.frequency.value = r.freq;
    filter.Q.value = r.q;

    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(r.gain, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(filter);
    filter.connect(env);
    env.connect(master);
    src.start(now);
    src.stop(now + dur + 0.02);
  } catch {
    /* audio is a nicety — never break a click because of it */
  }
}
