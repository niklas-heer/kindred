// A family draft as a readable card: each new person on a row, with their relationships in plain words, and the links
// whose person is already in the tree listed under "Connections". Warnings show where a person may already be in the
// tree or a link would loop. Rows can be edited or removed until they are added. "Add all", or each row's own "Add",
// sends the rows to applyFamilyBatch; every step has its own retry key, so a row that failed can be sent again, and a
// row that worked is never written twice.
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { aiChatMark } from '~/lib/ai.functions';
import { applyFamilyBatch } from '~/lib/family-batch.functions';
import { opKeys } from '~/lib/api';
import { NEW_REF, type FamilyLink, type FamilyPerson, type Proposal } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import { errorText } from '~/lib/errortext';
import type { Locale } from '~/lib/i18n/types';

type Status = 'todo' | 'done' | 'failed';
type Translate = ReturnType<typeof useT>;
interface Row extends FamilyPerson { status: Status; id?: string; error?: string }
interface LinkRow extends FamilyLink { uid: string; status: Status; error?: string }

const REL_KEY: Record<FamilyLink['relation'], Key> = {
  child: 'ai.famRelChild', parent: 'ai.famRelParent', partner: 'ai.famRelPartner', sibling: 'ai.famRelSibling',
};
/** The same relation said from the other person's end: a child's parent is someone whose child they are. */
const INVERSE: Record<FamilyLink['relation'], FamilyLink['relation']> = { child: 'parent', parent: 'child', partner: 'partner', sibling: 'sibling' };

/** The person as the server takes it: empty fields left out, so a blank date is not sent as a date. */
function clean(r: FamilyPerson): FamilyPerson {
  const s = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  return {
    ref: r.ref, given: r.given.trim(), surname: s(r.surname), sex: r.sex || undefined, born: s(r.born), bornPlace: s(r.bornPlace),
    died: s(r.died), diedPlace: s(r.diedPlace), living: r.living, occupation: s(r.occupation), story: r.story,
  };
}

/** A date for the card: "~1938" reads as "about 1938". */
const dateText = (t: Translate, d: string) => (d.startsWith('~') ? t('ai.famAboutDate', { date: d.slice(1) }) : d);

