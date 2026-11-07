// Seeded PRNG (mulberry32) plus small helpers. Same seed, same sequence, on every run.

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Weighted pick; weights are relative. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Normal-ish sample via sum of uniforms (Irwin–Hall), mean mu, spread sigma. */
  gauss(mu: number, sigma: number): number;
  /** Fisher–Yates, returns a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /** A new independent generator derived from this one, labelled for stability. */
  fork(label: string): Rng;
}

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      if (items.length === 0) throw new Error('pick: empty array');
      return items[Math.floor(next() * items.length)] as never;
    },
    weighted(items, weights) {
      const total = weights.reduce((sum, w) => sum + w, 0);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i] as number;
        if (r < 0) return items[i] as never;
      }
      return items[items.length - 1] as never;
    },
    chance(p) {
      return next() < p;
    },
    gauss(mu, sigma) {
      let sum = 0;
      for (let i = 0; i < 4; i++) sum += next();
      return mu + ((sum - 2) / 2) * sigma * Math.sqrt(3);
    },
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j] as never, out[i] as never];
      }
      return out;
    },
    fork(label) {
      // FNV-1a over the label, mixed with a draw from the parent so forks stay deterministic.
      let h = 0x811c9dc5;
      for (let i = 0; i < label.length; i++) {
        h ^= label.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return mulberry32((h ^ Math.floor(next() * 0xffffffff)) >>> 0);
    },
  };
  return rng;
}

/** Stable short id, e.g. "p0412". */
export function idOf(prefix: string, n: number, width = 4): string {
  return `${prefix}${String(n).padStart(width, '0')}`;
}
