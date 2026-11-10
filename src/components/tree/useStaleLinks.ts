import { useEffect, useRef } from 'react';
import type { Family } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { toast } from '~/lib/toast';

type PersonParams = { focus?: string; sel?: string; root?: string; to?: string };

/**
 * Someone in the URL who isn't in this tree (a stale link, a typo): say so once and tidy the URL.
 * People who were here a moment ago (removed with Undo) are dropped quietly.
 */
export function useStaleLinks(search: PersonParams, f: Family, tidy: (stale: (keyof PersonParams)[]) => void) {
  const known = useRef(new Set<string>());
  for (const p of f.graph.people) known.current.add(p.id);
  const told = useRef('');
  const t = useT();
  useEffect(() => {
    const stale = (['focus', 'sel', 'root', 'to'] as const).filter((k) => search[k] && !f.byId.has(search[k]!));
    if (!stale.length) return;
    const unseen = stale.some((k) => !known.current.has(search[k]!));
    tidy(stale);
    // Once per stale link, even if the effect runs again before the URL is tidied.
    const key = stale.map((k) => search[k]).join('|');
    if (told.current === key) return;
    told.current = key;
    if (unseen) toast({ title: t('tp.toastStale'), body: t('tp.toastStaleBody'), ms: 6000 });
  }, [search.focus, search.sel, search.root, search.to, f]); // eslint-disable-line react-hooks/exhaustive-deps
}
