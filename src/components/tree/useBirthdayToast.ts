import { useEffect } from 'react';
import { displayName, type Family, type Kinship } from '~/lib/graph';
import { useT, yourKinship } from '~/lib/i18n';
import { play } from '~/lib/sfx';
import { toast } from '~/lib/toast';
import { birthdaysOn } from '~/lib/tree-view';

/** Once a day per tree: whose birthday is today, shown only to someone looking at the page. */
export function useBirthdayToast({ tree, f, kinFor, select }: { tree: string; f: Family; kinFor: (id: string) => Kinship | undefined; select: (id: string) => void }) {
  const t = useT();
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
      for (const { person: p, age } of who.slice(0, 2)) {
        toast({
          title: t('tp.birthdayToast', { name: displayName(p, f), n: age }),
          body: kinFor(p.id) ? `${yourKinship(kinFor(p.id)!, t.locale, { capital: true })}. ${t('tp.callDay')}` : t('tp.goodDay'),
          person: p.id,
          icon: 'cake-slice',
          ms: 9000,
          action: { label: t('tp.open'), run: () => select(p.id) },
        });
      }
    };
    document.addEventListener('visibilitychange', arm);
    arm();
    return disarm;
  }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps
}
