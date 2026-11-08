// A proposed change, shown as a card with a short diff. Nothing is saved until the reader approves; the
// approval sends the card's arguments (after any edits) to the existing server function.
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { aiChatMark } from '~/lib/ai.functions';
import { copyFor, PROPOSAL_KIND_LABEL, type Copy } from '~/lib/ai/copy';
import { toAiLocale, type Proposal, type ProposalArgs } from '~/lib/ai/types';
import { useT } from '~/lib/i18n';
import { applyProposal, approvalKeys, type ApprovalKeys } from './apply';

const FIELD: Record<string, keyof Copy> = {
  given: 'fieldName', surname: 'fieldSurname', born: 'fieldBorn', died: 'fieldDied', bornPlace: 'fieldBornPlace',
  title: 'fieldName', body: 'fieldStory', label: 'fieldLabel',
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ProposalCard({ tree, itemId, proposal }: { tree: string; itemId: string; proposal: Proposal }) {
  const t = useT();
  const c = copyFor(toAiLocale(t.locale));
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
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setStatus('dismissed');
    await mark('dismissed').catch(() => {});
  }

  return (
    <article className={`ai-card ai-card-${status}`} aria-label={c.proposalHeading}>
      <p className="ai-card-kind">{c[PROPOSAL_KIND_LABEL[proposal.kind]] as string}</p>
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
            const label = c[FIELD[k] ?? 'fieldValue'] as string;
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
            <Check size={15} aria-hidden /> {busy ? c.approving : c.approve}
          </button>
          {proposal.editable.length > 0 && (
            <button type="button" className="btn ghost" onClick={() => setEditing(!editing)} aria-expanded={editing}>
              <Pencil size={14} aria-hidden /> {c.edit}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={dismiss} disabled={busy}>
            <X size={14} aria-hidden /> {c.dismiss}
          </button>
        </div>
      )}
      {status === 'done' && <p className="ai-card-state ok">{c.done}</p>}
      {status === 'dismissed' && <p className="ai-card-state subtle">{c.dismissed}</p>}
      {error && <p className="ai-card-error" role="alert">{c.approveFailed}{error}</p>}
    </article>
  );
}
