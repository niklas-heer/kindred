// The reader's chats, newest first: a list inside the window when it is wide, sliding over the thread when it is narrow or on a
// phone. Search looks through titles and text; each chat can be renamed or deleted. Also the strip of open tabs.
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { aiThreadDelete, aiThreadRename, aiThreadSearchQuery, aiThreadsQuery } from '~/lib/ai.functions';
import type { ThreadSummary } from '~/lib/ai/types';
import { errorText } from '~/lib/errortext';
import { dateText, useT } from '~/lib/i18n';
import { Notice, Skeleton } from '~/components/ui';
import { useRunSummary } from './chat-runs';

type T = ReturnType<typeof useT>;

/** A chat's name in the reader's language. */
export function chatName(t: T, s: Pick<ThreadSummary, 'title' | 'untitled'> | undefined, fallback?: string): string {
  if (s?.title) return s.title;
  if (s?.untitled === 'session') return t('ai.chatUntitledSession');
  if (s?.untitled === 'pictures') return t('ai.chatUntitledPictures');
  return fallback || t('ai.chatUntitled');
}

/** Today's chats by the time, this year's by the day, older ones with the year. */
function when(t: T, at: number): string {
  const d = new Date(at);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = d.toDateString() === now.toDateString()
    ? { hour: 'numeric', minute: '2-digit' }
    : d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return dateText(d, t.locale, opts);
}

export function RunMark({ conv, summary }: { conv: string; summary: ReturnType<typeof useRunSummary> }) {
  const t = useT();
  if (summary.busy.has(conv)) return <span className="ai-run-mark ai-run-busy" role="img" aria-label={t('ai.chatRunning')} title={t('ai.chatRunning')} />;
  if (summary.unread.has(conv)) return <span className="ai-run-mark ai-run-unread" role="img" aria-label={t('ai.chatUnread')} title={t('ai.chatUnread')} />;
  return null;
}

function Row({ tree, thread, active, open, snippet, onPick, onDeleted }: { tree: string; thread: ThreadSummary; active: boolean; open: boolean; snippet?: string; onPick: () => void; onDeleted: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const runs = useRunSummary();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const name = chatName(t, thread);
  useEffect(() => { if (deleting) keep.current?.focus(); }, [deleting]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['ai-threads', tree] });

  async function rename(value: string) {
    setRenaming(false);
    if (value.trim() === thread.title.trim()) return;
    try {
      await aiThreadRename({ data: { tree, conv: thread.conv, title: value } });
      await refresh();
    } catch (err) {
      setError(errorText(err, t.locale));
    }
  }

  async function remove() {
    setError(null);
    try {
      await aiThreadDelete({ data: { tree, conv: thread.conv } });
      setDeleting(false);
      onDeleted();
      await refresh();
    } catch (err) {
      setError(errorText(err, t.locale));
    }
  }

  function onRenameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void rename(e.currentTarget.value);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setRenaming(false);
    }
  }

  if (deleting) {
    return (
      <li className="ai-chat-row ai-chat-confirm">
        <p>{t('ai.chatDeleteConfirm', { name })}</p>
        <div className="ai-chat-confirm-actions">
          <button type="button" className="btn ai-touch" ref={keep} onClick={() => setDeleting(false)}>{t('ai.chatDeleteNo')}</button>
          <button type="button" className="btn ai-touch danger" onClick={() => void remove()} disabled={runs.busy.has(thread.conv)}>{t('ai.chatDeleteYes')}</button>
        </div>
        {error && <p className="ai-card-error" role="alert">{error}</p>}
      </li>
    );
  }
  return (
    <li className={`ai-chat-row${active ? ' ai-chat-active' : ''}`}>
      {renaming ? (
        <input className="ai-chat-rename" autoFocus defaultValue={thread.renamed ? thread.title : name} maxLength={80} aria-label={t('ai.chatRenameLabel')} onFocus={(e) => e.currentTarget.select()} onKeyDown={onRenameKey} onBlur={(e) => void rename(e.currentTarget.value)} />
      ) : (
        <button type="button" className="ai-chat-open" onClick={onPick} aria-current={active ? 'true' : undefined}>
          <span className="ai-chat-title">
            <RunMark conv={thread.conv} summary={runs} />
            <span className="ai-chat-name">{name}</span>
            {open && !active && <span className="ai-chat-tabbed" title={t('ai.chatOpenInTab')} aria-label={t('ai.chatOpenInTab')} />}
          </span>
          {snippet && <span className="ai-chat-snippet subtle">{snippet}</span>}
          <span className="ai-chat-date subtle">{when(t, thread.updated)}</span>
        </button>
      )}
      {!renaming && (
        <div className="ai-chat-actions">
          <button type="button" className="btn ghost ai-icon ai-chat-action" onClick={() => setRenaming(true)} aria-label={t('ai.chatRename')} title={t('ai.chatRename')}><Pencil size={14} aria-hidden /></button>
          <button type="button" className="btn ghost ai-icon ai-chat-action" onClick={() => setDeleting(true)} aria-label={t('ai.chatDelete')} title={t('ai.chatDelete')}><Trash2 size={14} aria-hidden /></button>
        </div>
      )}
      {error && <p className="ai-card-error" role="alert">{error}</p>}
    </li>
  );
}

