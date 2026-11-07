// The signed-in reader's role in the current tree. Until accounts exist, the local user is the
// tree's steward; components already ask `useCan(action)`, so access control drops in here.
import { can, type Action, type Role } from './roles';

export function useRole(): Role {
  return 'steward';
}

export function useCan(action: Action): boolean {
  return can(useRole(), action);
}
