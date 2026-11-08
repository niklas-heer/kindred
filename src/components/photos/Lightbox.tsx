// One photograph at a time: the picture with its people, the details, and the tools to tag and to find
// faces. Arrow keys and Escape work; a phone swipes between pictures. Every change goes to the server,
// which checks the role again.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ScanFace, Tag as TagIcon, Trash, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Dialog, Notice, Select } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { formatDate, useT } from '~/lib/i18n';
import { validDate } from '~/lib/dates';
import { useFamily } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { confirmPhotoTag, removeGalleryPhoto, removePhotoTag, saveGalleryPhoto, suggestPhotoTags, tagPhoto } from '~/lib/photos.functions';
import { useCan } from '~/lib/session';
import type { GPerson } from '~/lib/types';
import { AiSetupHint } from '~/components/assistant/AiSetup';
import { facesOn, findFaces } from './aiFaces';
import { PersonPicker } from './PersonPicker';
import { refreshPhotos } from './refresh';
import { mediaUrl, type Album, type Box, type MediaItem } from './types';
import '~/styles/gallery.css';

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
/** A box the picture can hold: inside the frame, and at least a sliver big. */
export function clampBox(b: Box): Box {
  const x = clamp(b.x), y = clamp(b.y);
  return { x, y, w: clamp(b.w, 0.005, 1 - x), h: clamp(b.h, 0.005, 1 - y) };
}
const isTyping = (el: EventTarget | null) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

export function Lightbox({ tree, items, index, albums, onIndex, onClose }: {
  tree: string;
  /** The pictures in view, in order: the arrows move through these. */
  items: MediaItem[];
  index: number;
  albums: Album[];
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const g = useT();
  const [dirty, setDirty] = useState(false);
  const count = items.length;
  const go = (d: number) => {
    const n = index + d;
    if (n >= 0 && n < count) onIndex(n);
  };
  // Whatever was deleted, the lightbox shows a picture still there, or closes when none are left.
  useEffect(() => {
    if (!count) onClose();
    else if (index >= count) onIndex(count - 1);
  }, [count, index, onClose, onIndex]);
  const item = items[index];
  if (!item) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      label={g('lb.label')}
      closeButton
      dirty={dirty}
      className="lb-dialog"
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (isTyping(e.target)) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      }}
    >
      <Photo key={item.key} tree={tree} item={item} index={index} count={count} albums={albums} onGo={go} onDirty={setDirty} />
    </Dialog>
  );
}

