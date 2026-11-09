// Approving a proposal: the card's arguments go to the existing server functions (api.ts, person.functions.ts,
// photos.functions.ts, houses.functions.ts, research.functions.ts and the rest), exactly as the forms send them, under the reader's own role. Nothing
// here writes on its own; the server checks the role and the family's rules again on every call. A family draft is
// approved row by row by FamilyDraft.tsx, which calls applyFamilyBatch (family-batch.functions.ts).
import type { QueryClient } from '@tanstack/react-query';
import { addRelative, addStory, deleteStory, graphQuery, linkRelative, opKeys, patchPerson, removePerson, setPartnershipEnd, unlinkRelative, updateHouse, upsertPlaces } from '~/lib/api';
import { addPersonField, deletePersonField, getEditSnapshot, savePersonEdit, setDiedPlace, setLook } from '~/lib/person.functions';
import { deleteAlbum, removeGalleryPhoto, removePhotoTag, saveAlbum, saveGalleryPhoto, tagPhoto } from '~/lib/photos.functions';
import { createHouseFn, setHouseMembersFn, updateHouseSettings } from '~/lib/houses.functions';
import { getHouseMeanings, saveHouseMeaning } from '~/lib/house-meaning.functions';
import { setPersonDisplay } from '~/lib/portrait.functions';
import { addResearchLink, removeResearchDocument, removeResearchLink, removeResearchNote, removeResearchProject, saveResearchDocument, saveResearchNote, saveResearchProject } from '~/lib/research.functions';
import { updateFamilyDetails } from '~/lib/family-details.functions';
import { setPartnershipDetails } from '~/lib/partnership.functions';
import { CHANGED_SINCE_OPENED, defaultVisibility, fieldInput } from '~/components/fields/model';
import { detailsOf, fieldsOf, mergeEdit, mergeField } from './apply-merge';
import { proposalArgs, type Proposal, type ProposalArgs } from '~/lib/ai/types';

/** A form's retry keys: the same approval sent twice reuses its key, so a lost reply can't write twice. */
export type ApprovalKeys = ReturnType<typeof opKeys>;
export const approvalKeys = () => opKeys();

