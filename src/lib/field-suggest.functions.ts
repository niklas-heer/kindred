// Server functions behind the field editor's suggestions. Kept apart from person.functions.ts: these change nothing.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Used } from './field-suggest';
import { audienceOf, fieldsVisibleTo, withoutPersonal } from './visibility';
import { LOCALES } from './i18n/languages';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const guard = () => import('./auth/guard.server');
const personId = z.string().min(1).max(120);

export interface FamilyWords { language: Used[]; level: Used[]; nationality: Used[]; religion: Used[] }

/** The languages, levels, nationalities and religions this family's visible fields already use, most used first. */
export const getFamilyWords = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<FamilyWords> => {
    const m = await (await guard()).requireCan(data.tree, 'edit-person');
    const seen = fieldsVisibleTo(withoutPersonal(audienceOf(m)));
    const rows = await (await import('./db.server')).db(data.tree).all<{ type: string; value: string }>(
      `SELECT type, value FROM person_field WHERE ${seen.sql} AND type IN ('languages', 'nationality', 'religion')`,
      ...seen.params,
    );
    const counts: Record<keyof FamilyWords, Map<string, number>> = { language: new Map(), level: new Map(), nationality: new Map(), religion: new Map() };
    const add = (k: keyof FamilyWords, v: unknown) => { if (typeof v === 'string' && v.trim()) counts[k].set(v.trim(), (counts[k].get(v.trim()) ?? 0) + 1); };
    for (const r of rows) {
      const v = JSON.parse(r.value) as Record<string, unknown>;
      if (r.type === 'languages') { add('language', v.language); add('level', v.level); }
      else if (r.type === 'nationality') add('nationality', v.country);
      else add('religion', v.name);
    }
    const list = (k: keyof FamilyWords) => [...counts[k]].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n).slice(0, 30);
    return { language: list('language'), level: list('level'), nationality: list('nationality'), religion: list('religion') };
  });
export const familyWordsQuery = (t: string) =>
  queryOptions({ queryKey: ['family-words', t], queryFn: () => getFamilyWords({ data: { tree: t } }), staleTime: 300_000 });

/** Close family's addresses to copy from, limited to what this reader may already see (see family-addresses.server.ts). */
export const getFamilyAddresses = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, person: personId }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-contact');
    return (await import('./family-addresses.server')).familyAddresses(data.tree, data.person, withoutPersonal(audienceOf(m)));
  });
export const familyAddressesQuery = (t: string, person: string) =>
  queryOptions({ queryKey: ['family-addresses', t, person], queryFn: () => getFamilyAddresses({ data: { tree: t, person } }), staleTime: 60_000 });

/**
 * Whether the address box may suggest whole addresses from OpenStreetMap (address-lookup.server.ts): on unless the
 * self-hoster switched it off or the operator's policy has it off for this family, and never in a demo. Asked once per page; a guest or a viewer is refused, as for the lookup.
 */
export const getAddressLookup = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'edit-contact');
    // The operator's policy (`feature.address_lookup`) decides with the server's setting: off for this family, the box
    // suggests towns from the offline gazetteer only.
    return { on: await (await import('./operator/policy.server')).allowed(data.tree, 'feature.address_lookup') };
  });
export const addressLookupQuery = (t: string) =>
  queryOptions({ queryKey: ['address-lookup', t], queryFn: () => getAddressLookup({ data: { tree: t } }), staleTime: Infinity, retry: false });

/**
 * Addresses for what is being typed, from OpenStreetMap through Photon: the browser asks here, never Photon itself.
 * POST, so the address stays out of URLs and access logs. Editing a contact is what this is for, so it needs that right,
 * which a guest, a viewer and a demo's visitor do not have.
 */
export const suggestAddressesOnline = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, text: z.string().trim().min(3).max(200), locale: z.enum(LOCALES) }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireCan(data.tree, 'edit-contact');
    // Refused on the server when the operator has it off for this family, whatever the browser asks.
    if (!(await (await import('./operator/policy.server')).allowed(data.tree, 'feature.address_lookup'))) return { ok: false as const, reason: 'off' as const };
    return (await import('./address-lookup.server')).suggestAddresses(data.tree, data.text, data.locale, m.user.id);
  });
