// Adding photographs: choose or drop several at once, give them one date, place and album if you like, then send them
// one by one. A date is never required; a photograph can still be given its own. Each picture is scaled down and
// stripped of its location data in the browser first.
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { DatePicker, Dialog, Notice, Select } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { validDate } from '~/lib/dates';
import { isoOfDate } from '~/lib/partial-date';
import { addGalleryPhoto } from '~/lib/photos.functions';
import { exifDate, scaledPicture, THUMB_EDGE } from './image';
import { refreshPhotos } from './refresh';
import { formatDate, useT } from '~/lib/i18n';
import { toast } from '~/lib/toast';
import { errorText } from '~/lib/errortext';
import type { Album } from './types';
import '~/styles/gallery.css';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

type Status = 'preparing' | 'ready' | 'adding' | 'added' | 'failed';

interface Item {
  id: string;
  name: string;
  size: number;
  modified: number;
  status: Status;
  /** The picture as it will be sent: scaled, re-encoded, without EXIF or GPS. */
  blob?: Blob;
  /** Its small copy for tiles (THUMB_EDGE), made from the scaled picture. Absent when the browser could not make one. */
  thumb?: Blob;
  width?: number;
  height?: number;
  preview?: string;
  /** The date the camera wrote, if it wrote one. */
  fromPhoto: string | null;
  /** The reader gave this photograph a date of its own: it no longer follows the date for all. */
  own: boolean;
  /** Its own date, used while `own` is set. */
  taken: string;
  caption: string;
  error?: string;
}

