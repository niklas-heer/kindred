// Reactions and comments under a memory, a gallery photo, a message or an event of the feed (docs/responses.md). Members
// only: for a share-link guest it draws nothing and asks nothing, and the server refuses a guest anyway.
//
//   <Responses tree={tree} kind="story" target={story.id} />
//   <Responses tree={tree} kind="event" target={item.target} compact />
//
// A reaction is an emoji. The bar shows the emoji given, with how many gave each, then the quick row (QUICK_REACTIONS) and
// a "+" that opens the palette, which loads its data only then. `compact` (a line of the feed) keeps the quick row in the
// palette. Holding the pointer on an emoji, or pressing it long on a phone, says who gave it.
//
// The counts come from one query for the whole family (responseCountsQuery), shared by every entry on the page, so a
// Chronicle of three hundred memories asks once. The thread itself is read when it is opened, or when someone asks who
// reacted.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, SmilePlus } from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Portrait } from '~/components/Portrait';
import { ConfirmDialog, Notice, Skeleton } from '~/components/ui';
import { newOpKey } from '~/lib/api';
import { useFamily } from '~/lib/family';
import { relativeTime, translateMessage, useT, type Translator } from '~/lib/i18n';
import {
  EMPTY_SUMMARY,
  MAX_COMMENT,
  MAX_REACTIONS,
  QUICK_REACTIONS,
  reactionOrder,
  targetKey,
  type CommentView,
  type ReactionKind,
  type ResponseCounts,
  type TargetKind,
} from '~/lib/responses';
import { addComment, editComment, removeComment, responseCountsQuery, setReaction, threadQuery } from '~/lib/responses.functions';
import { can } from '~/lib/roles';
import { useMember } from '~/lib/session';
import './responses.css';

const EmojiPalette = lazy(() => import('./EmojiPalette').then((m) => ({ default: m.EmojiPalette })));

/** How long a press on a phone is held before it asks who reacted, rather than reacting. */
const LONG_PRESS_MS = 450;

/** How many comments an opened thread shows at first; the earlier ones are one click away. */
const SHOWN = 5;

const message = (e: unknown, t: Translator) => (e instanceof Error && e.message ? translateMessage(e.message, t.locale) : t('responses.failed'));


/** The counts of the whole family, for members; undefined for a guest, who never asks. */
export function useResponseCounts(tree: string): ResponseCounts | undefined {
  const member = !!useMember(tree);
  return useQuery({ ...responseCountsQuery(tree), enabled: member }).data;
}

/** The small tally a gallery tile shows: reactions and comments, as numbers with words for a screen reader. */
export function ResponseTally({ tree, kind, target }: { tree: string; kind: TargetKind; target: string }) {
  const t = useT();
  const s = useResponseCounts(tree)?.[targetKey(kind, target)];
  if (!s) return null;
  const reactions = Object.values(s.reactions).reduce<number>((a, n) => a + (n ?? 0), 0);
  if (!reactions && !s.comments) return null;
  // The most given emoji stand for the reactions, as a chat shows them.
  const top = reactionOrder(s.reactions).sort((a, b) => (s.reactions[b] ?? 0) - (s.reactions[a] ?? 0)).slice(0, 3);
  return (
    <span className="resp-tally">
      {reactions ? <span><span className="resp-emoji" aria-hidden>{top.join('')}</span> {reactions}<span className="sr-only"> {t('responses.reactions_count', { count: reactions })}</span></span> : null}
      {s.comments ? <span><MessageCircle size={12} aria-hidden /> {s.comments}<span className="sr-only"> {t('responses.comments_count', { count: s.comments })}</span></span> : null}
    </span>
  );
}

