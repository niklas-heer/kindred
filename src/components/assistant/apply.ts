// Approving a proposal: the card's arguments go to the existing server functions (api.ts, person.functions.ts),
// exactly as the forms send them, under the reader's own role. Nothing here writes on its own; the server
// checks the role and the family's rules again on every call.
import type { QueryClient } from '@tanstack/react-query';
import { addRelative, addStory, linkRelative, opKeys, patchPerson } from '~/lib/api';
import { addPersonField } from '~/lib/person.functions';
import { fieldInput } from '~/components/fields/model';
import { proposalArgs, type Proposal, type ProposalArgs } from '~/lib/ai/types';

/** A form's retry keys: the same approval sent twice reuses its key, so a lost reply can't write twice. */
export type ApprovalKeys = ReturnType<typeof opKeys>;
export const approvalKeys = () => opKeys();

/** Sends one approved proposal. Throws the server's message when the family or the reader's role refuses it. */
export async function applyProposal(tree: string, p: Proposal, args: ProposalArgs, keys: ApprovalKeys, qc: QueryClient): Promise<void> {
  const parsed = proposalArgs[p.kind].safeParse(args);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the fields.');
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
  } else {
    const field = fieldInput.safeParse({ type: a.type, label: a.label ?? '', value: a.value, private: false });
    if (!field.success) throw new Error(field.error.issues[0]?.message ?? 'That detail does not fit its type.');
    await addPersonField({ data: { tree, person: a.person, field: field.data, opKey } });
  }
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['graph', tree] }),
    qc.invalidateQueries({ queryKey: ['person', tree] }),
    qc.invalidateQueries({ queryKey: ['chronicle', tree] }),
  ]);
}
