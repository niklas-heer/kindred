// A proposed change, shown as a card with a short diff. Nothing is saved until the reader approves; the approval sends
// the card's arguments (after any edits or removed rows) to the existing server function. A family draft has its own
// card (FamilyDraft.tsx); a photo or a drawn avatar shows its pictures before anything is kept.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { aiChatMark } from '~/lib/ai.functions';
import { graphQuery } from '~/lib/api';
import { PROPOSAL_KIND_KEY } from '~/lib/ai/labels';
import type { Proposal, ProposalArgs } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import { errorText } from '~/lib/errortext';
import type { Look } from '~/lib/types';
import { Portrait } from '~/components/Portrait';
import { withPresetLabel } from '../fields/presets';
import { applyProposal, approvalKeys, type ApprovalKeys } from './apply';
import { FamilyDraft } from './FamilyDraft';
import { CardHead } from './CardHead';
import { VisibilityPicker } from '../fields/VisibilityMark';
import type { Visibility } from '~/lib/visibility';

const FIELD: Record<string, Key> = {
  given: 'ai.fieldName', surname: 'ai.fieldSurname', born: 'ai.fieldBorn', died: 'ai.fieldDied', bornPlace: 'ai.fieldBornPlace', diedPlace: 'ai.fieldDiedPlace',
  title: 'ai.fieldName', body: 'ai.fieldStory', label: 'ai.fieldLabel', name: 'ai.fieldName', occupation: 'ai.fieldOccupation',
};

/**
 * The server words the summary with the label as stored ("Allergien (food)"). The Edit tab shows the reader's word
 * for a stored label from the field presets ("Essen"), so the card does the same for the one place it appears.
 */
function summaryWithLabel(proposal: Proposal, t: ReturnType<typeof useT>): string {
  const raw = proposal.kind === 'add-field' && typeof proposal.args.label === 'string' ? proposal.args.label : '';
  return withPresetLabel(proposal.summary, raw, t);
}

export function ProposalCard({ tree, itemId, proposal }: { tree: string; itemId: string; proposal: Proposal }) {
  const t = useT();
  // A family draft is its own card (it has rows that are added one by one), so it draws its own head and state.
  if (proposal.kind === 'family') return <FamilyDraft tree={tree} itemId={itemId} proposal={proposal} />;
  return <GenericCard tree={tree} itemId={itemId} proposal={proposal} />;
}

type Pic = { key: string; taken?: string | null; place?: string | null; caption?: string | null; album?: string | null };

