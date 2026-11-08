import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { leaveGuestVisit } from '~/lib/auth/share.functions';
import { useT } from '~/lib/i18n';
import { useSession } from '~/lib/session';

/** Where a guest would have their account menu: says they are a guest, and lets them leave. Nothing for anyone else. */
export function GuestChip() {
  const t = useT();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  if (!session?.guest || session.user) return null;
  const leave = async () => {
    setBusy(true);
    try { await leaveGuestVisit(); } catch {}
    window.location.assign('/share/left');
  };
  return (
    <span className="guest-chip" title={t('share.guestHint')}>
      <UserRound size={15} aria-hidden /> <span className="guest-chip-label">{t('share.guest')}</span>
      <button className="btn ghost" disabled={busy} onClick={() => void leave()}>{t('share.leave')}</button>
    </span>
  );
}
