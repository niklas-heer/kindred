// Who is in a house, for stewards: people from the family are added by searching for them (or by taking a whole surname at
// once), and members are taken out. Nothing changes until "Save"; the server decides again on the house's members as they
// are then, and a retry of the same save writes nothing twice.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Portrait } from '~/components/Portrait';
import { Dialog } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { useFamily } from '~/lib/family';
import { lifespan } from '~/lib/graph';
import { memberOrder } from '~/lib/houses';
import { setHouseMembersFn } from '~/lib/houses.functions';
import { errorText } from '~/lib/errortext';
import { compareText, useT, type Locale } from '~/lib/i18n';
import { toast } from '~/lib/toast';
import type { GPerson, House } from '~/lib/types';
import '~/styles/house.css';
import '~/styles/manage.css';

const SHOWN = 40;
const CHIPS = 6;

const nameOf = (p: GPerson) => [p.given, p.surname].filter(Boolean).join(' ');
const flip = (set: Set<string>, id: string) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** People grouped by surname, most people first: a chip can take everyone with that surname at once. */
function bySurname(people: GPerson[], locale: Locale) {
  const cmp = compareText(locale);
  const groups = new Map<string, GPerson[]>();
  for (const p of people) {
    const s = p.surname?.trim();
    if (!s) continue;
    groups.set(s, [...(groups.get(s) ?? []), p]);
  }
  return [...groups].map(([surname, ps]) => ({ surname, people: ps })).sort((a, b) => b.people.length - a.people.length || cmp(a.surname, b.surname));
}

