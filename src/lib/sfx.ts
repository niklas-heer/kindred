// Small synthesised sound effects (WebAudio, no audio files). Quiet, short, and never while the tab
// is hidden or unfocused. On by default only in the codex theme; the topbar has a mute toggle.
import { usePref } from './prefs';

export type Sfx = 'tick' | 'whoosh' | 'found' | 'chime' | 'seal' | 'fanfare' | 'page';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let hall: ConvolverNode | null = null;
let lastTick = 0;
let voices = 0;

const pref = () => {
  try {
    return localStorage.getItem('kindred:sound');
  } catch {
    return null;
  }
};

/** Sound is on when the reader turned it on, or by default in the codex theme. */
export function soundOn(): boolean {
  const p = pref();
  if (p === 'on') return true;
  if (p === 'off') return false;
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'codex';
}

export function useSoundOn(): boolean {
  usePref('sound');
  usePref('theme');
  return typeof document === 'undefined' ? false : soundOn();
}

function setup(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.22;
    // A short "hall": decaying noise as an impulse response, mixed in lightly.
    hall = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    hall.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.12;
    master.connect(ctx.destination);
    master.connect(hall).connect(wet).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function play(name: Sfx, opts: { pitch?: number } = {}) {
  if (!soundOn() || document.hidden || !document.hasFocus()) return;
  if (reducedMotion() && (name === 'whoosh' || name === 'page')) return;
  if (name === 'tick') {
    const now = performance.now();
    if (now - lastTick < 70) return;
    lastTick = now;
  }
  if (voices >= 3) return;
  const c = setup();
  if (!c || !master) return;
  voices++;
  setTimeout(() => voices--, 400);
  const t = c.currentTime + 0.005;
  const p = opts.pitch ?? 1;
  const out = master;

  const tone = (type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak: number, dest: AudioNode = out) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0 * p, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 * p, at + dur * 0.6);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.02);
  };
  const noise = (at: number, dur: number, peak: number, filter: BiquadFilterType, freq: number, q = 1, sweep?: [number, number]) => {
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const bq = c.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(freq, at);
    if (sweep) {
      bq.frequency.exponentialRampToValueAtTime(sweep[0], at + dur * 0.5);
      bq.frequency.exponentialRampToValueAtTime(sweep[1], at + dur);
    }
    bq.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bq).connect(g).connect(out);
    src.start(at);
  };
  /** A small bell: inharmonic partials with a long tail. */
  const bell = (f: number, at: number, peak = 0.12, dur = 1.2) => {
    tone('sine', f, f, at, dur, peak);
    tone('sine', f * 2.76, f * 2.76, at, dur * 0.6, peak * 0.25);
    tone('sine', f * 5.4, f * 5.4, at, dur * 0.35, peak * 0.1);
  };

  switch (name) {
    case 'tick': // selecting someone: a wooden tap
      tone('triangle', 880, 620, t, 0.07, 0.15);
      noise(t, 0.025, 0.05, 'bandpass', 3000, 2);
      break;
    case 'whoosh': // the camera flies somewhere
      noise(t, 0.45, 0.08, 'bandpass', 400, 0.8, [1800, 600]);
      break;
    case 'found': // arriving at a search result
      [392, 494, 587].forEach((f, i) => tone('triangle', f, f, t + i * 0.07, 0.35, 0.09));
      break;
    case 'chime': // someone joined the family
      bell(659, t);
      bell(988, t + 0.09);
      break;
    case 'seal': // opening a house: a soft drum
      tone('sine', 140, 55, t, 0.4, 0.3);
      noise(t, 0.06, 0.06, 'lowpass', 600);
      break;
    case 'fanfare': // a birthday today
      [523, 659, 784, 1047].forEach((f, i) => bell(f, t + i * 0.11, 0.1, 1));
      break;
    case 'page': // folding a branch
      noise(t, 0.05, 0.04, 'highpass', 2000);
      break;
  }
}