function Photo({ tree, item, index, count, albums, onGo, onDirty }: {
  tree: string;
  item: MediaItem;
  index: number;
  count: number;
  albums: Album[];
  onGo: (d: number) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const g = useT();
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const canAdd = useCan('upload-photo');
  const canDelete = useCan('edit-person');
  const keys = useRef(opKeys());
  const alt = item.caption || (item.taken ? g('common.photo_of', { name: formatDate(item.taken, t.locale) }) : g('common.photo_undated'));
  const name = (id: string) => {
    const p = f.byId.get(id);
    return p ? displayName(p, f) : '';
  };
  const confirmed = item.tags.filter((x) => x.confirmed);
  const suggested = item.tags.filter((x) => !x.confirmed);

  // ---------- tagging ----------
  const [tagging, setTagging] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const [pending, setPending] = useState<Box | null>(null);
  const [picked, setPicked] = useState<GPerson | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  const point = (e: ReactPointerEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const boxBetween = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
  });
  function drawStart(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    drag.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  function drawMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setDraft(boxBetween(drag.current, point(e)));
  }
  function drawEnd(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const b = boxBetween(drag.current, point(e));
    drag.current = null;
    setDraft(null);
    // A tap or a sliver is not a face.
    if (b.w >= 0.02 && b.h >= 0.02) {
      setPending(b);
      setPicked(null);
      setTagError(null);
    }
  }

  const tag = useMutation({
    mutationFn: (args: { person: string; box: Box }) =>
      tagPhoto({ data: { tree, key: item.key, person: args.person, box: args.box, opKey: keys.current.for('tag', [item.key, args.person, args.box]) } }),
    onSuccess: async () => {
      keys.current.clear('tag');
      setPending(null);
      setPicked(null);
      await refreshPhotos(qc, tree);
    },
    onError: () => setTagError(g('pp.failed')),
  });
  const confirmOne = useMutation({
    mutationFn: (id: number) => confirmPhotoTag({ data: { tree, id, opKey: keys.current.for(`confirm-${id}`, [id]) } }),
    onSuccess: async (_r, id) => {
      keys.current.clear(`confirm-${id}`);
      await refreshPhotos(qc, tree);
    },
  });
  const removeOne = useMutation({
    mutationFn: (id: number) => removePhotoTag({ data: { tree, id } }),
    onSuccess: () => refreshPhotos(qc, tree),
  });

  // ---------- AI face finder (only when the feature is on) ----------
  const ai = useQuery({ queryKey: ['photo-faces-on', tree], queryFn: () => facesOn(tree), staleTime: 60_000, enabled: canAdd });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiReasons, setAiReasons] = useState<Record<string, string>>({});
  async function findPeople() {
    setAiBusy(true);
    setAiNote(null);
    try {
      const { faces, references } = await findFaces(tree, item.key, t.locale);
      // Nobody is confirmed or has a profile photo yet, so there is nothing to recognise faces by.
      if (!references) {
        setAiNote(g('lb.ai_no_refs'));
        return;
      }
      const reasons: Record<string, string> = {};
      const rows = faces.flatMap((face) =>
        face.suggestions
          .filter((s) => f.byId.has(s.personId))
          .map((s) => {
            reasons[s.personId] = s.reason;
            return { box: clampBox(face.box), personId: s.personId };
          }),
      );
      setAiReasons(reasons);
      if (!rows.length) {
        setAiNote(g('lb.ai_none'));
        return;
      }
      await suggestPhotoTags({ data: { tree, key: item.key, faces: rows, opKey: keys.current.for('suggest', [item.key, rows]) } });
      keys.current.clear('suggest');
      await refreshPhotos(qc, tree);
    } catch {
      setAiNote(g('lb.ai_failed'));
    } finally {
      setAiBusy(false);
    }
  }

  // A new picture is a new element: keep the keyboard on the stage, so the arrow keys keep working.
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stage.current?.focus({ preventScroll: true });
  }, []);

  // ---------- swipe between pictures (not while drawing a box) ----------
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onSwipeStart = (e: ReactPointerEvent) => { if (!tagging) swipe.current = { x: e.clientX, y: e.clientY }; };
  const onSwipeEnd = (e: ReactPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || tagging) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onGo(dx < 0 ? 1 : -1);
  };

  // ---------- details ----------
  const [taken, setTaken] = useState(item.taken ?? '');
  const [place, setPlace] = useState(item.place ?? '');
  const [caption, setCaption] = useState(item.caption ?? '');
  const [album, setAlbum] = useState(item.album ?? '');
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = taken !== (item.taken ?? '') || place !== (item.place ?? '') || caption !== (item.caption ?? '') || album !== (item.album ?? '');
  useEffect(() => onDirty(changed), [changed, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  const details = useMutation({
    mutationFn: () =>
      saveGalleryPhoto({
        data: {
          tree, key: item.key, taken: taken.trim(), place: place.trim(), caption: caption.trim(), album: album || null,
          opKey: keys.current.for('details', [item.key, taken, place, caption, album]),
        },
      }),
    onSuccess: async () => {
      keys.current.clear('details');
      setSaved(true);
      await refreshPhotos(qc, tree);
    },
  });
  function saveDetails() {
    if (taken.trim() && !validDate(taken.trim())) {
      setDetailError(g('lb.date_invalid'));
      return;
    }
    setDetailError(null);
    setSaved(false);
    details.mutate();
  }

  // ---------- delete ----------
  const [sure, setSure] = useState(false);
  const remove = useMutation({
    mutationFn: () => removeGalleryPhoto({ data: { tree, key: item.key, opKey: keys.current.for('remove', [item.key]) } }),
    onSuccess: async () => {
      keys.current.clear('remove');
      await refreshPhotos(qc, tree);
    },
  });

  const frameStyle = { '--ar': `${item.width} / ${item.height}` } as CSSProperties;
  const albumName = albums.find((a) => a.id === item.album)?.name;

  return (
    <div className="lb">
      <div className="lb-main">
        <div
          ref={stage}
          className="lb-stage"
          tabIndex={-1}
          data-autofocus
          onPointerDown={onSwipeStart}
          onPointerUp={onSwipeEnd}
          onPointerCancel={() => (swipe.current = null)}
        >
          {index > 0 ? (
            <button type="button" className="btn icon lb-nav lb-prev" onClick={() => onGo(-1)} aria-label={g('lb.prev')} title={g('lb.prev')}>
              <ChevronLeft size={22} aria-hidden />
            </button>
          ) : null}
          <div ref={frame} className={`lb-frame${tagging ? ' is-tagging' : ''}`} style={frameStyle}>
            <img src={mediaUrl(tree, item.key)} alt={alt} draggable={false} decoding="async" />
            {item.tags.map((tg) => (
              <div
                key={tg.id}
                className={`lb-box${tg.confirmed ? '' : ' is-suggestion'}${hot === tg.id ? ' is-hot' : ''}`}
                style={{ left: `${tg.box.x * 100}%`, top: `${tg.box.y * 100}%`, width: `${tg.box.w * 100}%`, height: `${tg.box.h * 100}%` }}
              >
                <span className="lb-box-name">{name(tg.person)}</span>
              </div>
            ))}
            {pending ? <div className="lb-box is-pending" style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%`, width: `${pending.w * 100}%`, height: `${pending.h * 100}%` }} /> : null}
            {draft ? <div className="lb-box is-pending" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} /> : null}
            {tagging ? (
              <div
                className="lb-draw"
                onPointerDown={drawStart}
                onPointerMove={drawMove}
                onPointerUp={drawEnd}
                onPointerCancel={() => { drag.current = null; setDraft(null); }}
                aria-hidden
              />
            ) : null}
          </div>
          {index < count - 1 ? (
            <button type="button" className="btn icon lb-nav lb-next" onClick={() => onGo(1)} aria-label={g('lb.next')} title={g('lb.next')}>
              <ChevronRight size={22} aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="lb-people">
          <h3 className="lb-h">{g('lb.in_photo')}</h3>
          {!confirmed.length && !suggested.length ? <p className="subtle">{g('lb.nobody')}</p> : null}
          {confirmed.length ? (
            <ul className="lb-chips">
              {confirmed.map((tg) => (
                <li key={tg.id} className="lb-chip-row">
                  <span
                    className="lb-chip"
                    tabIndex={0}
                    onMouseEnter={() => setHot(tg.id)}
                    onMouseLeave={() => setHot(null)}
                    onFocus={() => setHot(tg.id)}
                    onBlur={() => setHot(null)}
                    onClick={() => setHot(hot === tg.id ? null : tg.id)}
                  >
                    {name(tg.person)}
                  </span>
                  {canAdd ? (
                    <button
                      type="button"
                      className="btn icon ghost"
                      onClick={() => removeOne.mutate(tg.id)}
                      disabled={removeOne.isPending}
                      aria-label={g('lb.remove_tag', { name: name(tg.person) })}
                      title={g('lb.remove_tag', { name: name(tg.person) })}
                    >
                      <X size={14} aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {suggested.length ? (
            <div className="lb-suggest">
              <h4 className="lb-h2">{g('lb.suggested')}</h4>
              <p className="subtle lb-note">{g('lb.suggestion_help')}</p>
              <ul className="lb-chips">
                {suggested.map((tg) => (
                  <li key={tg.id} className="lb-chip-row is-suggestion" title={aiReasons[tg.person] ?? undefined}>
                    <span
                      className="lb-chip is-suggestion"
                      tabIndex={0}
                      onMouseEnter={() => setHot(tg.id)}
                      onMouseLeave={() => setHot(null)}
                      onFocus={() => setHot(tg.id)}
                      onBlur={() => setHot(null)}
                    >
                      {name(tg.person)}
                    </span>
                    {canAdd ? (
                      <>
                        <button type="button" className="btn" onClick={() => confirmOne.mutate(tg.id)} disabled={confirmOne.isPending}>
                          {g('lb.confirm')}
                        </button>
                        <button type="button" className="btn ghost" onClick={() => removeOne.mutate(tg.id)} disabled={removeOne.isPending}>
                          {g('lb.not_them')}
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {canAdd ? (
            <div className="lb-tools">
              <button type="button" className="btn" aria-pressed={tagging} onClick={() => { setTagging((v) => !v); setPending(null); }}>
                <TagIcon size={16} aria-hidden /> {tagging ? g('lb.tag_done') : g('lb.tag')}
              </button>
              {ai.data ? (
                <button type="button" className="btn" onClick={findPeople} disabled={aiBusy}>
                  <ScanFace size={16} aria-hidden /> {aiBusy ? g('lb.ai_busy') : g('lb.ai_find')}
                </button>
              ) : <AiSetupHint tree={tree} feature={g('lb.ai_find')} />}
            </div>
          ) : null}
          {tagging && !pending ? <p className="subtle">{g('lb.tag_help')}</p> : null}
          {aiNote ? <p className="subtle" role="status">{aiNote}</p> : null}

          {canAdd && pending ? (
            <div className="lb-who">
              <h4 className="lb-h2">{g('lb.who')}</h4>
              {picked ? (
                <div className="lb-picked">
                  <span className="name">{displayName(picked, f)}</span>
                  <button type="button" className="btn primary" onClick={() => tag.mutate({ person: picked.id, box: pending })} disabled={tag.isPending}>
                    {g('lb.confirm')}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setPicked(null)}>{g('lb.cancel')}</button>
                </div>
              ) : (
                <PersonPicker label={g('lb.who')} onPick={setPicked} />
              )}
              <button type="button" className="btn ghost" onClick={() => { setPending(null); setPicked(null); }}>{g('lb.cancel')}</button>
              {tagError ? <Notice>{tagError}</Notice> : null}
            </div>
          ) : null}
        </div>
      </div>

      <aside className="lb-side">
        <h3 className="lb-h">{g('lb.edit')}</h3>
        {canAdd ? (
          <form
            className="lb-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveDetails();
            }}
          >
            <label className="gal-field">
              <span>{g('lb.date')}</span>
              <input className="input" value={taken} onChange={(e) => setTaken(e.target.value)} placeholder="1985-06-14" maxLength={10} inputMode="numeric" />
              <small className="subtle">{g('lb.date_hint')}</small>
            </label>
            <label className="gal-field">
              <span>{g('lb.place')}</span>
              <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} />
            </label>
            <label className="gal-field">
              <span>{g('lb.caption')}</span>
              <textarea className="input" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={1000} rows={3} />
            </label>
            <div className="gal-field">
              <span>{g('lb.album')}</span>
              <Select
                aria-label={g('lb.album')}
                value={album}
                onChange={setAlbum}
                options={[{ value: '', label: g('gallery.no_album') }, ...albums.map((a) => ({ value: a.id, label: a.name }))]}
              />
            </div>
            {detailError ? <Notice>{detailError}</Notice> : null}
            <div className="lb-form-actions">
              <button type="submit" className="btn primary" disabled={!changed || details.isPending}>
                {details.isPending ? g('common.saving') : g('lb.save')}
              </button>
              {saved && !changed ? <span className="subtle" role="status">{g('lb.saved')}</span> : null}
            </div>
            {details.isError ? <Notice>{g('pp.failed')}</Notice> : null}
          </form>
        ) : (
          <dl className="lb-facts">
            <dt>{g('lb.date')}</dt>
            <dd>{item.taken ? formatDate(item.taken, t.locale) : g('lb.no_date')}</dd>
            <dt>{g('lb.place')}</dt>
            <dd>{item.place || g('lb.no_place')}</dd>
            <dt>{g('lb.album')}</dt>
            <dd>{albumName ?? g('gallery.no_album')}</dd>
            {item.caption ? (<><dt>{g('lb.caption')}</dt><dd>{item.caption}</dd></>) : null}
          </dl>
        )}
        <p className="subtle lb-added">{g('lb.added', { date: formatDate(item.uploadedAt.slice(0, 10), t.locale) })}</p>

        {canDelete ? (
          <div className="lb-danger">
            {!sure ? (
              <button type="button" className="btn ghost lb-delete" onClick={() => setSure(true)}>
                <Trash size={16} aria-hidden /> {g('lb.delete')}
              </button>
            ) : (
              <div className="lb-sure">
                <p className="subtle">{g('lb.delete_warn')}</p>
                <button type="button" className="btn danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                  {g('lb.delete_yes')}
                </button>
                <button type="button" className="btn" onClick={() => setSure(false)}>{g('lb.keep')}</button>
              </div>
            )}
            {remove.isError ? <Notice>{g('pp.failed')}</Notice> : null}
          </div>
        ) : null}
      </aside>
      {removeOne.isError || confirmOne.isError ? <Notice>{g('pp.failed')}</Notice> : null}
    </div>
  );
}
