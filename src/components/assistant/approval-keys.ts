// The retry keys of an approved card. They come from what the server stored (the proposal's id) and what is being sent, never from
// the browser, so two tabs, two devices or a reload after a lost reply all send the same key and the server replays the first result.
// A hash here cannot wrongly merge two changes: the server compares the whole payload (`once`) and refuses a key sent with anything else.

export interface ApprovalKeys { for(step: string, payload: unknown): string }

/** Object keys in one order, so the same args give the same text wherever they were built. */
const stable = (payload: unknown) =>
  JSON.stringify(payload ?? null, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/** A 53-bit string hash. Synchronous and available everywhere: crypto.subtle is missing outside secure contexts, and a family's own server may be plain http. */
function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Keys for one card. The server's rule is 8 to 80 of [A-Za-z0-9_-]; a proposal id is a UUID, and anything else is reduced to fit. */
export function approvalKeys(proposalId: string): ApprovalKeys {
  const card = proposalId.replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  return { for: (step, payload) => `ap-${card}-${hash(`${proposalId}\0${step}\0${stable(payload)}`).padStart(11, '0')}` };
}
