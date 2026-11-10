import { useCallback, useMemo } from 'react';
import { ancestorDepths, kinship, type Family, type Kinship } from '~/lib/graph';
import { kinshipLabel, useT } from '~/lib/i18n';

/** Kinship to the reader (`who`, the person they said they are), worked out lazily for the cards on screen. */
export function useKinLabels(f: Family, who: string | null | undefined) {
  const t = useT();
  const myAnc = useMemo(() => (who ? ancestorDepths(f, who) : new Map<string, number>()), [f, who]);
  // The cache is emptied when the family or the reader's chosen person changes, though it does not read either.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const kinCache = useMemo(() => new Map<string, Kinship | undefined>(), [f, who]);
  const kinFor = useCallback(
    (id: string) => {
      if (!who) return undefined;
      if (!kinCache.has(id)) {
        const k = kinship(f, who, id, myAnc);
        kinCache.set(id, k && k.label !== 'you' ? k : undefined);
      }
      return kinCache.get(id);
    },
    [kinCache, f, who, myAnc],
  );
  const kinOf = useCallback(
    (id: string) => {
      const k = kinFor(id);
      return k ? kinshipLabel(k, t.locale) : undefined;
    },
    [kinFor, t.locale],
  );
  return { kinFor, kinOf };
}
