// Adding photographs: choose or drop several at once, check the date each one was taken, then send them
// one by one. Each picture is scaled down and stripped of its location data in the browser first.
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Dialog, Notice, Select } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { validDate } from '~/lib/dates';
import { addGalleryPhoto } from '~/lib/photos.functions';
import { exifDate, scaledPicture } from './image';
import { refreshPhotos } from './refresh';
import { useT } from '~/lib/i18n';
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
  width?: number;
  height?: number;
  preview?: string;
  /** The date the camera wrote, if it wrote one. */
  fromPhoto: string | null;
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
      const preview = URL.createObjectURL(scaled.blob);
      previews.current.push(preview);
      update(it.id, { status: 'ready', blob: scaled.blob, width: scaled.width, height: scaled.height, preview, fromPhoto, taken: fromPhoto ?? '' });
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
    if (batch.some((it) => it.taken && !validDate(it.taken))) {
      setItems((list) => list.map((it) => (it.taken && !validDate(it.taken) ? { ...it, status: 'failed', error: g('lb.date_invalid') } : it)));
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
        fd.set('width', String(it.width));
        fd.set('height', String(it.height));
        fd.set('taken', it.taken);
        fd.set('place', place);
        fd.set('caption', it.caption);
        fd.set('album', album);
        fd.set('opKey', keys.current.for(it.id, [it.name, it.size, it.modified, it.taken, it.caption, place, album]));
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
    setNotice(failed ? g('up.partial') : g('up.done'));
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
          <div className="gal-batch">
            <Select
              aria-label={g('up.album_all')}
              value={album}
              onChange={setAlbum}
              options={[{ value: '', label: g('gallery.no_album') }, ...albums.map((a) => ({ value: a.id, label: a.name }))]}
              disabled={running}
            />
            <label className="gal-field">
              <span>{g('up.place_all')}</span>
              <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} disabled={running} />
            </label>
          </div>
          <ul className="gal-queue">
            {items.map((it) => (
              <li key={it.id} className={`gal-item is-${it.status}`}>
                <div className="gal-item-thumb">
                  {it.preview ? <img src={it.preview} alt="" /> : <span className="gal-item-wait" aria-hidden />}
                </div>
                <div className="gal-item-fields">
                  <p className="gal-item-name" title={it.name}>{it.name}</p>
                  <label className="gal-field">
                    <span>
                      {g('lb.date')}
                      {it.fromPhoto && it.taken === it.fromPhoto ? <em className="subtle"> · {g('up.from_photo')}</em> : null}
                    </span>
                    <input
                      className="input"
                      value={it.taken}
                      placeholder="1985-06-14"
                      inputMode="numeric"
                      maxLength={10}
                      disabled={it.status === 'adding' || it.status === 'added'}
                      onChange={(e) => update(it.id, { taken: e.target.value.trim() })}
                    />
                  </label>
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
