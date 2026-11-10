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
import { ArrowDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { aiChatModelsQuery, aiChatNew, aiChatQuery, aiStatusQuery, aiThreadsQuery } from '~/lib/ai.functions';
import { threadTitle } from '~/lib/ai/thread-title';
import { retryable } from '~/lib/ai/chat-turns';
import { graphQuery } from '~/lib/api';
import { toAiLocale } from '~/lib/ai/types';
import { compareText, useT } from '~/lib/i18n';
import { fullName } from '~/lib/graph';
import { useMeChosen } from '~/lib/family';
import { useCan } from '~/lib/session';
import { ErrorState, Notice, Skeleton } from '~/components/ui';
import type { OnDecided } from './ProposalCard';
import { AssistantTurn, UserTurn } from './ChatTurns';
import { ChatWelcome } from './ChatWelcome';
import { Composer } from './Composer';
import { DrawerHeader } from './DrawerHeader';
import { ContinueTurn, LiveTurn, SendingTurn, UnsentTurn } from './WaitingTurns';
import { chatExamples } from './examples';
import { usePageContext } from './page-context';
import './widgets/widgets.css';
import { closeAssistant } from './store';
import { ResizeEdges, useChatWindow } from './useChatWindow';
import { useTabs } from './ChatDock';
import { ChatList, chatName } from './ChatList';
import { forgetRun, getRun, patchRun, setFrontChat, useRun, useRunSummary } from './chat-runs';
import { closeTab, forgetChat, getTabs, openTab, updateTabs } from './chat-tabs';
import { ModelPicker } from './ModelPicker';
import { carryOn, forgetInterrupted, restoreInterrupted, transmit, useChatStream } from './useChatStream';
import { DropVeil, useImageAttach, type Attached } from './attachments';
import { useDictation } from './dictation';
import { FamilySession } from './FamilySession';
import { forgetDraftImages, joined, useBoxHeight, useChatDraft, useComposerBox, useNativeInput } from './useComposerBox';
import { useThreadScroll } from './useThreadScroll';
import { useViewportFit } from './useViewportFit';
import { useWindowFocus } from './useWindowFocus';
import { askAgain, chooseModel, recordAndCarryOn, recordDecision, sendSession } from './chat-actions';
import './assistant.css';

const restoredInterrupted = new Set<string>();

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

  const [slow, setSlow] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [keepImages, setKeepImages] = useState(false);
  const [session, setSession] = useState<{ open: boolean; used: boolean }>({ open: false, used: false });
  const [tabsFull, setTabsFull] = useState(false);
  const [moreExamples, setMoreExamples] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const win = useChatWindow(asideRef);
  const listOpen = tabState.listOpen;
  const listOpenRef = useRef(listOpen);
  listOpenRef.current = listOpen;
  const page = usePageContext(tree);
  const pageRef = useRef(page);
  pageRef.current = page;
  const ctx = (c: string) => ({ conv: c, tree, locale: t.locale, qc, page: pageRef.current });

  // The box, and the draft it holds (useComposerBox.ts: the box is not a controlled field).
  const { text, setText, noteText, setComposer } = useComposerBox({ tree, convRef, areaRef });

  const dictation = useDictation({ locale, onFinal: (s) => setComposer(joined(areaRef.current?.value ?? '', s)) });
  // Pictures need the same role as a family session. The composer shows nothing of them to anyone else.
  const attach = useImageAttach({ active: canDraft && !session.open, onError: setImageError });

  useWindowFocus({
    asideRef,
    areaRef,
    phone: win.phone,
    // The list of chats and a popover inside it close first.
    onEscape: () => {
      if (listOpenRef.current && listOverlays()) {
        closeList();
        return;
      }
      dictation.stop();
      closeAssistant();
    },
  });
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
  useNativeInput(areaRef, noteText);
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
  // Stops listening when the drawer closes, whatever it was doing.
  useEffect(() => () => dictation.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Switching chats brings that chat's own draft and pictures into the same box.
  useChatDraft({ tree, conv, areaRef, attach, noteText, setText, onSwitch: () => { setImageError(null); setKeepImages(false); } });
  // The typing line says more after a while: a lookup can take long, and the reader should know it has not stalled.
  useEffect(() => {
    setSlow(false);
    if (!busy) return;
    const id = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(id);
  }, [busy, conv]);
  useBoxHeight(areaRef, text, session.open);
  useViewportFit(asideRef);

  const live = stream.live;
  const { stick, away, onLogScroll, jumpLatest } = useThreadScroll({
    logRef,
    tree,
    conv,
    convRef,
    ready: chat.isSuccess,
    content: { items: items.length, pending, busy, unsent: unsent.length, liveText: live?.text, paused: session.open },
  });

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
    forgetDraftImages(c);
    updateTabs(tree, (s) => forgetChat(s, c));
    qc.removeQueries({ queryKey: ['ai-chat', tree, c] });
  }

  // ---------- messages ----------

  /** The example prompts that suit this reader's role and the family's features (the first is the one nobody else needs). */
  const viewed = page.personId ? graph.data?.people.find((p) => p.id === page.personId) : undefined;
  const examples = chatExamples({
    viewed: viewed && { id: viewed.id, name: fullName(viewed) },
    me,
    canDraft,
    canPhotos,
    canPropose,
    canHouse,
    avatars: !!status?.features.avatar,
  });

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
    const waiting = transcript ? t('ai.sessionMessage', { count: transcript.split('\n').length }) : t('ai.imagesSent', { count: images.length });
    return sendSession(ctx(c), { transcript, speaker, images, keep, pending: waiting }, () => setSession({ open: false, used: true }));
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
    recordDecision(c, t.locale, mark, () => void carryOn(ctx(c)));
  };

  /** Retry: records whatever could not be recorded, then asks the assistant to carry on. */
  async function retryContinue() {
    const c = conv;
    if (!c) return;
    await recordAndCarryOn(c, t.locale, () => carryOn(ctx(c)));
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

  const empty = !!conv && chat.isSuccess && items.length === 0 && unsent.length === 0 && pending === null;
  const summary = useRunSummary();
  const elsewhere = tabState.tabs.some((c) => c !== conv && summary.unread.has(c));

  return (
    <aside ref={asideRef} className={`ai-drawer${win.docked ? ' ai-docked' : ''}`} role="dialog" aria-label={t('ai.title')}>
      <ResizeEdges win={win} />
      <DrawerHeader
        win={win}
        session={session.open}
        listOpen={listOpen}
        elsewhere={elsewhere}
        title={win.phone && conv ? tabName(conv) : t('ai.title')}
        canDraft={canDraft}
        busy={busy}
        tabs={tabState.tabs}
        active={conv}
        tabName={tabName}
        onToggleList={toggleList}
        onSession={openSession}
        onNew={() => void newChat()}
        onClose={() => { dictation.stop(); closeAssistant(); }}
        onSwitch={switchTab}
        onCloseTab={closeChatTab}
      />

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
                <ChatWelcome
                  examples={examples}
                  more={moreExamples}
                  onMore={() => setMoreExamples(true)}
                  onPick={(ex) => {
                    if (ex.open) openSession();
                    else {
                      setComposer(t(ex.key, { name: ex.name ?? '' }));
                      areaRef.current?.focus();
                    }
                  }}
                />
              )}
              {conv && items.map((m, i) => (m.role === 'user' ? <UserTurn key={m.id} tree={tree} item={m} /> : <AssistantTurn key={m.id} tree={tree} conv={conv} item={m} people={people} places={places} onDecided={onDecided} steward={steward} models={models} canRetry={!busy && retryable(items, i)} onRetry={(id, model) => void askAgain(ctx(conv), id, model)} last={i === items.length - 1} busy={busy} onSay={(words) => { if (!getRun(conv).busy) void transmit(ctx(conv), words, [], false); }} pagePerson={viewed && { id: viewed.id, given: fullName(viewed) }} />))}
              {pending !== null && <SendingTurn text={pending} images={pendingImages} />}
              {busy && !session.open && <LiveTurn live={live} slow={slow} onStop={stream.stop} />}
              {unsent.map((u) => (
                <UnsentTurn
                  key={u.id}
                  unsent={u}
                  busy={busy}
                  onRetry={() => { if (conv && !getRun(conv).busy) void transmit(ctx(conv), u.text, u.images ?? [], !!u.keep, { retryId: u.id }); }}
                  onEdit={() => editUnsent(u)}
                />
              ))}
              {conv && !busy && !session.open && (continueError !== null || chat.data?.continueDue) && (
                <ContinueTurn error={continueError} onContinue={() => void retryContinue()} />
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
              <ModelPicker choices={models} override={chat.data?.override ?? null} onChange={(m) => void chooseModel(ctx(conv), m)} />
            </div>
          )}
          <Composer
            areaRef={areaRef}
            text={text}
            busy={busy}
            conv={conv}
            canDraft={canDraft}
            canPropose={canPropose}
            provider={status?.provider}
            attach={attach}
            keepImages={keepImages}
            onKeepImages={setKeepImages}
            imageError={imageError}
            dictation={dictation}
            onSubmit={send}
            onKeyDown={onInputKey}
            onMic={toggleMic}
          />
        </div>
      </div>
    </aside>
  );
}
