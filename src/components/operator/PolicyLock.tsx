// The one sentence beside a steward's control that the server's operator has locked (docs/hosting-many-families.md,
// "Policies"): why it is off, and how to reach the operator. The control stays in view, off. Members are never shown it.
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { richText, useT } from '~/lib/i18n';
import { publicInstanceQuery } from '~/lib/operator/operator.functions';
import type { PolicyLock } from '~/lib/operator/policy';
import { isEmail } from '~/lib/operator/shared';
import './operator.css';

export function PolicyLockNote({ reason, children }: { reason: PolicyLock['reason']; children?: string }) {
  const t = useT();
  const { data } = useQuery(publicInstanceQuery);
  const contact = data?.contactEmail;
  const text = children ?? (reason === 'deployment' ? t('policy.lock.deployment') : reason === 'status' ? t('policy.lock.status') : t('policy.lock.operator'));
  return (
    <p className="policy-lock" role="note">
      <Lock size={14} aria-hidden />
      <span>
        {text}{' '}
        {contact ? richText(t, 'policy.lock.contact', { email: isEmail(contact) ? <a href={`mailto:${contact}`}>{contact}</a> : <>{contact}</> }) : null}
      </span>
    </p>
  );
}
