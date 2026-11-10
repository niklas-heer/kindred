// The assistant: a chat window for one family (a full-height sheet on a phone). Questions are answered from the tree's own records;
// proposed changes arrive as cards that wait for the reader's approval. Mount <AssistantHost /> once in
// the tree layout (Launcher.tsx, which loads this module when the window first opens); open it with <AssistantButton />
// or openAssistant().
//
// A message appears at once and is replaced by the stored turn when the reply comes back. One that does not
// go stays in the thread with Retry and Edit, and a draft or an unsent message survives closing the drawer.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { errorText } from '~/lib/errortext';
import { ArrowDown, Mic, MicOff, MessageSquarePlus, PanelLeft, Pencil, RotateCw, Send, Sparkles, Square, Users, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { aiChatModelsQuery, aiChatNew, aiChatQuery, aiChatRetry, aiChatSend, aiStatusQuery, aiThreadSetModel, aiThreadsQuery } from '~/lib/ai.functions';
import { threadTitle } from '~/lib/ai/thread-title';
import { retryable } from '~/lib/ai/chat-turns';
import { graphQuery } from '~/lib/api';
import { toAiLocale } from '~/lib/ai/types';
import { compareText, useT, type Key } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import { fullName } from '~/lib/graph';
import { useMeChosen } from '~/lib/family';
import { useCan } from '~/lib/session';
import { ErrorState, Notice, Skeleton } from '~/components/ui';
import { isTopOverlay, useOverlayLayer } from '~/components/ui/overlay';
import type { OnDecided } from './ProposalCard';
import { AssistantTurn, AttachedThumbs, UserTurn } from './ChatTurns';
import { usePageContext } from './page-context';
import './widgets/widgets.css';
import { ASSISTANT_FOCUS, closeAssistant, takeFocusRequest } from './store';
import { ResizeEdges, useChatWindow, WindowControls } from './useChatWindow';
import { useTabs } from './ChatDock';
import { ChatList, ChatTabs, chatName } from './ChatList';
import { finishRun, forgetRun, getRun, patchRun, setFrontChat, useRun, useRunSummary } from './chat-runs';
import { closeTab, forgetChat, getTabs, openTab, updateTabs, withDraft } from './chat-tabs';
import { ModelPicker, type PickedModel } from './ModelPicker';
import { carryOn, forgetInterrupted, restoreInterrupted, transmit, useChatStream } from './useChatStream';
import { AttachButton, DropVeil, ImageTray, useImageAttach, type Attached } from './attachments';
import { useDictation } from './dictation';
import { FamilySession } from './FamilySession';
import './assistant.css';

/** Joins what was typed and what was heard, with one space between. */
const joined = (a: string, b: string) => (a.trim() ? `${a.replace(/\s+$/, '')} ${b}` : b);

// Pictures waiting to be sent, per chat, for the page's life: they are too large to keep across a reload, unlike a draft's words.
const draftImages = new Map<string, Attached[]>();
const restoredInterrupted = new Set<string>();

/** The composer's tallest: five lines of its text and its padding (the same number as max-height in assistant.css). */
const COMPOSER_MAX = 136;

/** From this wide, the list of chats sits beside the thread; below it, it slides over (the same width as the CSS container query). */
const LIST_BESIDE_WIDTH = 720;

/** The window itself. Loaded on demand by Launcher.tsx, so a page carries none of it until the reader asks. */
export function AssistantDrawer({ tree }: { tree: string }) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canPropose = useCan('add-story');
  const canDraft = useCan('add-person');
  const canPhotos = useCan('upload-photo');
  const canHouse = useCan('edit-house');
  const steward = useCan('manage-access');
  const status = useQuery(aiStatusQuery(tree)).data;
  const graph = useQuery(graphQuery(tree));
  const me = useMeChosen();
  const people = useMemo(
    () => (graph.data?.people ?? []).map((p) => ({ id: p.id, name: fullName(p) })).sort((a, b) => compareText(locale)(a.name, b.name)),
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

  // Which chats are open, and which is in front. Everything below is about the one in front; a reply in any of them runs on its own (chat-runs.ts).
  const tabState = useTabs(tree);
  const conv = tabState.active;
  const convRef = useRef(conv);
  convRef.current = conv;
  const threads = useQuery(aiThreadsQuery(tree));
  const chat = useQuery({ ...aiChatQuery(tree, conv ?? ''), enabled: !!conv });
  const items = conv ? (chat.data?.items ?? []) : [];
  const run = useRun(conv);
  const { busy, pending, pendingImages, unsent, error, continueError } = run;
  const stream = useChatStream(conv ?? '', conv ? chat.data?.items : undefined);
  const models = useQuery(aiChatModelsQuery(tree, steward)).data;

  // The box is not a controlled field: Wispr Flow and other dictation apps write into it from outside (paste, the accessibility API, a value set
  // and an input event), and nothing the app draws may put old text back over what they wrote. `text` follows the box, for the Send button and its size.
  const [text, setText] = useState('');
  const [slow, setSlow] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [keepImages, setKeepImages] = useState(false);
  const [session, setSession] = useState<{ open: boolean; used: boolean }>({ open: false, used: false });
  const [tabsFull, setTabsFull] = useState(false);
  const [moreExamples, setMoreExamples] = useState(false);
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
  const listOpen = tabState.listOpen;
  const listOpenRef = useRef(listOpen);
  listOpenRef.current = listOpen;
  const page = usePageContext(tree);
  const pageRef = useRef(page);
  pageRef.current = page;
  const ctx = (c: string) => ({ conv: c, tree, locale: t.locale, qc, page: pageRef.current });

  /** What the reader wrote: remembered for this chat. Every way of writing in the box comes through here. */
  const noteText = useCallback((value: string) => {
    setText(value);
    const c = convRef.current;
    if (c) updateTabs(tree, (s) => withDraft(s, c, value, Date.now()), true);
  }, [tree]);

  /** Sets the box from the app's side: a reply's Edit, an example, dictation, or clearing it after sending. */
  function setComposer(value: string) {
    const el = areaRef.current;
    if (el && el.value !== value) el.value = value;
    noteText(value);
  }

  const dictation = useDictation({ locale, onFinal: (s) => setComposer(joined(areaRef.current?.value ?? '', s)) });
  // Pictures need the same role as a family session. The composer shows nothing of them to anyone else.
  const attach = useImageAttach({ active: canDraft && !session.open, onError: setImageError });

  // Page hotkeys stay quiet while the reader is in the window, and always on a phone, where the sheet covers the page (ui/overlay.ts).
  const layer = useOverlayLayer(win.phone || inside);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  useEffect(() => {
    // A window that a reload put back leaves the focus where it is.
    if (takeFocusRequest()) areaRef.current?.focus();
    const back = returnTo.current as HTMLElement | null;
    // Focus goes back only if it was in the window: a reader who has moved on to the page keeps their place.
    return () => { if (insideRef.current || document.activeElement === document.body) back?.focus?.(); };
  }, []);
  // Once per page: a window minimized and restored must not read a reply still running as one the reload interrupted.
  useEffect(() => {
    if (restoredInterrupted.has(tree)) return;
    restoredInterrupted.add(tree);
    restoreInterrupted(tree, t.locale);
  }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps
  // The reader is looking at this chat, so a reply in it is not news. Nothing is in front while the window is minimized or closed.
  useEffect(() => {
    setFrontChat(conv);
    return () => setFrontChat(null);
  }, [conv]);
  // Text from outside the app arrives as a native input event. Listened to directly, because React skips one when the value was set by script.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onInput = () => noteText(el.value);
    el.addEventListener('input', onInput);
    return () => el.removeEventListener('input', onInput);
  }, [noteText]);
  // A window with nothing open starts on the newest chat, or a new one. Closing the last tab starts a new one.
  const firstLook = useRef(true);
  const starting = useRef(false);
  useEffect(() => {
    if (tabState.tabs.length > 0 || starting.current || (firstLook.current && threads.isPending)) return;
    const newest = firstLook.current ? threads.data?.[0]?.conv : undefined;
    firstLook.current = false;
    if (newest) {
      updateTabs(tree, (s) => openTab(s, newest) ?? s);
      return;
    }
    starting.current = true;
    void aiChatNew({ data: { tree } }).then(({ conv: c }) => updateTabs(tree, (s) => openTab(s, c) ?? s)).finally(() => { starting.current = false; });
  }, [tabState.tabs.length, threads.isPending, threads.data, tree]);
  // A chat that is gone (deleted on another device, or another account's tab in this browser) leaves its tab.
  useEffect(() => {
    if (conv && chat.error && String(chat.error.message).includes('ai.err_no_chat')) {
      forgetRun(conv);
      updateTabs(tree, (s) => forgetChat(s, conv));
    }
  }, [conv, chat.error, tree]);
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
    // Esc closes from anywhere in the window, the list of chats and a popover inside it first. F6 moves between the window and the page.
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented && insideRef.current && isTopOverlay(layerRef.current)) {
        e.preventDefault();
        if (listOpenRef.current && listOverlays()) {
          closeList();
          return;
        }
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
  // Stops listening when the drawer closes, whatever it was doing.
  useEffect(() => () => dictation.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Switching chats brings that chat's own draft and pictures into the same box, so the focus never moves.
  const shownConv = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = areaRef.current;
    const before = shownConv.current;
    shownConv.current = conv;
    if (!el || !conv) return;
    // Words written while the very first chat was being made belong to it.
    if (before === null && el.value) noteText(el.value);
    else {
      el.value = getTabs(tree).drafts[conv]?.text ?? '';
      setText(el.value);
    }
    if (before) draftImages.set(before, attach.images);
    attach.replace(draftImages.get(conv) ?? []);
    setImageError(null);
    setKeepImages(false);
  }, [conv, tree]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (conv) draftImages.set(conv, attach.images); }, [conv, attach.images]);
  // The typing line says more after a while: a lookup can take long, and the reader should know it has not stalled.
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const id = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(id);
  }, [busy, conv]);
  // The box grows with its text, up to five lines, then scrolls.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX)}px`;
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

  // Each chat comes back where the reader left it, once its messages are here.
  const placedConv = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || !conv || !chat.isSuccess || placedConv.current === conv) return;
    placedConv.current = conv;
    const spot = getTabs(tree).scroll[conv];
    stick.current = !spot || spot.atEnd;
    setAway(false);
    el.scrollTop = stick.current ? el.scrollHeight : spot.y;
  }, [conv, chat.isSuccess, tree]);

  // New content keeps the reader at the newest message, unless they have scrolled up to read; then it waits.
  const live = stream.live;
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || session.open) return;
    // Instant, not smooth: a reply that lands mid-animation would leave the thread short of its newest message.
    if (items.length === 0 && pending === null && !busy && unsent.length === 0) el.scrollTop = 0;
    else if (stick.current) el.scrollTop = el.scrollHeight;
    else setAway(true);
  }, [items.length, pending, busy, unsent.length, session.open, live?.text]);

  function onLogScroll() {
    const el = logRef.current;
    const c = convRef.current;
    if (!el || !c) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    stick.current = near;
    if (near) setAway(false);
    updateTabs(tree, (s) => ({ ...s, scroll: { ...s.scroll, [c]: { y: el.scrollTop, atEnd: near } } }), true);
  }

  /** An instant jump: a smooth one can be cut short by the reply landing, and the reader would be left in the middle. */
  function jumpLatest() {
    const el = logRef.current;
    stick.current = true;
    setAway(false);
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ---------- tabs and the list of chats ----------

  const listOverlays = () => (asideRef.current?.clientWidth ?? 0) < LIST_BESIDE_WIDTH;
  const closeList = () => updateTabs(tree, (s) => ({ ...s, listOpen: false }));
  const toggleList = () => updateTabs(tree, (s) => ({ ...s, listOpen: !s.listOpen }));
  const focusBox = () => requestAnimationFrame(() => areaRef.current?.focus());

  /** The name a tab shows, before the chat has a stored message too. */
  const tabName = (c: string) => {
    const waitingText = getRun(c).pending;
    return chatName(t, threads.data?.find((x) => x.conv === c), waitingText ? threadTitle(waitingText) : t('ai.chatNew'));
  };

  function showChat(c: string) {
    const next = openTab(getTabs(tree), c, (x) => getRun(x).busy);
    if (!next) return setTabsFull(true);
    setTabsFull(false);
    updateTabs(tree, () => next);
    if (listOverlays()) closeList();
    focusBox();
  }

  function switchTab(c: string) {
    updateTabs(tree, (s) => ({ ...s, active: c }));
    focusBox();
  }

  function closeChatTab(c: string) {
    setTabsFull(false);
    updateTabs(tree, (s) => closeTab(s, c));
    focusBox();
  }

  /** A new chat. An empty tab that is already open is used instead of making another. */
  async function newChat() {
    const empty = getTabs(tree).tabs.find((c) => !threads.data?.some((x) => x.conv === c) && !getRun(c).busy && !getRun(c).unsent.length && !getRun(c).pending);
    if (empty) return showChat(empty);
    const { conv: c } = await aiChatNew({ data: { tree } });
    showChat(c);
  }

  function onChatDeleted(c: string) {
    forgetRun(c);
    draftImages.delete(c);
    updateTabs(tree, (s) => forgetChat(s, c));
    qc.removeQueries({ queryKey: ['ai-chat', tree, c] });
  }

  // ---------- messages ----------

  /** The example prompts that suit this reader's role and the family's features (the first is the one nobody else needs). */
  const viewed = page.personId ? graph.data?.people.find((p) => p.id === page.personId) : undefined;
  const examples: { key: Key; open?: boolean; name?: string }[] = [
    ...(viewed
      ? (['chat.start.who', 'chat.start.family'] as Key[]).map((key) => ({ key, name: fullName(viewed) }))
      : [{ key: 'chat.start.birthdays' as Key }]),
    // Among the first four whatever page the reader is on: the rest wait behind "More".
    ...(canDraft ? [{ key: 'ai.exFamily' as Key, open: true }] : []),
    ...(viewed
      ? (['chat.start.timeline', 'chat.start.gaps', ...(me && me !== viewed.id ? ['chat.start.relation'] : [])] as Key[]).map((key) => ({ key, name: fullName(viewed) }))
      : []),
    { key: 'ai.exPhotos' },
    { key: 'ai.exMissing' },
    { key: 'ai.exRelated' },
    ...(canPhotos ? [{ key: 'ai.exAlbum' as Key }] : []),
    ...(canPropose && status?.features.avatar ? [{ key: 'ai.exAvatar' as Key }] : []),
    ...(canHouse ? [{ key: 'ai.exHouse' as Key }] : []),
  ];

  /** Sends what is in the box. While this chat is waiting for its reply nothing is sent, and the words stay where they are. */
  function send(e?: FormEvent) {
    e?.preventDefault();
    const c = conv;
    const msg = (areaRef.current?.value ?? text).trim();
    const images = attach.images;
    if (!c || (!msg && !images.length) || getRun(c).busy || attach.reading) return;
    setComposer('');
    attach.replace([]);
    setImageError(null);
    const keep = keepImages;
    setKeepImages(false);
    stick.current = true;
    void transmit(ctx(c), msg, images, keep);
    areaRef.current?.focus();
  }

  /** Puts an unsent message back in the box to change it. A draft already typed stays above it. */
  function editUnsent(u: (typeof unsent)[number]) {
    if (!conv) return;
    patchRun(conv, (r) => ({ unsent: r.unsent.filter((x) => x.id !== u.id) }));
    forgetInterrupted(tree, u.id);
    const now = areaRef.current?.value ?? '';
    setComposer(now.trim() ? `${now}\n${u.text}` : u.text);
    if (u.images?.length) attach.replace(u.images);
    setKeepImages(!!u.keep);
    areaRef.current?.focus();
  }

  /** A family session's transcript, sent once. Resolves true when the draft was made. */
  async function draftFamily(transcript: string, speaker: string, images: Attached[], keep: boolean): Promise<boolean> {
    const c = conv;
    if (!c) return false;
    stick.current = true;
    patchRun(c, { busy: true, error: null, pending: transcript ? t('ai.sessionMessage', { count: transcript.split('\n').length }) : t('ai.imagesSent', { count: images.length }), pendingImages: images });
    try {
      await aiChatSend({ data: { tree, conv: c, text: transcript, locale, session: true, speaker, ...(images.length && { images: images.map((i) => ({ base64: i.base64 })), keepImages: keep }) } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['ai-chat', tree, c] }), qc.invalidateQueries({ queryKey: ['ai-threads', tree] })]);
      setSession({ open: false, used: true });
      return true;
    } catch (err) {
      patchRun(c, { error: errorText(err, t.locale) });
      return false;
    } finally {
      patchRun(c, { pending: null, pendingImages: [], busy: false });
      finishRun(c);
    }
  }

  /** "Try with a stronger model": the same question on another model. Both answers stay; nothing new from the reader is stored. */
  async function retryAnswer(c: string, itemId: string, model: PickedModel) {
    if (getRun(c).busy) return;
    patchRun(c, { busy: true, error: null, stream: null });
    try {
      await aiChatRetry({ data: { tree, conv: c, itemId, model, locale } });
      await Promise.all([qc.invalidateQueries({ queryKey: ['ai-chat', tree, c] }), qc.invalidateQueries({ queryKey: ['ai-threads', tree] })]);
    } catch (err) {
      patchRun(c, { error: errorText(err, t.locale) });
    } finally {
      patchRun(c, { busy: false });
      finishRun(c);
    }
  }

  async function chooseModel(c: string, model: PickedModel | null) {
    try {
      await aiThreadSetModel({ data: { tree, conv: c, model } });
      await qc.invalidateQueries({ queryKey: ['ai-chat', tree, c] });
    } catch (err) {
      patchRun(c, { error: errorText(err, t.locale) });
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

  /** A card was decided: records it, and carries on when it was the last one waiting. */
  const onDecided: OnDecided = (mark) => {
    const c = conv;
    if (!c) return;
    void mark().then(
      (r) => { if (r.due) void carryOn(ctx(c)); },
      (err) => patchRun(c, (x) => ({ unrecorded: [...x.unrecorded, mark], continueError: errorText(err, t.locale) })),
    );
  };

  /** Retry: records whatever could not be recorded, then asks the assistant to carry on. */
  async function retryContinue() {
    const c = conv;
    if (!c) return;
    patchRun(c, { continueError: null });
    for (const mark of getRun(c).unrecorded) {
      try {
        await mark();
        patchRun(c, (x) => ({ unrecorded: x.unrecorded.filter((m) => m !== mark) }));
      } catch (err) {
        patchRun(c, { continueError: errorText(err, t.locale) });
        return;
      }
    }
    await carryOn(ctx(c));
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
    } else if (url.pathname !== `/${tree}` && url.pathname !== `/${tree}/`) {
      // A page the assistant pointed to, such as the Access page.
      navigate({ href: url.pathname + url.search });
    } else {
      navigate({ to: '/$tree', params: { tree }, search: { focus: url.searchParams.get('focus') ?? undefined } });
    }
  }

  function toggleMic() {
    if (dictation.state === 'listening') dictation.stop();
    else dictation.start();
  }

  const listening = dictation.state === 'listening';
  const empty = !!conv && chat.isSuccess && items.length === 0 && unsent.length === 0 && pending === null;
  const summary = useRunSummary();
  const elsewhere = tabState.tabs.some((c) => c !== conv && summary.unread.has(c));

  return (
    <aside ref={asideRef} className={`ai-drawer${win.docked ? ' ai-docked' : ''}`} role="dialog" aria-label={t('ai.title')}>
      <ResizeEdges win={win} />
      <header className="ai-drawer-head" onPointerDown={win.onHeaderPointerDown}>
        <div className="ai-drawer-bar">
          {!session.open && (
            <button type="button" className="btn ghost ai-touch ai-icon ai-chats-toggle" onClick={toggleList} aria-expanded={listOpen} aria-label={t(listOpen ? 'ai.chatsClose' : 'ai.chatsOpen')} title={t(listOpen ? 'ai.chatsClose' : 'ai.chatsOpen')}>
              <PanelLeft size={16} aria-hidden />
              {elsewhere && <span className="ai-run-mark ai-run-unread ai-chats-toggle-mark" aria-hidden />}
            </button>
          )}
          <h2 className="ai-drawer-title"><Sparkles size={16} aria-hidden /> <span>{win.phone && conv ? tabName(conv) : t('ai.title')}</span></h2>
          <div className="ai-drawer-tools">
            {canDraft && !session.open && (
              <button type="button" className="btn ghost ai-touch ai-icon ai-tool" onClick={openSession} disabled={busy} aria-label={t('ai.sessionStart')} title={t('ai.sessionStart')}>
                <Users size={16} aria-hidden />
              </button>
            )}
            {!session.open && (
              <button type="button" className="btn ghost ai-touch ai-icon ai-tool ai-tool-new" onClick={() => void newChat()} aria-label={t('ai.chatNew')} title={t('ai.chatNew')}>
                <MessageSquarePlus size={16} aria-hidden />
              </button>
            )}
          </div>
          <WindowControls win={win} />
          <button type="button" className="btn ghost ai-touch ai-icon ai-drawer-close" onClick={() => { dictation.stop(); closeAssistant(); }} aria-label={t('ai.close')} title={t('ai.close')}>
            <X size={17} aria-hidden />
          </button>
        </div>
        {!session.open && !win.phone && tabState.tabs.length > 0 && (
          <ChatTabs tabs={tabState.tabs} active={conv} names={tabName} onSwitch={switchTab} onClose={closeChatTab} onNew={() => void newChat()} />
        )}
      </header>

      {tabsFull && <Notice onDismiss={() => setTabsFull(false)}>{t('ai.tabsFull')}</Notice>}
      {error && <Notice onDismiss={() => conv && patchRun(conv, { error: null })}>{t('ai.sendFailed')} <span className="subtle">{error}</span></Notice>}

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

      <div className="ai-main" hidden={session.open}>
        <ChatList tree={tree} active={conv} tabs={tabState.tabs} open={listOpen} onPick={showChat} onNew={() => void newChat()} onClose={closeList} onDeleted={onChatDeleted} />
        <div className="ai-body ai-drop-zone" {...(canDraft ? attach.dropProps : {})}>
          <DropVeil show={attach.dragging} />
          <div className="ai-thread">
            <div className="ai-log" ref={logRef} role="log" aria-live="polite" aria-label={t('ai.title')} onScroll={onLogScroll} onClick={onLogClick}>
              {(!conv || chat.isPending) && <Skeleton lines={3} />}
              {chat.isError && !String(chat.error.message).includes('ai.err_no_chat') && <ErrorState title={t('ai.loadFailed')} message={errorText(chat.error, t.locale)} onRetry={() => chat.refetch()} />}
              {empty && (
                <div className="ai-empty">
                  <div className="ai-welcome">
                    <span className="ai-mark" aria-hidden><Sparkles size={16} /></span>
                    <p className="ai-welcome-text">{t('ai.empty')}</p>
                  </div>
                  <p className="ai-examples-title">{t('ai.examplesTitle')}</p>
                  <div className="ai-examples">
                    {(moreExamples ? examples : examples.slice(0, 4)).map((ex) => (
                      <button
                        key={ex.key}
                        type="button"
                        className={`ai-example${ex.open ? ' ai-example-primary' : ''}`}
                        onClick={() => {
                          if (ex.open) openSession();
                          else {
                            setComposer(t(ex.key, { name: ex.name ?? '' }));
                            areaRef.current?.focus();
                          }
                        }}
                      >
                        {ex.open && <Users size={14} aria-hidden />}
                        {t(ex.key, { name: ex.name ?? '' })}
                      </button>
                    ))}
                    {!moreExamples && examples.length > 4 && (
                      <button type="button" className="btn ghost ai-touch ai-examples-more" onClick={() => setMoreExamples(true)}>{t('shell.more')}</button>
                    )}
                  </div>
                </div>
              )}
              {conv && items.map((m, i) => (m.role === 'user' ? <UserTurn key={m.id} tree={tree} item={m} /> : <AssistantTurn key={m.id} tree={tree} conv={conv} item={m} people={people} places={places} onDecided={onDecided} steward={steward} models={models} canRetry={!busy && retryable(items, i)} onRetry={(id, model) => void retryAnswer(conv, id, model)} last={i === items.length - 1} busy={busy} onSay={(words) => { if (!getRun(conv).busy) void transmit(ctx(conv), words, [], false); }} pagePerson={viewed && { id: viewed.id, given: fullName(viewed) }} />))}
              {pending !== null && (
                <div className="ai-turn ai-turn-user ai-turn-pending">
                  <AttachedThumbs images={pendingImages} />
                  {pending && <div className="ai-bubble">{pending}</div>}
                </div>
              )}
              {busy && !session.open && (
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
                    <button type="button" className="btn ghost ai-touch ai-stop" onClick={stream.stop}><Square size={13} aria-hidden /> {t('ai.stop')}</button>
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
                      <button type="button" className="btn ai-touch ai-retry" onClick={() => { if (conv && !getRun(conv).busy) void transmit(ctx(conv), u.text, u.images ?? [], !!u.keep, { retryId: u.id }); }} disabled={busy}>
                        <RotateCw size={14} aria-hidden /> {t('ai.retryNow')}
                      </button>
                      <button type="button" className="btn ghost ai-touch" onClick={() => editUnsent(u)} disabled={busy}>
                        <Pencil size={14} aria-hidden /> {t('ai.edit')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {conv && !busy && !session.open && (continueError !== null || chat.data?.continueDue) && (
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
          <p className="ai-sr" role="status">{busy && !session.open ? t(live?.step ?? 'ai.sending') : ''}</p>

          {steward && models && conv && (
            <div className="ai-composer-meta">
              <ModelPicker choices={models} override={chat.data?.override ?? null} onChange={(m) => void chooseModel(conv, m)} />
            </div>
          )}
          <form className="ai-composer" onSubmit={send}>
            <label className="ai-sr" htmlFor="ai-input">{t('ai.placeholder')}</label>
            {canDraft && <ImageTray attach={attach} provider={status?.provider} keep={keepImages} onKeep={setKeepImages} />}
            {listening && (
              <p className="ai-rec" role="status">
                <span className="ai-rec-dot" aria-hidden /> {t('ai.micRecording')}
                {dictation.interim && <em className="subtle"> {dictation.interim}</em>}
              </p>
            )}
            <div className="ai-composer-row">
              {canDraft && <AttachButton attach={attach} />}
              {dictation.supported && (
                <button type="button" className={`btn ghost ai-touch ai-icon ai-mic${listening ? ' ai-mic-on' : ''}`} onClick={toggleMic} aria-pressed={listening} aria-label={listening ? t('ai.micStop') : t('ai.mic')} title={listening ? t('ai.micStop') : t('ai.mic')}>
                  {listening ? <MicOff size={17} aria-hidden /> : <Mic size={17} aria-hidden />}
                </button>
              )}
              <textarea
                id="ai-input"
                ref={areaRef}
                rows={1}
                maxLength={4000}
                placeholder={t('ai.placeholder')}
                onKeyDown={onInputKey}
              />
              <button type="submit" className="btn primary ai-touch ai-icon ai-send" disabled={busy || !conv || attach.reading || (!text.trim() && !attach.images.length)} aria-label={t('ai.send')} title={busy ? t('ai.waitForReply') : t('ai.send')}>
                <Send size={17} aria-hidden />
              </button>
            </div>
          </form>
          <p className="ai-composer-hint subtle" aria-hidden={text ? true : undefined}>{t(canDraft ? 'ai.composerHintImages' : 'ai.composerHint')}</p>
          {imageError && <p className="ai-foot ai-card-error" role="alert">{t(imageError as Key)}</p>}
          {dictation.state === 'denied' && <p className="ai-foot subtle" role="status">{t('ai.micDenied')}</p>}
          {dictation.state === 'error' && <p className="ai-foot subtle" role="status">{t('ai.micFailed')}</p>}
          {!dictation.supported && <p className="ai-foot subtle">{t('ai.micUnsupported')}</p>}
          {!canPropose && <p className="ai-foot subtle">{t('ai.viewerNote')}</p>}
        </div>
      </div>
    </aside>
  );
}