/** Sends one approved proposal. Throws the server's message when the family or the reader's role refuses it. */
export async function applyProposal(tree: string, p: Proposal, args: ProposalArgs, keys: ApprovalKeys, qc: QueryClient): Promise<void> {
  if (p.kind === 'family') throw new Error('ai.famRefused');
  const parsed = proposalArgs[p.kind].safeParse(args);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'ai.err_check_fields');
  const a = parsed.data as Record<string, any>;
  const opKey = keys.for(p.kind, args);

  if (p.kind === 'add-person') {
    await addRelative({ data: { tree, anchor: a.anchor, relation: a.relation, coParent: a.coParent, person: { given: a.given, furtherGiven: a.furtherGiven?.length ? a.furtherGiven : undefined, surname: a.surname || undefined, sex: a.sex, born: a.born || undefined, died: a.died || undefined, living: a.living }, partnership: a.partnership, opKey } });
  } else if (p.kind === 'link-relative') {
    await linkRelative({ data: { tree, anchor: a.anchor, person: a.person, relation: a.relation, coParent: a.coParent, partnership: a.partnership, opKey } });
  } else if (p.kind === 'add-story') {
    await addStory({ data: { tree, person: a.person, kind: a.kind, title: a.title || undefined, body: a.body, opKey } });
  } else if (p.kind === 'set-dates') {
    await patchPerson({ data: { tree, id: a.person, patch: { born: a.born || undefined, bornPlace: a.bornPlace || undefined, died: a.died || undefined }, opKey } });
    // The death place has its own endpoint, with its own retry key, so a lost reply cannot write it twice.
    if (a.diedPlace !== undefined) await setDiedPlace({ data: { tree, id: a.person, place: a.diedPlace || null, opKey: keys.for('set-dates:died-place', { person: a.person, place: a.diedPlace }) } });
  } else if (p.kind === 'add-field') {
    // The card's choice of level. A proposal saved before there were levels has the old flag instead.
    const visibility = a.visibility ?? (typeof a.private === 'boolean' ? (a.private ? 'editors' : 'family') : defaultVisibility(a.type));
    const field = fieldInput.safeParse({ type: a.type, label: a.label ?? '', value: a.value, visibility });
    if (!field.success) throw new Error(field.error.issues[0]?.message ?? 'ai.err_detail_type');
    await addPersonField({ data: { tree, person: a.person, field: field.data, opKey } });
  } else if (p.kind === 'set-occupation') {
    await patchPerson({ data: { tree, id: a.person, patch: { occupation: a.occupation }, opKey } });
  } else if (p.kind === 'avatar') {
    await setLook({ data: { tree, id: a.person, look: a.look, opKey } });
  } else if (p.kind === 'house-settings') {
    await updateHouseSettings({ data: { tree, id: a.house, opKey, law: a.law, head: a.head, heir: a.heir, country: a.country } });
  } else if (p.kind === 'photo-details') {
    // The gallery saves a photo's details together: the empty strings clear nothing that the card did not change.
    for (const it of a.items as { key: string; taken?: string | null; place?: string | null; caption?: string | null; album?: string | null }[]) {
      await saveGalleryPhoto({ data: { tree, key: it.key, taken: it.taken ?? '', place: it.place ?? '', caption: it.caption ?? '', album: it.album ?? null, opKey: keys.for(`photo:${it.key}`, it) } });
    }
  } else if (p.kind === 'photo-album') {
    // A new album is made first; its id then goes to each photo. The album's own retry key replays its id after a lost reply.
    let albumId: string | null = a.albumId ?? null;
    if (!albumId) albumId = (await saveAlbum({ data: { tree, name: a.name, opKey: keys.for('album:new', a.name) } })).id;
    for (const it of a.items as { key: string; taken?: string | null; place?: string | null; caption?: string | null }[]) {
      await saveGalleryPhoto({ data: { tree, key: it.key, taken: it.taken ?? '', place: it.place ?? '', caption: it.caption ?? '', album: albumId, opKey: keys.for(`album-photo:${it.key}`, { ...it, albumId }) } });
    }
  } else if (p.kind === 'photo-tags') {
    for (const t of a.people as { person: string; box: { x: number; y: number; w: number; h: number } }[]) {
      await tagPhoto({ data: { tree, key: a.key, person: t.person, box: t.box, opKey: keys.for(`tag:${t.person}`, { key: a.key, ...t }) } });
    }
  } else if (p.kind === 'edit-person') {
    // The Edit tab's own save, at the revision just read: another change landing in between is refused by the server.
    const snap = await getEditSnapshot({ data: { tree, id: a.person } });
    const details = mergeEdit(snap, a);
    if (details) await savePersonEdit({ data: { tree, id: a.person, details, fields: fieldsOf(snap), revision: snap.revision, opKey: keys.for('edit-person', { ...args, revision: snap.revision }) } });
  } else if (p.kind === 'update-field') {
    const snap = await getEditSnapshot({ data: { tree, id: a.person } });
    const fields = mergeField(snap, a as Parameters<typeof mergeField>[1]);
    if (fields) await savePersonEdit({ data: { tree, id: a.person, details: detailsOf(snap), fields, revision: snap.revision, opKey: keys.for('update-field', { ...args, revision: snap.revision }) } });
  } else if (p.kind === 'remove-field') {
    await deletePersonField({ data: { tree, id: a.field, opKey } });
  } else if (p.kind === 'remove-story') {
    await deleteStory({ data: { tree, id: a.story } });
  } else if (p.kind === 'unlink') {
    await unlinkRelative({ data: { tree, parents: a.parents, partnership: a.partnership } });
  } else if (p.kind === 'partnership') {
    await setPartnershipDetails({ data: { tree, id: a.partnership, kind: a.kind, start: a.start, place: a.place, opKey } });
  } else if (p.kind === 'partnership-end') {
    await setPartnershipEnd({ data: { tree, id: a.partnership, end: a.end, endReason: a.endReason } });
  } else if (p.kind === 'remove-person') {
    await removePerson({ data: { tree, id: a.person } });
  } else if (p.kind === 'house-details') {
    // The designer saves a house's name, motto and arms together, so the arms go back as they are.
    const graph = await qc.fetchQuery({ ...graphQuery(tree), staleTime: 0 });
    const house = graph.houses.find((h) => h.id === a.house);
    if (!house) throw new Error('houses.err.not_found');
    if (house.name !== a.before.name || (house.motto ?? null) !== a.before.motto) throw new Error(CHANGED_SINCE_OPENED);
    await updateHouse({ data: { tree, id: a.house, name: a.name, motto: a.motto, arms: house.arms } });
  } else if (p.kind === 'house-create') {
    await createHouseFn({ data: { tree, opKey, name: a.name, motto: a.motto, country: a.country } });
  } else if (p.kind === 'house-members') {
    await setHouseMembersFn({ data: { tree, opKey, id: a.house, add: a.add, remove: a.remove } });
  } else if (p.kind === 'house-words') {
    const saved = (await getHouseMeanings({ data: { tree } }))[a.house];
    if (!saved) throw new Error('houses.err.not_found');
    await saveHouseMeaning({ data: { tree, house: a.house, opKey, name: saved.name, familyWords: a.familyWords, webSearched: saved.webSearched, note: saved.note, meanings: saved.meanings } });
  } else if (p.kind === 'album-rename') {
    await saveAlbum({ data: { tree, id: a.album, name: a.name, opKey } });
  } else if (p.kind === 'album-delete') {
    await deleteAlbum({ data: { tree, id: a.album, opKey } });
  } else if (p.kind === 'photo-remove') {
    await removeGalleryPhoto({ data: { tree, key: a.key, opKey } });
  } else if (p.kind === 'photo-untag') {
    await removePhotoTag({ data: { tree, id: a.tag, opKey } });
  } else if (p.kind === 'person-display') {
    await setPersonDisplay({ data: { tree, id: a.person, display: a.display, opKey } });
  } else if (p.kind === 'place-pin') {
    await upsertPlaces({ data: { tree, places: [{ name: a.name, lat: a.lat, lng: a.lng, country: a.country, move: a.move }], opKey } });
  } else if (p.kind === 'research-project') {
    await saveResearchProject({ data: { tree, id: a.id, title: a.title, summary: a.summary, private: a.private, opKey } });
  } else if (p.kind === 'research-note') {
    await saveResearchNote({ data: { tree, id: a.id, project: a.project, title: a.title, body: a.body, date: a.date ?? '', private: a.private, opKey } });
  } else if (p.kind === 'research-document') {
    await saveResearchDocument({ data: { tree, id: a.id, title: a.title, date: a.date ?? '', source: a.source ?? '', notes: a.notes, private: a.private, opKey } });
  } else if (p.kind === 'research-link') {
    const link = { tree, project: a.project, kind: a.kind, target: a.target, opKey };
    await (a.remove ? removeResearchLink({ data: link }) : addResearchLink({ data: link }));
  } else if (p.kind === 'research-remove') {
    if (a.what === 'project') await removeResearchProject({ data: { tree, id: a.id, opKey } });
    else if (a.what === 'note') await removeResearchNote({ data: { tree, project: a.project, id: a.id, opKey } });
    else await removeResearchDocument({ data: { tree, id: a.id, opKey } });
  } else if (p.kind === 'family-details') {
    await updateFamilyDetails({ data: { tree, opKey, name: a.name, tagline: a.tagline } });
  }
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['graph', tree] }),
    qc.invalidateQueries({ queryKey: ['person', tree] }),
    qc.invalidateQueries({ queryKey: ['chronicle', tree] }),
    qc.invalidateQueries({ queryKey: ['gallery', tree] }),
    qc.invalidateQueries({ queryKey: ['person-photos', tree] }),
    qc.invalidateQueries({ queryKey: ['house-settings', tree] }),
    qc.invalidateQueries({ queryKey: ['house-meanings', tree] }),
    qc.invalidateQueries({ queryKey: ['research', tree] }),
    // The widgets in the chat are built from the tree, so they follow what was just changed.
    qc.invalidateQueries({ queryKey: ['ai-widget', tree] }),
  ]);
}
