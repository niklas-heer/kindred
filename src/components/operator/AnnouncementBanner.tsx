// The operator's announcements (docs/hosting-many-families.md, "Announcements"): a small card at the foot of every page for a
// signed-in reader, until they dismiss it on this device. Plain text: the words are shown as typed, never as HTML. The server
// decides who sees which (src/lib/operator/policy.functions.ts): stewards' notes go to stewards and operators, never to a
// "View as" preview of someone else, and nothing shows in a demo.
import { useQuery } from '@tanstack/react-query';
import { Megaphone, X } from 'lucide-react';
import { useT } from '~/lib/i18n';
import { myAnnouncementsQuery } from '~/lib/operator/policy.functions';
import { setPref, usePref } from '~/lib/prefs';
import { useSession } from '~/lib/session';
import './operator.css';

const PREF = 'announcements:dismissed';

const dismissedOf = (raw: string | null): string[] => {
  try {
    const list = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export function AnnouncementBanner() {
  const t = useT();
  const session = useSession();
  const on = !!session?.user && !session.demo;
  const { data } = useQuery({ ...myAnnouncementsQuery, enabled: on });
  const dismissed = dismissedOf(usePref(PREF));
  const shown = on ? (data ?? []).filter((a) => !dismissed.includes(a.id)) : [];
  if (!shown.length) return null;
  // Only the ids still shown are kept, so the list never grows past what the server sends.
  const dismiss = (id: string) => setPref(PREF, JSON.stringify([...dismissed.filter((d) => (data ?? []).some((a) => a.id === d)), id]));
  return (
    <div className="announcements" role="region" aria-label={t('policy.banner_label')}>
      {shown.map((a) => (
        <div key={a.id} className="announcement" role="status">
          <Megaphone size={16} aria-hidden />
          <div>
            <b>{a.title}</b>
            {a.body && <p>{a.body}</p>}
          </div>
          <button type="button" className="btn icon ghost" onClick={() => dismiss(a.id)} aria-label={t('ui.dismiss')}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
