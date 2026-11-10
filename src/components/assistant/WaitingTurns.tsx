// The turns of a chat that are not stored yet: the message on its way, the reply being written, messages that did not
// go, and the assistant waiting to carry on after the reader's decisions.
import { Pencil, RotateCw, Sparkles, Square } from 'lucide-react';
import { useT } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import type { Attached } from './attachments';
import type { Unsent } from './chat-runs';
import { AttachedThumbs } from './ChatTurns';
import type { LiveReply } from './useChatStream';

/** The reader's message on its way (`text` empty for pictures alone). */
export function SendingTurn({ text, images }: { text: string; images: Attached[] }) {
  return (
    <div className="ai-turn ai-turn-user ai-turn-pending">
      <AttachedThumbs images={images} />
      {text && <div className="ai-bubble">{text}</div>}
    </div>
  );
}

/** The reply being written: its text so far, or what the assistant is doing (`slow` once that takes a while), and Stop. */
export function LiveTurn({ live, slow, onStop }: { live: LiveReply | null | undefined; slow: boolean; onStop: () => void }) {
  const t = useT();
  return (
    <div className="ai-turn ai-turn-assistant ai-turn-live">
      <span className="ai-mark" aria-hidden><Sparkles size={13} /></span>
      <div className="ai-turn-body">
        {/* Hidden from screen readers while it is written: the log announces the finished reply, once, when it is stored. */}
        <div aria-hidden="true">
          {live?.text
            ? <div className="ai-text ai-text-live" dangerouslySetInnerHTML={{ __html: renderMarkdown(live.text, { images: 'text' }) }} />
            : (
              <div className="ai-live-status">
                <span className="ai-dots"><i /><i /><i /></span>
                <span className="subtle">{t(live?.step ?? 'ai.sending')}</span>
                {slow && <span className="subtle ai-slow">{t('ai.stillWorking')}</span>}
              </div>
            )}
        </div>
        <button type="button" className="btn ghost ai-touch ai-stop" onClick={onStop}><Square size={13} aria-hidden /> {t('ai.stop')}</button>
      </div>
    </div>
  );
}

/** A message that did not go, with why, Retry and Edit (both wait while a reply is on its way). */
export function UnsentTurn({ unsent: u, busy, onRetry, onEdit }: { unsent: Unsent; busy: boolean; onRetry: () => void; onEdit: () => void }) {
  const t = useT();
  return (
    <div className="ai-turn ai-turn-user ai-turn-unsent">
      <AttachedThumbs images={u.images ?? []} />
      {u.text && <div className="ai-bubble">{u.text}</div>}
      <div className="ai-unsent">
        <p className="ai-unsent-line" role="alert">
          <strong>{t('ai.notSent')}</strong> <span className="subtle">{u.error}</span>
        </p>
        <div className="ai-unsent-actions">
          <button type="button" className="btn ai-touch ai-retry" onClick={onRetry} disabled={busy}>
            <RotateCw size={14} aria-hidden /> {t('ai.retryNow')}
          </button>
          <button type="button" className="btn ghost ai-touch" onClick={onEdit} disabled={busy}>
            <Pencil size={14} aria-hidden /> {t('ai.edit')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The reader has decided every card: the assistant carries on, or says it could not (`error`) and offers to try again. */
export function ContinueTurn({ error, onContinue }: { error: string | null; onContinue: () => void }) {
  const t = useT();
  const failed = error !== null;
  return (
    <div className="ai-turn ai-turn-assistant">
      <span className="ai-mark" aria-hidden><Sparkles size={13} /></span>
      <div className="ai-turn-body">
        <p className="ai-unsent-line" role={failed ? 'alert' : undefined}>
          {t(failed ? 'ai.continueFailed' : 'ai.continueDue')}{error && <span className="subtle"> {error}</span>}
        </p>
        <div className="ai-unsent-actions ai-continue-actions">
          <button type="button" className="btn ai-touch ai-retry" onClick={onContinue}>
            <RotateCw size={14} aria-hidden /> {t(failed ? 'ai.retryNow' : 'ai.continueNow')}
          </button>
        </div>
      </div>
    </div>
  );
}
