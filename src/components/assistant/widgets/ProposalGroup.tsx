// The proposal cards of one reply, and Apply all when there are several. Apply all approves each card in turn through the same
// approval its own button runs, so what a reader edited on a card counts, and each card ends in its own state. Removing a whole
// person cannot be undone, so that card is left to its own button.
import { Check } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { Proposal } from '~/lib/ai/types';
import { useT } from '~/lib/i18n';
import { ProposalCard, type CardControl, type OnDecided } from '../ProposalCard';
import './widgets.css';

const inBulk = (p: Proposal) => p.kind !== 'family' && p.kind !== 'remove-person';

export function ProposalGroup({ tree, itemId, proposals, onDecided, conv }: { tree: string; itemId: string; proposals: Proposal[]; onDecided: OnDecided; conv: string }) {
  const t = useT();
  const cards = useRef(new Map<string, CardControl>());
  const [run, setRun] = useState<{ done: number; failed: string[]; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const register = useCallback((id: string, c: CardControl | null) => {
    if (c) cards.current.set(id, c);
    else cards.current.delete(id);
    bump((n) => n + 1);
  }, []);
  // The card's own state decides: a card already approved or dismissed by hand is not approved again.
  const eligible = proposals.filter((p) => inBulk(p) && p.status === 'open');
  const waiting = eligible.filter((p) => cards.current.get(p.id)?.open() ?? true);
  const removals = waiting.filter((p) => p.removal).length;

  async function applyAll() {
    setBusy(true);
    const failed: string[] = [];
    let done = 0;
    const todo = waiting;
    setRun({ done: 0, failed: [], total: todo.length });
    // One at a time: several cards can change the same person, and each save starts from what the last one left.
    for (const p of todo) {
      const ok = await cards.current.get(p.id)?.approve();
      if (ok) done++;
      else failed.push(p.summary);
      setRun({ done, failed: [...failed], total: todo.length });
    }
    setBusy(false);
  }

  const cardProps = { tree, conv, itemId, onDecided, register };
  return (
    <>
      {proposals.map((p) => <ProposalCard key={p.id} {...cardProps} proposal={p} />)}
      {(waiting.length > 1 || run) && (
        <div className="aw-applyall">
          {waiting.length > 1 && (
            <>
              <button type="button" className="btn primary ai-touch" onClick={() => void applyAll()} disabled={busy}>
                <Check size={15} aria-hidden /> {busy ? t('ai.approving') : t('chat.applyAll', { count: waiting.length })}
              </button>
              {removals > 0 && <p className="aw-applyall-note">{t('chat.applyAllRemovals', { count: removals })}</p>}
            </>
          )}
          {run && (
            <div role="status">
              <p className="aw-applyall-result">{t('chat.applyAllResult', { done: run.done, total: run.total })}</p>
              {run.failed.length > 0 && (
                <ul className="aw-applyall-failed">
                  {run.failed.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