export function UploadDialog({ tree, albums, initialAlbum, files, onClose }: {
  tree: string;
  albums: Album[];
  initialAlbum: string | null;
  /** Pictures dropped on the page before the dialog opened. */
  files?: File[];
  onClose: () => void;
}) {
  const g = useT();
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [album, setAlbum] = useState(initialAlbum ?? '');
  const [place, setPlace] = useState('');
  // One date for the batch. A photograph's own date comes first, then this, then the date the camera wrote.
  const [dateAll, setDateAll] = useState('');
  const dateOf = (it: Item) => (it.own ? it.taken : dateAll || it.fromPhoto || '');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [over, setOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const keys = useRef(opKeys());
  const previews = useRef<string[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !files?.length) return;
    started.current = true;
    void addFiles(files);
    // Pictures dropped on the page are taken once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  async function prepare(it: Item, file: File) {
    try {
      const fromPhoto = await exifDate(file);
      const scaled = await scaledPicture(file);
      // Tiles are 84 to 200 pixels across: a small copy saves loading the whole picture for each. Without one the
      // gallery shows the picture itself, as it does for photos from before thumbnails, so a failure here costs nothing.
      const thumb = await scaledPicture(scaled.blob, THUMB_EDGE, 0.8).then((t) => t.blob, () => undefined);
      const preview = URL.createObjectURL(thumb ?? scaled.blob);
      previews.current.push(preview);
      update(it.id, { status: 'ready', blob: scaled.blob, thumb, width: scaled.width, height: scaled.height, preview, fromPhoto });
    } catch {
      update(it.id, { status: 'failed', error: g('up.unreadable') });
    }
  }

  async function addFiles(list: File[] | FileList) {
    const picked = Array.from(list);
    const fresh: { item: Item; file: File }[] = picked.map((file) => ({
      file,
      item: {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        modified: file.lastModified,
        status: ACCEPT.includes(file.type) ? 'preparing' : 'failed',
        fromPhoto: null,
        own: false,
        taken: '',
        caption: '',
        error: ACCEPT.includes(file.type) ? undefined : g('up.unreadable'),
      },
    }));
    setItems((cur) => [...cur, ...fresh.map((f) => f.item)]);
    // One at a time: decoding several large pictures at once is slow on a phone.
    for (const { item, file } of fresh) {
      if (item.status === 'preparing') await prepare(item, file);
    }
  }

  async function submit() {
    const batch = items.filter((it) => (it.status === 'ready' || it.status === 'failed') && it.blob);
    if (!batch.length) return;
    const badDate = (it: Item) => !!dateOf(it) && !validDate(dateOf(it));
    if (batch.some(badDate)) {
      setItems((list) => list.map((it) => (badDate(it) ? { ...it, status: 'failed', error: g('lb.date_invalid') } : it)));
      return;
    }
    setRunning(true);
    setNotice(null);
    setDone(0);
    // Pictures that could not be read at all were refused before this; they count as not added too.
    let failed = items.filter((it) => it.status === 'failed' && !it.blob).length;
    for (const it of batch) {
      update(it.id, { status: 'adding', error: undefined });
      try {
        const fd = new FormData();
        fd.set('tree', tree);
        fd.set('file', new File([it.blob!], `${it.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' }));
        if (it.thumb) fd.set('thumb', new File([it.thumb], 'thumb.jpg', { type: 'image/jpeg' }));
        fd.set('width', String(it.width));
        fd.set('height', String(it.height));
        fd.set('taken', dateOf(it));
        fd.set('place', place);
        fd.set('caption', it.caption);
        fd.set('album', album);
        fd.set('opKey', keys.current.for(it.id, [it.name, it.size, it.modified, dateOf(it), it.caption, place, album]));
        await addGalleryPhoto({ data: fd });
        keys.current.clear(it.id);
        update(it.id, { status: 'added' });
      } catch (e) {
        failed++;
        update(it.id, { status: 'failed', error: e instanceof Error ? errorText(e, g.locale) : undefined });
      }
      setDone((n) => n + 1);
    }
    await refreshPhotos(qc, tree);
    setRunning(false);
    // Everything went in: the dialog has done its job, so it closes and the gallery says what was added.
    if (!failed) {
      toast({ title: g('up.added_toast', { count: batch.length }), body: g('up.added_toast_body') });
      onClose();
      return;
    }
    setNotice(g('up.partial'));
  }

  const ready = items.filter((it) => (it.status === 'ready' || it.status === 'failed') && it.blob);
  const dirty = items.some((it) => it.status !== 'added');
  const total = ready.length;
  // Nothing left to send, and something was sent: the dialog's job is done.
  const finished = !running && total === 0 && items.some((it) => it.status === 'added');

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={g('up.title')}
      placement="center"
      width="min(720px, 100vw - 24px)"
      dirty={dirty && !running}
      dismissible={!running}
      className="gal-upload"
      bodyClassName="gal-upload-body"
      footer={
        <div className="gal-upload-foot">
          {running ? (
            <span className="subtle" role="status">{g('up.progress', { done, total })}</span>
          ) : null}
          <span className="gal-spacer" />
          {finished ? (
            <button type="button" className="btn primary" onClick={onClose}>{g('common.close')}</button>
          ) : (
            <button type="button" className="btn primary" disabled={!total || running} onClick={submit}>
              {g('up.submit', { count: total })}
            </button>
          )}
        </div>
      }
    >
      <div className={`gal-drop${over ? ' is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <ImagePlus size={28} aria-hidden />
        <button type="button" className="btn primary" onClick={() => input.current?.click()} disabled={running}>
          <Upload size={16} aria-hidden /> {g('up.choose')}
        </button>
        <span className="subtle">{g('up.or_drop')}</span>
        <p className="subtle gal-formats">{g('up.formats')}</p>
        <input
          ref={input}
          type="file"
          accept={ACCEPT.join(',')}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {items.length ? (
        <>
          <fieldset className="gal-batch" disabled={running}>
            <legend>{g('up.for_all')}</legend>
            <div className="gal-field">
              <span>{g('up.album_all')}</span>
              <Select
                aria-label={g('up.album_all')}
                value={album}
                onChange={setAlbum}
                options={[{ value: '', label: g('gallery.no_album') }, ...albums.map((a) => ({ value: a.id, label: a.name }))]}
                disabled={running}
              />
            </div>
            <label className="gal-field">
              <span>{g('up.place_all')}</span>
              <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} disabled={running} />
            </label>
            <DatePicker
              className="gal-field gal-batch-date"
              label={g('up.date_all')}
              value={dateAll}
              onChange={setDateAll}
              notAfter={isoOfDate(new Date())}
              hint={g('up.date_all_hint')}
              disabled={running}
            />
          </fieldset>
          <ul className="gal-queue">
            {items.map((it) => (
              <li key={it.id} className={`gal-item is-${it.status}`}>
                <div className="gal-item-thumb">
                  {it.preview ? <img src={it.preview} alt="" /> : <span className="gal-item-wait" aria-hidden />}
                </div>
                <div className="gal-item-fields">
                  <p className="gal-item-name" title={it.name}>{it.name}</p>
                  {/* The date this photograph will get, in one line; its own date picker only when asked for. */}
                  <p className="gal-item-date">
                    <span>
                      {dateOf(it) && validDate(dateOf(it)) ? g('up.date_is', { date: formatDate(dateOf(it), g.locale) }) : g('up.no_date')}
                      {!it.own && dateOf(it) ? <em className="subtle"> · {dateAll ? g('up.date_for_all_mark') : g('up.from_photo')}</em> : null}
                    </span>
                    {it.status !== 'adding' && it.status !== 'added' ? (
                      <button type="button" className="btn ghost" onClick={() => update(it.id, it.own ? { own: false } : { own: true, taken: dateOf(it) })}>
                        {it.own ? g('up.date_same') : g('up.date_own')}
                      </button>
                    ) : null}
                  </p>
                  {it.own ? (
                    <DatePicker
                      className="gal-field"
                      label={g('lb.date')}
                      value={it.taken}
                      onChange={(next) => update(it.id, { taken: next })}
                      notAfter={isoOfDate(new Date())}
                      disabled={it.status === 'adding' || it.status === 'added'}
                    />
                  ) : null}
                  <label className="gal-field">
                    <span>{g('lb.caption')}</span>
                    <input
                      className="input"
                      value={it.caption}
                      maxLength={1000}
                      disabled={it.status === 'adding' || it.status === 'added'}
                      onChange={(e) => update(it.id, { caption: e.target.value })}
                    />
                  </label>
                  <p className="gal-item-status" role="status">
                    {it.status === 'preparing' ? g('up.preparing') : null}
                    {it.status === 'ready' ? g('up.ready') : null}
                    {it.status === 'adding' ? g('up.adding') : null}
                    {it.status === 'added' ? g('up.added') : null}
                    {it.status === 'failed' ? <span className="gal-error">{it.error ?? g('up.failed')}</span> : null}
                  </p>
                </div>
                {it.status !== 'adding' && it.status !== 'added' ? (
                  <button
                    type="button"
                    className="btn icon ghost gal-item-remove"
                    aria-label={g('up.remove', { name: it.name })}
                    title={g('common.delete')}
                    onClick={() => setItems((list) => list.filter((x) => x.id !== it.id))}
                  >
                    <Trash size={16} aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {running ? (
            <div className="gal-progress" role="progressbar" aria-label={g('up.progress', { done, total })} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
              <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
          ) : null}
        </>
      ) : null}
      {notice ? <Notice onDismiss={() => setNotice(null)}>{notice}</Notice> : null}
    </Dialog>
  );
}
