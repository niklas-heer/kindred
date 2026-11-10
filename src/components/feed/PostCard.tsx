// A post as an entry of the feed (docs/feed.md): the face and name of who wrote it, their words with their line breaks
// and clickable links, the pictures, the people it is about, and the family's reactions and comments. Its writer can
// change it, and its writer or an editor can remove it. The card is the Chronicle's (chronicle.css), so a post sits
// among the memories as one of them.
//
//   <PostCard post={post} tree={tree} now={now} />
//
// The words are the writer's input: they are written as text, never as HTML, and only http(s) addresses become links
// (src/lib/feed/text.ts), each with rel="noopener noreferrer".
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Pencil, Trash2 } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Lightbox } from '~/components/photos/Lightbox';
import { PortraitZoom } from '~/components/photos/PortraitZoom';
import { Portrait } from '~/components/Portrait';
import { Responses } from '~/components/responses/Responses';
import { ConfirmDialog } from '~/components/ui';
import { newOpKey } from '~/lib/api';
import { removePost } from '~/lib/feed/feed.functions';
import { linkify } from '~/lib/feed/text';
import type { FeedAuthor, FeedPicture, PostView } from '~/lib/feed/types';
import { useFamily } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { useT, type Translator } from '~/lib/i18n';
import { galleryQuery } from '~/lib/photos.functions';
import { mediaUrl } from '~/lib/photos/types';
import type { GPerson } from '~/lib/types';
import { ago, exact } from '~/lib/when';
import '~/styles/chronicle.css';
import './feed.css';

// The composer is fetched when a writer changes their message: a reader never needs it, and the person panel, which
// shows a person's messages, is itself part of the composer (the memory form).
const Composer = lazy(() => import('./Composer').then((m) => ({ default: m.Composer })));

/** The pictures a post shows before "+3". */
const SHOWN = 4;

/** A writer's name as the page says it: the name they wrote under, else who they are in the tree, else "a former member". */
export function useAuthorName(author: FeedAuthor): { name: string; person: GPerson | undefined } {
  const t = useT();
  const f = useFamily();
  const person = author.person ? f.byId.get(author.person) : undefined;
  return { name: author.name || (person ? displayName(person, f) : t('responses.former_member')), person };
}

/** The writer's face beside an entry, and in its first line on a phone: their portrait, or their initial. */
export function authorFaces({ person, name, tree, defer }: { person: GPerson | undefined; name: string; tree: string; defer?: boolean }) {
  const initial = (name.trim()[0] ?? '·').toUpperCase();
  return {
    beside: person ? <PortraitZoom person={person} tree={tree} size={50} className="chr-face" defer={defer} /> : <span className="fd-initial" aria-hidden>{initial}</span>,
    inline: <span className="chr-face-in">{person ? <Portrait person={person} tree={tree} size={28} decorative defer={defer} /> : <span className="fd-initial" data-small aria-hidden>{initial}</span>}</span>,
  };
}

