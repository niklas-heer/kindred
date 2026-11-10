// Reactions and comments under a memory or a gallery photo (docs/responses.md). Members only: for a share-link guest it
// draws nothing and asks nothing, and the server refuses a guest anyway.
//
//   <Responses tree={tree} kind="story" target={story.id} />
//
// The counts come from one query for the whole family (responseCountsQuery), shared by every entry on the page, so a
// Chronicle of three hundred memories asks once. The thread itself is read when it is opened.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandHeart, Heart, Laugh, MessageCircle, Sparkles } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { ConfirmDialog, Notice, Skeleton } from '~/components/ui';
import { newOpKey } from '~/lib/api';
import { useFamily } from '~/lib/family';
import { relativeTime, translateMessage, useT, type Translator } from '~/lib/i18n';
import {
  EMPTY_SUMMARY,
  MAX_COMMENT,
  REACTIONS,
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

const ICON: Record<ReactionKind, (size: number) => ReactNode> = {
  heart: (s) => <Heart size={s} aria-hidden />,
  remember: (s) => <Sparkles size={s} aria-hidden />,
  laugh: (s) => <Laugh size={s} aria-hidden />,
  candle: (s) => <GameIcon name="candle-light" size={s} />,
  thanks: (s) => <HandHeart size={s} aria-hidden />,
};

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
  const reactions = Object.values(s.reactions).reduce((a, n) => a + (n ?? 0), 0);
  if (!reactions && !s.comments) return null;
  return (
    <span className="resp-tally">
      {reactions ? <span><Heart size={12} aria-hidden /> {reactions}<span className="sr-only"> {t('responses.reactions_count', { count: reactions })}</span></span> : null}
      {s.comments ? <span><MessageCircle size={12} aria-hidden /> {s.comments}<span className="sr-only"> {t('responses.comments_count', { count: s.comments })}</span></span> : null}
    </span>
  );
}

export function Responses({ tree, kind, target, startOpen = false }: { tree: string; kind: TargetKind; target: string; startOpen?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const membership = useMember(tree);
  const counts = useResponseCounts(tree);
  const [open, setOpen] = useState(startOpen);
  const threadId = useId();
  const key = targetKey(kind, target);
  const summary = counts?.[key] ?? EMPTY_SUMMARY;
  const canComment = can(membership?.role, 'comment');

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
  return (
    <div className="resp">
      <div className="resp-bar">
        <div className="resp-reactions" role="group" aria-label={t('responses.reactions')}>
          {REACTIONS.map((r) => {
            const n = summary.reactions[r] ?? 0;
            const mine = summary.mine.includes(r);
            const name = t(`responses.reaction.${r}`);
            const label = n ? t('responses.react_count', { reaction: name, count: n }) : name;
            return (
              <button
                key={r}
                type="button"
                className="resp-react"
                data-kind={r}
                aria-pressed={mine}
                title={label}
                onClick={() => toggle.mutate({ reaction: r, on: !mine })}
              >
                {ICON[r](15)}
                {/* The name is the words and the number the reader sees, so speech input can say what is on screen. */}
                <span className="sr-only">{n ? `${name}, ` : name}</span>
                {n ? <span className="resp-n">{n}</span> : null}
              </button>
            );
          })}
        </div>
        {count > 0 || canComment ? (
          <button type="button" className="btn ghost resp-open" aria-expanded={open} aria-controls={threadId} onClick={() => setOpen(!open)}>
            <MessageCircle size={15} aria-hidden /> {count ? t('responses.comments_count', { count }) : t('responses.comment')}
          </button>
        ) : null}
      </div>
      {toggle.isError ? <Notice>{message(toggle.error, t)}</Notice> : null}
      {open ? <ThreadView id={threadId} tree={tree} kind={kind} target={target} canComment={canComment} /> : null}
    </div>
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
              {ICON[r](13)} {t('responses.reactors', { reaction: t(`responses.reaction.${r}`), names: names.map((n) => n || t('responses.former_member')).join(', ') })}
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
            <small>{asking.authorName}</small>
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
  return (
    <li className="resp-comment" tabIndex={-1}>
      <Face tree={tree} person={c.person} name={c.authorName} />
      <div className="resp-main">
        <div className="resp-head">
          <b>{c.authorName}</b>
          <time dateTime={c.createdAt} title={at.toLocaleString()}>{now === null ? '' : relativeTime(at, t.locale, now)}</time>
          {c.editedAt ? <span className="subtle">· {t('responses.edited')}</span> : null}
          {!editing && ((c.mine && canComment) || c.removable) ? (
            <span className="resp-actions">
              {c.mine && canComment ? (
                <button type="button" className="btn ghost" aria-label={t('responses.edit_named')} onClick={() => setEditing(true)}>{t('responses.edit')}</button>
              ) : null}
              {c.removable ? (
                <button type="button" className="btn ghost" aria-label={t('responses.remove_named', { name: c.authorName })} onClick={onRemove}>{t('responses.remove')}</button>
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
