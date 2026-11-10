// "Open the family on Today": a reader's choice, kept in this browser (`open:<tree>`), that the family's address
// leads to the Today page instead of the tree when they arrive. Only on arrival: once they are inside the family, the
// Tree section is the tree. The tree's route asks `opensOnToday` before it loads; the family's layout says when the
// reader has arrived and when they have left.
const inside = new Set<string>();

export const OPEN_PREF = (tree: string) => `open:${tree}`;

export const arrivedIn = (tree: string) => { inside.add(tree); };
export const leftFamily = (tree: string) => { inside.delete(tree); };

/** True when this reader asked for Today as the opening page and is only now arriving in the family. Never on the server. */
export function opensOnToday(tree: string): boolean {
  if (typeof localStorage === 'undefined' || inside.has(tree)) return false;
  try { return localStorage.getItem(`kindred:${OPEN_PREF(tree)}`) === 'today'; } catch { return false; }
}
