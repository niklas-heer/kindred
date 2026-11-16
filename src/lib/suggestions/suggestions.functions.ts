// The server functions of suggestions from the family (docs in suggest.server.ts, review.server.ts and reads.server.ts, which
// check every rule again):
//
//   anyone who reads   the family's two switches (whether guests may suggest and attach files), and their own suggestions
//   suggest            make one and withdraw your own: a member (`requireMember`; the role is checked inside), or a share-link
//                      guest (`requireReader`) while the family lets guests suggest
//   review-suggestions the waiting suggestions, their counts and a missing relative's possible matches; approve, decline,
//                      and close an approval that cannot finish (an editor)
//   manage-access      change the switches (a steward)
//
// A guest is known by the `kindred_voter` cookie (suggester.server.ts), which the server makes with their first suggestion and
// sends only once it was taken; their name is needed with that first one. Files go through the upload route
// (src/routes/api/suggestion-upload.$tree.$id.ts), which takes the bytes as they come, and are served by
// src/routes/api/suggestion-file.$tree.$id.ts.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { MAX_GUEST_NAME } from '../votes/types';
import { MAX_NOTE, MAX_REASON, SUGGESTION_KINDS, type SuggestionPayload, type SuggestionView } from './types';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const suggestionId = z.string().regex(/^[0-9a-f-]{36}$/);
const person = z.string().min(1).max(200);
// A little room over the limits for line endings the server folds; the server holds the limits itself.
const note = z.string().max(MAX_NOTE * 2).optional();
const reason = z.string().max(MAX_REASON * 2).optional();
/** A suggestion's values: checked against its kind and the record by suggest.server.ts, so here only bounded in size. */
const payload = z.record(z.string(), z.unknown()).refine((p) => JSON.stringify(p).length <= 20_000);

const guard = () => import('../auth/guard.server');
const suggest = () => import('./suggest.server');
const review = () => import('./review.server');
const reads = () => import('./reads.server');

/** The member asking, with the role `action` needs (`read`: a read, which a suspended family or a demo still answers). */
async function reviewer(t: string, action: 'review-suggestions' | 'manage-access', read = false) {
  const m = await (await guard()).requireCan(t, action, { read });
  return { id: m.user.id, name: m.user.name, role: m.role, person: m.person, personConfirmed: m.personConfirmed };
}

/** Who is asking in this request, to read or withdraw their own (suggester.server.ts). */
async function asking(t: string) {
  const [{ getRequest }, { suggesterOf }] = await Promise.all([import('@tanstack/react-start/server'), import('./suggester.server')]);
  return suggesterOf(t, getRequest());
}

/** Who is making a suggestion in this request, with a guest's name and network (suggester.server.ts). */
async function making(t: string, name: string | undefined) {
  const [{ getRequest }, { makerOf }] = await Promise.all([import('@tanstack/react-start/server'), import('./suggester.server')]);
  return makerOf(t, getRequest(), { name });
}

/** The retry key for a change, bound to who sends it and to everything else they sent (see db.server.ts `once`). */
function opOf<D extends { opKey?: string }>(user: string, data: D) {
  if (!data.opKey) return undefined;
  const { opKey: key, ...rest } = data;
  return { key, user, payload: rest };
}

// ---------- reads ----------

/** Whether guests may suggest and attach files: a guest's page asks before it offers to. */
export const getSuggestSettings = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<{ guests: boolean; guestFiles: boolean }> => {
    await (await guard()).requireReader(data.tree);
    return (await suggest()).suggestSettings(data.tree);
  });

export const suggestSettingsQuery = (t: string) =>
  queryOptions({ queryKey: ['suggestions', t, 'settings'], queryFn: () => getSuggestSettings({ data: { tree: t } }), staleTime: 60_000 });

/** The reader's own suggestions (about one person when `person` is given); a guest's by their cookie, none without one. */
export const getMySuggestions = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, person: person.optional() }))
  .handler(async ({ data }): Promise<SuggestionView[]> => {
    const { by } = await asking(data.tree);
    return (await reads()).mySuggestions(data.tree, by, { person: data.person });
  });

export const mySuggestionsQuery = (t: string, p?: string) =>
  queryOptions({ queryKey: ['suggestions', t, 'mine', p ?? null], queryFn: () => getMySuggestions({ data: { tree: t, person: p } }), staleTime: 30_000 });

export const getWaitingSuggestions = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, person: person.optional() }))
  .handler(async ({ data }): Promise<SuggestionView[]> => {
    const me = await reviewer(data.tree, 'review-suggestions', true);
    return (await reads()).waitingSuggestions(data.tree, me, { person: data.person });
  });

export const waitingSuggestionsQuery = (t: string, p?: string) =>
  queryOptions({ queryKey: ['suggestions', t, 'waiting', p ?? null], queryFn: () => getWaitingSuggestions({ data: { tree: t, person: p } }), staleTime: 30_000 });

/** How many wait, in all and per person: the navigation's count and a person page's. */
export const getSuggestionCounts = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }): Promise<{ total: number; people: Record<string, number> }> => {
    const me = await reviewer(data.tree, 'review-suggestions', true);
    return (await reads()).suggestionCounts(data.tree, me);
  });

