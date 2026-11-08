// A family draft as a readable card: each new person on a row, with their relationships in plain words, and the links
// whose person is already in the tree listed under "Connections". Warnings show where a person may already be in the
// tree or a link would loop. Rows can be edited or removed until they are added. "Add all", or each row's own "Add",
// sends the rows to applyFamilyBatch; every step has its own retry key, so a row that failed can be sent again, and a
// row that worked is never written twice. A memory is shown in full, because approving it puts those words in the Chronicle.
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { aiChatMark } from '~/lib/ai.functions';
import { applyFamilyBatch } from '~/lib/family-batch.functions';
import { opKeys } from '~/lib/api';
import { allGiven, MAX_FURTHER } from '~/lib/further-given';
import { type FamilyLink, type FamilyPerson, type Proposal } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import { PROPOSAL_KIND_KEY, STORY_KIND_KEY } from '~/lib/ai/labels';
import { errorText } from '~/lib/errortext';
import { socialLink } from '~/lib/social';
import type { Locale } from '~/lib/i18n/types';
import { Select } from '~/components/ui';
import { CardHead } from './CardHead';
import type { OnDecided } from './ProposalCard';
import type { DecisionOutcome } from '~/lib/ai/continuation';
import { VisibilityMark } from '../fields/VisibilityMark';
import { presetLabel } from '../fields/presets';
import { cleanPerson, detailKeys, detailPreview, draftProgress, dropDetail, linksToSend, patchDetail, type DraftLink as LinkRow, type DraftRow as Row, type Status } from './family-draft';

type Translate = ReturnType<typeof useT>;
type Story = NonNullable<FamilyPerson['story']>;

const REL_KEY: Record<FamilyLink['relation'], Key> = {
  child: 'ai.famRelChild', parent: 'ai.famRelParent', partner: 'ai.famRelPartner', sibling: 'ai.famRelSibling',
};
/** The same relation said from the other person's end: a child's parent is someone whose child they are. */
const INVERSE: Record<FamilyLink['relation'], FamilyLink['relation']> = { child: 'parent', parent: 'child', partner: 'partner', sibling: 'sibling' };

/** What the editor calls each part of a detail's value (fields/FieldEditor.tsx). */
const PART_LABEL: Record<string, Key> = {
  number: 'input.number', address: 'input.email', street: 'input.street', postcode: 'input.postcode', city: 'input.city', country: 'input.country', url: 'input.url',
  name: 'input.name', date: 'input.date', note: 'input.note', school: 'input.school', place: 'input.place', from: 'input.from', to: 'input.to', title: 'input.title',
  employer: 'input.employer', unit: 'input.unit', rank: 'input.rank', language: 'input.language', level: 'input.level', left: 'faith.left', leftOn: 'faith.leftWhen',
};

/** A date for the card: "~1938" reads as "about 1938". */
const dateText = (t: Translate, d: string) => (d.startsWith('~') ? t('ai.famAboutDate', { date: d.slice(1) }) : d);

