// The server's terms of use, accepted (accounts migration 0037, `terms_acceptance`; docs/hosting-many-families.md). While the
// operator has written terms, whoever makes a family and whoever accepts an invitation to be a family's steward ticks
// "I accept the terms"; the server refuses without it and records the account, the terms' version (a short hash of their
// text, so a changed text is a new version) and when. An operator wrote the terms and is not asked. Without terms, nobody is.
import { AuthError } from '../auth/errors.ts';
import { translate } from '../i18n/dictionary.ts';
import { q, type Query } from '../store/index.ts';
import { instanceSettings } from './settings.server.ts';

export type TermsAction = 'family.create' | 'invite.steward';

/** The current terms' version (16 hex characters of their SHA-256), or null when the server has none. */
export async function termsVersion(): Promise<string | null> {
  const text = (await instanceSettings()).terms.trim();
  if (!text) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether this account must accept the terms for this step: the server has terms, and the account is not an operator. */
export async function termsNeeded(operator: boolean): Promise<boolean> {
  return !operator && (await termsVersion()) !== null;
}

/** The refusal for a step taken without accepting the terms. */
export const termsRefused = () => new AuthError('invalid', translate('en', 'operator.err_terms'));

/**
 * The statement that records `user` accepting the terms for `action`, to go in the same batch as the step; none when no
 * terms are needed. Throws when they are needed and were not accepted.
 */
export async function acceptance(user: { id: string; operator?: number }, accepted: boolean | undefined, action: TermsAction, family: string | null, at = Date.now()): Promise<Query[]> {
  if (user.operator === 1) return [];
  const version = await termsVersion();
  if (version === null) return [];
  if (!accepted) throw termsRefused();
  return [q('INSERT INTO terms_acceptance (user, version, at, action, family) VALUES (?, ?, ?, ?, ?)', user.id, version, at, action, family)];
}

/** For an invitation: a steward's invitation asks for the terms (the statement to record them), any other none. */
export async function inviteAcceptance(invite: { role: string; tree: string }, user: { id: string; operator?: number }, accepted: boolean | undefined): Promise<Query[]> {
  return invite.role === 'steward' ? acceptance(user, accepted, 'invite.steward', invite.tree) : [];
}

/** Whether taking this invitation needs the terms accepted: before a passkey is made for it, so nobody makes one in vain. */
export async function inviteNeedsTerms(invite: { role: string }, operator = false): Promise<boolean> {
  return invite.role === 'steward' && (await termsNeeded(operator));
}
