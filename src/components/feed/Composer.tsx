// The one composer (docs/feed.md): it writes a message to the family, with a few pictures and the people it is about,
// or, with a person chosen and a kind picked, a memory, saying or recipe for the Chronicle. The Today page opens it on
// "a message", the Chronicle on "a memory of someone" (src/components/AddMemory.tsx); either way the other is one press
// away, and there is one place that saves each.
//
//   <Composer tree={tree} onClose={close} />                  a message
//   <Composer tree={tree} onClose={close} start="memory" />   a memory: first who it is about, then the Chronicle's form
//   <Composer tree={tree} onClose={close} edit={post} />      changing your own message: its words and who it is about
//
// A message's pictures go through the gallery's own upload (scaled down and stripped of their location data in the
// browser, a small copy for tiles beside each), one by one, marked as meant for a post, and then the message names them.
// A retried request never sends a picture or the message twice (one key per step). Pictures uploaded for a message that
// is then refused, or not sent at all (the window closed), are deleted again at once, best effort; the server deletes any
// it missed after a day (posts.server.ts `sweepLeftovers`), and nobody sees them meanwhile.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DraftContext, type Draft } from '~/components/fields/draft';
import { StoryForm } from '~/components/PersonPanel';
import { exifDate, scaledPicture, THUMB_EDGE } from '~/components/photos/image';
import { PersonPicker } from '~/components/photos/PersonPicker';
import { refreshPhotos } from '~/components/photos/refresh';
import { Portrait } from '~/components/Portrait';
import { Dialog, Notice, Segmented } from '~/components/ui';
import { chronicleQuery, opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useFamily, useMeChosen } from '~/lib/family';
import { createPost, discardPostPictures, editPost } from '~/lib/feed/feed.functions';
import { MAX_POST, MAX_POST_MEDIA, MAX_POST_PEOPLE, type PostView } from '~/lib/feed/types';
import { displayName } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { closestFamily } from '~/lib/person-overview';
import { addGalleryPhoto } from '~/lib/photos.functions';
import { mediaUrl } from '~/lib/photos/types';
import { useCan } from '~/lib/session';
import { toast } from '~/lib/toast';
import type { GPerson } from '~/lib/types';
import '~/styles/chronicle.css';
import '~/styles/gallery.css';
import './feed.css';

type Mode = 'post' | 'memory';
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

interface Picture {
  id: string;
  name: string;
  status: 'preparing' | 'ready' | 'adding' | 'added' | 'failed';
  /** The picture as it will be sent: scaled, re-encoded, without EXIF or GPS. */
  blob?: Blob;
  thumb?: Blob;
  width?: number;
  height?: number;
  preview?: string;
  /** The date the camera wrote, if it wrote one: the Gallery files it under that. */
  taken: string;
  /** Its gallery key, once it has been sent. */
  key?: string;
}

export function Composer({ tree, onClose, start = 'post', files, edit }: {
  tree: string;
  onClose: () => void;
  start?: Mode;
  /** Pictures chosen before the window opened. */
  files?: File[];
  /** The reader's own message, to change. */
  edit?: PostView;
}) {
  const t = useT();
  const canPost = useCan('post');
  const canRemember = useCan('add-story');
  const [mode, setMode] = useState<Mode>(edit || (start === 'post' && canPost) || !canRemember ? 'post' : 'memory');
  const [postDirty, setPostDirty] = useState(false);
  const [memoryDirty, setMemoryDirty] = useState(false);
  const both = !edit && canPost && canRemember;

  return (
    <Dialog
      open
      onClose={onClose}
      title={edit ? t('feed.edit.title') : mode === 'post' ? t('feed.compose.title') : t('chronicle.add_title')}
      variant="event"
      width="min(580px, 100vw - 24px)"
      dirty={postDirty || memoryDirty}
      bodyClassName="fd-composer"
    >
      {both ? (
        <Segmented
          aria-label={t('feed.compose.mode')}
          block
          value={mode}
          onChange={setMode}
          options={[{ value: 'post', label: t('feed.compose.mode_post') }, { value: 'memory', label: t('feed.compose.mode_memory') }]}
        />
      ) : null}
      {/* Both stay mounted, so what was typed in one is still there after a look at the other. */}
      <div hidden={mode !== 'post'}>
        <PostForm tree={tree} edit={edit} files={files} active={mode === 'post'} onDirty={setPostDirty} onClose={onClose} />
      </div>
      {!edit && canRemember ? (
        <div hidden={mode !== 'memory'}>
          <MemoryForm tree={tree} active={mode === 'memory'} hint={both} onDirty={setMemoryDirty} onClose={onClose} />
        </div>
      ) : null}
    </Dialog>
  );
}