export function FamilyDraft({ tree, itemId, proposal, onDecided }: { tree: string; itemId: string; proposal: Proposal; onDecided: OnDecided }) {
  const t = useT();
  const qc = useQueryClient();
  const seed = proposal.args as unknown as { people: FamilyPerson[]; links: FamilyLink[] };
  const view = proposal.view ?? {};
  // A row the server is sure is someone already in the tree starts as that person, so adding it adds no one new.
  const [rows, setRows] = useState<Row[]>(() => seed.people.map((p) => ({ ...p, status: 'todo' as Status, ...(view.matches?.[p.ref]?.[0]?.sure && { existing: view.matches[p.ref][0].id }) })));
  // A link's uid is its place in the draft as the server checked it (view.loops counts those places).
  const [links, setLinks] = useState<LinkRow[]>(() => seed.links.map((l, i) => ({ ...l, uid: `l${i}`, status: 'todo' as Status })));
  const [editing, setEditing] = useState<string | null>(null);
  // A list read from a picture may hold strangers, so nobody is on the way in until the reader ticks them.
  const pick = !!view.pick;
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  // One key per step, kept for the card's life: a retry of the same row or link replays what it did, and an edited row gets a new key.
  const [keys] = useState(() => opKeys());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState(proposal.status);
  const locale = t.locale as Locale;

  const nameOfRow = (r: Row) => [allGiven(r.given, r.furtherGiven), r.surname].filter(Boolean).join(' ');
  const refName = (ref: string) => {
    const r = rows.find((x) => x.ref === ref);
    return r ? nameOfRow(r) : (view.names?.[ref] ?? ref);
  };
  const duplicateOf = (ref: string) => view.duplicates?.find((d) => d.ref === ref);
  const loopUids = new Set((view.loops ?? []).map((i) => `l${i}`));
  const relLine = (l: LinkRow) => {
    const anchor = refName(l.anchor);
    const co = l.coParent ? refName(l.coParent) : undefined;
    return t(REL_KEY[l.relation], { name: co ? `${anchor} & ${co}` : anchor });
  };

  function patchRow(ref: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.ref === ref ? { ...r, ...patch } : r)));
  }

  /** An edit to a row that failed sends it again with new content (and so a new key). A row already added is locked. */
  function edit(ref: string, field: keyof FamilyPerson, value: string) {
    setRows((rs) => rs.map((r) => (r.ref === ref ? { ...r, [field]: value, status: r.status === 'failed' ? 'todo' : r.status, error: undefined } : r)));
  }

  /** Changes one profile's handle, or takes the profile off (null). The row is sent again with new content. */
  function editSocial(ref: string, index: number, handle: string | null) {
    setRows((rs) => rs.map((r) => (r.ref === ref
      ? { ...r, social: handle === null ? r.social?.filter((_, i) => i !== index) : r.social?.map((s, i) => (i === index ? { ...s, handle } : s)), status: r.status === 'failed' ? 'todo' : r.status, error: undefined }
      : r)));
  }

  /** Whether this row is a new person or someone already in the tree. */
  function setExisting(ref: string, existing: string | undefined) {
    setRows((rs) => rs.map((r) => (r.ref === ref ? { ...r, existing, status: r.status === 'failed' ? 'todo' : r.status, error: undefined } : r)));
  }

  function toggleChosen(ref: string, on: boolean) {
    setChosen((c) => {
      const next = new Set(c);
      if (on) next.add(ref);
      else next.delete(ref);
      return next;
    });
  }

  /** The same for the memory: a change or removal sends the row again with new content. Blanking the text leaves the memory out. */
  function editStory(ref: string, patch: Partial<Story> | null) {
    setRows((rs) => rs.map((r) => (r.ref === ref && r.story
      ? { ...r, story: patch ? { ...r.story, ...patch } : undefined, status: r.status === 'failed' ? 'todo' : r.status, error: undefined }
      : r)));
  }

  /** Changes or removes one detail. The row is sent again with new content. */
  function changeDetails(ref: string, next: (d: Row['details']) => Row['details']) {
    setRows((rs) => rs.map((r) => (r.ref === ref ? { ...r, details: next(r.details), status: r.status === 'failed' ? 'todo' : r.status, error: undefined } : r)));
  }

  /** Leaves out what was read for this person beyond the main facts: the uncertain lines, and the details that came with them. The row is sent again with new content. */
  function leaveOutDetails(ref: string) {
    setRows((rs) => rs.map((r) => (r.ref === ref ? { ...r, details: undefined, unsure: undefined, status: r.status === 'failed' ? 'todo' : r.status, error: undefined } : r)));
  }

  /** Takes rows or links off the card. When that leaves only what was already added, the card is finished. */
  function applyRemoval(nextRows: Row[], nextLinks: LinkRow[]) {
    setRows(nextRows);
    setLinks(nextLinks);
    if (draftProgress(nextRows, nextLinks, loopUids).settled) finish('done', nextRows, nextLinks);
  }

  const removeRow = (ref: string) => applyRemoval(rows.filter((r) => r.ref !== ref), links.filter((l) => l.anchor !== ref && l.person !== ref && l.coParent !== ref));
  const removeLink = (uid: string) => applyRemoval(rows, links.filter((l) => l.uid !== uid));

  /** What became of the rows and links, for the assistant to carry on from. */
  const outcomeOf = (rs: Row[], ls: LinkRow[]): DecisionOutcome => ({
    added: rs.filter((r) => r.status === 'done').map((r) => r.ref),
    failed: rs.filter((r) => r.status === 'failed').map((r) => r.ref),
    linksAdded: ls.filter((l) => l.status === 'done').length,
    linksFailed: ls.filter((l) => l.status === 'failed').length,
  });

  function finish(next: 'done' | 'dismissed', rs: Row[] = rows, ls: LinkRow[] = links) {
    setStatus(next);
    onDecided(() => aiChatMark({ data: { tree, itemId, proposalId: proposal.id, status: next, ...(next === 'done' && { outcome: outcomeOf(rs, ls) }) } }));
  }

  /** "Add all" did not fully work. The card stays open to retry, and the assistant hears what happened. */
  function reportFailure(outcome: DecisionOutcome) {
    onDecided(() => aiChatMark({ data: { tree, itemId, proposalId: proposal.id, status: 'failed', outcome } }));
  }

  /** Sends the chosen rows (all, or one), and every link whose two ends are known by then. */
  async function add(only?: string) {
    setBusy(true);
    setNotice(null);
    const sendRows = rows.filter((r) => r.status !== 'done' && (only ? r.ref === only : !pick || chosen.has(r.ref)));
    const sending = new Set(sendRows.map((r) => r.ref));
    const sendLinks = linksToSend(rows, links, loopUids, sending);
    const people = sendRows.map((r) => {
      const body = cleanPerson(r);
      return { ...body, key: keys.for(`person:${r.ref}`, body) };
    });
    const uidOfKey = new Map<string, string>();
    const linkBody = sendLinks.map((l) => {
      const key = keys.for(`link:${l.uid}`, l.payload);
      uidOfKey.set(key, l.uid);
      return { ...l.payload, key };
    });
    try {
      const res = await applyFamilyBatch({ data: { tree, people, links: linkBody, locale } });
      const newRows = rows.map((r) => {
        const got = res.people.find((p) => p.ref === r.ref);
        if (!got) return r;
        return got.id ? { ...r, status: 'done' as Status, id: got.id, error: undefined } : { ...r, status: 'failed' as Status, error: errorText(got.error ?? '', locale) };
      });
      const newLinks = links.map((l) => {
        const got = res.links.find((x) => uidOfKey.get(x.key) === l.uid);
        if (!got) return l;
        return got.ok ? { ...l, status: 'done' as Status, error: undefined } : { ...l, status: 'failed' as Status, error: errorText(got.error ?? '', locale) };
      });
      setRows(newRows);
      setLinks(newLinks);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['graph', tree] }),
        qc.invalidateQueries({ queryKey: ['chronicle', tree] }),
      ]);
      const after = draftProgress(newRows, newLinks, loopUids);
      if (after.settled) finish('done', newRows, newLinks);
      else if (!only && after.failed) reportFailure(outcomeOf(newRows, newLinks));
    } catch (e) {
      const message = errorText(e, locale);
      setNotice(message);
      if (!only) reportFailure({ ...outcomeOf(rows, links), error: message.slice(0, 240) });
    } finally {
      setBusy(false);
    }
  }

  const kind = t(PROPOSAL_KIND_KEY[proposal.kind]);
  if (status !== 'open') {
    return (
      <article className={`ai-card ai-card-${status}`} aria-label={t('ai.proposalHeading')}>
        <CardHead kind={kind} state={status} />
        <p className="ai-card-summary">{proposal.summary}</p>
      </article>
    );
  }

  const progress = draftProgress(rows, links, loopUids);
  const failedAny = progress.failed;
  // Who a memory can be saved under: the person who told it, or the approver. The server looks the name up from the id.
  const tellers = [...new Set(seed.people.flatMap((p) => (p.story?.teller ? [p.story.teller] : [])))];
  // Each link is said on the row of the person it describes ("sibling of Ingrid"), and again from the other end when that
  // end is also a new person in the draft ("partner of Kurt" on Greta's row). A link to a person in the tree is under Connections.
  const rowLines = (ref: string) => links.flatMap((l) => {
    const out: { key: string; uid: string; status: Status; text: string; error?: string }[] = [];
    if (l.person === ref) out.push({ key: `${l.uid}-f`, uid: l.uid, status: l.status, text: relLine(l), error: l.error });
    const otherEnd = l.anchor === ref || l.coParent === ref;
    if (otherEnd && l.person !== ref && rows.some((r) => r.ref === l.person)) {
      out.push({ key: `${l.uid}-r`, uid: l.uid, status: l.status, text: t(REL_KEY[INVERSE[l.relation]], { name: refName(l.person) }), error: l.error });
    }
    return out;
  });
  const connections = links.filter((l) => !rows.some((r) => r.ref === l.person));
  const open = rows.filter((r) => r.status !== 'done');
  const chosenCount = open.filter((r) => chosen.has(r.ref)).length;
  return (
    <article className="ai-card ai-card-open" aria-label={t('ai.proposalHeading')}>
      <CardHead kind={kind} state="open" />
      <p className="ai-card-summary">{proposal.summary}</p>
      <div className="ai-fam">
        <p className="ai-fam-intro subtle">{t(pick ? 'ai.famPickIntro' : 'ai.famIntro')}</p>
        {view.known && view.known.length > 0 && (
          <p className="ai-fam-known subtle">{t('ai.famKnown', { names: view.known.map((k) => k.name).join(', ') })}</p>
        )}
        {view.questions && view.questions.length > 0 && (
          <div className="ai-fam-questions">
            <p className="ai-fam-label">{t('ai.famQuestions')}</p>
            <ul>{view.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          </div>
        )}

        {pick && open.length > 1 && (
          <div className="ai-fam-pickall">
            <button type="button" className="btn ghost ai-touch" onClick={() => setChosen(new Set(open.map((r) => r.ref)))} disabled={busy}>{t('ai.famPickAll')}</button>
            <button type="button" className="btn ghost ai-touch" onClick={() => setChosen(new Set())} disabled={busy || chosenCount === 0}>{t('ai.famPickNone')}</button>
          </div>
        )}
        <ol className="ai-fam-rows">
          {rows.length === 0 && <li className="subtle">{t('ai.famEmpty')}</li>}
          {rows.map((r) => {
            const dup = duplicateOf(r.ref);
            const matches = view.matches?.[r.ref] ?? [];
            const locked = r.status === 'done';
            const facts = [r.born ? t('ai.famBorn', { date: dateText(t, r.born) }) : null, r.died ? t('ai.famDied', { date: dateText(t, r.died) }) : null, r.occupation || null].filter(Boolean);
            return (
              <li key={r.ref} className={`ai-fam-row ai-fam-${r.status}`}>
                <div className="ai-fam-main">
                  {pick && !locked ? (
                    <label className="ai-fam-pick">
                      <input type="checkbox" checked={chosen.has(r.ref)} onChange={(e) => toggleChosen(r.ref, e.target.checked)} disabled={busy} aria-label={t('ai.famPickRow', { name: nameOfRow(r) })} />
                      <span className="ai-fam-name">{nameOfRow(r)}</span>
                    </label>
                  ) : <p className="ai-fam-name">{nameOfRow(r)}</p>}
                  {r.social && r.social.length > 0 && (
                    <ul className="ai-fam-socials">
                      {r.social.map((s, i) => {
                        const link = socialLink(s.handle, s.network);
                        return <li key={i}>{link ? <a href={link.href} target="_blank" rel="noopener noreferrer nofollow">{link.network} {link.handle}</a> : `${s.network} ${s.handle}`}</li>;
                      })}
                    </ul>
                  )}
                  {pick && !locked && matches.length > 0 && (
                    <div className="ai-field ai-fam-match">
                      <span>{t('ai.famMatchLabel')}</span>
                      <Select
                        value={r.existing ?? ''}
                        onChange={(v) => setExisting(r.ref, v || undefined)}
                        options={[{ value: '', label: t('ai.famMatchNew') }, ...matches.map((m) => ({ value: m.id, label: m.born ? `${m.name} (${m.born.replace(/^~/, '').slice(0, 4)})` : m.name }))]}
                        aria-label={t('ai.famMatchLabel')}
                        size="md"
                      />
                    </div>
                  )}
                  {pick && !locked && !r.existing && rowLines(r.ref).length === 0 && <p className="ai-fam-facts subtle">{t('ai.famNoLink')}</p>}
                  {facts.length > 0 && <p className="ai-fam-facts subtle">{facts.join(' · ')}</p>}
                  {rowLines(r.ref).length > 0 && (
                    <ul className="ai-fam-rels">
                      {rowLines(r.ref).map((x) => (
                        <li key={x.key} className={loopUids.has(x.uid) && x.status !== 'done' ? 'ai-fam-loop' : undefined}>
                          {x.text}
                          {loopUids.has(x.uid) && x.status !== 'done' && <span className="subtle"> · {t('ai.famLoop')}</span>}
                          {x.status === 'failed' && x.error && <span className="ai-card-error"> {x.error}</span>}
                          {x.status === 'failed' && (
                            <button type="button" className="btn ghost ai-touch ai-link-remove" onClick={() => removeLink(x.uid)} disabled={busy} aria-label={t('ai.famRemove')} title={t('ai.famRemove')}>
                              <X size={13} aria-hidden />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.story && r.story.body.trim() && (
                    <div className="ai-fam-story">
                      <p className="ai-fam-story-head">
                        <span>{[STORY_KIND_KEY[r.story.kind] ? t(STORY_KIND_KEY[r.story.kind]) : r.story.kind, r.story.title].filter(Boolean).join(' · ')}</span>
                        {!locked && (
                          <button type="button" className="btn ghost ai-touch ai-link-remove" onClick={() => editStory(r.ref, null)} disabled={busy} aria-label={t('ai.famStoryRemove')} title={t('ai.famStoryRemove')}>
                            <X size={13} aria-hidden />
                          </button>
                        )}
                      </p>
                      <p className="ai-fam-story-body">{r.story.body}</p>
                      <p className="ai-fam-story-by subtle">{r.story.teller ? t('ai.famToldBy', { name: refName(r.story.teller) }) : t('ai.famToldByYou')}</p>
                    </div>
                  )}
                  {r.details && r.details.length > 0 && (
                    <ul className="ai-fam-details">
                      {r.details.map((d, i) => {
                        const p = detailPreview(d);
                        const typeName = t(`type.${d.type}` as Key);
                        return (
                          <li key={i} className="ai-fam-detail">
                            <div className="ai-fam-detail-text">
                              <p className="ai-fam-detail-head"><b>{typeName}</b> <span className="subtle">· {presetLabel(p.label, t)}</span> <VisibilityMark level={p.level} /></p>
                              <p className="ai-fam-detail-value">
                                {p.parts.map(([k, v]) => (k === 'left' ? t('faith.left') : p.parts.length > 1 ? `${t(PART_LABEL[k])}: ${v}` : v)).join(' · ')}
                              </p>
                              {p.issue && <p className="ai-card-error" role="note">{t(`issue.${p.issue}` as Key)} {t('ai.famDetailSkipped')}</p>}
                            </div>
                            {!locked && (
                              <button type="button" className="btn ghost ai-touch ai-link-remove" onClick={() => changeDetails(r.ref, (ds) => dropDetail(ds, i))} disabled={busy} aria-label={t('fields.remove', { name: typeName })} title={t('fields.remove', { name: typeName })}>
                                <X size={13} aria-hidden />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {r.unsure && r.unsure.length > 0 && (
                    <div className="ai-fam-unsure">
                      <p className="ai-fam-unsure-head">
                        <span>{t('ai.famUnsureLabel')}</span>
                        {!locked && (
                          <button type="button" className="btn ghost ai-touch ai-link-remove" onClick={() => leaveOutDetails(r.ref)} disabled={busy} aria-label={t(r.details?.length ? 'ai.famUnsureLeaveAll' : 'ai.famUnsureLeave')} title={t(r.details?.length ? 'ai.famUnsureLeaveAll' : 'ai.famUnsureLeave')}>
                            <X size={13} aria-hidden />
                          </button>
                        )}
                      </p>
                      <ul>{r.unsure.map((line, i) => <li key={i}>{line}</li>)}</ul>
                    </div>
                  )}
                  {dup && !locked && matches.length === 0 && <p className="ai-fam-dup" role="note">{t('ai.famDuplicate', { name: dup.name })}</p>}
                  {locked && <p className="ai-card-state ok">{t('ai.famDone')}</p>}
                  {r.status === 'failed' && <p className="ai-card-error" role="alert">{r.error}</p>}
                </div>
                {!locked && (
                  <div className="ai-fam-actions">
                    <button type="button" className="btn ghost ai-touch" onClick={() => setEditing(editing === r.ref ? null : r.ref)} aria-expanded={editing === r.ref} aria-label={t('ai.edit')} title={t('ai.edit')}>
                      <Pencil size={14} aria-hidden />
                    </button>
                    <button type="button" className="btn ghost ai-touch" onClick={() => add(r.ref)} disabled={busy} aria-label={t('ai.famAddRow')} title={t('ai.famAddRow')}>
                      <Check size={15} aria-hidden />
                    </button>
                    <button type="button" className="btn ghost ai-touch" onClick={() => removeRow(r.ref)} disabled={busy} aria-label={t('ai.famRemove')} title={t('ai.famRemove')}>
                      <X size={15} aria-hidden />
                    </button>
                  </div>
                )}
                {editing === r.ref && !locked && (
                  <div className="ai-fam-edit">
                    {(r.existing ? [] : [
                      ['given', 'ai.fieldName'], ['surname', 'ai.fieldSurname'], ['born', 'ai.fieldBorn'], ['bornPlace', 'ai.fieldBornPlace'],
                      ['died', 'ai.fieldDied'], ['diedPlace', 'ai.fieldDiedPlace'], ['occupation', 'ai.fieldOccupation'],
                    ] as [keyof FamilyPerson, Key][]).map(([field, label]) => (
                      <label key={field} className="ai-field">
                        <span>{t(label)}</span>
                        <input value={(r[field] as string | undefined) ?? ''} onChange={(e) => edit(r.ref, field, e.target.value)} />
                      </label>
                    ))}
                    {!r.existing && (
                      <label className="ai-field">
                        <span>{t('ai.fieldFurtherGiven')}</span>
                        <input
                          value={(r.furtherGiven ?? []).join(', ')}
                          onChange={(e) => setRows((rs) => rs.map((x) => (x.ref === r.ref ? { ...x, furtherGiven: e.target.value.split(',').map((n) => n.trim()).filter(Boolean).slice(0, MAX_FURTHER), status: x.status === 'failed' ? 'todo' : x.status, error: undefined } : x)))}
                        />
                      </label>
                    )}
                    {r.social?.map((s, i) => (
                      <div key={i} className="ai-field ai-fam-wide ai-fam-social-edit">
                        <label htmlFor={`${r.ref}-social-${i}`}>{t('ai.famSocialLabel', { network: s.network })}</label>
                        <div>
                          <input id={`${r.ref}-social-${i}`} value={s.handle} onChange={(e) => editSocial(r.ref, i, e.target.value)} />
                          <button type="button" className="btn ghost ai-touch" onClick={() => editSocial(r.ref, i, null)} aria-label={t('ai.famRemove')} title={t('ai.famRemove')}>
                            <X size={13} aria-hidden />
                          </button>
                        </div>
                      </div>
                    ))}
                    {r.details?.map((d, i) => (
                      <fieldset key={i} className="ai-fam-wide ai-fam-detail-edit">
                        <legend>{t(`type.${d.type}` as Key)}</legend>
                        <label className="ai-field">
                          <span>{t('fields.label')}</span>
                          <input value={d.label ?? ''} maxLength={60} placeholder={presetLabel(detailPreview(d).label, t)} onChange={(e) => changeDetails(r.ref, (ds) => patchDetail(ds, i, { label: e.target.value }))} />
                        </label>
                        {detailKeys(d).map((k) => (
                          <label key={k} className="ai-field">
                            <span>{t(PART_LABEL[k])}</span>
                            <input value={d.value[k] ?? ''} maxLength={500} onChange={(e) => changeDetails(r.ref, (ds) => patchDetail(ds, i, { key: k, value: e.target.value }))} />
                          </label>
                        ))}
                      </fieldset>
                    ))}
                    {r.story && (
                      <>
                        <label className="ai-field ai-fam-wide">
                          <span>{t('ai.famStoryTitle')}</span>
                          <input value={r.story.title ?? ''} onChange={(e) => editStory(r.ref, { title: e.target.value })} />
                        </label>
                        <label className="ai-field ai-fam-wide">
                          <span>{t('ai.famStoryBody')}</span>
                          <textarea value={r.story.body} maxLength={20_000} onChange={(e) => editStory(r.ref, { body: e.target.value })} />
                        </label>
                        {tellers.length > 0 && (
                          <div className="ai-field ai-fam-wide">
                            <span>{t('ai.famStoryTeller')}</span>
                            <Select
                              value={r.story.teller ?? ''}
                              onChange={(v) => editStory(r.ref, { teller: v || undefined })}
                              options={[{ value: '', label: t('ai.famStoryMe') }, ...tellers.map((id) => ({ value: id, label: refName(id) }))]}
                              aria-label={t('ai.famStoryTeller')}
                              size="md"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {connections.length > 0 && (
          <div className="ai-fam-connections">
            <p className="ai-fam-label">{t('ai.famConnections')}</p>
            <ul className="ai-fam-rels">
              {connections.map((l) => (
                <li key={l.uid} className={loopUids.has(l.uid) && l.status !== 'done' ? 'ai-fam-loop' : undefined}>
                  <span>{refName(l.person)}, {relLine(l)}</span>
                  {loopUids.has(l.uid) && l.status !== 'done' && <span className="subtle"> · {t('ai.famLoop')}</span>}
                  {l.status === 'failed' && <span className="ai-card-error"> {l.error}</span>}
                  {l.status === 'done' && <span className="ai-card-state ok"> · {t('ai.famDone')}</span>}
                  {l.status !== 'done' && (
                    <button type="button" className="btn ghost ai-touch ai-link-remove" onClick={() => removeLink(l.uid)} disabled={busy} aria-label={t('ai.famRemove')} title={t('ai.famRemove')}>
                      <X size={13} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {notice && <p className="ai-card-error" role="alert">{t('ai.approveFailed')}{notice}</p>}
        {failedAny && !notice && (
          <p className="ai-card-state subtle" role="status">
            {t('ai.famCountPeople', { done: String(progress.peopleDone), total: String(progress.peopleTotal) })}
            {progress.linksTotal > 0 && <> {t('ai.famCountLinks', { done: String(progress.linksDone), total: String(progress.linksTotal) })}</>}
            {' '}{t('ai.famPartial')}
          </p>
        )}

        <div className="ai-card-actions">
          <button type="button" className="btn primary" onClick={() => add()} disabled={busy || progress.unfinished === 0 || (pick && chosenCount === 0)}>
            {failedAny ? <RotateCw size={15} aria-hidden /> : <Check size={15} aria-hidden />}{' '}
            {busy ? t('ai.approving') : pick ? t('ai.famAddChosen', { count: chosenCount }) : failedAny ? t('ai.famRetry') : t('ai.famAddAll')}
          </button>
          <button type="button" className="btn ghost" onClick={() => finish(progress.anyDone ? 'done' : 'dismissed')} disabled={busy}>
            <X size={14} aria-hidden /> {progress.anyDone ? t('ai.famLeaveRest') : t('ai.dismiss')}
          </button>
        </div>
      </div>
      {!progress.anyDone && <p className="ai-card-note subtle">{t('ai.notSavedYet')}</p>}
    </article>
  );
}
