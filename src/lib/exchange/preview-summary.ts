// The counted lines of the import preview (the Import page), in the order the page shows them: what a GEDCOM file would
// add to the family, and what it holds that the family already has. No React, so the test runner loads it.
import type { Key } from '../i18n/dictionary.ts';
import type { ImportPreview } from './import.server.ts';

type Counts = Pick<
  ImportPreview,
  | 'addCount' | 'matchCount' | 'conflictCount' | 'parents' | 'unions' | 'duplicateParents' | 'duplicateUnions' | 'ambiguous'
  | 'pictures' | 'unlinked' | 'events' | 'duplicateEvents' | 'sources' | 'duplicateSources' | 'citations' | 'duplicateCitations'
>;

export interface SummaryLine { key: Key; count: number }

/** Whether the file would change nothing: no new person, link, partnership, life event, source or citation, and no conflict. */
export function nothingToAdd(p: Counts): boolean {
  return p.addCount + p.conflictCount + p.parents + p.unions + p.events + p.sources + p.citations === 0;
}

/** The preview's counted lines. The first lines always show; the rest only when there is something to count. */
export function summaryLines(p: Counts): SummaryLine[] {
  const lines: SummaryLine[] = [
    { key: 'exchange.import.summary.new', count: p.addCount },
    { key: 'exchange.import.summary.matched', count: p.matchCount },
    { key: 'exchange.import.summary.conflicts', count: p.conflictCount },
    { key: 'exchange.import.summary.parents', count: p.parents },
    { key: 'exchange.import.summary.unions', count: p.unions },
    { key: 'exchange.import.summary.dupes', count: p.duplicateParents + p.duplicateUnions },
  ];
  const optional: SummaryLine[] = [
    { key: 'exchange.import.summary.events', count: p.events },
    { key: 'exchange.import.summary.sources', count: p.sources },
    { key: 'exchange.import.summary.citations', count: p.citations },
    { key: 'exchange.import.summary.records_there', count: p.duplicateEvents + p.duplicateSources + p.duplicateCitations },
    { key: 'exchange.import.summary.ambiguous', count: p.ambiguous.length },
    { key: 'exchange.import.summary.pictures', count: p.pictures },
    { key: 'exchange.import.summary.unlinked', count: p.unlinked },
  ];
  return [...lines, ...optional.filter((l) => l.count > 0)];
}
