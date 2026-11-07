// The signed-in reader: who they are, and their role in the current tree. The server checks the same
// roles (src/lib/auth/guard.server.ts), so hiding a control is never the only protection.
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { sessionQuery, type SessionInfo } from './auth/functions';
import { can, type Action, type Role } from './roles';

export { sessionQuery, type SessionInfo };

/** The session, once loaded (the tree's loader loads it first, so inside a tree it is always there). */
export function useSession(): SessionInfo | undefined {
  return useQuery(sessionQuery).data;
}

/** The reader's membership of a tree (the current one by default), or undefined. */
export function useMembership(tree?: string): SessionInfo['memberships'][number] | undefined {
  const current = useParams({ strict: false }).tree as string | undefined;
  const t = tree ?? current;
  return useSession()?.memberships.find((m) => m.tree === t);
}

/** The reader's role in the current tree; 'viewer' (can change nothing) when unknown. */
export function useRole(): Role {
  return useMembership()?.role ?? 'viewer';
}

export function useCan(action: Action): boolean {
  return can(useRole(), action);
}