export function HouseMembersDialog({ open, onClose, tree, house, members }: {
  open: boolean; onClose: () => void; tree: string; house: House; members: GPerson[];
}) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const [keys] = useState(() => opKeys());
  const [query, setQuery] = useState('');
  const [add, setAdd] = useState<Set<string>>(() => new Set());
  const [remove, setRemove] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const inHouse = useMemo(() => new Set(members.map((p) => p.id)), [members]);
  const outside = useMemo(() => f.graph.people.filter((p) => !inHouse.has(p.id)).sort(memberOrder), [f, inHouse]);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = useMemo(
    () => (tokens.length ? outside.filter((p) => tokens.every((x) => `${p.given} ${p.surname ?? ''} ${p.nickname ?? ''} ${p.epithet ?? ''} ${p.title ?? ''}`.toLowerCase().includes(x))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outside, query],
  );
  const shown = found.slice(0, SHOWN);
  // Surnames to take in bulk: those of the search results, or of everyone outside the house when nothing is searched.
  const outsideBySurname = useMemo(() => bySurname(outside, t.locale), [outside, t.locale]);
  const chosenSurnames = new Set((tokens.length ? found : outside).map((p) => p.surname?.trim()).filter(Boolean));
  const surnameChips = outsideBySurname.filter((g) => chosenSurnames.has(g.surname)).slice(0, CHIPS);
  const memberChips = bySurname(members, t.locale).slice(0, CHIPS);
  const sortedMembers = [...members].sort(memberOrder);

  const dirty = add.size + remove.size > 0;
  const save = useMutation({
    mutationFn: () => {
      const payload = { id: house.id, add: [...add], remove: [...remove] };
      return setHouseMembersFn({ data: { tree, opKey: keys.for('house-members', payload), ...payload } });
    },
    onSuccess: async () => {
      keys.clear();
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      toast({ title: t('houses.membersSaved'), body: house.name, icon: 'crown' });
      setAdd(new Set());
      setRemove(new Set());
      setQuery('');
      onClose();
    },
    onError: (e) => setError(errorText(e, t.locale)),
  });

  const close = () => {
    setError(null);
    onClose();
  };

  const row = (p: GPerson, on: boolean, toggle: () => void, label: string, pressed: boolean) => (
    <li key={p.id}>
      <button type="button" className="hm-row" aria-pressed={pressed} onClick={toggle} disabled={save.isPending}>
        <Portrait person={p} tree={tree} size={32} frame={false} />
        <span className="hm-name">
          <b>{nameOf(p)}{p.epithet && <i> {p.epithet}</i>}</b>
          {lifespan(p, t.locale) && <small>{lifespan(p, t.locale)}</small>}
        </span>
        {on && <span className="hm-mark">{label}</span>}
      </button>
    </li>
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('houses.membersTitle', { name: house.name })}
      description={t('houses.membersText')}
      dirty={dirty}
      width={580}
      footer={
        <>
          <span className="hm-summary" aria-live="polite">{dirty ? t('houses.membersSummary', { add: add.size, remove: remove.size }) : t('houses.membersNone')}</span>
          <button type="button" className="btn" onClick={close} disabled={save.isPending}>{t('houses.cancel')}</button>
          <button type="button" className="btn primary" onClick={() => { setError(null); save.mutate(); }} disabled={!dirty || save.isPending}>
            {save.isPending ? t('houses.saving') : t('houses.membersSave')}
          </button>
        </>
      }
    >
      <section className="hm-section" aria-labelledby={`hm-add-${house.id}`}>
        <h3 id={`hm-add-${house.id}`} className="hp-eyebrow">{t('houses.membersAdd')}</h3>
        <label className="hm-search">
          <Search size={15} aria-hidden />
          <input className="input" type="search" data-autofocus value={query} placeholder={t('houses.membersSearch')} aria-label={t('houses.membersSearch')} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        </label>
        {!tokens.length && !outside.length && <p className="hm-empty">{t('houses.membersAllIn')}</p>}
        {!tokens.length && outside.length > 0 && <p className="hm-empty">{t('houses.membersHint')}</p>}
        {tokens.length > 0 && found.length === 0 && <p className="hm-empty">{t('houses.noMatch', { q: query.trim() })}</p>}
        {surnameChips.length > 0 && (
          <div className="hm-chips" role="group" aria-label={t('houses.membersBySurname')}>
            {surnameChips.map((g) => (
              <button
                key={g.surname}
                type="button"
                className="hm-chip"
                onClick={() => setAdd((s) => new Set([...s, ...g.people.map((p) => p.id)]))}
                disabled={save.isPending}
              >
                {t('houses.everyoneNamed', { name: g.surname, count: g.people.length })}
              </button>
            ))}
          </div>
        )}
        {shown.length > 0 && (
          <ul className="manage-list" aria-label={t('houses.membersAdd')}>
            {shown.map((p) => row(p, add.has(p.id), () => setAdd((s) => flip(s, p.id)), t('houses.toAdd'), add.has(p.id)))}
          </ul>
        )}
        {found.length > SHOWN && <p className="hm-empty">{t('houses.membersMore', { count: found.length - SHOWN })}</p>}
      </section>

      <section className="hm-section" aria-labelledby={`hm-in-${house.id}`}>
        <h3 id={`hm-in-${house.id}`} className="hp-eyebrow">{t('houses.membersIn', { count: members.length })}</h3>
        {members.length === 0 && <p className="hm-empty">{t('houses.none')}</p>}
        {memberChips.length > 0 && (
          <div className="hm-chips" role="group" aria-label={t('houses.membersBySurname')}>
            {memberChips.map((g) => (
              <button
                key={g.surname}
                type="button"
                className="hm-chip"
                onClick={() => setRemove((s) => new Set([...s, ...g.people.map((p) => p.id)]))}
                disabled={save.isPending}
              >
                {t('houses.takeOutNamed', { name: g.surname, count: g.people.length })}
              </button>
            ))}
          </div>
        )}
        {sortedMembers.length > 0 && (
          <ul className="manage-list" aria-label={t('houses.membersIn', { count: members.length })}>
            {sortedMembers.map((p) => row(p, remove.has(p.id), () => setRemove((s) => flip(s, p.id)), t('houses.toTakeOut'), remove.has(p.id)))}
          </ul>
        )}
      </section>

      {error && <p role="alert" className="hp-error">{error}</p>}
    </Dialog>
  );
}
