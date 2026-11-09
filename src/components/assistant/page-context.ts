// What the reader is looking at, for the assistant: the page, and the person on it if there is one.
import { useRouterState } from '@tanstack/react-router';

export interface PageContext { path: string; personId?: string }

/** The page from a location. A person's page, or a person selected or centred on the tree. */
export function pageFrom(pathname: string, search: Record<string, unknown>, tree: string): PageContext {
  const profile = new RegExp(`^/${tree}/person/([^/]+)`).exec(pathname)?.[1];
  const onTree = pathname === `/${tree}` || pathname === `/${tree}/`;
  const picked = onTree ? (typeof search.sel === 'string' && search.sel) || (typeof search.focus === 'string' && search.focus) : undefined;
  const personId = profile ? decodeURIComponent(profile) : picked || undefined;
  return { path: pathname, ...(personId && { personId }) };
}

export function usePageContext(tree: string): PageContext {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  return pageFrom(path, search, tree);
}
