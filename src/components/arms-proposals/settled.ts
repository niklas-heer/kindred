// After a read that settled a house's arms vote, or started the next one (docs/arms-proposals.md, "Settlement"): the reads
// of the votes, of one vote and of a house's proposals settle as they are made and say so (`settled`). The house's arms
// then changed under a page that holds them (the graph is read once), so it reads them again, with the votes, the
// proposals and the reader's families (their shields), as a steward's close does.
//
//   const q = useQuery(voteQuery(tree, vote));
//   useSettledRefresh(tree, q.data?.settled, q.dataUpdatedAt);
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { armsKeys } from '~/lib/arms-proposals/proposals.functions';
import { myFamiliesQuery } from '~/lib/auth/functions';

/** Reads again what a settlement changed, once per answer that says it settled something (`at`: when it was answered). */
export function useSettledRefresh(tree: string, settled: boolean | undefined, at: number) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!settled) return;
    for (const queryKey of [...armsKeys(tree), myFamiliesQuery.queryKey]) void qc.invalidateQueries({ queryKey });
  }, [qc, tree, settled, at]);
}
