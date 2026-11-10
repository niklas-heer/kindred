// The birthday notices of the tree page (useBirthdayToast.ts), without React: built when they are shown, from what the
// page holds at that moment, and with an "Open" that selects through the page's `select` of the moment it is pressed.
// A notice outlives the render that armed it (it is shown a second later and stays for nine), so nothing in it may be
// the first render's: the family, the kinship labels, the language or the selection would all be stale.
import { displayName, type Family, type Kinship } from '../../lib/graph.ts';
import type { GPerson } from '../../lib/types.ts';
import type { Key, Locale, Vars } from '../../lib/i18n/dictionary.ts';
import { yourKinship } from '../../lib/i18n/kinship.ts';
import type { Toast } from '../../lib/toast.ts';

/** What the page holds now. */
export interface NoticePage {
  f: Family;
  kinFor: (id: string) => Kinship | undefined;
  select: (id: string) => void;
  t: ((key: Key, vars?: Vars) => string) & { locale: Locale };
}

/** One notice for each of the first two birthdays, read from `page()` now and again when "Open" is pressed. */
export function birthdayNotices(who: readonly { person: GPerson; age: number }[], page: () => NoticePage): Omit<Toast, 'id'>[] {
  const { f, kinFor, t } = page();
  return who.slice(0, 2).map(({ person: p, age }) => {
    const kin = kinFor(p.id);
    const named = f.byId.get(p.id) ?? p;
    return {
      title: t('tp.birthdayToast', { name: displayName(named, f), n: age }),
      body: kin ? `${yourKinship(kin, t.locale, { capital: true })}. ${t('tp.callDay')}` : t('tp.goodDay'),
      person: p.id,
      icon: 'cake-slice' as const,
      ms: 9000,
      action: { label: t('tp.open'), run: () => page().select(p.id) },
    };
  });
}