export function FamilyDraft({ tree, itemId, proposal }: { tree: string; itemId: string; proposal: Proposal }) {
  const t = useT();
  const qc = useQueryClient();
  const seed = proposal.args as unknown as { people: FamilyPerson[]; links: FamilyLink[] };
  const view = proposal.view ?? {};
  const [rows, setRows] = useState<Row[]>(() => seed.people.map((p) => ({ ...p, status: 'todo' as Status })));
  // A link's uid is its place in the draft as the server checked it (view.loops counts those places).
  const [links, setLinks] = useState<LinkRow[]>(() => seed.links.map((l, i) => ({ ...l, uid: `l${i}`, status: 'todo' as Status })));
  const [editing, setEditing] = useState<string | null>(null);
  // One key per step, kept for the card's life: a retry of the same row or link replays what it did, and an edited row gets a new key.
  const [keys] = useState(() => opKeys());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState(proposal.status);
  const locale = t.locale as Locale;

  const nameOfRow = (r: Row) => [r.given, r.surname].filter(Boolean).join(' ');
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

  function removeRow(ref: string) {
    setRows((rs) => rs.filter((r) => r.ref !== ref));
    setLinks((ls) => ls.filter((l) => l.anchor !== ref && l.person !== ref && l.coParent !== ref));
  }

  /** Sends the chosen rows (all, or one), and every link whose two ends are known by then. */
  async function add(only?: string) {
    setBusy(true);
    setNotice(null);
    const sendRows = rows.filter((r) => r.status !== 'done' && (!only || r.ref === only));
    const sending = new Set(sendRows.map((r) => r.ref));
    // A reference is a row sent now (the server maps it to the id it creates), a row already added (its real id), or an id in the tree.
    const doneId = (ref: string) => rows.find((r) => r.ref === ref && r.status === 'done')?.id;
    const resolve = (x: string): string | undefined => (sending.has(x) ? x : doneId(x) ?? (NEW_REF.test(x) ? undefined : x));
    const sendLinks: { uid: string; payload: { anchor: string; person: string; relation: FamilyLink['relation']; coParent?: string } }[] = [];
    for (const l of links) {
      if (l.status === 'done') continue;
      const anchor = resolve(l.anchor);
      const person = resolve(l.person);
      const coParent = l.coParent ? resolve(l.coParent) : undefined;
      if (!anchor || !person || (l.coParent && !coParent)) continue;
      sendLinks.push({ uid: l.uid, payload: { anchor, person, relation: l.relation, ...(coParent ? { coParent } : {}) } });
    }
    const people = sendRows.map((r) => {
      const body = clean(r);
      return { ...body, key: keys.for(`person:${r.ref}`, body) };
    });
    const uidOfKey = new Map<string, string>();
    const linkBody = sendLinks.map((l) => {
      const key = keys.for(`link:${l.uid}`, l.payload);
      uidOfKey.set(key, l.uid);
      return { ...l.payload, key };
    });
    try {
      const res = await applyFamilyBatch({ data: { tree, people, links: linkBody } });
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
      if (newRows.every((r) => r.status === 'done') && newLinks.every((l) => l.status === 'done')) {
        setStatus('done');
        await aiChatMark({ data: { tree, itemId, proposalId: proposal.id, status: 'done' } }).catch(() => {});
      }
    } catch (e) {
      setNotice(errorText(e, locale));
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setStatus('dismissed');
    await aiChatMark({ data: { tree, itemId, proposalId: proposal.id, status: 'dismissed' } }).catch(() => {});
  }

  if (status !== 'open') {
    return <p className={`ai-card-state ${status === 'done' ? 'ok' : 'subtle'}`}>{t(status === 'done' ? 'ai.done' : 'ai.dismissed')}</p>;
  }

  const todo = rows.filter((r) => r.status !== 'done').length;
  const failedAny = rows.some((r) => r.status === 'failed') || links.some((l) => l.status === 'failed');
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
  return (
    <div className="ai-fam">
      <p className="ai-fam-intro subtle">{t('ai.famIntro')}</p>
      {view.questions && view.questions.length > 0 && (
        <div className="ai-fam-questions">
          <p className="ai-fam-label">{t('ai.famQuestions')}</p>
          <ul>{view.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
        </div>
      )}

      <ol className="ai-fam-rows">
        {rows.length === 0 && <li className="subtle">{t('ai.famEmpty')}</li>}
        {rows.map((r) => {
          const dup = duplicateOf(r.ref);
          const locked = r.status === 'done';
          const facts = [r.born ? t('ai.famBorn', { date: dateText(t, r.born) }) : null, r.died ? t('ai.famDied', { date: dateText(t, r.died) }) : null, r.occupation || null].filter(Boolean);
          return (
            <li key={r.ref} className={`ai-fam-row ai-fam-${r.status}`}>
              <div className="ai-fam-main">
                <p className="ai-fam-name">{nameOfRow(r)}</p>
                {facts.length > 0 && <p className="ai-fam-facts subtle">{facts.join(' · ')}</p>}
                {rowLines(r.ref).length > 0 && (
                  <ul className="ai-fam-rels">
                    {rowLines(r.ref).map((x) => (
                      <li key={x.key} className={loopUids.has(x.uid) && x.status !== 'done' ? 'ai-fam-loop' : undefined}>
                        {x.text}
                        {loopUids.has(x.uid) && x.status !== 'done' && <span className="subtle"> · {t('ai.famLoop')}</span>}
                        {x.status === 'failed' && x.error && <span className="ai-card-error"> {x.error}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {r.story && <p className="ai-fam-story subtle">{t('ai.famStory', { title: r.story.title || r.story.kind })}</p>}
                {dup && !locked && <p className="ai-fam-dup" role="note">{t('ai.famDuplicate', { name: dup.name })}</p>}
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
                  {([
                    ['given', 'ai.fieldName'], ['surname', 'ai.fieldSurname'], ['born', 'ai.fieldBorn'], ['bornPlace', 'ai.fieldBornPlace'],
                    ['died', 'ai.fieldDied'], ['diedPlace', 'ai.fieldDiedPlace'], ['occupation', 'ai.fieldOccupation'],
                  ] as [keyof FamilyPerson, Key][]).map(([field, label]) => (
                    <label key={field} className="ai-field">
                      <span>{t(label)}</span>
                      <input value={(r[field] as string | undefined) ?? ''} onChange={(e) => edit(r.ref, field, e.target.value)} />
                    </label>
                  ))}
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
                  <button type="button" className="btn ghost ai-touch ai-link-remove" onClick={() => setLinks((ls) => ls.filter((x) => x.uid !== l.uid))} disabled={busy} aria-label={t('ai.famRemove')} title={t('ai.famRemove')}>
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
        <p className="ai-card-state subtle" role="status">{t('ai.famPartial', { done: String(rows.length - todo), total: String(rows.length) })}</p>
      )}

      <div className="ai-card-actions">
        <button type="button" className="btn primary" onClick={() => add()} disabled={busy || todo === 0}>
          {failedAny ? <RotateCw size={15} aria-hidden /> : <Check size={15} aria-hidden />}{' '}
          {busy ? t('ai.approving') : failedAny ? t('ai.famRetry') : t('ai.famAddAll')}
        </button>
        <button type="button" className="btn ghost" onClick={dismiss} disabled={busy}>
          <X size={14} aria-hidden /> {t('ai.dismiss')}
        </button>
      </div>
    </div>
  );
}
