// A proposed change, shown as a card with a short diff. Nothing is saved until the reader approves; the
// approval sends the card's arguments (after any edits) to the existing server function.
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { aiChatMark } from '~/lib/ai.functions';
import { PROPOSAL_KIND_KEY } from '~/lib/ai/labels';
import type { Proposal, ProposalArgs } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import { errorText } from '~/lib/errortext';
import { applyProposal, approvalKeys, type ApprovalKeys } from './apply';

const FIELD: Record<string, Key> = {
  given: 'ai.fieldName', surname: 'ai.fieldSurname', born: 'ai.fieldBorn', died: 'ai.fieldDied', bornPlace: 'ai.fieldBornPlace', diedPlace: 'ai.fieldDiedPlace',
  title: 'ai.fieldName', body: 'ai.fieldStory', label: 'ai.fieldLabel',
};


export function ProposalCard({ tree, itemId, proposal }: { tree: string; itemId: string; proposal: Proposal }) {
  const t = useT();
  const qc = useQueryClient();
  const [status, setStatus] = useState(proposal.status);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(proposal.editable.map((k) => [k, String(proposal.args[k] ?? '')])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per card: a retry of the same approval replays the stored result rather than writing twice.
  const [keys] = useState<ApprovalKeys>(() => approvalKeys());

  const open = status === 'open';
  const mark = (s: 'done' | 'dismissed') => aiChatMark({ data: { tree, itemId, proposalId: proposal.id, status: s } });

  async function approve() {
    setBusy(true);
    setError(null);
    // Edited fields go in as typed; a cleared optional field is left out.
    const args: ProposalArgs = { ...proposal.args };
    for (const [k, v] of Object.entries(edits)) {
      if (v.trim() === '') delete args[k];
      else args[k] = v.trim();
    }
    try {
      await applyProposal(tree, proposal, args, keys, qc);
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
      <p className="ai-card-kind">{t(PROPOSAL_KIND_KEY[proposal.kind])}</p>
      <p className="ai-card-summary">{proposal.summary}</p>
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
          <button type="button" className="btn primary" onClick={approve} disabled={busy}>
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
      {status === 'done' && <p className="ai-card-state ok">{t('ai.done')}</p>}
      {status === 'dismissed' && <p className="ai-card-state subtle">{t('ai.dismissed')}</p>}
      {error && <p className="ai-card-error" role="alert">{t('ai.approveFailed')}{error}</p>}
    </article>
  );
}
