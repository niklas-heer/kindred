// Making houses, for stewards: one house by hand (a name, a motto, a country), or one house for each surname among the people
// who have no house yet, chosen from a preview. Used by the Houses page and the GEDCOM import. The server checks the steward's
// permission first, and the name and the people are decided again there if the family changed meanwhile.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import { countryName, Flag } from '~/components/heraldry/Flag';
import { Dialog, ErrorState, Select, Skeleton, type SelectOption } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { COUNTRY_CODES } from '~/lib/houses';
import { createHouseFn, createHousesFromSurnamesFn, surnameGroupsQuery } from '~/lib/houses.functions';
import { errorText } from '~/lib/errortext';
import { compareText, useT, type Locale } from '~/lib/i18n';
import { toast } from '~/lib/toast';
import '~/styles/house.css';
import '~/styles/manage.css';

/** The countries a house can have, by their names in the reader's language, with the "no country" choice first. */
function countryOptions(locale: Locale, none: string): SelectOption<string>[] {
  const rest = COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code, locale), icon: <Flag code={code} size={16} /> }))
    .sort((a, b) => compareText(locale)(a.label, b.label));
  return [{ value: '', label: none }, ...rest];
}

/** A house by hand: its name is required; the motto and the country are optional. Opens on the new house's page. */
export function HouseCreateDialog({ open, onClose, tree }: { open: boolean; onClose: () => void; tree: string }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ids = useId();
  const [keys] = useState(() => opKeys());
  const [name, setName] = useState('');
  const [motto, setMotto] = useState('');
  const [country, setCountry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const clean = name.trim();
  const dirty = !!(name || motto || country);

  const create = useMutation({
    mutationFn: () => {
      const payload = { name: clean, motto: motto.trim() || null, country: country || null };
      return createHouseFn({ data: { tree, opKey: keys.for('create-house', payload), ...payload } });
    },
    onSuccess: async (made) => {
      keys.clear();
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      toast({ title: t('houses.created'), body: made.name, icon: 'crown' });
      setName('');
      setMotto('');
      setCountry('');
      setError(null);
      onClose();
      void navigate({ to: '/$tree/house/$house', params: { tree, house: made.id } });
    },
    onError: (e) => setError(errorText(e, t.locale)),
  });

  const close = () => {
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('houses.newTitle')}
      description={t('houses.newText')}
      dirty={dirty && !create.isSuccess}
      width={480}
      footer={
        <>
          <button type="button" className="btn" onClick={close} disabled={create.isPending}>{t('houses.cancel')}</button>
          <button type="submit" form={`${ids}-form`} className="btn primary" disabled={!clean || create.isPending}>
            {create.isPending ? t('houses.creating') : t('houses.create')}
          </button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="hm-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!clean || create.isPending) return;
          setError(null);
          create.mutate();
        }}
      >
        <label className="hp-field">
          <span>{t('houses.nameLabel')}</span>
          <input className="input" data-autofocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('houses.namePlaceholder')} autoComplete="off" required />
        </label>
        <label className="hp-field">
          <span>{t('houses.mottoLabel')}</span>
          <input className="input" value={motto} maxLength={160} onChange={(e) => setMotto(e.target.value)} autoComplete="off" />
        </label>
        <div className="hp-field">
          <span id={`${ids}-country`}>{t('houses.country')}</span>
          <Select aria-labelledby={`${ids}-country`} value={country} onChange={setCountry} options={countryOptions(t.locale, t('houses.countryNone'))} menuWidth={300} />
        </div>
        {error && <p role="alert" className="hp-error">{error}</p>}
      </form>
    </Dialog>
  );
}

/**
 * One house for each chosen surname. The choices are the surnames of people with no house yet; a surname that already names a
 * house cannot be chosen. Surnames with two or more people are chosen to begin with.
 */
export function SurnameHousesDialog({ open, onClose, tree }: { open: boolean; onClose: () => void; tree: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [keys] = useState(() => opKeys());
  // null until the steward touches the list: then the default choice (two or more people) applies.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groupsQ = useQuery({ ...surnameGroupsQuery(tree), enabled: open });
  const groups = groupsQ.data?.groups ?? [];
  const available = groups.filter((g) => !g.taken);
  const chosen = picked ?? new Set(available.filter((g) => g.people >= 2).map((g) => g.surname));
  const chosenNow = available.filter((g) => chosen.has(g.surname)).map((g) => g.surname);

  const make = useMutation({
    mutationFn: () => createHousesFromSurnamesFn({ data: { tree, opKey: keys.for('surname-houses', chosenNow), surnames: chosenNow } }),
    onSuccess: async (made) => {
      keys.clear();
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      void qc.invalidateQueries({ queryKey: ['surname-houses', tree] });
      toast({ title: t('houses.createdMany', { count: made.length }), icon: 'crown' });
      setPicked(null);
      setError(null);
      onClose();
    },
    onError: (e) => setError(errorText(e, t.locale)),
  });

  const toggle = (surname: string) => {
    const next = new Set(chosen);
    if (next.has(surname)) next.delete(surname);
    else next.add(surname);
    setPicked(next);
  };

  return (
    <Dialog
      open={open}
      onClose={() => { setError(null); onClose(); }}
      title={t('houses.surnamesTitle')}
      description={t('houses.surnamesText')}
      width={540}
      footer={
        <>
          <button type="button" className="btn" onClick={() => { setError(null); onClose(); }} disabled={make.isPending}>{t('houses.cancel')}</button>
          <button type="button" className="btn primary" onClick={() => { setError(null); make.mutate(); }} disabled={!chosenNow.length || make.isPending}>
            {make.isPending ? t('houses.creating') : t('houses.createCount', { count: chosenNow.length })}
          </button>
        </>
      }
    >
      {groupsQ.isPending ? (
        <Skeleton lines={4} />
      ) : groupsQ.isError ? (
        <ErrorState title={t('houses.surnamesError')} error={groupsQ.error} onRetry={() => void groupsQ.refetch()} />
      ) : groups.length === 0 ? (
        <p className="hp-none">{t('houses.surnamesNone')}</p>
      ) : (
        <>
          <div className="hm-tools">
            <button type="button" className="btn ghost" onClick={() => setPicked(new Set(available.map((g) => g.surname)))} disabled={!available.length}>
              {t('houses.selectAll')}
            </button>
            <button type="button" className="btn ghost" onClick={() => setPicked(new Set())} disabled={!chosenNow.length}>
              {t('houses.selectNone')}
            </button>
          </div>
          <ul className="manage-list" aria-label={t('houses.surnamesTitle')}>
            {groups.map((g) => {
              const on = !g.taken && chosen.has(g.surname);
              return (
                <li key={g.surname}>
                  <button type="button" className="hm-pick" aria-pressed={on} disabled={g.taken} onClick={() => toggle(g.surname)}>
                    <span className="hm-box" aria-hidden>{on && <Check size={15} />}</span>
                    <span className="hm-name"><b>{g.surname}</b></span>
                    <span className="hm-count">{g.taken ? t('houses.surnameTaken') : t('houses.surnamePeople', { count: g.people })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {error && <p role="alert" className="hp-error">{error}</p>}
    </Dialog>
  );
}
