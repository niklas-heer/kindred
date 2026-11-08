// One box for a whole address. Typing suggests towns from the family's own places and the offline gazetteer, which
// never leaves the app. For a street, "Look up this address" asks OpenStreetMap, and only when pressed: the button says
// where the text goes. A failed lookup changes nothing, so what was typed stays.
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, UsersRound } from 'lucide-react';
import { useMemo } from 'react';
import { placeSearchQuery } from '~/lib/api';
import { formatAddress, townQuery, type AddressParts } from '~/lib/address';
import { familyAddressesQuery, lookupAddressOnline } from '~/lib/field-suggest.functions';
import { displayName, type Family } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import type { Suggestion } from '~/lib/field-suggest';
import { countryName } from '../PlaceInput';
import { SuggestInput } from './SuggestInput';

export function AddressFinder({ tree, value, onChange, onPick, onBlur, label, labelledBy, placeholder, family }: {
  tree: string;
  value: string;
  onChange: (text: string) => void;
  onPick: (parts: AddressParts) => void;
  onBlur?: () => void;
  label?: string;
  labelledBy?: string;
  placeholder?: string;
  /** Offers close family's addresses to copy for this person, named by who has them. */
  family?: { person: string; fam: Family; onCopy: (parts: AddressParts) => void };
}) {
  const t = useT();
  const text = value.trim();
  const typed = townQuery(value);
  const [q] = useDebouncedValue(typed.q, { wait: 150 });
  const search = useQuery({ ...placeSearchQuery(tree, q), enabled: q.trim().length >= 2 });
  const hits = useMemo(() => (q.trim().length >= 2 ? search.data ?? [] : []), [q, search.data]);
  const options = useMemo<Suggestion[]>(() => hits.map((h, i) => ({
    value: String(i),
    label: h.name,
    hint: [h.region && h.region !== h.name ? h.region : '', countryName(h.country, t.locale)].filter(Boolean).join(', ') || undefined,
    used: h.uses !== undefined,
  })), [hits, t.locale]);

  const lookup = useMutation({ mutationFn: (typedText: string) => lookupAddressOnline({ data: { tree, text: typedText, locale: t.locale } }) });
  // An answer belongs to the text it was asked about; typing on makes it stale.
  const answer = lookup.variables === text ? lookup.data : undefined;
  const failed = lookup.variables === text && (lookup.isError || answer?.ok === false);
  const found = answer?.ok ? answer.hits : undefined;
  const relatives = useQuery({ ...familyAddressesQuery(tree, family?.person ?? ''), enabled: !!family }).data ?? [];
  const nameOf = (id: string) => { const p = family?.fam.byId.get(id); return p ? displayName(p, family!.fam) : undefined; };
  const canLookUp = text.length >= 5 && /\p{L}/u.test(text);

  const pickTown = (s: Suggestion) => {
    const h = hits[Number(s.value)];
    if (!h) return;
    const named = h.name.split(',').map((x) => x.trim());
    onPick({ street: typed.street, postcode: typed.postcode, city: named[0], country: h.country ? countryName(h.country, t.locale) : named.slice(1).join(', ') });
  };

  return (
    <div className="af">
      <SuggestInput value={value} onChange={onChange} onPick={pickTown} onBlur={onBlur} options={options} label={label} labelledBy={labelledBy} placeholder={placeholder ?? t('addr.placeholder')} listLabel={t('places.suggestedAria')} />
      {family && relatives.length > 0 && (
        <div className="af-family" role="group" aria-label={t('addr.family')}>
          <span className="af-family-title">{t('addr.family')}</span>
          {relatives.map((a) => {
            const who = a.who.map(nameOf).filter(Boolean).join(', ');
            return (
              <button type="button" className="af-result af-copy" key={formatAddress(a.parts)} onClick={() => family.onCopy(a.parts)}>
                <UsersRound size={15} aria-hidden />
                <span><b>{who}</b><small>{formatAddress(a.parts)}</small></span>
              </button>
            );
          })}
        </div>
      )}
      {canLookUp && (
        <div className="af-tools">
          <div className="af-ask">
            <button type="button" className="btn af-lookup" disabled={lookup.isPending} onClick={() => lookup.mutate(text)}>
              <Search size={14} aria-hidden /> {lookup.isPending ? t('addr.looking') : t('addr.lookup')}
            </button>
            <span className="subtle af-where">{t('addr.lookupHint')}</span>
          </div>
          {failed && <p className="subtle af-note" role="status">{t('addr.failed')}</p>}
          {found && !found.length && <p className="subtle af-note" role="status">{t('addr.none')}</p>}
          {found && found.length > 0 && (
            <div className="af-results" role="group" aria-label={t('addr.resultsAria')}>
              {found.map((h) => (
                <button type="button" key={h.id} className="af-result" onClick={() => { onPick(h.parts); lookup.reset(); }}>{h.label}</button>
              ))}
              <small className="subtle af-attr">{t('addr.attribution')}</small>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