/** A post's words: plain text with its line breaks, and its addresses as links. Long ones open on request. */
export function PostText({ body }: { body: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const pieces = useMemo(() => linkify(body), [body]);
  if (!body) return null;
  const long = body.length > 520 || body.split('\n').length > 8;
  return (
    <>
      <p className="fd-body" data-clamped={(long && !open) || undefined}>
        {pieces.map((piece, i) => (piece.href
          ? <a key={i} href={piece.href} target="_blank" rel="noopener noreferrer">{piece.text}</a>
          : piece.text))}
      </p>
      {long && (
        <button type="button" className="btn ghost chr-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('chronicle.show_less') : t('chronicle.read_more')}
        </button>
      )}
    </>
  );
}

/**
 * A post's pictures: one whole, two side by side, three with the first tall, four in a square, and the rest counted on
 * the fourth. A picture opens in the gallery's own window, where the family says who is in it.
 */
export function PostPictures({ pictures, tree, by }: { pictures: FeedPicture[]; tree: string; by: string }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  // The gallery's window shows gallery pictures: they are read when the first one is opened.
  const gallery = useQuery({ ...galleryQuery(tree), enabled: open !== null }).data;
  const items = useMemo(() => {
    const byKey = new Map((gallery?.media ?? []).map((m) => [m.key, m]));
    return pictures.map((p) => byKey.get(p.key)).filter((m): m is NonNullable<typeof m> => !!m);
  }, [gallery, pictures]);
  if (!pictures.length) return null;
  const shown = pictures.slice(0, SHOWN);
  const hidden = pictures.length - shown.length;
  const index = open ? items.findIndex((m) => m.key === open) : -1;
  return (
    <>
      <ul className="fd-pics" data-n={shown.length}>
        {shown.map((p, i) => (
          <li key={p.key} style={shown.length === 1 ? { aspectRatio: `${p.width || 4} / ${p.height || 3}` } : undefined}>
            <button type="button" aria-haspopup="dialog" onClick={() => setOpen(p.key)}>
              <img
                src={mediaUrl(tree, p.key, shown.length === 1 ? undefined : 'thumb')}
                alt={`${t('feed.post.picture_alt', { n: i + 1, count: pictures.length, name: by })}${hidden && i === SHOWN - 1 ? `, ${t('feed.post.more_pictures', { count: hidden })}` : ''}`}
                loading="lazy" decoding="async"
              />
              {hidden > 0 && i === SHOWN - 1 ? <span className="fd-pics-more" aria-hidden>+{hidden}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {open && gallery && index >= 0 ? (
        <Lightbox tree={tree} items={items} index={index} albums={gallery.albums} onIndex={(i) => setOpen(items[i]?.key ?? null)} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

/** "3 hours ago", once the page runs in the browser; the exact moment on hover. */
export function When({ at, now, t }: { at: string; now?: number; t: Translator }) {
  return <time dateTime={at} title={now === undefined ? undefined : exact(at, t.locale)}>{now === undefined ? '' : ago(at, now, t)}</time>;
}

export function PostCard({ post, tree, now, defer }: { post: PostView; tree: string; now?: number; defer?: boolean }) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const { name, person } = useAuthorName(post.author);
  const faces = authorFaces({ person, name, tree, defer });
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const remove = useMutation({
    mutationFn: () => removePost({ data: { tree, id: post.id, opKey: newOpKey() } }),
    onSuccess: async () => {
      setAsking(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['feed', tree] }),
        qc.invalidateQueries({ queryKey: ['responses', tree] }),
        ...(post.pictures.length ? [qc.invalidateQueries({ queryKey: ['gallery', tree] }), qc.invalidateQueries({ queryKey: ['person-photos', tree] })] : []),
      ]);
    },
  });
  const about = post.people.map((id) => f.byId.get(id)).filter((p): p is GPerson => !!p);

  return (
    <li className="chr-item fd-post">
      {faces.beside}
      <article className="chr-card ui-card" aria-label={t('feed.post.label', { author: name })}>
        <header>
          {faces.inline}
          <span className="fd-author">
            {person ? <Link to="/$tree/person/$id" params={{ tree, id: person.id }}>{name}</Link> : <b>{name}</b>}
          </span>
          <When at={post.at} now={now} t={t} />
          {post.editedAt ? <span className="fd-edited">· {t('feed.post.edited')}</span> : null}
          {post.mine || post.removable ? (
            <span className="fd-actions">
              {post.mine ? <button type="button" className="btn icon ghost" aria-label={t('feed.post.edit_named')} title={t('feed.post.edit')} onClick={() => setEditing(true)}><Pencil size={15} aria-hidden /></button> : null}
              {post.removable ? <button type="button" className="btn icon ghost" aria-label={t('feed.post.remove_named', { name })} title={t('feed.post.remove')} onClick={() => { remove.reset(); setAsking(true); }}><Trash2 size={15} aria-hidden /></button> : null}
            </span>
          ) : null}
        </header>
        <PostText body={post.body} />
        <PostPictures pictures={post.pictures} tree={tree} by={name} />
        {about.length ? (
          <p className="fd-about">
            <span>{t('feed.post.about')}</span>
            {about.map((p) => <Link key={p.id} to="/$tree/person/$id" params={{ tree, id: p.id }}>{displayName(p, f)}</Link>)}
          </p>
        ) : null}
        <Responses tree={tree} kind="post" target={post.id} />
      </article>
      {editing ? <Suspense fallback={null}><Composer tree={tree} edit={post} onClose={() => setEditing(false)} /></Suspense> : null}
      <ConfirmDialog
        open={asking}
        onClose={() => setAsking(false)}
        onConfirm={() => remove.mutate()}
        title={t('feed.post.remove_title')}
        confirmLabel={t('feed.post.remove_yes')}
        busy={remove.isPending}
        error={remove.isError ? t('feed.post.remove_failed') : undefined}
      >
        <blockquote className="ui-confirm-quote resp-quote">
          {post.body ? (post.body.length > 240 ? `${post.body.slice(0, 237).trimEnd()}…` : post.body) : t('feed.post.only_pictures', { count: post.pictures.length })}
          <small>{name}</small>
        </blockquote>
        <p>{t('feed.post.remove_text')}{post.pictures.length ? ` ${t('feed.post.remove_pictures', { count: post.pictures.length })}` : ''}</p>
      </ConfirmDialog>
    </li>
  );
}
