// The tree canvas's state lives in the URL, so every view is a link: back/forward walk your
// trail, and a view can be shared.
import { z } from 'zod';
import { allGiven } from './further-given.ts';
import type { Family } from './graph.ts';
import { occupationSearchText } from './occupations.ts';
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

/**
 * The view a family's tree opens in when the link names none: the one this reader last chose there, else Family.
 * Family shows one person or a thousand equally well; a dynasty with its house banner is a choice, not a default.
 */
export function openingView(remembered: string | null | undefined): NonNullable<TreeSearch['view']> {
  return remembered === 'dynasty' || remembered === 'ancestors' || remembered === 'family' ? remembered : 'family';
}

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

/**
 * People matching a typed search, best first. A name ranks above a match in the epithet, title, occupation or house,
 * and a word that starts one of the names above one found inside it. Among people who match the words equally well,
 * `near` (steps from the reader, see `stepsFrom`) puts the reader's closest relatives first, so "ashw" lists your
 * great-grandmother before a namesake you are not related to; then the living, the storied and the titled.
 * `score` is the match without the closeness, for callers that add their own weights.
 */
export function searchPeople(f: Family, q: string, limit = 40, near?: ReadonlyMap<string, number>): { id: string; score: number }[] {
  const terms = foldName(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out: { id: string; score: number; text: number; steps: number }[] = [];
  for (const p of f.graph.people) {
    // Names first (any known name, in any order); the epithet, title, occupation and house also find someone.
    const named = matchesName(p, q);
    const name = foldName([p.given, p.surname, p.nickname].filter(Boolean).join(' '));
    const extra = foldName([p.epithet, p.title, p.occupation, occupationSearchText(p.occupationCode), f.house.get(p.house ?? '')?.name].filter(Boolean).join(' '));
    if (!named && !terms.every((t) => extra.includes(t))) continue;
    const text = named ? 10 + terms.filter((t) => name.split(' ').some((w) => w.startsWith(t))).length * 5 : 2;
    const score = text + (p.living ? 1 : 0) + Math.min(p.stories, 5) * 0.2 + (p.title ? 0.5 : 0);
    out.push({ id: p.id, score, text, steps: near?.get(p.id) ?? Infinity });
  }
  return out
    .sort((a, b) => b.text - a.text || (a.steps === b.steps ? 0 : a.steps < b.steps ? -1 : 1) || b.score - a.score)
    .slice(0, limit)
    .map(({ id, score }) => ({ id, score }));
}
