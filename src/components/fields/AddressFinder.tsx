// One box for a whole address, suggesting as you type. First the towns from the family's own places and the offline
// gazetteer, which never leaves the app; then, once there are a few letters, whole addresses from OpenStreetMap, which our
// server looks up with Photon (address-lookup.server.ts) so the browser never talks to anyone else. One line under the box
// says so. Picking an address fills the street, the postcode, the town and the country. A self-hoster can switch the
// online part off (KINDRED_ADDRESS_LOOKUP), and a guest never has it; the towns stay either way, and a failed lookup changes
// nothing, so what was typed stays.
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useQuery } from '@tanstack/react-query';
import { UsersRound } from 'lucide-react';
import { useId, useMemo } from 'react';
import { placeSearchQuery } from '~/lib/api';
import { formatAddress, townQuery, type AddressParts } from '~/lib/address';
import { addressLookupQuery, familyAddressesQuery, suggestAddressesOnline } from '~/lib/field-suggest.functions';
import { displayName, type Family } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { useMember } from '~/lib/session';
import type { Suggestion } from '~/lib/field-suggest';
import { countryName } from '../PlaceInput';
import { SuggestInput } from './SuggestInput';

/** Fewer letters than this and an address search finds too much to be any help. */
const MIN_LETTERS = 4;

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
  const noteId = useId();
  const typed = townQuery(value);
  const [q] = useDebouncedValue(typed.q, { wait: 150 });
  const search = useQuery({ ...placeSearchQuery(tree, q), enabled: q.trim().length >= 2 });
  const towns = useMemo(() => (q.trim().length >= 2 ? search.data ?? [] : []), [q, search.data]);

  // The online part: for members only, and only when this server has it on.
  const member = !!useMember(tree);
  const online = useQuery({ ...addressLookupQuery(tree), enabled: member }).data?.on === true;
  const [asked] = useDebouncedValue(value.trim(), { wait: 300 });
  const askable = online && asked.length >= MIN_LETTERS && /\p{L}/u.test(asked);
  const found = useQuery({
    queryKey: ['address-suggest', tree, t.locale, asked.toLowerCase()],
    queryFn: () => suggestAddressesOnline({ data: { tree, text: asked, locale: t.locale } }),
    enabled: askable,
    staleTime: 600_000,
    retry: false,
    // While the next answer is on its way, the last one stays, so the list does not blink with every key.
    placeholderData: (prev) => prev,
  });
  const addresses = useMemo(() => (askable && found.data?.ok ? found.data.hits : []), [askable, found.data]);

  const options = useMemo<Suggestion[]>(() => [
    ...towns.map((h, i) => ({
      value: `t${i}`,
      label: h.name,
      hint: [h.region && h.region !== h.name ? h.region : '', countryName(h.country, t.locale)].filter(Boolean).join(', ') || undefined,
      used: h.uses !== undefined,
    })),
    ...addresses.map((h, i) => ({ value: `a${i}`, label: h.parts.street || h.label, hint: [h.parts.postcode, h.parts.city, h.parts.country].filter(Boolean).join(' · ') || undefined, group: t('addr.resultsAria') })),
  ], [towns, addresses, t]);

  const relatives = useQuery({ ...familyAddressesQuery(tree, family?.person ?? ''), enabled: !!family }).data ?? [];
  const nameOf = (id: string) => { const p = family?.fam.byId.get(id); return p ? displayName(p, family!.fam) : undefined; };

  const pick = (s: Suggestion) => {
    const n = Number(s.value.slice(1));
    if (s.value.startsWith('a')) {
      const h = addresses[n];
      if (h) onPick(h.parts);
      return;
    }
    const h = towns[n];
    if (!h) return;
    const named = h.name.split(',').map((x) => x.trim());
    onPick({ street: typed.street, postcode: typed.postcode, city: named[0], country: h.country ? countryName(h.country, t.locale) : named.slice(1).join(', ') });
  };

  return (
    <div className="af" data-tour="address-finder">
      <SuggestInput value={value} onChange={onChange} onPick={pick} onBlur={onBlur} options={options} label={label} labelledBy={labelledBy} describedBy={online ? noteId : undefined} placeholder={placeholder ?? t('addr.placeholder')} listLabel={t('places.suggestedAria')} />
      {online && <small className="subtle af-where af-tools" id={noteId}>{t('addr.onlineNote')}</small>}
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
    </div>
  );
}
