// A person's photographs: the pictures they are confirmed in, and the choice of which one is their
// profile picture. Editors and stewards can crop a square from one, or go back to the drawn portrait.
// Viewers see the strip only.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Crop } from 'lucide-react';
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Portrait } from '~/components/Portrait';
import { Dialog, EmptyState, Range, Skeleton } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { useFamily } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { personPhotosQuery, setPersonPortrait, setPreferAvatar } from '~/lib/photos.functions';
import { useCan } from '~/lib/session';
import { squareCrop } from './image';
import { refreshPhotos } from './refresh';
import { useT } from '~/lib/i18n';
import { mediaUrl, type MediaItem } from './types';
import '~/styles/gallery.css';

export function PersonPhotos({ tree, id }: { tree: string; id: string }) {
  const g = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const canEdit = useCan('edit-person');
  const person = f.byId.get(id);
  const q = useQuery(personPhotosQuery(tree, id));
  const [selected, setSelected] = useState<string | null>(null);
  const [cropping, setCropping] = useState<MediaItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useRef(opKeys());
  // Shows the drawn avatar, or the photo again. The photo is kept either way.
  const avatar = useMutation({
    mutationFn: (prefer: boolean) => setPreferAvatar({ data: { tree, id, prefer, opKey: keys.current.for('prefer', [id, prefer]) } }),
    onSuccess: async (_r, prefer) => {
      keys.current.clear('prefer');
      setNotice(g(prefer ? 'pp.avatar_done' : 'pp.photo_done'));
      await refreshPhotos(qc, tree);
    },
    onError: () => setNotice(g('pp.failed')),
  });

  if (!person) return null;
  const name = displayName(person, f);
  const photos = q.data ?? [];
  const chosen = photos.find((m) => m.key === selected) ?? null;
  const drawnShown = !!person.preferAvatar;

  return (
    <section className="pp" aria-labelledby={`pp-${id}`}>
      <h3 className="pp-title" id={`pp-${id}`}>{g('pp.title')}</h3>

      {person.photo ? (
        <div className="pp-portraits">
          <figure className="pp-portrait">
            <Portrait person={person} tree={tree} size={88} prefer="photo" />
            <figcaption>
              {g('pp.photo')} {!drawnShown ? <span className="pp-badge">{g('pp.in_use')}</span> : null}
            </figcaption>
          </figure>
          <figure className="pp-portrait">
            <Portrait person={person} tree={tree} size={88} prefer="avatar" />
            <figcaption>
              {g('pp.drawn')} {drawnShown ? <span className="pp-badge">{g('pp.in_use')}</span> : null}
            </figcaption>
          </figure>
        </div>
      ) : null}

      {q.isPending ? (
        <Skeleton lines={2} />
      ) : q.isError ? (
        <div className="pp-error">
          <p className="subtle">{g('pp.load_failed')}</p>
          <button type="button" className="btn" onClick={() => void q.refetch()}>{g('pp.retry')}</button>
        </div>
      ) : photos.length === 0 ? (
        <EmptyState
          title={g('pp.none', { name })}
          text={g('pp.none_hint', { name })}
          action={<Link className="btn" to="/$tree/gallery" params={{ tree }}>{g('pp.open')}</Link>}
        />
      ) : (
        <ul className="pp-strip">
          {photos.map((m) => (
            <li key={m.key}>
              <button
                type="button"
                className="pp-thumb"
                aria-pressed={selected === m.key}
                aria-label={m.caption || g('common.photo_of', { name })}
                onClick={() => setSelected(m.key)}
              >
                <img src={mediaUrl(tree, m.key)} alt="" loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {canEdit && photos.length ? (
        <div className="pp-actions">
          {chosen ? (
            <button type="button" className="btn primary" onClick={() => setCropping(chosen)}>
              <Crop size={16} aria-hidden /> {g('pp.set')}
            </button>
          ) : null}
          {person.photo ? (
            <button type="button" className="btn ghost" onClick={() => avatar.mutate(!drawnShown)} disabled={avatar.isPending}>
              {drawnShown ? g('pp.use_photo') : g('pp.use_drawn')}
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? <p className="subtle pp-notice" role="status">{notice}</p> : null}

      {cropping ? (
        <CropDialog
          tree={tree}
          personId={id}
          item={cropping}
          onClose={() => setCropping(null)}
          onDone={() => {
            setCropping(null);
            setNotice(g('pp.saved'));
          }}
        />
      ) : null}
    </section>
  );
}

// ---------- the square ----------

const FRAME = 280;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A square window over a picture. Drag to move the picture under it; the slider zooms. Saves the square
 * as a JPEG and sets it as the person's portrait.
 */
function CropDialog({ tree, personId, item, onClose, onDone }: {
  tree: string;
  personId: string;
  item: MediaItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const g = useT();
  const qc = useQueryClient();
  const keys = useRef(opKeys());
  const img = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // The picture starts covering the square, centred.
  const base = natural ? FRAME / Math.min(natural.w, natural.h) : 1;
  const scale = base * zoom;
  const fit = (x: number, y: number, s: number) =>
    natural ? { x: clamp(x, FRAME - natural.w * s, 0), y: clamp(y, FRAME - natural.h * s, 0) } : { x, y };

  function loaded() {
    const el = img.current;
    if (!el) return;
    const n = { w: el.naturalWidth, h: el.naturalHeight };
    const s = FRAME / Math.min(n.w, n.h);
    setNatural(n);
    setOff({ x: (FRAME - n.w * s) / 2, y: (FRAME - n.h * s) / 2 });
  }

  function zoomTo(z: number) {
    if (!natural) return;
    const next = base * z;
    // Keep the middle of the square on the same part of the picture.
    const cx = (FRAME / 2 - off.x) / scale;
    const cy = (FRAME / 2 - off.y) / scale;
    setOff(fit(FRAME / 2 - cx * next, FRAME / 2 - cy * next, next));
    setZoom(z);
  }

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y };
  }
  function move(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    setOff(fit(d.ox + e.clientX - d.px, d.oy + e.clientY - d.py, scale));
  }

  async function save() {
    if (!natural || !img.current) return;
    setBusy(true);
    setErr(null);
    try {
      const box = { x: -off.x / scale, y: -off.y / scale, size: FRAME / scale };
      const blob = await squareCrop(img.current, box, 512);
      const fd = new FormData();
      fd.set('tree', tree);
      fd.set('id', personId);
      fd.set('file', new File([blob], 'portrait.jpg', { type: 'image/jpeg' }));
      fd.set('opKey', keys.current.for('portrait', [item.key, box.x, box.y, box.size]));
      await setPersonPortrait({ data: fd });
      keys.current.clear('portrait');
      await refreshPhotos(qc, tree);
      onDone();
    } catch {
      setErr(g('pp.failed'));
    } finally {
      setBusy(false);
    }
  }

  const pictureStyle: CSSProperties = natural
    ? { left: off.x, top: off.y, width: natural.w * scale, height: natural.h * scale }
    : { visibility: 'hidden' };

  return (
    <Dialog
      open
      onClose={onClose}
      title={g('pp.crop_title')}
      width="min(360px, 100vw - 24px)"
      dismissible={!busy}
      footer={
        <button type="button" className="btn primary" onClick={save} disabled={!natural || busy}>
          {busy ? g('common.saving') : g('pp.save')}
        </button>
      }
    >
      <div className="pp-crop-wrap">
        <p className="subtle">{g('pp.crop_help')}</p>
        <div
          className="pp-crop"
          style={{ width: FRAME, height: FRAME }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <img ref={img} src={mediaUrl(tree, item.key)} alt="" onLoad={loaded} draggable={false} style={pictureStyle} />
          <span className="pp-crop-ring" aria-hidden />
        </div>
        <label className="pp-zoom">
          <span>{g('pp.zoom')}</span>
          <Range value={zoom} onChange={zoomTo} min={1} max={4} step={0.01} aria-label={g('pp.zoom')} />
        </label>
        {err ? <p className="gal-error" role="alert">{err}</p> : null}
      </div>
    </Dialog>
  );
}