/** The photo rows a card lists: one per photo for details and albums, one per person for tags. */
function PhotoRows({ proposal, dropped, onDrop, t }: { proposal: Proposal; dropped: string[]; onDrop: (k: string) => void; t: ReturnType<typeof useT> }) {
  const thumbs = proposal.view?.thumbs ?? {};
  const before = proposal.view?.before ?? {};
  if (proposal.kind === 'photo-tags') {
    const people = (proposal.args.people as { person: string }[] | undefined) ?? [];
    const names = proposal.view?.names ?? {};
    const key = proposal.args.key as string;
    return (
      <div className="ai-photo">
        {thumbs[key] && <img className="ai-thumb ai-thumb-wide" src={thumbs[key]} alt="" loading="lazy" />}
        <ul className="ai-photo-list">
          {people.filter((p) => !dropped.includes(p.person)).map((p) => (
            <li key={p.person} className="ai-photo-row">
              <span className="ai-photo-text">{names[p.person] ?? p.person} <span className="subtle">· {t('ai.photoWhole')}</span></span>
              <button type="button" className="btn ghost ai-touch ai-photo-drop" onClick={() => onDrop(p.person)} aria-label={t('ai.famRemove')} title={t('ai.famRemove')}>
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const items = (proposal.args.items as Pic[] | undefined) ?? [];
  const rowText = (it: Pic) => {
    const was = before[it.key] ?? {};
    const lines: string[] = [];
    if (proposal.kind === 'photo-details') {
      if (it.taken !== was.taken) lines.push(`${t('ai.fieldTaken')}: ${was.taken || t('ai.fieldNone')} → ${it.taken || t('ai.fieldNone')}`);
      if (it.place !== was.place) lines.push(`${t('ai.fieldPlace')}: ${was.place || t('ai.fieldNone')} → ${it.place || t('ai.fieldNone')}`);
      if (it.caption !== was.caption) lines.push(`${t('ai.fieldCaption')}: ${was.caption || t('ai.fieldNone')} → ${it.caption || t('ai.fieldNone')}`);
    }
    return lines;
  };
  return (
    <ul className="ai-photo-list">
      {items.filter((it) => !dropped.includes(it.key)).map((it) => (
        <li key={it.key} className="ai-photo-row">
          {thumbs[it.key] ? <img className="ai-thumb" src={thumbs[it.key]} alt="" loading="lazy" /> : <span className="ai-thumb" aria-hidden />}
          <div className="ai-photo-text">
            {rowText(it).map((line, i) => <p key={i}>{line}</p>)}
            {proposal.kind === 'photo-album' && [it.taken, it.place, it.caption].some(Boolean) && <p className="subtle">{[it.taken, it.place, it.caption].filter(Boolean).join(' · ')}</p>}
          </div>
          <button type="button" className="btn ghost ai-touch ai-photo-drop" onClick={() => onDrop(it.key)} aria-label={t('ai.famRemove')} title={t('ai.famRemove')}>
            <X size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A drawn avatar, drawn from the look the assistant proposed, before anything is kept. */
function AvatarPreview({ tree, proposal, t }: { tree: string; proposal: Proposal; t: ReturnType<typeof useT> }) {
  const g = useQuery(graphQuery(tree));
  const id = proposal.args.person as string;
  const p = g.data?.people.find((x) => x.id === id);
  const thumb = proposal.view?.thumbs ? Object.values(proposal.view.thumbs)[0] : undefined;
  return (
    <div className="ai-avatar">
      {p ? <Portrait person={{ ...p, look: proposal.args.look as unknown as Look }} tree={tree} size={112} frame prefer="avatar" /> : <span className="ai-thumb ai-thumb-wide" aria-hidden />}
      <div className="ai-avatar-text">
        <p>{proposal.view?.personName ?? ''}</p>
        {thumb && <img className="ai-thumb" src={thumb} alt={t('ai.avatarBefore')} loading="lazy" />}
        <p className="subtle">{t('ai.avatarNote')}</p>
      </div>
    </div>
  );
}

function GenericCard({ tree, itemId, proposal }: { tree: string; itemId: string; proposal: Proposal }) {
  const t = useT();
  const qc = useQueryClient();
  const [status, setStatus] = useState(proposal.status);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(proposal.editable.map((k) => [k, String(proposal.args[k] ?? '')])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new detail starts at the level the family's rule says (the editors' for a health detail); the approver may change it.
  const [level, setLevel] = useState<Visibility>((proposal.args.visibility as Visibility | undefined) ?? (proposal.args.private === true ? 'editors' : 'family'));
  // Photos the reader took off the card (a row's remove button): they are not sent on approval.
  const [dropped, setDropped] = useState<string[]>([]);
  // One key per card: a retry of the same approval replays the stored result rather than writing twice.
  const [keys] = useState<ApprovalKeys>(() => approvalKeys());

  const open = status === 'open';
  const mark = (s: 'done' | 'dismissed') => aiChatMark({ data: { tree, itemId, proposalId: proposal.id, status: s } });
  const photoKind = proposal.kind === 'photo-details' || proposal.kind === 'photo-album' || proposal.kind === 'photo-tags';
  const remaining = photoKind ? ((proposal.kind === 'photo-tags' ? proposal.args.people : proposal.args.items) as unknown[] ?? []).length - dropped.length : 1;

  async function approve() {
    setBusy(true);
    setError(null);
    // Edited fields go in as typed; a cleared optional field is left out.
    const args: ProposalArgs = { ...proposal.args };
    for (const [k, v] of Object.entries(edits)) {
      if (v.trim() === '') delete args[k];
      else args[k] = v.trim();
    }
    if (proposal.kind === 'add-field') args.visibility = level;
    if (proposal.kind === 'photo-tags') args.people = (proposal.args.people as { person: string }[]).filter((p) => !dropped.includes(p.person));
    else if (photoKind) args.items = (proposal.args.items as Pic[]).filter((p) => !dropped.includes(p.key));
    try {
      await applyProposal(tree, { ...proposal, args }, args, keys, qc);
      setStatus('done');
      await mark('done').catch(() => {});
    } catch (e) {
      setError(errorText(e, t.locale));
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setStatus('dismissed');
    await mark('dismissed').catch(() => {});
  }

  return (
    <article className={`ai-card ai-card-${status}`} aria-label={t('ai.proposalHeading')}>
      <CardHead kind={t(PROPOSAL_KIND_KEY[proposal.kind])} state={status} />
      <p className="ai-card-summary">{summaryWithLabel(proposal, t)}</p>
      {photoKind && open && <PhotoRows proposal={proposal} dropped={dropped} onDrop={(k) => setDropped((d) => [...d, k])} t={t} />}
      {proposal.kind === 'avatar' && <AvatarPreview tree={tree} proposal={proposal} t={t} />}
      {proposal.diff.length > 0 && (
        <dl className="ai-diff">
          {proposal.diff.map((d, i) => (
            <div key={i} className="ai-diff-row">
              <dt>{d.label}</dt>
              <dd>
                {d.from !== undefined && <><s className="subtle">{d.from}</s> <span aria-hidden>→</span> </>}
                <span>{d.to}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {open && proposal.kind === 'add-field' && (
        <VisibilityPicker value={level} onChange={setLevel} />
      )}
      {open && editing && (
        <div className="ai-card-edit">
          {proposal.editable.map((k) => {
            const label = t(FIELD[k] ?? 'ai.fieldValue');
            const multi = k === 'body';
            const id = `ai-${proposal.id}-${k}`;
            return (
              <label key={k} className="ai-field" htmlFor={id}>
                <span>{label}</span>
                {multi ? (
                  <textarea id={id} rows={4} value={edits[k] ?? ''} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
                ) : (
                  <input id={id} value={edits[k] ?? ''} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
                )}
              </label>
            );
          })}
        </div>
      )}
      {open && (
        <div className="ai-card-actions">
          <button type="button" className="btn primary" onClick={approve} disabled={busy || (photoKind && remaining <= 0)}>
            <Check size={15} aria-hidden /> {busy ? t('ai.approving') : t('ai.approve')}
          </button>
          {proposal.editable.length > 0 && (
            <button type="button" className="btn ghost" onClick={() => setEditing(!editing)} aria-expanded={editing}>
              <Pencil size={14} aria-hidden /> {t('ai.edit')}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={dismiss} disabled={busy}>
            <X size={14} aria-hidden /> {t('ai.dismiss')}
          </button>
        </div>
      )}
      {open && <p className="ai-card-note subtle">{t('ai.notSavedYet')}</p>}
      {error && <p className="ai-card-error" role="alert">{t('ai.approveFailed')}{error}</p>}
    </article>
  );
}
