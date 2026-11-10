// A small seeded random number generator for the campaign (./engine.ts): the same seed gives the same dice, the same
// map and the same regent on the server and in the browser. Not for secrets.

/** A 32-bit hash of a text (xmur3). */
export function hashSeed(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Numbers from 0 (inclusive) to 1 (exclusive), the same sequence for the same seed (mulberry32). */
export function rng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number from `min` to `max`, both included. */
export const between = (random: () => number, min: number, max: number) => min + Math.floor(random() * (max - min + 1));