// ---------- a message ----------

function PostForm({ tree, edit, files, active, onDirty, onClose }: {
  tree: string; edit?: PostView; files?: File[]; active: boolean; onDirty: (dirty: boolean) => void; onClose: () => void;
}) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const me = useMeChosen();
  const [body, setBody] = useState(edit?.body ?? '');
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [people, setPeople] = useState<string[]>(edit?.people ?? []);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ n: number; count: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const addPerson = useRef<HTMLButtonElement>(null);
  const [keys] = useState(opKeys);
  const previews = useRef<string[]>([]);
  const started = useRef(false);
  // The pictures stored for this message and not yet in it; each attempt after a refusal uploads them afresh.
  const [uploaded] = useState(() => new Set<string>());
  const attempt = useRef(0);
  const [discard] = useState(() => () => {
    const media = [...uploaded];
    uploaded.clear();
    if (media.length) void discardPostPictures({ data: { tree, media } }).catch(() => {});
  });

  useEffect(() => {
    if (started.current || !files?.length) return;
    started.current = true;
    void addFiles(files);
    // Pictures chosen before the window opened are taken once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);
  // Closed without sending: what was uploaded for it goes.
  useEffect(() => discard, [discard]);
  useEffect(() => { if (picking) picker.current?.querySelector('input')?.focus(); }, [picking]);

  const text = body.trim();
  const changed = edit ? text !== edit.body || people.join('\n') !== edit.people.join('\n') : !!text || pictures.length > 0 || people.length > 0;
  useEffect(() => onDirty(changed), [changed, onDirty]);

  const update = (id: string, patch: Partial<Picture>) => setPictures((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  async function addFiles(list: File[] | FileList) {
    const room = MAX_POST_MEDIA - pictures.length;
    const picked = Array.from(list);
    const taken = picked.slice(0, Math.max(0, room));
    const problems: string[] = [];
    if (picked.length > taken.length) problems.push(t('feed.compose.pictures_full', { count: MAX_POST_MEDIA }));
    const fresh = taken.filter((file) => {
      if (ACCEPT.includes(file.type)) return true;
      problems.push(t('feed.compose.picture_failed', { name: file.name }));
      return false;
    }).map((file) => ({ file, picture: { id: crypto.randomUUID(), name: file.name, status: 'preparing', taken: '' } satisfies Picture as Picture }));
    setNotice(problems.length ? problems.join(' ') : null);
    setPictures((cur) => [...cur, ...fresh.map((x) => x.picture)]);
    // One at a time: decoding several large pictures at once is slow on a phone.
    for (const { file, picture } of fresh) {
      try {
        const fromPhoto = await exifDate(file);
        const scaled = await scaledPicture(file);
        const thumb = await scaledPicture(scaled.blob, THUMB_EDGE, 0.8).then((x) => x.blob, () => undefined);
        const preview = URL.createObjectURL(thumb ?? scaled.blob);
        previews.current.push(preview);
        update(picture.id, { status: 'ready', blob: scaled.blob, thumb, width: scaled.width, height: scaled.height, preview, taken: fromPhoto ?? '' });
      } catch {
        setPictures((cur) => cur.filter((p) => p.id !== picture.id));
        setNotice(t('feed.compose.picture_failed', { name: file.name }));
      }
    }
  }

  const share = useMutation({
    mutationFn: async () => {
      if (edit) {
        const data = { tree, id: edit.id, body: text, people };
        await editPost({ data: { ...data, opKey: keys.for('edit', data) } });
        return;
      }
      // The pictures first, through the gallery's own upload; one already sent (an earlier try) is not sent again.
      const sent: string[] = [];
      const waiting = pictures.filter((p) => p.blob);
      for (const [i, p] of waiting.entries()) {
        if (p.key) { sent.push(p.key); continue; }
        setProgress({ n: i + 1, count: waiting.length });
        update(p.id, { status: 'adding' });
        try {
          const fd = new FormData();
          fd.set('tree', tree);
          fd.set('file', new File([p.blob!], `${p.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' }));
          if (p.thumb) fd.set('thumb', new File([p.thumb], 'thumb.jpg', { type: 'image/jpeg' }));
          fd.set('width', String(p.width));
          fd.set('height', String(p.height));
          fd.set('taken', p.taken);
          fd.set('place', '');
          fd.set('caption', '');
          fd.set('album', '');
          fd.set('forPost', '1');
          fd.set('opKey', keys.for(`${p.id}:${attempt.current}`, [p.name, p.blob!.size]));
          const photo = await addGalleryPhoto({ data: fd });
          uploaded.add(photo.key);
          update(p.id, { status: 'added', key: photo.key });
          sent.push(photo.key);
        } catch (e) {
          update(p.id, { status: 'failed' });
          throw e;
        }
      }
      setProgress(null);
      const data = { tree, body: text, media: sent, people };
      await createPost({ data: { ...data, opKey: keys.for('post', data) } });
    },
    onSuccess: async () => {
      uploaded.clear();
      keys.clear();
      onDirty(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['feed', tree] }),
        ...(pictures.length ? [refreshPhotos(qc, tree)] : []),
      ]);
      if (!edit) toast({ title: t('feed.compose.shared'), body: t('feed.compose.shared_body'), icon: 'quill-ink' });
      onClose();
    },
    // Refused or failed: the pictures uploaded for it are deleted, and a second try sends them again.
    onError: () => {
      setProgress(null);
      attempt.current += 1;
      discard();
      setPictures((list) => list.map((p) => (p.key ? { ...p, key: undefined, status: 'ready' } : p.status === 'failed' ? { ...p, status: 'ready' } : p)));
    },
  });

  const preparing = pictures.some((p) => p.status === 'preparing');
  const left = MAX_POST - text.length;
  const hasSomething = edit ? !!text || edit.pictures.length > 0 : !!text || pictures.length > 0;
  const canShare = hasSomething && left >= 0 && !preparing && !share.isPending && (!edit || changed);
  const suggested = useMemo(() => (me ? [me, ...closestFamily(f, me, 7).shown.map((r) => r.id)] : undefined), [f, me]);
  const chosen = people.map((id) => f.byId.get(id)).filter((p): p is GPerson => !!p);

  return (
    <form className="fd-composer" onSubmit={(e) => { e.preventDefault(); if (canShare) share.mutate(); }}>
      <div>
        <label htmlFor="fd-body">{t('feed.compose.label')}</label>
        <textarea
          id="fd-body"
          className="input"
          rows={5}
          maxLength={MAX_POST}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canShare) { e.preventDefault(); share.mutate(); } }}
          placeholder={t('feed.compose.placeholder')}
          aria-describedby="fd-body-hint"
          {...(active ? { 'data-autofocus': true } : {})}
        />
        <div className="fd-composer-meta">
          <p className="fd-composer-hint" id="fd-body-hint">{t('feed.compose.hint')}</p>
          {left <= 300 ? <span className={`fd-left${left < 0 ? ' is-over' : ''}`} aria-live="polite">{t('feed.compose.chars_left', { count: Math.max(0, left) })}</span> : null}
        </div>
      </div>

      {edit ? (
        edit.pictures.length ? (
          <ul className="fd-thumbs" aria-label={t('feed.compose.pictures')}>
            {edit.pictures.map((p, i) => <li key={p.key}><img src={mediaUrl(tree, p.key, 'thumb')} alt={t('feed.compose.picture_n', { n: i + 1 })} /></li>)}
          </ul>
        ) : null
      ) : (
        <div>
          <input
            ref={input} type="file" accept={ACCEPT.join(',')} multiple hidden
            onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ''; }}
          />
          {pictures.length ? (
            <ul className="fd-thumbs" aria-label={t('feed.compose.pictures')}>
              {pictures.map((p, i) => (
                <li key={p.id} data-status={p.status}>
                  {p.preview ? <img src={p.preview} alt={t('feed.compose.picture_n', { n: i + 1 })} /> : null}
                  <button type="button" className="btn icon" disabled={share.isPending} aria-label={t('feed.compose.remove_picture', { n: i + 1 })} title={t('feed.compose.remove_picture', { n: i + 1 })}
                    onClick={() => setPictures((cur) => cur.filter((x) => x.id !== p.id))}><X size={15} aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="fd-composer-row" style={pictures.length ? { marginTop: 8 } : undefined}>
            <button type="button" className="btn" disabled={pictures.length >= MAX_POST_MEDIA || share.isPending} onClick={() => input.current?.click()}>
              <ImagePlus size={16} aria-hidden /> {t('feed.compose.add_pictures')}
            </button>
            <span className="fd-composer-hint">{t('feed.compose.pictures_hint', { count: MAX_POST_MEDIA })}</span>
          </div>
        </div>
      )}

      <div>
        <span className="fd-label" id="fd-about-label">{t('feed.compose.about')}</span>
        <div className="fd-composer-row">
          {chosen.length ? (
            <ul className="fd-chips" aria-labelledby="fd-about-label">
              {chosen.map((p) => (
                <li key={p.id}>
                  <Portrait person={p} tree={tree} size={24} decorative />
                  <span>{displayName(p, f)}</span>
                  <button type="button" className="btn icon ghost" aria-label={t('feed.compose.remove_person', { name: displayName(p, f) })} onClick={() => setPeople((cur) => cur.filter((id) => id !== p.id))}><X size={14} aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : null}
          {people.length < MAX_POST_PEOPLE ? (
            <button ref={addPerson} type="button" className="btn ghost" aria-expanded={picking} onClick={() => setPicking(!picking)}>
              <UserPlus size={16} aria-hidden /> {t('feed.compose.add_person')}
            </button>
          ) : null}
          {!chosen.length && !picking ? <span className="fd-composer-hint">{t('feed.compose.about_hint')}</span> : null}
        </div>
        {picking ? (
          <div className="fd-composer-pick" ref={picker} style={{ marginTop: 8 }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setPicking(false); addPerson.current?.focus(); } }}>
            <PersonPicker
              label={t('feed.compose.about')}
              onPick={(p) => { setPeople((cur) => (cur.includes(p.id) ? cur : [...cur, p.id])); setPicking(false); requestAnimationFrame(() => addPerson.current?.focus()); }}
              suggested={suggested}
              portraits={tree}
            />
          </div>
        ) : null}
      </div>

      {notice ? <Notice onDismiss={() => setNotice(null)}>{notice}</Notice> : null}
      {share.isError ? <p role="alert" className="err">{errorText(share.error, t.locale) || t('feed.compose.failed')}</p> : null}
      <div className="fd-composer-actions">
        <button type="submit" className="btn primary" disabled={!canShare}>
          {share.isPending ? (edit ? t('feed.edit.saving') : t('feed.compose.sharing')) : edit ? t('feed.edit.save') : t('feed.compose.share')}
        </button>
        <button type="button" className="btn ghost" onClick={onClose} disabled={share.isPending}>{t('common.cancel')}</button>
        {progress ? <span className="subtle" role="status">{t('feed.compose.uploading', progress)}</span> : null}
      </div>
    </form>
  );
}

// ---------- a memory of someone ----------

/** First who it is about, then the form the person panel uses (StoryForm): one way to write a memory, one place that saves it. */
function MemoryForm({ tree, active, hint, onDirty, onClose }: { tree: string; active: boolean; hint: boolean; onDirty: (dirty: boolean) => void; onClose: () => void }) {
  const t = useT();
  const f = useFamily();
  const me = useMeChosen();
  const [about, setAbout] = useState<GPerson | null>(null);
  const recent = useQuery({ ...chronicleQuery(tree), enabled: active && !me }).data as { person: string }[] | undefined;
  // The people a reader most often writes about: their own closest family, then themselves. For a reader who has not
  // said who they are, the people the family wrote about last, so the list never opens on the oldest ancestors.
  const suggested = useMemo(
    () => (me ? [...closestFamily(f, me, 7).shown.map((r) => r.id), me] : [...new Set((recent ?? []).map((s) => s.person))].slice(0, 8)),
    [f, me, recent],
  );
  // The form reports what is typed, so closing the window asks before throwing it away.
  const draft = useMemo(() => ({
    register: (d: Draft | null) => onDirty(!!d?.dirty),
    leave: (next: () => void) => next(),
  }), [onDirty]);
  // Nothing in a hidden half takes the focus or a place in the tab order.
  if (!active && !about) return null;

  return (
    <div className="chr-add">
      {about ? (
        <>
          <div className="chr-add-about">
            <Portrait person={about} tree={tree} size={44} decorative />
            <div>
              <span className="subtle">{t('chronicle.add_about')}</span>
              <b>{displayName(about, f)}</b>
            </div>
            <button type="button" className="btn ghost" onClick={() => setAbout(null)}>{t('chronicle.add_change')}</button>
          </div>
          <DraftContext.Provider value={draft}>
            <StoryForm
              tree={tree}
              person={about}
              done={onClose}
              saved={() => toast({ title: t('chronicle.add_saved'), body: t('chronicle.add_saved_body', { name: about.given }), person: about.id, icon: 'quill-ink' })}
            />
          </DraftContext.Provider>
        </>
      ) : (
        <>
          <p className="fd-composer-hint">{hint ? t('feed.compose.memory_hint') : t('chronicle.add_intro')}</p>
          <h3 className="chr-add-q">{t('chronicle.add_who')}</h3>
          <PersonPicker label={t('chronicle.add_who')} onPick={setAbout} suggested={suggested} portraits={tree} />
        </>
      )}
    </div>
  );
}