export const suggestionCountsQuery = (t: string) =>
  queryOptions({ queryKey: ['suggestions', t, 'counts'], queryFn: () => getSuggestionCounts({ data: { tree: t } }), staleTime: 60_000 });

/** The people already in the tree a suggested missing relative may be, best first. */
export const getMatchCandidates = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id: suggestionId }))
  .handler(async ({ data }): Promise<{ person: string; score: number }[]> => {
    const me = await reviewer(data.tree, 'review-suggestions', true);
    return (await review()).matchCandidates(data.tree, me, data.id);
  });

export const matchCandidatesQuery = (t: string, id: string) =>
  queryOptions({ queryKey: ['suggestions', t, 'matches', id], queryFn: () => getMatchCandidates({ data: { tree: t, id } }), staleTime: 30_000 });

// ---------- changes ----------

/** What a suggestion's change leaves stale: the family's suggestions (lists, counts, settings). */
export const suggestionKeys = (t: string) => [['suggestions', t]];
/** What an approval leaves stale as well: the records it changed (people, events, sources) and their history. */
export const approvalKeys = (t: string) => [...suggestionKeys(t), ['graph', t], ['person', t], ['events', t], ['sources', t], ['history', t], ['chronicle', t]];

export const setSuggestSettings = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, guests: z.boolean(), guestFiles: z.boolean(), opKey }))
  .handler(async ({ data }) => {
    const me = await reviewer(data.tree, 'manage-access');
    await (await suggest()).saveSuggestSettings(data.tree, me, { guests: data.guests, guestFiles: data.guestFiles }, opOf(me.id, data));
  });

/**
 * Makes a suggestion. A guest gives their `name` with their first one (later ones keep it), and the response sets their
 * `kindred_voter` cookie when they have none yet, only once the suggestion was taken. The retry key is bound to the member's
 * account or the guest's cookie, so a retry after a lost response is the same suggestion. (A new guest whose first response
 * was lost lost its cookie too: their retry is refused as sent by someone else, never a second suggestion.) The family's
 * reviewers' devices are told afterwards (push.server.ts); the page does not wait.
 */
export const createSuggestionFn = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree, kind: z.enum(SUGGESTION_KINDS), person: person.nullable(), payload, note, name: z.string().max(MAX_GUEST_NAME * 2).optional(), opKey,
  }))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { by, account, setCookie } = await making(data.tree, data.name);
    const made = await (await suggest()).createSuggestion(data.tree, by, {
      kind: data.kind, person: data.person ?? null, payload: data.payload as SuggestionPayload, note: data.note,
    }, undefined, opOf(by.kind === 'member' ? by.who.id : by.key, data));
    const [{ appendResponseHeader }, { notifySuggestion }, { store }] = await Promise.all([
      import('@tanstack/react-start/server'), import('./push.server'), import('../db.server'),
    ]);
    if (setCookie) appendResponseHeader('Set-Cookie', setCookie);
    store.keepAlive(notifySuggestion(data.tree, { by: account }));
    return made;
  });

/** Withdraws the reader's own waiting suggestion (a guest's by their cookie); its files go. */
export const withdrawSuggestionFn = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: suggestionId, opKey }))
  .handler(async ({ data }) => {
    const { by } = await asking(data.tree);
    await (await suggest()).withdrawSuggestion(data.tree, by, data.id, undefined, opOf(by.kind === 'member' ? by.who.id : by.key, data));
  });

/**
 * Approves a waiting suggestion, as suggested or with the reviewer's `adjusted` values: for a correction with the values the
 * reviewer was shown (`seen`), for a missing relative as someone already in the tree (`existing`), and with the title of the
 * source its files go to (`sourceTitle`; by default written in the reviewer's language).
 */
export const approveSuggestionFn = createServerFn({ method: 'POST' })
  .validator(z.object({
    tree, id: suggestionId, adjusted: payload.nullable().optional(), seen: payload.optional(), existing: person.optional(), sourceTitle: z.string().max(600).optional(),
  }))
  .handler(async ({ data }) => {
    const me = await reviewer(data.tree, 'review-suggestions');
    const { locale } = await (await import('../i18n/request.server')).localeOfRequest();
    return (await review()).approveSuggestion(data.tree, me, data.id, (data.adjusted ?? null) as SuggestionPayload | null, {
      seen: data.seen, existing: data.existing, sourceTitle: data.sourceTitle, locale,
    });
  });

/** Declines a waiting suggestion, with an optional reason its suggester sees; its files are deleted. */
export const declineSuggestionFn = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: suggestionId, reason, opKey }))
  .handler(async ({ data }) => {
    const me = await reviewer(data.tree, 'review-suggestions');
    await (await review()).declineSuggestion(data.tree, me, data.id, data.reason, undefined, opOf(me.id, data));
  });

/** Closes an approval that changed records but cannot finish, as approved in part. */
export const closePartlyAppliedFn = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: suggestionId, opKey }))
  .handler(async ({ data }) => {
    const me = await reviewer(data.tree, 'review-suggestions');
    return (await review()).closePartlyApplied(data.tree, me, data.id, undefined, opOf(me.id, data));
  });
