// The assistant: a side drawer for one family. Questions are answered from the tree's own records;
// proposed changes arrive as cards that wait for the reader's approval. Mount <AssistantHost /> once in
// the tree layout (see the report); open it with <AssistantButton /> or openAssistant().
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { errorText } from '~/lib/errortext';
import { Mic, MicOff, MessageSquarePlus, Send, Sparkles, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { aiChatNew, aiChatQuery, aiChatSend, aiStatusQuery } from '~/lib/ai.functions';
import { graphQuery } from '~/lib/api';
import { toAiLocale } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import { fullName } from '~/lib/graph';
import { useMeChosen } from '~/lib/family';
import { useCan } from '~/lib/session';
import { EmptyState, ErrorState, Notice, Skeleton } from '~/components/ui';
import { useOverlayLayer } from '~/components/ui/overlay';
import { ProposalCard } from './ProposalCard';
import { closeAssistant, openAssistant, useAiStatus, useAssistantOpen } from './store';
import { AiSetupButton, AiSetupDialog } from './AiSetup';
import { useDictation } from './dictation';
import { FamilySession } from './FamilySession';
import './assistant.css';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Renders the drawer while it is open, and nothing otherwise. Mount once per family, inside the tree layout. Also the "Set up AI" panel. */
export function AssistantHost({ tree }: { tree: string }) {
  const open = useAssistantOpen();
  const status = useAiStatus(tree);
  return (
    <>
      <AiSetupDialog tree={tree} />
      {open && status?.features.assistant ? <AssistantDrawer tree={tree} /> : null}
    </>
  );
}

/**
 * The "Ask" button. Shown only when the assistant is switched on and configured for this family. A steward of a
 * family with no AI key gets "Set up AI" in its place, which opens the panel that explains it.
 */
export function AssistantButton({ tree, className = '' }: { tree: string; className?: string }) {
  const t = useT();
  const status = useAiStatus(tree);
  if (!status?.features.assistant) return <AiSetupButton tree={tree} className={className} />;
  return (
    <button type="button" className={`btn ai-launch ${className}`} onClick={openAssistant} aria-haspopup="dialog">
      <Sparkles size={16} aria-hidden /> {t('ai.askButton')}
    </button>
  );
}

/** Joins what was typed and what was heard, with one space between. */
const joined = (a: string, b: string) => (a.trim() ? `${a.replace(/\s+$/, '')} ${b}` : b);

function AssistantDrawer({ tree }: { tree: string }) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const qc = useQueryClient();
  const canPropose = useCan('add-story');
  const canDraft = useCan('add-person');
  const canPhotos = useCan('upload-photo');
  const canHouse = useCan('edit-house');
  const status = useQuery(aiStatusQuery(tree)).data;
  const graph = useQuery(graphQuery(tree));
  const me = useMeChosen();
  const people = useMemo(
    () => (graph.data?.people ?? []).map((p) => ({ id: p.id, name: fullName(p) })).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [graph.data, locale],
  );
  const chat = useQuery(aiChatQuery(tree));
  const items = chat.data?.items ?? [];
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ open: boolean; used: boolean }>({ open: false, used: false });
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(document.activeElement);
  const dictation = useDictation({ locale, onFinal: (s) => setText((prev) => joined(prev, s)) });

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
  // Stops listening when the drawer closes, whatever it was doing.
  useEffect(() => () => dictation.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** The example prompts that suit this reader's role and the family's features (the first is the one nobody else needs). */
  const examples: { key: Key; open?: boolean }[] = [
    ...(canDraft ? [{ key: 'ai.exFamily' as Key, open: true }] : []),
    { key: 'ai.exPhotos' },
    { key: 'ai.exMissing' },
    { key: 'ai.exRelated' },
    ...(canPhotos ? [{ key: 'ai.exAlbum' as Key }] : []),
    ...(canPropose && status?.features.avatar ? [{ key: 'ai.exAvatar' as Key }] : []),
    ...(canHouse ? [{ key: 'ai.exHouse' as Key }] : []),
  ];

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
      setError(errorText(err, t.locale));
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  /** A family session's transcript, sent once. Resolves true when the draft was made. */
  async function draftFamily(transcript: string, speaker: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setPending(t('ai.sessionMessage', { count: transcript.split('\n').length }));
    try {
      await aiChatSend({ data: { tree, text: transcript, locale, session: true, speaker } });
      await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
      setSession({ open: false, used: true });
      return true;
    } catch (err) {
      setError(errorText(err, t.locale));
      return false;
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  function openSession() {
    dictation.stop();
    setSession({ open: true, used: true });
  }

  function leaveSession() {
    dictation.stop();
    setSession((s) => ({ ...s, open: false }));
    areaRef.current?.focus();
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
      dictation.stop();
      closeAssistant();
    }
  }

  function onInputKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  function toggleMic() {
    if (dictation.state === 'listening') dictation.stop();
    else dictation.start();
  }

  const listening = dictation.state === 'listening';

  return (
    <aside className="ai-drawer" role="dialog" aria-label={t('ai.title')} onKeyDown={onKey}>
      <header className="ai-drawer-head">
        <h2 className="ai-drawer-title"><Sparkles size={16} aria-hidden /> {t('ai.title')}</h2>
        <button type="button" className="btn ghost ai-touch ai-icon ai-drawer-close" onClick={() => { dictation.stop(); closeAssistant(); }} aria-label={t('ai.close')} title={t('ai.close')}>
          <X size={17} aria-hidden />
        </button>
        <div className="ai-drawer-tools">
          {canDraft && !session.open && (
            <button type="button" className="btn ghost ai-touch" onClick={openSession} disabled={busy}>
              <Users size={15} aria-hidden /> {t('ai.sessionStart')}
            </button>
          )}
          {!session.open && (
            <button type="button" className="btn ghost ai-touch" onClick={newConversation} disabled={busy}>
              <MessageSquarePlus size={15} aria-hidden /> {t('ai.newConversation')}
            </button>
          )}
        </div>
      </header>

      {session.used && (
        <div className="ai-body" hidden={!session.open}>
          <FamilySession
            people={people}
            initial={me}
            busy={busy}
            onDraft={draftFamily}
            onLeave={leaveSession}
            locale={locale}
          />
        </div>
      )}

      <div className="ai-body" hidden={session.open}>
        <div className="ai-log" ref={logRef} role="log" aria-live="polite">
          {chat.isPending && <Skeleton lines={3} />}
          {chat.isError && <ErrorState title={t('ai.loadFailed')} message={errorText(chat.error, t.locale)} onRetry={() => chat.refetch()} />}
          {chat.isSuccess && items.length === 0 && !pending && (
            <div className="ai-empty">
              <EmptyState title={t('ai.title')} text={t('ai.empty')} />
              <p className="ai-examples-title subtle">{t('ai.examplesTitle')}</p>
              <div className="ai-examples">
                {examples.map((ex) => (
                  <button
                    key={ex.key}
                    type="button"
                    className="ai-example"
                    onClick={() => {
                      if (ex.open) openSession();
                      else {
                        setText(t(ex.key));
                        areaRef.current?.focus();
                      }
                    }}
                  >
                    {t(ex.key)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {items.map((m) =>
            m.role === 'user' && m.session ? (
              <details key={m.id} className="ai-msg ai-msg-user ai-msg-session">
                <summary>{t('ai.sessionMessage', { count: m.text.split('\n').length })}</summary>
                <pre className="ai-session-text">{m.text}</pre>
              </details>
            ) : m.role === 'user' ? (
              <div key={m.id} className="ai-msg ai-msg-user"><p>{m.text}</p></div>
            ) : (
              <div key={m.id} className="ai-msg ai-msg-assistant">
                {/* The model's text: an image in it shows its alt text only, so nothing loads from an address the model chose. */}
                {m.text && <div className="ai-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text, { images: 'text' }) }} />}
                {m.proposals?.map((p) => <ProposalCard key={p.id} tree={tree} itemId={m.id} proposal={p} />)}
              </div>
            ),
          )}
          {pending && <div className="ai-msg ai-msg-user"><p>{pending}</p></div>}
          {busy && !session.open && <p className="ai-thinking subtle">{t('ai.sending')}</p>}
          {error && <Notice onDismiss={() => setError(null)}>{t('ai.sendFailed')} <span className="subtle">{error}</span></Notice>}
        </div>

        <form className="ai-composer" onSubmit={send}>
          <label className="ai-sr" htmlFor="ai-input">{t('ai.placeholder')}</label>
          <textarea
            id="ai-input"
            ref={areaRef}
            rows={2}
            maxLength={4000}
            placeholder={t('ai.placeholder')}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onInputKey}
          />
          <div className="ai-composer-actions">
            {dictation.supported && (
              <button type="button" className={`btn ${listening ? 'primary' : 'ghost'} ai-touch ai-mic`} onClick={toggleMic} disabled={busy} aria-pressed={listening} aria-label={listening ? t('ai.micStop') : t('ai.mic')} title={listening ? t('ai.micStop') : t('ai.mic')}>
                {listening ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
              </button>
            )}
            <button type="submit" className="btn primary ai-touch" disabled={busy || !text.trim()}>
              <Send size={15} aria-hidden /> {t('ai.send')}
            </button>
          </div>
        </form>
        {listening && (
          <p className="ai-rec" role="status">
            <span className="ai-rec-dot" aria-hidden /> {t('ai.micRecording')}
            {dictation.interim && <em className="subtle"> {dictation.interim}</em>}
          </p>
        )}
        {dictation.state === 'denied' && <p className="ai-foot subtle" role="status">{t('ai.micDenied')}</p>}
        {dictation.state === 'error' && <p className="ai-foot subtle" role="status">{t('ai.micFailed')}</p>}
        {!dictation.supported && <p className="ai-foot subtle">{t('ai.micUnsupported')}</p>}
        {!canPropose && <p className="ai-foot subtle">{t('ai.viewerNote')}</p>}
      </div>
    </aside>
  );
}
