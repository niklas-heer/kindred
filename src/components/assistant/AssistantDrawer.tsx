// The assistant: a side drawer for one family. Questions are answered from the tree's own records;
// proposed changes arrive as cards that wait for the reader's approval. Mount <AssistantHost /> once in
// the tree layout (see the report); open it with <AssistantButton /> or openAssistant().
//
// A message appears at once and is replaced by the stored turn when the reply comes back. One that does not
// go stays in the thread with Retry and Edit, and a draft or an unsent message survives closing the drawer.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { errorText } from '~/lib/errortext';
import { ArrowDown, Mic, MicOff, MessageSquarePlus, Pencil, RotateCw, Send, Sparkles, Users, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { aiChatNew, aiChatQuery, aiChatSend, aiStatusQuery } from '~/lib/ai.functions';
import { graphQuery } from '~/lib/api';
import { toAiLocale, type ChatItem } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import { fullName } from '~/lib/graph';
import { useMeChosen } from '~/lib/family';
import { useCan } from '~/lib/session';
import { ErrorState, Notice, Skeleton } from '~/components/ui';
import { useOverlayLayer } from '~/components/ui/overlay';
import { ProposalCard } from './ProposalCard';
import { closeAssistant, openAssistant, useAiStatus, useAssistantOpen } from './store';
import { AiSetupButton, AiSetupDialog } from './AiSetup';
import { useDictation } from './dictation';
import { FamilySession } from './FamilySession';
import { linkMentions } from './mentions';
import './assistant.css';

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

/** A message that did not go: its text, why it failed, and the id Retry and Edit work from. */
interface Unsent { id: string; text: string; error: string }

// Kept for the page's life, not across a reload: a family's draft and its unsent messages survive closing the drawer.
const drafts = new Map<string, string>();
const unsentByTree = new Map<string, Unsent[]>();
let seq = 0;
const newId = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A link a reader can follow: http(s) only. The model's own sources are shown as links, so nothing else is. */
const webUrl = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function AssistantDrawer({ tree }: { tree: string }) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const navigate = useNavigate();
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
  // Places from the tree's records, so a place the model names can link to the atlas.
  const places = useMemo(() => {
    const set = new Set<string>();
    for (const p of graph.data?.people ?? []) {
      if (p.bornPlace) set.add(p.bornPlace);
      if (p.diedPlace) set.add(p.diedPlace);
    }
    return [...set];
  }, [graph.data]);
  const chat = useQuery(aiChatQuery(tree));
  const items = chat.data?.items ?? [];

  const [text, setText] = useState(() => drafts.get(tree) ?? '');
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [unsent, setUnsent] = useState<Unsent[]>(() => unsentByTree.get(tree) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ open: boolean; used: boolean }>({ open: false, used: false });
  // Whether the reader has scrolled away from the newest message; then new content waits behind "Jump to latest".
  const [away, setAway] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const stick = useRef(true);
  const returnTo = useRef<Element | null>(document.activeElement);
  const dictation = useDictation({ locale, onFinal: (s) => setText((prev) => joined(prev, s)) });

  // Page hotkeys stay quiet while the drawer is up (ui/overlay.ts).
  useOverlayLayer(true);
  useEffect(() => {
    areaRef.current?.focus();
    const back = returnTo.current as HTMLElement | null;
    return () => back?.focus?.();
  }, []);
  // Stops listening when the drawer closes, whatever it was doing.
  useEffect(() => () => dictation.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { drafts.set(tree, text); if (!text) drafts.delete(tree); }, [tree, text]);
  useEffect(() => { unsentByTree.set(tree, unsent); }, [tree, unsent]);
  // The typing line says more after a while: a lookup can take long, and the reader should know it has not stalled.
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const id = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(id);
  }, [busy]);
  // The box grows with its text, up to about eight lines, then scrolls.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text, session.open]);
  // On a phone the sheet follows the visible part of the screen, so the composer stays above the on-screen keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    const el = asideRef.current;
    if (!vv || !el) return;
    const fit = () => {
      if (window.matchMedia('(max-width: 640px)').matches) {
        el.style.height = `${vv.height}px`;
        el.style.top = `${vv.offsetTop}px`;
      } else {
        el.style.height = '';
        el.style.top = '';
      }
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, []);

  // New content keeps the reader at the newest message, unless they have scrolled up to read; then it waits.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || session.open) return;
    // Instant, not smooth: a reply that lands mid-animation would leave the thread short of its newest message.
    if (stick.current) el.scrollTop = el.scrollHeight;
    else setAway(true);
  }, [items.length, pending, busy, unsent.length, session.open]);

  function onLogScroll() {
    const el = logRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    stick.current = near;
    if (near) setAway(false);
  }

  /** An instant jump: a smooth one can be cut short by the reply landing, and the reader would be left in the middle. */
  function jumpLatest() {
    const el = logRef.current;
    stick.current = true;
    setAway(false);
    if (el) el.scrollTop = el.scrollHeight;
  }

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

  /** One message, from the composer or a Retry. Its text stays in the thread until it is stored, or until Edit or Retry takes it. */
  async function transmit(msg: string, retryId?: string) {
    stick.current = true;
    setBusy(true);
    setError(null);
    setPending(msg);
    if (retryId) setUnsent((u) => u.filter((x) => x.id !== retryId));
    try {
      await aiChatSend({ data: { tree, text: msg, locale } });
      await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
    } catch (err) {
      const id = retryId ?? newId();
      setUnsent((u) => [...u.filter((x) => x.id !== id), { id, text: msg, error: errorText(err, t.locale) }]);
    } finally {
      setPending(null);
      setBusy(false);
      areaRef.current?.focus();
    }
  }

  function send(e?: FormEvent) {
    e?.preventDefault();
    const msg = text.trim();
    if (!msg || busy) return;
    setText('');
    void transmit(msg);
  }

  /** Puts an unsent message back in the box to change it. A draft already typed stays above it. */
  function editUnsent(u: Unsent) {
    setUnsent((list) => list.filter((x) => x.id !== u.id));
    setText((prev) => (prev.trim() ? `${prev}\n${u.text}` : u.text));
    areaRef.current?.focus();
  }

  /** A family session's transcript, sent once. Resolves true when the draft was made. */
  async function draftFamily(transcript: string, speaker: string): Promise<boolean> {
    stick.current = true;
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
    setUnsent([]);
    await aiChatNew({ data: { tree } });
    await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
    stick.current = true;
    areaRef.current?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dictation.stop();
      closeAssistant();
    }
  }

  /** Enter sends; Shift+Enter makes a new line. Nothing is sent while a reply is on its way. */
  function onInputKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  /** A name or a place in the reply opens its page in the tree, and the drawer steps aside. Other links open as usual. */
  function onLogClick(e: MouseEvent<HTMLDivElement>) {
    const link = (e.target as HTMLElement).closest?.<HTMLAnchorElement>('.ai-text a');
    if (!link || !link.getAttribute('href')?.startsWith('/')) return;
    const url = new URL(link.href);
    e.preventDefault();
    closeAssistant();
    if (url.pathname === `/${tree}/atlas`) {
      navigate({ to: '/$tree/atlas', params: { tree }, search: { place: url.searchParams.get('place') ?? undefined } });
    } else {
      navigate({ to: '/$tree', params: { tree }, search: { focus: url.searchParams.get('focus') ?? undefined } });
    }
  }

  function toggleMic() {
    if (dictation.state === 'listening') dictation.stop();
    else dictation.start();
  }

  const listening = dictation.state === 'listening';
  const empty = chat.isSuccess && items.length === 0 && unsent.length === 0 && !pending;

  return (
    <aside ref={asideRef} className="ai-drawer" role="dialog" aria-label={t('ai.title')} onKeyDown={onKey}>
      <header className="ai-drawer-head">
        <div className="ai-drawer-bar">
          <h2 className="ai-drawer-title"><Sparkles size={16} aria-hidden /> {t('ai.title')}</h2>
          <button type="button" className="btn ghost ai-touch ai-icon ai-drawer-close" onClick={() => { dictation.stop(); closeAssistant(); }} aria-label={t('ai.close')} title={t('ai.close')}>
            <X size={17} aria-hidden />
          </button>
        </div>
        <div className="ai-drawer-tools">
          {canDraft && !session.open && (
            <button type="button" className="btn ghost ai-touch ai-tool" onClick={openSession} disabled={busy}>
              <Users size={15} aria-hidden /> {t('ai.sessionStart')}
            </button>
          )}
          {!session.open && (
            <button type="button" className="btn ghost ai-touch ai-tool" onClick={newConversation} disabled={busy}>
              <MessageSquarePlus size={15} aria-hidden /> {t('ai.newConversation')}
            </button>
          )}
        </div>
      </header>

      {error && <Notice onDismiss={() => setError(null)}>{t('ai.sendFailed')} <span className="subtle">{error}</span></Notice>}

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
        <div className="ai-thread">
          <div className="ai-log" ref={logRef} role="log" aria-live="polite" aria-label={t('ai.title')} onScroll={onLogScroll} onClick={onLogClick}>
            {chat.isPending && <Skeleton lines={3} />}
            {chat.isError && <ErrorState title={t('ai.loadFailed')} message={errorText(chat.error, t.locale)} onRetry={() => chat.refetch()} />}
            {empty && (
              <div className="ai-empty">
                <div className="ai-welcome">
                  <span className="ai-mark" aria-hidden><Sparkles size={16} /></span>
                  <p className="ai-welcome-text">{t('ai.empty')}</p>
                </div>
                <p className="ai-examples-title">{t('ai.examplesTitle')}</p>
                <div className="ai-examples">
                  {examples.map((ex) => (
                    <button
                      key={ex.key}
                      type="button"
                      className={`ai-example${ex.open ? ' ai-example-primary' : ''}`}
                      onClick={() => {
                        if (ex.open) openSession();
                        else {
                          setText(t(ex.key));
                          areaRef.current?.focus();
                        }
                      }}
                    >
                      {ex.open && <Users size={14} aria-hidden />}
                      {t(ex.key)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {items.map((m) => (m.role === 'user' ? <UserTurn key={m.id} item={m} /> : <AssistantTurn key={m.id} tree={tree} item={m} people={people} places={places} />))}
            {pending && (
              <div className="ai-turn ai-turn-user ai-turn-pending">
                <div className="ai-bubble">{pending}</div>
              </div>
            )}
            {busy && !session.open && (
              <div className="ai-turn ai-turn-assistant ai-turn-typing" aria-hidden="true">
                <span className="ai-mark"><Sparkles size={13} /></span>
                <div className="ai-typing-body">
                  <span className="ai-dots"><i /><i /><i /></span>
                  <span className="subtle">{t('ai.sending')}</span>
                  {slow && <span className="subtle ai-slow">{t('ai.stillWorking')}</span>}
                </div>
              </div>
            )}
            {unsent.map((u) => (
              <div key={u.id} className="ai-turn ai-turn-user ai-turn-unsent">
                <div className="ai-bubble">{u.text}</div>
                <div className="ai-unsent">
                  <p className="ai-unsent-line" role="alert">
                    <strong>{t('ai.notSent')}</strong> <span className="subtle">{u.error}</span>
                  </p>
                  <div className="ai-unsent-actions">
                    <button type="button" className="btn ai-touch ai-retry" onClick={() => !busy && void transmit(u.text, u.id)} disabled={busy}>
                      <RotateCw size={14} aria-hidden /> {t('ai.retryNow')}
                    </button>
                    <button type="button" className="btn ghost ai-touch" onClick={() => editUnsent(u)} disabled={busy}>
                      <Pencil size={14} aria-hidden /> {t('ai.edit')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {away && (
            <button type="button" className="ai-jump" onClick={jumpLatest}>
              <ArrowDown size={14} aria-hidden /> {t('ai.jumpLatest')}
            </button>
          )}
        </div>
        <p className="ai-sr" role="status">{busy && !session.open ? t('ai.sending') : ''}</p>

        <form className="ai-composer" onSubmit={send}>
          <label className="ai-sr" htmlFor="ai-input">{t('ai.placeholder')}</label>
          {listening && (
            <p className="ai-rec" role="status">
              <span className="ai-rec-dot" aria-hidden /> {t('ai.micRecording')}
              {dictation.interim && <em className="subtle"> {dictation.interim}</em>}
            </p>
          )}
          <textarea
            id="ai-input"
            ref={areaRef}
            rows={1}
            maxLength={4000}
            placeholder={t('ai.placeholder')}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onInputKey}
          />
          <div className="ai-composer-row">
            {dictation.supported && (
              <button type="button" className={`btn ai-touch ai-mic${listening ? ' ai-mic-on' : ''}`} onClick={toggleMic} disabled={busy} aria-pressed={listening} aria-label={listening ? t('ai.micStop') : t('ai.mic')} title={listening ? t('ai.micStop') : t('ai.mic')}>
                {listening ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
                <span className="ai-mic-label">{listening ? t('ai.micStop') : t('ai.mic')}</span>
              </button>
            )}
            <button type="submit" className="btn primary ai-touch ai-send" disabled={busy || !text.trim()}>
              <Send size={15} aria-hidden /> {t('ai.send')}
            </button>
          </div>
        </form>
        <p className="ai-composer-hint subtle">{t('ai.composerHint')}</p>
        {dictation.state === 'denied' && <p className="ai-foot subtle" role="status">{t('ai.micDenied')}</p>}
        {dictation.state === 'error' && <p className="ai-foot subtle" role="status">{t('ai.micFailed')}</p>}
        {!dictation.supported && <p className="ai-foot subtle">{t('ai.micUnsupported')}</p>}
        {!canPropose && <p className="ai-foot subtle">{t('ai.viewerNote')}</p>}
      </div>
    </aside>
  );
}

/** The reader's turn: their words in a bubble. A family session's transcript is a summary that opens to the full text. */
function UserTurn({ item }: { item: ChatItem }) {
  const t = useT();
  if (item.session) {
    return (
      <details className="ai-turn ai-turn-user ai-msg-session">
        <summary>{t('ai.sessionMessage', { count: item.text.split('\n').length })}</summary>
        <pre className="ai-session-text">{item.text}</pre>
      </details>
    );
  }
  return (
    <div className="ai-turn ai-turn-user">
      <div className="ai-bubble">{item.text}</div>
    </div>
  );
}

/** The assistant's turn: its text as Markdown, names and places as links, its proposals as cards, and the pages it drew on. */
function AssistantTurn({ tree, item, people, places }: { tree: string; item: ChatItem; people: { id: string; name: string }[]; places: string[] }) {
  const t = useT();
  const sources = (item.sources ?? []).filter((s) => webUrl(s.url));
  return (
    <div className="ai-turn ai-turn-assistant">
      <span className="ai-mark" aria-hidden><Sparkles size={13} /></span>
      <div className="ai-turn-body">
        {/* The model's text: an image in it shows its alt text only, so nothing loads from an address the model chose. */}
        {item.text && (
          <div className="ai-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(linkMentions(item.text, { tree, people, places }), { images: 'text' }) }} />
        )}
        {item.proposals?.map((p) => <ProposalCard key={p.id} tree={tree} itemId={item.id} proposal={p} />)}
        {sources.length > 0 && (
          <div className="ai-sources">
            <p className="ai-sources-title">{t('ai.sourcesTitle')}</p>
            <ul>
              {sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.title || hostOf(s.url)}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
