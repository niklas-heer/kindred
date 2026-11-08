// The current tree's graph, indexed once and shared by every view under /$tree.
import { useSuspenseQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useMemo } from 'react';
import { graphQuery } from './api';
import { setMyPerson } from './auth/functions';
import { buildFamily, generations, type Family } from './graph';
import { setPref, usePref } from './prefs';
import { useMembership } from './session';

export function useTreeId(): string {
  return useParams({ strict: false }).tree as string;
}

const cache = new WeakMap<object, Family & { gen: Map<string, number> }>();

export function useFamily(): Family & { gen: Map<string, number> } {
  const tree = useTreeId();
  const { data } = useSuspenseQuery(graphQuery(tree));
  return useMemo(() => {
    let f = cache.get(data);
    if (!f) {
      const base = buildFamily(data);
      f = { ...base, gen: generations(base) };
      cache.set(data, f);
    }
    return f;
  }, [data]);
}

/** The `me:<tree>` preference value for "just browsing": the reader chose not to be anyone. */
export const BROWSING = '-';

/**
 * Where the tree opens and "home" goes: the reader's own card once they've said who they are, else
 * the tree's focus person. Not for kinship labels: use `useMeChosen()` for those.
 */
export function useMe(): string {
  const f = useFamily();
  const who = useMeChosen();
  return who ?? f.graph.tree.focus;
}

/**
 * Who the reader said they are, or null until they choose (or chose "just browsing"). Kinship
 * labels ("your aunt") are only shown when this is set, never computed from an arbitrary person.
 *
 * The answer is saved with their membership of the family, so it follows them to every device. The
 * `me:<tree>` preference in this browser takes precedence: "Be them" changes only that, for a while.
 */
export function useMeChosen(): string | null {
  const f = useFamily();
  const local = usePref(`me:${f.graph.tree.id}`);
  const saved = useMembership(f.graph.tree.id)?.person ?? null;
  const me = local ?? saved;
  return me && me !== BROWSING && f.byId.has(me) ? me : null;
}

/** Whether the reader has answered "Who are you?" for this tree (including "just browsing"). */
export function useMeAnswered(): boolean {
  const f = useFamily();
  const local = usePref(`me:${f.graph.tree.id}`);
  const saved = useMembership(f.graph.tree.id)?.person ?? null;
  return local !== null || saved !== null;
}

/**
 * The reader says who they are in a family (a person id, or BROWSING): saved in this browser at once
 * and with their membership on the server. Use this for "This is me", not for "Be them".
 */
export function chooseMe(tree: string, id: string): Promise<void> {
  setPref(`me:${tree}`, id);
  return setMyPerson({ data: { tree, person: id } }).then(() => undefined, () => undefined);
}
