// Who may do what in a family tree. Every editing control asks `can(action)`; the server checks the
// same table, so hiding a button is never the only protection.
//
//   viewer      — browse the tree, the Atlas, the Almanac
//   contributor — also add memories, sayings, recipes and photos; suggest corrections
//   editor      — also add, edit and remove people and their links, places and contacts
//   steward     — also edit houses and their arms, delete albums, and manage who has access

export type Role = 'viewer' | 'contributor' | 'editor' | 'steward';

export const ROLES: { id: Role; label: string; description: string }[] = [
  { id: 'viewer', label: 'Viewer', description: 'Can browse everything, change nothing' },
  { id: 'contributor', label: 'Contributor', description: 'Can add memories, sayings, recipes and photos' },
  { id: 'editor', label: 'Editor', description: 'Can add and edit people, links, places and contacts' },
  { id: 'steward', label: 'Steward', description: 'Can edit houses and their arms, and manage access' },
];

export type Action =
  | 'view'
  | 'add-story'
  | 'upload-photo'
  | 'edit-person'
  | 'add-person'
  | 'remove-person'
  | 'edit-contact'
  | 'edit-place'
  | 'edit-house'
  | 'delete-album'
  | 'manage-access';

const RANK: Record<Role, number> = { viewer: 0, contributor: 1, editor: 2, steward: 3 };

const NEEDS: Record<Action, Role> = {
  view: 'viewer',
  'add-story': 'contributor',
  'upload-photo': 'contributor',
  'edit-person': 'editor',
  'add-person': 'editor',
  'remove-person': 'editor',
  'edit-contact': 'editor',
  'edit-place': 'editor',
  'edit-house': 'steward',
  'delete-album': 'steward',
  'manage-access': 'steward',
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && RANK[role] >= RANK[NEEDS[action]];
}

/** The lowest role that may do something, for "Ask a steward to…" messages. */
export const needs = (action: Action): Role => NEEDS[action];
