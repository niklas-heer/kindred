// The storage key of a kept edit draft. Its own module because signing out (lib/auth/client.ts, in every page's entry
// chunk) clears the drafts, and importing it from autosave.ts would bring the editor's model and zod to the sign-in page.

/** Every kept draft's storage key starts with this, so signing out can clear them all. */
export const JOURNAL_PREFIX = 'kindred.edit-draft.';

export const journalKey = (user: string, tree: string, person: string) => `${JOURNAL_PREFIX}${user}.${tree}.${person}`;
