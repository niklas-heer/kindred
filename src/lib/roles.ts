// Who may do what in a family tree. Every editing control asks `can(action)`; the server checks the
// same table, so hiding a button is never the only protection.
//
//   viewer      — browse the tree, the Atlas, the Almanac; react to memories and photos
//   contributor — also add memories, sayings, recipes and photos, and comment on them; suggest corrections
//   editor      — also add, edit and remove people and their links, places and contacts, and remove anyone's comment
//   steward     — also edit houses and their arms, delete albums, and manage who has access

export type Role = 'viewer' | 'contributor' | 'editor' | 'steward';

import type { Key } from './i18n/dictionary.ts';

/** Each role's name and one-line description, as translation keys (the Access page and the invitation show them). */
export const ROLES: { id: Role; label: Key; description: Key }[] = [
  { id: 'viewer', label: 'role.viewer', description: 'role.viewerDescription' },
  { id: 'contributor', label: 'role.contributor', description: 'role.contributorDescription' },
  { id: 'editor', label: 'role.editor', description: 'role.editorDescription' },
  { id: 'steward', label: 'role.steward', description: 'role.stewardDescription' },
];

export type Action =
  | 'view'
  | 'add-story'
  | 'upload-photo'
  | 'add-research'
  | 'edit-research'
  | 'edit-person'
  | 'add-person'
  | 'remove-person'
  | 'edit-contact'
  | 'edit-place'
  | 'edit-house'
  | 'delete-album'
  | 'manage-access'
  | 'view-statistics'
  | 'react'
  | 'comment'
  | 'remove-comment';

const RANK: Record<Role, number> = { viewer: 0, contributor: 1, editor: 2, steward: 3 };

const NEEDS: Record<Action, Role> = {
  view: 'viewer',
  'add-story': 'contributor',
  'upload-photo': 'contributor',
  'add-research': 'contributor',
  'edit-research': 'editor',
  'edit-person': 'editor',
  'add-person': 'editor',
  'remove-person': 'editor',
  'edit-contact': 'editor',
  'edit-place': 'editor',
  'edit-house': 'steward',
  'delete-album': 'steward',
  'manage-access': 'steward',
  'view-statistics': 'steward',
  react: 'viewer',
  comment: 'contributor',
  'remove-comment': 'editor',
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && RANK[role] >= RANK[NEEDS[action]];
}

/** The lowest role that may do something, for "Ask a steward to…" messages. */
export const needs = (action: Action): Role => NEEDS[action];
