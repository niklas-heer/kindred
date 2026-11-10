// After a change to the gallery, the pictures, the people in them and the portraits are all out of date.
import type { QueryClient } from '@tanstack/react-query';
import { graphQuery } from '~/lib/api';

export function refreshPhotos(qc: QueryClient, tree: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['gallery', tree] }),
    qc.invalidateQueries({ queryKey: ['person-photos', tree] }),
    qc.invalidateQueries({ queryKey: graphQuery(tree).queryKey }),
    // The family's feed shows a day's uploads and a post's pictures.
    qc.invalidateQueries({ queryKey: ['feed', tree] }),
  ]);
}
