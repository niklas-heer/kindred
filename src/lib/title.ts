// Page titles: "Almanac · The Lindqvist–Ashworth family · Kindred". Built in each route's head() from
// the graph already in the query cache, so nothing extra is sent to the browser.
import type { QueryClient } from '@tanstack/react-query';
import { graphQuery } from './api';
import type { GPerson } from './types';

interface HeadCtx {
  match: { context: unknown; params: unknown };
}

const graphOf = (ctx: HeadCtx) => {
  const qc = (ctx.match.context as { queryClient?: QueryClient }).queryClient;
  const tree = (ctx.match.params as { tree?: string }).tree;
  return tree && qc ? qc.getQueryData(graphQuery(tree).queryKey) : undefined;
};

/** A title for a page under /$tree: section and/or person first, then the family, then Kindred. */
export function treeTitle(ctx: HeadCtx, ...parts: (string | undefined)[]): string {
  const name = graphOf(ctx)?.tree.name;
  return [...parts, name, 'Kindred'].filter(Boolean).join(' · ');
}

/** A person's plain name for a title, if they are in the tree. */
export function personName(ctx: HeadCtx, id: string | undefined): string | undefined {
  if (!id) return undefined;
  const p: GPerson | undefined = graphOf(ctx)?.people.find((x) => x.id === id);
  return p ? [p.given, p.surname].filter(Boolean).join(' ') : undefined;
}

/** head() for a section page: `head: sectionHead('Almanac')`. */
export const sectionHead = (section: string) => (ctx: HeadCtx) => ({ meta: [{ title: treeTitle(ctx, section) }] });