export function Responses({ tree, kind, target, startOpen = false, compact = false }: { tree: string; kind: TargetKind; target: string; startOpen?: boolean; compact?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const membership = useMember(tree);
  const counts = useResponseCounts(tree);
  const [open, setOpen] = useState(startOpen);
  const threadId = useId();
  const key = targetKey(kind, target);
  const summary = counts?.[key] ?? EMPTY_SUMMARY;
  const canComment = can(membership?.role, 'comment');
  const [picking, setPicking] = useState(false);
  const [full, setFull] = useState(false);
  const plus = useRef<HTMLButtonElement>(null);

  const toggle = useMutation({
    mutationFn: ({ reaction, on }: { reaction: ReactionKind; on: boolean }) =>
      setReaction({ data: { tree, kind, target, reaction, on, opKey: newOpKey() } }),
    // The reader sees their reaction at once; the server's counts follow.
    onMutate: async ({ reaction, on }) => {
      await qc.cancelQueries({ queryKey: responseCountsQuery(tree).queryKey });
      const before = qc.getQueryData(responseCountsQuery(tree).queryKey);
      qc.setQueryData(responseCountsQuery(tree).queryKey, (all) => {
        const s = all?.[key] ?? EMPTY_SUMMARY;
        const had = s.mine.includes(reaction);
        if (had === on) return all;
        const n = Math.max(0, (s.reactions[reaction] ?? 0) + (on ? 1 : -1));
        const reactions = { ...s.reactions, [reaction]: n || undefined };
        return { ...all, [key]: { ...s, reactions, mine: on ? [...s.mine, reaction] : s.mine.filter((r) => r !== reaction) } };
      });
      return { before };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(responseCountsQuery(tree).queryKey, ctx?.before),
    onSettled: () => qc.invalidateQueries({ queryKey: ['responses', tree] }),
  });

  if (!membership) return null;
  const count = summary.comments;
  const given = reactionOrder(summary.reactions);
  const quick = compact ? [] : QUICK_REACTIONS.filter((r) => !given.includes(r));
  /** Gives or takes back an emoji; a new one past the limit is refused here as the server would. */
  const pick = (r: ReactionKind) => {
    const mine = summary.mine.includes(r);
    if (!mine && summary.mine.length >= MAX_REACTIONS) {
      setFull(true);
      return;
    }
    setFull(false);
    toggle.mutate({ reaction: r, on: !mine });
  };
  return (
    <div className="resp" data-compact={compact || undefined}>
      <div className="resp-bar">
        <div className="resp-reactions" role="group" aria-label={t('responses.reactions')}>
          {given.map((r) => (
            <ReactionButton key={r} tree={tree} kind={kind} target={target} reaction={r} n={summary.reactions[r] ?? 0} mine={summary.mine.includes(r)} onToggle={() => pick(r)} />
          ))}
          {quick.map((r) => <ReactionButton key={r} tree={tree} kind={kind} target={target} reaction={r} n={0} mine={false} quick onToggle={() => pick(r)} />)}
          <button
            ref={plus}
            type="button"
            className="resp-react resp-plus"
            data-tour="feed-react"
            aria-expanded={picking}
            aria-haspopup="dialog"
            title={t('responses.more_emoji')}
            onClick={() => setPicking(!picking)}
          >
            <SmilePlus size={15} aria-hidden />
            <span className="sr-only">{t('responses.more_emoji')}</span>
          </button>
        </div>
        {count > 0 || canComment ? (
          <button type="button" className="btn ghost resp-open" aria-expanded={open} aria-controls={threadId} onClick={() => setOpen(!open)}>
            <MessageCircle size={15} aria-hidden /> {count ? t('responses.comments_count', { count }) : t('responses.comment')}
          </button>
        ) : null}
      </div>
      {picking ? (
        <Suspense fallback={<div className="resp-palette" aria-busy="true"><Skeleton lines={2} /></div>}>
          <EmojiPalette
            tree={tree}
            mine={summary.mine}
            anchor={plus}
            onPick={(r) => { pick(r); setPicking(false); plus.current?.focus(); }}
            onClose={(back) => { setPicking(false); if (back) plus.current?.focus(); }}
          />
        </Suspense>
      ) : null}
      {full ? <Notice>{t('responses.err.too_many', { count: MAX_REACTIONS })}</Notice> : null}
      {toggle.isError ? <Notice>{message(toggle.error, t)}</Notice> : null}
      {open ? <ThreadView id={threadId} tree={tree} kind={kind} target={target} canComment={canComment} /> : null}
    </div>
  );
}

/**
 * One emoji under an entry: pressed gives it or takes it back. Held (a pointer resting on it, a long press on a phone, or
 * focus from the keyboard) it says who gave it, read from the thread only then.
 */
function ReactionButton({ tree, kind, target, reaction, n, mine, quick, onToggle }: {
  tree: string; kind: TargetKind; target: string; reaction: ReactionKind; n: number; mine: boolean; quick?: boolean; onToggle: () => void;
}) {
  const t = useT();
  const [peek, setPeek] = useState(false);
  const tip = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const who = useQuery({ ...threadQuery(tree, kind, target), enabled: peek && n > 0 });
  const names = who.data?.reactors[reaction]?.map((x) => x || t('responses.former_member'));
  const label = n ? t('responses.react_count', { reaction, count: n }) : t('responses.react_with', { reaction });
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => stop, []);
  return (
    <span className="resp-react-wrap">
      <button
        type="button"
        className={`resp-react${quick ? ' resp-quick' : ''}`}
        aria-pressed={mine}
        aria-label={label}
        aria-describedby={peek && n ? tip : undefined}
        onClick={() => { if (held.current) { held.current = false; return; } onToggle(); }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse' && n) { stop(); timer.current = setTimeout(() => setPeek(true), 350); } }}
        onPointerLeave={() => { stop(); setPeek(false); }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' || !n) return;
          held.current = false;
          stop();
          timer.current = setTimeout(() => { held.current = true; setPeek(true); }, LONG_PRESS_MS);
        }}
        onPointerUp={stop}
        onPointerCancel={() => { stop(); setPeek(false); }}
        onContextMenu={(e) => { if (n) e.preventDefault(); }}
        onFocus={(e) => { if (n && e.currentTarget.matches(':focus-visible')) setPeek(true); }}
        onBlur={() => setPeek(false)}
        onKeyDown={(e) => { if (e.key === 'Escape' && peek) { e.stopPropagation(); setPeek(false); } }}
      >
        <span className="resp-emoji" aria-hidden>{reaction}</span>
        {/* The space makes the visible text "🙏 1", which the label begins with (axe: label-content-name-mismatch); flex ignores it. */}
        {n ? <>{' '}<span className="resp-n" aria-hidden>{n}</span></> : null}
      </button>
      {peek && n ? (
        <span id={tip} className="resp-peek" role="tooltip">
          <span className="resp-emoji" aria-hidden>{reaction}</span>{' '}
          {names ? names.join(', ') : who.isError ? t('responses.load_failed') : t('responses.loading_who')}
        </span>
      ) : null}
    </span>
  );
}

function ThreadView({ id, tree, kind, target, canComment }: { id: string; tree: string; kind: TargetKind; target: string; canComment: boolean }) {
  const t = useT();
  const q = useQuery(threadQuery(tree, kind, target));
  const [all, setAll] = useState(false);
  const [asking, setAsking] = useState<CommentView | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['responses', tree] });
  const remove = useMutation({
    mutationFn: (c: CommentView) => removeComment({ data: { tree, id: c.id, opKey: newOpKey() } }),
    onSuccess: async () => {
      setAsking(null);
      await refresh();
    },
  });

  const comments = q.data?.comments ?? [];
  const hidden = all ? 0 : Math.max(0, comments.length - SHOWN);
  const shown = comments.slice(hidden);
  const reactors = Object.entries(q.data?.reactors ?? {}) as [ReactionKind, string[]][];

  return (
    <section id={id} className="resp-thread" aria-label={t('responses.thread')}>
      {q.isPending ? <div aria-busy="true"><Skeleton lines={2} /></div> : null}
      {q.isError ? (
        <p className="subtle" role="alert">
          {t('responses.load_failed')} <button type="button" className="btn ghost" onClick={() => void q.refetch()}>{t('responses.retry')}</button>
        </p>
      ) : null}
      {reactors.length ? (
        <ul className="resp-who">
          {reactors.map(([r, names]) => (
            <li key={r}>
              {t('responses.reactors', { reaction: r, names: names.map((n) => n || t('responses.former_member')).join(', ') })}
            </li>
          ))}
        </ul>
      ) : null}
      {hidden ? (
        <button
          type="button"
          className="btn ghost resp-earlier"
          onClick={() => {
            setAll(true);
            // The button goes; the reader goes on reading from the first comment.
            requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('.resp-comment')?.focus());
          }}
        >
          {t('responses.show_earlier', { count: hidden })}
        </button>
      ) : null}
      {q.data && !comments.length ? <p className="subtle resp-none">{t('responses.none')}</p> : null}
      {shown.length ? (
        <ol className="resp-list" ref={list}>
          {shown.map((c) => <CommentItem key={c.id} c={c} tree={tree} canComment={canComment} onRemove={() => { remove.reset(); setAsking(c); }} />)}
        </ol>
      ) : null}
      {canComment ? <Composer tree={tree} kind={kind} target={target} /> : q.data ? <p className="subtle resp-none">{t('responses.contributors_only')}</p> : null}
      <ConfirmDialog
        open={!!asking}
        onClose={() => setAsking(null)}
        onConfirm={() => asking && remove.mutate(asking)}
        title={t('responses.remove_title')}
        confirmLabel={t('responses.remove_yes')}
        busy={remove.isPending}
        error={remove.isError ? t('responses.remove_failed') : undefined}
      >
        {asking ? (
          <blockquote className="ui-confirm-quote resp-quote">
            {asking.body.length > 240 ? `${asking.body.slice(0, 237).trimEnd()}…` : asking.body}
            <small>{asking.authorName || t('responses.former_member')}</small>
          </blockquote>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}

function Face({ tree, person, name }: { tree: string; person: string | null; name: string }) {
  const f = useFamily();
  const p = person ? f.byId.get(person) : undefined;
  if (p) return <span className="resp-face"><Portrait person={p} tree={tree} size={30} decorative /></span>;
  return <span className="resp-face resp-initial" aria-hidden>{(name.trim()[0] ?? '·').toUpperCase()}</span>;
}

function CommentItem({ c, tree, canComment, onRemove }: { c: CommentView; tree: string; canComment: boolean; onRemove: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  // The time is written once the page runs in the browser, so the server's HTML and the first render agree.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const at = new Date(c.createdAt);
  // A comment keeps the name it was written under; one with none (the writer left, or never had a name) is a former member's.
  const author = c.authorName || t('responses.former_member');
  return (
    <li className="resp-comment" tabIndex={-1}>
      <Face tree={tree} person={c.person} name={author} />
      <div className="resp-main">
        <div className="resp-head">
          <b>{author}</b>
          <time dateTime={c.createdAt} title={at.toLocaleString()}>{now === null ? '' : relativeTime(at, t.locale, now)}</time>
          {c.editedAt ? <span className="subtle">· {t('responses.edited')}</span> : null}
          {!editing && ((c.mine && canComment) || c.removable) ? (
            <span className="resp-actions">
              {c.mine && canComment ? (
                <button type="button" className="btn ghost" aria-label={t('responses.edit_named')} onClick={() => setEditing(true)}>{t('responses.edit')}</button>
              ) : null}
              {c.removable ? (
                <button type="button" className="btn ghost" aria-label={t('responses.remove_named', { name: author })} onClick={onRemove}>{t('responses.remove')}</button>
              ) : null}
            </span>
          ) : null}
        </div>
        {editing ? (
          <EditForm tree={tree} c={c} done={() => setEditing(false)} />
        ) : (
          <p className="resp-body">{c.body}</p>
        )}
      </div>
    </li>
  );
}

/** The characters left, shown only when they start to matter. */
function Left({ text }: { text: string }) {
  const t = useT();
  const left = MAX_COMMENT - text.length;
  return left <= 150 ? <span className={`resp-left${left < 0 ? ' is-over' : ''}`} aria-live="polite">{t('responses.chars_left', { count: Math.max(0, left) })}</span> : null;
}

function Composer({ tree, kind, target }: { tree: string; kind: TargetKind; target: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  // One key per comment: a retry after a lost answer never posts it twice.
  const [opKey, setOpKey] = useState(newOpKey);
  const fieldId = useId();
  const send = useMutation({
    mutationFn: () => addComment({ data: { tree, kind, target, body: text, opKey } }),
    onSuccess: async () => {
      setText('');
      setOpKey(newOpKey());
      await qc.invalidateQueries({ queryKey: ['responses', tree] });
    },
  });
  const empty = !text.trim();
  return (
    <form className="resp-compose" onSubmit={(e) => { e.preventDefault(); if (!empty) send.mutate(); }}>
      <label htmlFor={fieldId} className="sr-only">{t('responses.write')}</label>
      <textarea
        id={fieldId}
        className="input"
        rows={2}
        maxLength={MAX_COMMENT}
        placeholder={t('responses.write_ph')}
        value={text}
        onChange={(e) => { setText(e.target.value); setOpKey(newOpKey()); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !empty) { e.preventDefault(); send.mutate(); } }}
      />
      <div className="resp-compose-row">
        <Left text={text} />
        <button type="submit" className="btn primary" disabled={empty || send.isPending}>{send.isPending ? t('responses.sending') : t('responses.send')}</button>
      </div>
      {send.isError ? <Notice>{message(send.error, t)}</Notice> : null}
    </form>
  );
}

function EditForm({ tree, c, done }: { tree: string; c: CommentView; done: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState(c.body);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  const save = useMutation({
    mutationFn: () => editComment({ data: { tree, id: c.id, body: text, opKey: newOpKey() } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['responses', tree] });
      done();
    },
  });
  return (
    <form className="resp-compose" onSubmit={(e) => { e.preventDefault(); if (text.trim()) save.mutate(); }}>
      <textarea
        ref={field}
        className="input"
        aria-label={t('responses.edit_named')}
        rows={3}
        maxLength={MAX_COMMENT}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } }}
      />
      <div className="resp-compose-row">
        <Left text={text} />
        <button type="button" className="btn ghost" onClick={done}>{t('common.cancel')}</button>
        <button type="submit" className="btn primary" disabled={!text.trim() || save.isPending}>{t('responses.save')}</button>
      </div>
      {save.isError ? <Notice>{message(save.error, t)}</Notice> : null}
    </form>
  );
}
