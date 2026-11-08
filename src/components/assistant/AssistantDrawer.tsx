// The assistant: a chat window for one family (a full-height sheet on a phone). Questions are answered from the tree's own records;
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
import { aiChatContinue, aiChatImageQuery, aiChatNew, aiChatQuery, aiChatSend, aiStatusQuery } from '~/lib/ai.functions';
import { graphQuery } from '~/lib/api';
import { toAiLocale, type ChatItem } from '~/lib/ai/types';
import { useT, type Key } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import { fullName } from '~/lib/graph';
import { useMeChosen } from '~/lib/family';
import { useCan } from '~/lib/session';
import { ErrorState, Notice, Skeleton } from '~/components/ui';
import { isTopOverlay, useOverlayLayer } from '~/components/ui/overlay';
import { ProposalCard, type OnDecided } from './ProposalCard';
import { ASSISTANT_FOCUS, closeAssistant, openAssistant, useAiStatus, useAssistantOpen } from './store';
import { ResizeEdges, useChatWindow, WindowControls } from './useChatWindow';
import { AiSetupButton, AiSetupDialog } from './AiSetup';
import { AttachButton, DropVeil, ImageTray, useImageAttach, type Attached } from './attachments';
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
interface Unsent { id: string; text: string; error: string; images?: Attached[]; keep?: boolean }

