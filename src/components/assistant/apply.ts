// Approving a proposal: the card's arguments go to the existing server functions (api.ts, person.functions.ts,
// photos.functions.ts, houses.functions.ts), exactly as the forms send them, under the reader's own role. Nothing
// here writes on its own; the server checks the role and the family's rules again on every call. A family draft is
// approved row by row by FamilyDraft.tsx, which calls applyFamilyBatch (family-batch.functions.ts).
import type { QueryClient } from '@tanstack/react-query';
import { addRelative, addStory, linkRelative, opKeys, patchPerson } from '~/lib/api';
import { addPersonField, setDiedPlace, setLook } from '~/lib/person.functions';
import { saveAlbum, saveGalleryPhoto, tagPhoto } from '~/lib/photos.functions';
import { updateHouseSettings } from '~/lib/houses.functions';
import { fieldInput, privateByDefault } from '~/components/fields/model';
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
    await addRelative({ data: { tree, anchor: a.anchor, relation: a.relation, coParent: a.coParent, person: { given: a.given, surname: a.surname || undefined, sex: a.sex, born: a.born || undefined, died: a.died || undefined, living: a.living }, opKey } });
  } else if (p.kind === 'link-relative') {
    await linkRelative({ data: { tree, anchor: a.anchor, person: a.person, relation: a.relation, coParent: a.coParent, opKey } });
  } else if (p.kind === 'add-story') {
    await addStory({ data: { tree, person: a.person, kind: a.kind, title: a.title || undefined, body: a.body, opKey } });
  } else if (p.kind === 'set-dates') {
    await patchPerson({ data: { tree, id: a.person, patch: { born: a.born || undefined, bornPlace: a.bornPlace || undefined, died: a.died || undefined }, opKey } });
    // The death place has its own endpoint, with its own retry key, so a lost reply cannot write it twice.
    if (a.diedPlace !== undefined) await setDiedPlace({ data: { tree, id: a.person, place: a.diedPlace || null, opKey: keys.for('set-dates:died-place', { person: a.person, place: a.diedPlace }) } });
  } else if (p.kind === 'add-field') {
    // The card's Private switch (the proposal's default is the type's rule, see tools.server.ts).
    const isPrivate = typeof a.private === 'boolean' ? a.private : privateByDefault(a.type);
    const field = fieldInput.safeParse({ type: a.type, label: a.label ?? '', value: a.value, private: isPrivate });
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
  }
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['graph', tree] }),
    qc.invalidateQueries({ queryKey: ['person', tree] }),
    qc.invalidateQueries({ queryKey: ['chronicle', tree] }),
    qc.invalidateQueries({ queryKey: ['gallery', tree] }),
    qc.invalidateQueries({ queryKey: ['person-photos', tree] }),
    qc.invalidateQueries({ queryKey: ['house-settings', tree] }),
  ]);
}
