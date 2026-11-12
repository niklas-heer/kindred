// The operator's notice about a personal data breach that affects this family (src/lib/gdpr/breach.server.ts), shown to its
// stewards only, until its end date or until the breach is closed. Deliberately small and self-contained: a bar fixed to the
// bottom of the page, so it takes no row from the family's layout. A steward may put it away for this browser session.
// (The `policy` lane's announcements may take this over: then this becomes one kind of announcement.)
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { useT } from '~/lib/i18n';
import { breachNoticesQuery } from '~/lib/gdpr/gdpr.functions';
import { useMembership, useSession } from '~/lib/session';
import './gdpr.css';

const KEY = 'kindred.breach-notice.dismissed';
const dismissedIds = (): string[] => {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[]; } catch { return []; }
};

export function BreachNotice({ tree }: { tree: string }) {
  const t = useT();
  const m = useMembership();
  const session = useSession();
  // Stewards only, and never a preview (it answers as someone else) or a demo.
  const enabled = m?.role === 'steward' && !session?.viewAs && !session?.demo && !session?.guest;
  const { data } = useQuery({ ...breachNoticesQuery(tree), enabled });
  const [hidden, setHidden] = useState<string[]>(() => (typeof window === 'undefined' ? [] : dismissedIds()));
  const notice = enabled ? data?.find((n) => !hidden.includes(n.id)) : undefined;
  if (!notice) return null;
  const dismiss = () => {
    const next = [...hidden, notice.id];
    setHidden(next);
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  };
  return (
    <div className="gdpr-notice" role="region" aria-label={t('gdpr.notice_label')}>
      <ShieldAlert size={18} aria-hidden />
      <div>
        <b>{t('gdpr.notice_title')}</b>
        <p>{notice.notice}</p>
      </div>
      <button type="button" className="btn ghost icon" onClick={dismiss} aria-label={t('gdpr.notice_dismiss')}><X size={16} /></button>
    </div>
  );
}
