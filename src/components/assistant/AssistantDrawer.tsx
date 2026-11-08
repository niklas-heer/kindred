// The assistant: a side drawer for one family. Questions are answered from the tree's own records;
// proposed changes arrive as cards that wait for the reader's approval. Mount <AssistantHost /> once in
// the tree layout (see the report); open it with <AssistantButton /> or openAssistant().
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, Send, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { aiChatNew, aiChatQuery, aiChatSend } from '~/lib/ai.functions';
import { copyFor } from '~/lib/ai/copy';
import { toAiLocale } from '~/lib/ai/types';
import { useT } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import { useCan } from '~/lib/session';
import { EmptyState, ErrorState, Notice, Skeleton } from '~/components/ui';
import { useOverlayLayer } from '~/components/ui/overlay';
import { ProposalCard } from './ProposalCard';
import { closeAssistant, openAssistant, useAiStatus, useAssistantOpen } from './store';
import './assistant.css';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Renders the drawer while it is open, and nothing otherwise. Mount once per family, inside the tree layout. */
export function AssistantHost({ tree }: { tree: string }) {
  const open = useAssistantOpen();
  const status = useAiStatus(tree);
  if (!open || !status?.features.assistant) return null;
  return <AssistantDrawer tree={tree} />;
}

/** The "Ask" button. Shown only when the assistant is switched on and configured for this family. */
export function AssistantButton({ tree, className = '' }: { tree: string; className?: string }) {
  const t = useT();
  const c = copyFor(toAiLocale(t.locale));
  const status = useAiStatus(tree);
  if (!status?.features.assistant) return null;
  return (
    <button type="button" className={`btn ai-launch ${className}`} onClick={openAssistant} aria-haspopup="dialog">
      <Sparkles size={16} aria-hidden /> {c.askButton}
    </button>
  );
}

function AssistantDrawer({ tree }: { tree: string }) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const c = copyFor(locale);
  const qc = useQueryClient();
  const canPropose = useCan('add-story');
  const chat = useQuery(aiChatQuery(tree));
  const items = chat.data?.items ?? [];
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(document.activeElement);

  // Page hotkeys stay quiet while the drawer is up (ui/overlay.ts).
  useOverlayLayer(true);
  useEffect(() => {
    areaRef.current?.focus();
    const back = returnTo.current as HTMLElement | null;
    return () => back?.focus?.();
  }, []);
  useEffect(() => {
    const log = logRef.current;
    log?.scrollTo({ top: log.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' });
  }, [items.length, pending, busy]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const msg = text.trim();
    if (!msg || busy) return;
    setBusy(true);
    setPending(msg);
    setText('');
    setError(null);
    try {
      await aiChatSend({ data: { tree, text: msg, locale } });
      await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
    } catch (err) {
      setText(msg);
      setError(messageOf(err));
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  async function newConversation() {
    setError(null);
    await aiChatNew({ data: { tree } });
    await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
    areaRef.current?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeAssistant();
    }
  }

  function onInputKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <aside className="ai-drawer" role="dialog" aria-label={c.title} onKeyDown={onKey}>
      <header className="ai-drawer-head">
        <h2 className="ai-drawer-title"><Sparkles size={16} aria-hidden /> {c.title}</h2>
        <div className="ai-drawer-tools">
          <button type="button" className="btn ghost ai-touch" onClick={newConversation} disabled={busy}>
            <MessageSquarePlus size={15} aria-hidden /> {c.newConversation}
          </button>
          <button type="button" className="btn ghost ai-touch ai-icon" onClick={closeAssistant} aria-label={c.close} title={c.close}>
            <X size={17} aria-hidden />
          </button>
        </div>
      </header>

      <div className="ai-log" ref={logRef} role="log" aria-live="polite">
        {chat.isPending && <Skeleton lines={3} />}
        {chat.isError && <ErrorState title={c.loadFailed} message={messageOf(chat.error)} onRetry={() => chat.refetch()} />}
        {chat.isSuccess && items.length === 0 && !pending && <EmptyState title={c.title} text={c.empty} />}
        {items.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="ai-msg ai-msg-user"><p>{m.text}</p></div>
          ) : (
            <div key={m.id} className="ai-msg ai-msg-assistant">
              {m.text && <div className="ai-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />}
              {m.proposals?.map((p) => <ProposalCard key={p.id} tree={tree} itemId={m.id} proposal={p} />)}
            </div>
          ),
        )}
        {pending && <div className="ai-msg ai-msg-user"><p>{pending}</p></div>}
        {busy && <p className="ai-thinking subtle">{c.sending}</p>}
        {error && <Notice onDismiss={() => setError(null)}>{c.sendFailed} <span className="subtle">{error}</span></Notice>}
      </div>

      <form className="ai-composer" onSubmit={send}>
        <label className="ai-sr" htmlFor="ai-input">{c.placeholder}</label>
        <textarea
          id="ai-input"
          ref={areaRef}
          rows={2}
          maxLength={4000}
          placeholder={c.placeholder}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onInputKey}
        />
        <button type="submit" className="btn primary ai-touch" disabled={busy || !text.trim()}>
          <Send size={15} aria-hidden /> {c.send}
        </button>
      </form>
      {!canPropose && <p className="ai-foot subtle">{c.viewerNote}</p>}
    </aside>
  );
}
