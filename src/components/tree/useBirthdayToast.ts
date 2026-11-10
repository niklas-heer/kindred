import { useEffect, useRef } from 'react';
import type { Family, Kinship } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { play } from '~/lib/sfx';
import { toast } from '~/lib/toast';
import { birthdaysOn } from '~/lib/tree-view';
import { birthdayNotices, type NoticePage } from './birthday-notices';

/** Once a day per tree: whose birthday is today, shown only to someone looking at the page. */
export function useBirthdayToast({ tree, f, kinFor, select }: { tree: string; f: Family; kinFor: (id: string) => Kinship | undefined; select: (id: string) => void }) {
  const t = useT();
  // The notice is armed once per tree, but shown later and acted on later still: it reads the page as it is then.
  const page = useRef<NoticePage>({ f, kinFor, select, t });
  useEffect(() => { page.current = { f, kinFor, select, t }; });
  useEffect(() => {
    const today = new Date();
    const key = `kindred:bday:${tree}:${today.toDateString()}`;
    try { if (localStorage.getItem(key)) return; } catch { return; }
    const who = birthdaysOn(f.graph.people, today);
    if (!who.length) return;
    let timer = 0;
    // Shown only to someone looking: the timer starts over whenever the tab is hidden and shown again.
    const arm = () => {
      clearTimeout(timer);
      if (!document.hidden) timer = window.setTimeout(show, 1200);
    };
    const disarm = () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', arm);
    };
    const show = () => {
      if (document.hidden) return;
      disarm();
      // Marked only once shown: a cancelled effect (StrictMode runs effects twice) must not eat it.
      try { localStorage.setItem(key, '1'); } catch {}
      play('fanfare');
      for (const notice of birthdayNotices(who, () => page.current)) toast(notice);
    };
    document.addEventListener('visibilitychange', arm);
    arm();
    return disarm;
  }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps
}
