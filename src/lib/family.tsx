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

/** Who "you" are in this tree: kinship labels are relative to this person. */
export function useMe(): string {
  const f = useFamily();
  const me = usePref(`me:${f.graph.tree.id}`);
  return me && f.byId.has(me) ? me : f.graph.tree.focus;
}
