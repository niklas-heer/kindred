// The processing agreement (GDPR Art. 28) between the operator and each family that keeps its tree on this server. The operator
// writes it in the console (`processingAgreement`, an instance setting; docs/processing-agreement.md is a template to start
// from). While it is set, whoever makes a family, or becomes a family's first steward through an invitation, accepts it
// together with the terms, with one box (src/components/operator/TermsCheck.tsx), and the server records it in
// `terms_acceptance` with `kind = 'dpa'` (accounts migration 0044) in the same batch as the step. An operator wrote it and is
// not asked.
//
// For the sign-up lane (and anything else that makes a family): call `legalAcceptance` with what the form's box said, and put
// the statements it returns in the batch that makes the family. It throws `operator.err_terms` when something must be
// accepted and was not, before anything is written.
import type { Query } from '../store/index.ts';
import { acceptance, agreementVersion, termsNeeded, termsVersion, type TermsAction } from '../operator/terms.server.ts';

export { agreementVersion, termsVersion };

/** What a form must show: whether there are terms, a processing agreement, or both, for this account to accept. */
export async function legalToAccept(operator: boolean): Promise<{ terms: boolean; agreement: boolean }> {
  if (!(await termsNeeded(operator))) return { terms: false, agreement: false };
  const [t, a] = await Promise.all([termsVersion(), agreementVersion()]);
  return { terms: !!t, agreement: !!a };
}

/** The statements recording the terms and the processing agreement accepted for making `family` (none needed: none). */
export function legalAcceptance(user: { id: string; operator?: number }, accepted: boolean | undefined, family: string, action: TermsAction = 'family.create', at = Date.now()): Promise<Query[]> {
  return acceptance(user, accepted, action, family, at);
}