export function ChatList({ tree, active, tabs, open, onPick, onNew, onClose, onDeleted }: {
  tree: string; active: string | null; tabs: string[]; open: boolean;
  onPick: (conv: string) => void; onNew: () => void; onClose: () => void; onDeleted: (conv: string) => void;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q, { wait: 180 });
  const threads = useQuery(aiThreadsQuery(tree));
  const search = useQuery(aiThreadSearchQuery(tree, dq));
  const searching = !!dq.trim();
  const list = searching ? search.data : threads.data;
  const failed = searching ? search.error : threads.error;
  return (
    <>
      <button type="button" className="ai-chats-veil" tabIndex={-1} aria-hidden hidden={!open} onClick={onClose} />
      <nav className="ai-chats" data-open={open} aria-label={t('ai.chatsTitle')} hidden={!open}>
        <div className="ai-chats-head">
          <h3 className="ai-chats-title">{t('ai.chatsTitle')}</h3>
          <button type="button" className="btn ghost ai-icon ai-chat-action" onClick={onNew} aria-label={t('ai.chatNew')} title={t('ai.chatNew')}><MessageSquarePlus size={16} aria-hidden /></button>
          <button type="button" className="btn ghost ai-icon ai-chat-action" onClick={onClose} aria-label={t('ai.chatsClose')} title={t('ai.chatsClose')}><X size={16} aria-hidden /></button>
        </div>
        <label className="ai-chats-search">
          <Search size={14} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ai.chatSearch')} aria-label={t('ai.chatSearch')} />
        </label>
        <div className="ai-chats-scroll">
          {failed && <Notice>{errorText(failed, t.locale)}</Notice>}
          {!list && !failed && <Skeleton lines={4} />}
          {list?.length === 0 && <p className="ai-chats-none subtle">{t(searching ? 'ai.chatSearchEmpty' : 'ai.chatsEmpty')}</p>}
          <ul className="ai-chats-list">
            {list?.map((th) => (
              <Row key={th.conv} tree={tree} thread={th} active={th.conv === active} open={tabs.includes(th.conv)} snippet={'snippet' in th ? (th as { snippet?: string }).snippet : undefined} onPick={() => onPick(th.conv)} onDeleted={() => onDeleted(th.conv)} />
            ))}
          </ul>
        </div>
      </nav>
    </>
  );
}

/** The open chats as tabs. Arrow keys, Home and End move between them, Enter opens one and Delete closes it. */
export function ChatTabs({ tabs, active, names, onSwitch, onClose, onNew }: { tabs: string[]; active: string | null; names: (conv: string) => string; onSwitch: (conv: string) => void; onClose: (conv: string) => void; onNew: () => void }) {
  const t = useT();
  const runs = useRunSummary();
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);

  function focusTab(i: number) {
    strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number, conv: string) {
    const last = tabs.length - 1;
    const to = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1) : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (to >= 0) {
      e.preventDefault();
      focusTab(to);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      onClose(conv);
      focusTab(Math.min(i, last - 1));
    }
  }

  return (
    <div className="ai-tabs-bar">
      <div className="ai-tabs" role="tablist" aria-label={t('ai.tabsLabel')} ref={strip}>
        {tabs.map((conv, i) => (
          <div key={conv} className={`ai-tab${conv === active ? ' ai-tab-active' : ''}`} role="presentation">
            <button type="button" role="tab" className="ai-tab-open" aria-selected={conv === active} tabIndex={conv === active ? 0 : -1} aria-keyshortcuts="Delete" title={names(conv)} onClick={() => onSwitch(conv)} onKeyDown={(e) => onKeyDown(e, i, conv)}>
              <RunMark conv={conv} summary={runs} />
              <span className="ai-tab-name">{names(conv)}</span>
            </button>
            <button type="button" className="ai-tab-close" tabIndex={-1} aria-label={t('ai.tabClose', { name: names(conv) })} title={t('ai.tabClose', { name: names(conv) })} onClick={() => onClose(conv)}>
              <X size={12} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn ghost ai-icon ai-tab-new" onClick={onNew} aria-label={t('ai.chatNew')} title={t('ai.chatNew')}><Plus size={15} aria-hidden /></button>
    </div>
  );
}
