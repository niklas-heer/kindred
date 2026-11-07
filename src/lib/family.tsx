// The current tree's graph, indexed once and shared by every view under /$tree.
import { useSuspenseQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useMemo } from 'react';
import { graphQuery } from './api';
import { buildFamily, generations, type Family } from './graph';
import { usePref } from './prefs';

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
 */
export function useMeChosen(): string | null {
  const f = useFamily();
  const me = usePref(`me:${f.graph.tree.id}`);
  return me && me !== BROWSING && f.byId.has(me) ? me : null;
}

/** Whether the reader has answered "Who are you?" for this tree (including "just browsing"). */
export function useMeAnswered(): boolean {
  const f = useFamily();
  return usePref(`me:${f.graph.tree.id}`) !== null;
}
