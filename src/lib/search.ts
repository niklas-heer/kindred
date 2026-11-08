// The tree canvas's state lives in the URL, so every view is a link: back/forward walk your
// trail, and a view can be shared.
import { z } from 'zod';
import { allGiven } from './further-given.ts';
import type { GPerson } from './types';

export const treeSearch = z.object({
  /** The centre of the family/ancestor views and the dynasty's line. */
  focus: z.string().optional(),
  /** Who the side panel shows, when not the focus. Selecting never moves the tree. */
  sel: z.string().optional(),
  view: z.enum(['dynasty', 'family', 'ancestors']).optional(),
  /** Dynasty root; defaults to the oldest ancestor of the focus in its line. */
  root: z.string().optional(),
  /** Dynasty: only house members (CK3) or every descendant. */
  line: z.enum(['house', 'all']).optional(),
  up: z.number().int().min(1).max(12).optional(),
  down: z.number().int().min(1).max(12).optional(),
  /** Highlight lens: dims everyone outside it. */
  lens: z.enum(['none', 'line', 'living', 'house', 'path', 'gaps']).optional(),
  /** For the path lens: the other person. */
  to: z.string().optional(),
});
export type TreeSearch = z.infer<typeof treeSearch>;

// ---------- finding people by name ----------

/** Lower case, no accents: what a name search compares. */
export const foldName = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Every name a person is known by, folded: the birth name, the name they go by now (the current name
 * where recorded), the nickname and their parts. A search looks at all of them, so a woman found by
 * her birth surname is found by her married one too.
 */
export function personNames(p: GPerson): string[] {
  const now = { given: p.currentGiven ?? p.given, surname: p.currentSurname ?? p.surname };
  const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ');
  const further = p.furtherGiven ?? [];
  return [join(allGiven(p.given, further), p.surname), join(p.given, p.surname), join(now.given, now.surname), p.given, now.given, ...further, p.nickname, p.surname, now.surname]
    .filter((s): s is string => !!s)
    .map(foldName);
}

/** Whether a person matches a typed search: every word typed appears in one of their names, in any order. */
export function matchesName(p: GPerson, query: string): boolean {
  const words = foldName(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const names = personNames(p);
  return words.every((w) => names.some((n) => n.includes(w)));
}
