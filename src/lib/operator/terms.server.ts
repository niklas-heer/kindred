// The server's terms of use and its processing agreement, accepted (accounts migrations 0037 and 0044, `terms_acceptance`;
// docs/hosting-many-families.md, docs/gdpr.md). While the operator has written terms or a processing agreement, whoever makes a family and whoever accepts an invitation to be a family's steward ticks
// "I accept the terms"; the server refuses without it and records the account, the terms' version (a short hash of their
// text, so a changed text is a new version) and when. An operator wrote the terms and is not asked. Without terms, nobody is.
import { AuthError } from '../auth/errors.ts';
import { translate } from '../i18n/dictionary.ts';
import { q, type Query } from '../store/index.ts';
import { instanceSettings } from './settings.server.ts';

export type TermsAction = 'family.create' | 'invite.steward';
/** What an acceptance row records (accounts migration 0044): the terms, or the processing agreement (src/lib/gdpr/dpa.server.ts). */
export type AcceptanceKind = 'terms' | 'dpa';

/** A text's version: 16 hex characters of its SHA-256, or null for no text. */
async function versionOf(raw: string): Promise<string | null> {
  const text = raw.trim();
  if (!text) return null;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The current terms' version (16 hex characters of their SHA-256), or null when the server has none. */
export async function termsVersion(): Promise<string | null> {
  return versionOf((await instanceSettings()).terms);
}

/** The current processing agreement's version, or null when the operator has set none. */
export async function agreementVersion(): Promise<string | null> {
  return versionOf((await instanceSettings()).processingAgreement);
}

/** The versions to accept for a step: the terms and the processing agreement, those the server has. */
async function versions(): Promise<{ kind: AcceptanceKind; version: string }[]> {
  const [terms, dpa] = await Promise.all([termsVersion(), agreementVersion()]);
  return [...(terms ? [{ kind: 'terms' as const, version: terms }] : []), ...(dpa ? [{ kind: 'dpa' as const, version: dpa }] : [])];
}

/**
 * Whether this account must accept something for this step: the server has terms or a processing agreement, and the account is
 * not an operator (who wrote them). One box accepts both; the page names those there are.
 */
export async function termsNeeded(operator: boolean): Promise<boolean> {
  return !operator && (await versions()).length > 0;
}

/** The refusal for a step taken without accepting the terms. */
export const termsRefused = () => new AuthError('invalid', translate('en', 'operator.err_terms'));

/**
 * The statements that record `user` accepting the terms and the processing agreement for `action`, to go in the same batch as
 * the step: one row for each the server has (`kind` 'terms' or 'dpa'), none when it has neither. Throws when something must be
 * accepted and was not.
 */
export async function acceptance(user: { id: string; operator?: number }, accepted: boolean | undefined, action: TermsAction, family: string | null, at = Date.now()): Promise<Query[]> {
  if (user.operator === 1) return [];
  const due = await versions();
  if (!due.length) return [];
  if (!accepted) throw termsRefused();
  return due.map((v) => q('INSERT INTO terms_acceptance (user, version, at, action, family, kind) VALUES (?, ?, ?, ?, ?, ?)', user.id, v.version, at, action, family, v.kind));
}

/** For an invitation: a steward's invitation asks for the terms (the statement to record them), any other none. */
export async function inviteAcceptance(invite: { role: string; tree: string }, user: { id: string; operator?: number }, accepted: boolean | undefined): Promise<Query[]> {
  return invite.role === 'steward' ? acceptance(user, accepted, 'invite.steward', invite.tree) : [];
}

/** Whether taking this invitation needs the terms accepted: before a passkey is made for it, so nobody makes one in vain. */
export async function inviteNeedsTerms(invite: { role: string }, operator = false): Promise<boolean> {
  return invite.role === 'steward' && (await termsNeeded(operator));
}