// Kept for the page's life, not across a reload: a family's draft and its unsent messages survive closing the drawer.
const drafts = new Map<string, string>();
const unsentByTree = new Map<string, Unsent[]>();
const draftImages = new Map<string, Attached[]>();
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
  const [pendingImages, setPendingImages] = useState<Attached[]>([]);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [unsent, setUnsent] = useState<Unsent[]>(() => unsentByTree.get(tree) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [keepImages, setKeepImages] = useState(false);
  const [session, setSession] = useState<{ open: boolean; used: boolean }>({ open: false, used: false });
  // Whether the reader has scrolled away from the newest message; then new content waits behind "Jump to latest".
  const [away, setAway] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const stick = useRef(true);
  const returnTo = useRef<Element | null>(document.activeElement);
  const win = useChatWindow(asideRef);
  // Whether the reader is working in the window. It is not modal: while they are on the page behind it, the page's keys are the page's.
  const [inside, setInside] = useState(true);
  const insideRef = useRef(true);
  const busyRef = useRef(false);
  busyRef.current = busy;
  // Decisions are told once, in one reply. One decided while a reply is on its way waits here for that reply to end.
  const wantContinue = useRef(false);
  const unrecorded = useRef<Parameters<OnDecided>[0][]>([]);
  const [continueError, setContinueError] = useState<string | null>(null);
  const dictation = useDictation({ locale, onFinal: (s) => setText((prev) => joined(prev, s)) });
  // Pictures need the same role as a family session. The composer shows nothing of them to anyone else.
  const attach = useImageAttach({ active: canDraft && !session.open, initial: draftImages.get(tree), onError: setImageError });

  // Page hotkeys stay quiet while the reader is in the window, and always on a phone, where the sheet covers the page (ui/overlay.ts).
  const layer = useOverlayLayer(win.phone || inside);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  useEffect(() => {
    areaRef.current?.focus();
    const back = returnTo.current as HTMLElement | null;
    // Focus goes back only if it was in the window: a reader who has moved on to the page keeps their place.
    return () => { if (insideRef.current || document.activeElement === document.body) back?.focus?.(); };
  }, []);
  // Follows where the reader is working, by focus and by pointer (a click on empty page moves no focus).
  useEffect(() => {
    const track = (e: Event) => {
      const now = !!asideRef.current?.contains(e.target as Node);
      insideRef.current = now;
      setInside(now);
    };
    const enter = () => {
      insideRef.current = true;
      setInside(true);
      areaRef.current?.focus();
    };
    // Esc closes from anywhere in the window, a popover inside it first. F6 moves between the window and the page.
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented && insideRef.current && isTopOverlay(layerRef.current)) {
        e.preventDefault();
        dictation.stop();
        closeAssistant();
      } else if (e.key === 'F6' && !e.defaultPrevented) {
        e.preventDefault();
        if (!insideRef.current) return enter();
        insideRef.current = false;
        setInside(false);
        const back = returnTo.current as HTMLElement | null;
        if (back && back !== document.body && back.isConnected) back.focus();
        else (document.activeElement as HTMLElement | null)?.blur?.();
      }
    };
    document.addEventListener('focusin', track);
    document.addEventListener('pointerdown', track, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener(ASSISTANT_FOCUS, enter);
    return () => {
      document.removeEventListener('focusin', track);
      document.removeEventListener('pointerdown', track, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(ASSISTANT_FOCUS, enter);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Resizing the window keeps the newest message in view, unless the reader has scrolled up.
  useEffect(() => {
    const el = logRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // When a reply has ended: a continuation that had to wait starts, and a reader still in the window gets the box back
  // (the box was disabled while waiting, which dropped its focus).
  useEffect(() => {
    if (busy) return;
    if (wantContinue.current) {
      wantContinue.current = false;
      void carryOn();
    } else if (insideRef.current && document.activeElement === document.body) {
      areaRef.current?.focus();
    }
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  // Stops listening when the drawer closes, whatever it was doing.
  useEffect(() => () => dictation.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { drafts.set(tree, text); if (!text) drafts.delete(tree); }, [tree, text]);
  useEffect(() => { unsentByTree.set(tree, unsent); }, [tree, unsent]);
  useEffect(() => { draftImages.set(tree, attach.images); }, [tree, attach.images]);
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
  async function transmit(msg: string, images: Attached[], keep: boolean, retryId?: string) {
    stick.current = true;
    setBusy(true);
    setError(null);
    setPending(msg);
    setPendingImages(images);
    if (retryId) setUnsent((u) => u.filter((x) => x.id !== retryId));
    try {
      await aiChatSend({ data: { tree, text: msg, locale, ...(images.length && { images: images.map((i) => ({ base64: i.base64 })), keepImages: keep }) } });
      await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
    } catch (err) {
      const id = retryId ?? newId();
      setUnsent((u) => [...u.filter((x) => x.id !== id), { id, text: msg, error: errorText(err, t.locale), images, keep }]);
    } finally {
      setPending(null);
      setPendingImages([]);
      setBusy(false);
      areaRef.current?.focus();
    }
  }

  function send(e?: FormEvent) {
    e?.preventDefault();
    const msg = text.trim();
    const images = attach.images;
    if ((!msg && !images.length) || busy || attach.reading) return;
    setText('');
    attach.replace([]);
    setImageError(null);
    const keep = keepImages;
    setKeepImages(false);
    void transmit(msg, images, keep);
  }

  /** Puts an unsent message back in the box to change it. A draft already typed stays above it. */
  function editUnsent(u: Unsent) {
    setUnsent((list) => list.filter((x) => x.id !== u.id));
    setText((prev) => (prev.trim() ? `${prev}\n${u.text}` : u.text));
    if (u.images?.length) attach.replace(u.images);
    setKeepImages(!!u.keep);
    areaRef.current?.focus();
  }

  /** A family session's transcript, sent once. Resolves true when the draft was made. */
  async function draftFamily(transcript: string, speaker: string, images: Attached[], keep: boolean): Promise<boolean> {
    stick.current = true;
    setBusy(true);
    setError(null);
    setPending(transcript ? t('ai.sessionMessage', { count: transcript.split('\n').length }) : t('ai.imagesSent', { count: images.length }));
    setPendingImages(images);
    try {
      await aiChatSend({ data: { tree, text: transcript, locale, session: true, speaker, ...(images.length && { images: images.map((i) => ({ base64: i.base64 })), keepImages: keep }) } });
      await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
      setSession({ open: false, used: true });
      return true;
    } catch (err) {
      setError(errorText(err, t.locale));
      return false;
    } finally {
      setPending(null);
      setPendingImages([]);
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

  /** The assistant carries on after the reader's decisions. Its reply is stored like any other; if it fails, the decisions are safe and Retry asks again. */
  async function carryOn() {
    if (busyRef.current) {
      wantContinue.current = true;
      return;
    }
    busyRef.current = true;
    stick.current = true;
    setContinueError(null);
    setBusy(true);
    try {
      await aiChatContinue({ data: { tree, locale } });
      await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
    } catch (err) {
      setContinueError(errorText(err, t.locale));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /** A card was decided: records it, and carries on when it was the last one waiting. */
  const onDecided: OnDecided = (mark) => {
    void mark().then(
      (r) => { if (r.due) void carryOn(); },
      (err) => {
        unrecorded.current.push(mark);
        setContinueError(errorText(err, t.locale));
      },
    );
  };

  /** Retry: records whatever could not be recorded, then asks the assistant to carry on. */
  async function retryContinue() {
    setContinueError(null);
    for (const mark of unrecorded.current.splice(0)) {
      try {
        await mark();
      } catch (err) {
        unrecorded.current.push(mark);
        setContinueError(errorText(err, t.locale));
        return;
      }
    }
    await carryOn();
  }

  async function newConversation() {
    setError(null);
    setUnsent([]);
    setContinueError(null);
    unrecorded.current = [];
    await aiChatNew({ data: { tree } });
    await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
    stick.current = true;
    areaRef.current?.focus();
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
  const empty = chat.isSuccess && items.length === 0 && unsent.length === 0 && pending === null;

  return (
    <aside ref={asideRef} className={`ai-drawer${win.docked ? ' ai-docked' : ''}`} role="dialog" aria-label={t('ai.title')}>
      <ResizeEdges win={win} />
      <header className="ai-drawer-head" onPointerDown={win.onHeaderPointerDown}>
        <div className="ai-drawer-bar">
          <h2 className="ai-drawer-title"><Sparkles size={16} aria-hidden /> <span>{t('ai.title')}</span></h2>
          <WindowControls win={win} />
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
            active={session.open}
            provider={status?.provider}
          />
        </div>
      )}

      <div className="ai-body ai-drop-zone" hidden={session.open} {...(canDraft ? attach.dropProps : {})}>
        <DropVeil show={attach.dragging} />
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
            {items.map((m) => (m.role === 'user' ? <UserTurn key={m.id} tree={tree} item={m} /> : <AssistantTurn key={m.id} tree={tree} item={m} people={people} places={places} onDecided={onDecided} />))}
            {(pending !== null) && (
              <div className="ai-turn ai-turn-user ai-turn-pending">
                <AttachedThumbs images={pendingImages} />
                {pending && <div className="ai-bubble">{pending}</div>}
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
                <AttachedThumbs images={u.images ?? []} />
                {u.text && <div className="ai-bubble">{u.text}</div>}
                <div className="ai-unsent">
                  <p className="ai-unsent-line" role="alert">
                    <strong>{t('ai.notSent')}</strong> <span className="subtle">{u.error}</span>
                  </p>
                  <div className="ai-unsent-actions">
                    <button type="button" className="btn ai-touch ai-retry" onClick={() => !busy && void transmit(u.text, u.images ?? [], !!u.keep, u.id)} disabled={busy}>
                      <RotateCw size={14} aria-hidden /> {t('ai.retryNow')}
                    </button>
                    <button type="button" className="btn ghost ai-touch" onClick={() => editUnsent(u)} disabled={busy}>
                      <Pencil size={14} aria-hidden /> {t('ai.edit')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {!busy && !session.open && (continueError !== null || chat.data?.continueDue) && (
              <div className="ai-turn ai-turn-assistant">
                <span className="ai-mark" aria-hidden><Sparkles size={13} /></span>
                <div className="ai-turn-body">
                  <p className="ai-unsent-line" role={continueError !== null ? 'alert' : undefined}>
                    {t(continueError !== null ? 'ai.continueFailed' : 'ai.continueDue')}{continueError && <span className="subtle"> {continueError}</span>}
                  </p>
                  <div className="ai-unsent-actions ai-continue-actions">
                    <button type="button" className="btn ai-touch ai-retry" onClick={() => void retryContinue()}>
                      <RotateCw size={14} aria-hidden /> {t(continueError !== null ? 'ai.retryNow' : 'ai.continueNow')}
                    </button>
                  </div>
                </div>
              </div>
            )}
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
          {canDraft && <ImageTray attach={attach} provider={status?.provider} keep={keepImages} onKeep={setKeepImages} disabled={busy} />}
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
            {canDraft && <AttachButton attach={attach} disabled={busy} />}
            {dictation.supported && (
              <button type="button" className={`btn ai-touch ai-mic${listening ? ' ai-mic-on' : ''}`} onClick={toggleMic} disabled={busy} aria-pressed={listening} aria-label={listening ? t('ai.micStop') : t('ai.mic')} title={listening ? t('ai.micStop') : t('ai.mic')}>
                {listening ? <MicOff size={16} aria-hidden /> : <Mic size={16} aria-hidden />}
                <span className="ai-mic-label">{listening ? t('ai.micStop') : t('ai.mic')}</span>
              </button>
            )}
            <button type="submit" className="btn primary ai-touch ai-send" disabled={busy || attach.reading || (!text.trim() && !attach.images.length)}>
              <Send size={15} aria-hidden /> {t('ai.send')}
            </button>
          </div>
        </form>
        {imageError && <p className="ai-foot ai-card-error" role="alert">{t(imageError as Key)}</p>}
        <p className="ai-composer-hint subtle">{t(canDraft ? 'ai.composerHintImages' : 'ai.composerHint')}</p>
        {dictation.state === 'denied' && <p className="ai-foot subtle" role="status">{t('ai.micDenied')}</p>}
        {dictation.state === 'error' && <p className="ai-foot subtle" role="status">{t('ai.micFailed')}</p>}
        {!dictation.supported && <p className="ai-foot subtle">{t('ai.micUnsupported')}</p>}
        {!canPropose && <p className="ai-foot subtle">{t('ai.viewerNote')}</p>}
      </div>
    </aside>
  );
}

/** The reader's turn: their words in a bubble. A family session's transcript is a summary that opens to the full text. */
function UserTurn({ tree, item }: { tree: string; item: ChatItem }) {
  const t = useT();
  if (item.session && item.text.trim()) {
    return (
      <details className="ai-turn ai-turn-user ai-msg-session">
        <summary>{t('ai.sessionMessage', { count: item.text.split('\n').length })}</summary>
        <pre className="ai-session-text">{item.text}</pre>
        <SentImages tree={tree} images={item.images} />
      </details>
    );
  }
  return (
    <div className="ai-turn ai-turn-user">
      <SentImages tree={tree} images={item.images} />
      {item.text && <div className="ai-bubble">{item.text}</div>}
    </div>
  );
}

/** The pictures on a message that has not been stored yet. */
function AttachedThumbs({ images }: { images: Attached[] }) {
  const t = useT();
  if (!images.length) return null;
  return (
    <ul className="ai-thumbs ai-thumbs-sent">
      {images.map((img, i) => <li key={img.id} className="ai-thumb"><img src={img.url} alt={t('ai.attachAlt', { n: i + 1 })} /></li>)}
    </ul>
  );
}

/** The pictures on a stored message: the ones its writer kept, and how many there were. */
function SentImages({ tree, images }: { tree: string; images: ChatItem['images'] }) {
  const t = useT();
  if (!images) return null;
  const dropped = images.count - images.kept.length;
  return (
    <div className="ai-sent-images">
      {images.kept.length > 0 && <ul className="ai-thumbs ai-thumbs-sent">{images.kept.map((id, i) => <KeptImage key={id} tree={tree} id={id} n={i + 1} />)}</ul>}
      {dropped > 0 && <p className="ai-sent-note subtle">{t('ai.imagesNotKept', { count: dropped })}</p>}
    </div>
  );
}

function KeptImage({ tree, id, n }: { tree: string; id: string; n: number }) {
  const t = useT();
  const img = useQuery(aiChatImageQuery(tree, id)).data;
  return <li className="ai-thumb">{img ? <img src={`data:${img.mime};base64,${img.base64}`} alt={t('ai.attachAlt', { n })} /> : null}</li>;
}

/** The assistant's turn: its text as Markdown, names and places as links, its proposals as cards, and the pages it drew on. */
function AssistantTurn({ tree, item, people, places, onDecided }: { tree: string; item: ChatItem; people: { id: string; name: string }[]; places: string[]; onDecided: OnDecided }) {
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
        {item.proposals?.map((p) => <ProposalCard key={p.id} tree={tree} itemId={item.id} proposal={p} onDecided={onDecided} />)}
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
