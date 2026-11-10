import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { FolderPlus, ImagePlus, Images, Pencil, Tag as TagIcon, Trash2 } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { AlbumDialog, DeleteAlbumDialog, Lightbox, PersonPhotos, UploadDialog, mediaUrl, type Album, type MediaItem } from '~/components/photos';
import { EmptyState, ErrorState, PageHeader, Select, Skeleton, Switch } from '~/components/ui';
import { compareText, formatDate, useT } from '~/lib/i18n';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { galleryQuery } from '~/lib/photos.functions';
import { translate, type Locale } from '~/lib/i18n';
import { treeTitle } from '~/lib/title';
import { useCan } from '~/lib/session';
import '~/styles/gallery.css';
import { useDealt } from '~/lib/dealt';

export const Route = createFileRoute('/$tree/gallery')({
  // The page's own query, fetched before it renders, so the server sends the photos rather than an empty gallery. Every
  // reader of the family may see it, the family's guest included; a failure is the page's to show.
  loader: async ({ context: { queryClient }, params: { tree } }) => {
    await queryClient.prefetchQuery(galleryQuery(tree));
  },
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'gallery.title')) }] }),
  component: GalleryPage,
});

/** The album filter: every photo, the ones in no album, or one album. */
type AlbumScope = 'all' | 'none' | string;

const decadeOf = (taken: string | null) => (taken && /^\d{4}/.test(taken) ? Math.floor(Number(taken.slice(0, 4)) / 10) * 10 : null);

// ---------- page ----------

function GalleryPage() {
  const tree = useTreeId();
  const f = useFamily();
  const g = useT();
  const t = useT();
  const canAdd = useCan('upload-photo');
  const canDeleteAlbum = useCan('delete-album');
  const q = useQuery(galleryQuery(tree));
  const dealt = useDealt(!q.isPending);
  const [album, setAlbum] = useState<AlbumScope>('all');
  const [person, setPerson] = useState('all');
  const [decade, setDecade] = useState('all');
  const [untagged, setUntagged] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ files?: File[] } | null>(null);
  const [albumEdit, setAlbumEdit] = useState<{ id?: string; name?: string } | null>(null);
  const [albumDelete, setAlbumDelete] = useState<{ id: string; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  const media = q.data?.media ?? [];
  const albums = q.data?.albums ?? [];

  const decades = useMemo(
    () => [...new Set(media.map((m) => decadeOf(m.taken)).filter((d): d is number => d !== null))].sort((a, b) => b - a),
    [media],
  );
  const people = useMemo(() => {
    const ids = new Set(media.flatMap((m) => m.tags.filter((x) => x.confirmed).map((x) => x.person)));
    return [...ids]
      .map((id) => f.byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .sort((a, b) => compareText(t.locale)(displayName(a, f), displayName(b, f)));
  }, [media, f, t.locale]);

  const filtered = media.filter(inScope);

  function inScope(m: MediaItem) {
    if (album === 'none' && m.album) return false;
    if (album !== 'all' && album !== 'none' && m.album !== album) return false;
    if (person !== 'all' && !m.tags.some((x) => x.confirmed && x.person === person)) return false;
    if (decade === 'undated' && m.taken) return false;
    if (decade !== 'all' && decade !== 'undated' && decadeOf(m.taken) !== Number(decade)) return false;
    if (untagged && m.tags.some((x) => x.confirmed)) return false;
    return true;
  }

  const filtersOn = album !== 'all' || person !== 'all' || decade !== 'all' || untagged;
  const clear = () => {
    setAlbum('all');
    setPerson('all');
    setDecade('all');
    setUntagged(false);
  };

  const openIndex = openKey ? filtered.findIndex((m) => m.key === openKey) : -1;
  const selectedAlbum = album !== 'all' && album !== 'none' ? albums.find((a) => a.id === album) : undefined;

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragging(false);
    if (!canAdd || !e.dataTransfer.files.length) return;
    e.preventDefault();
    setUploading({ files: Array.from(e.dataTransfer.files) });
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!canAdd || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  };

  const addButton = canAdd ? (
    <button type="button" className="btn primary" onClick={() => setUploading({})}>
      <ImagePlus size={16} aria-hidden /> {g('gallery.add')}
    </button>
  ) : null;

  return (
    <div className="page">
    <div className={`page-inner gallery${dragging ? ' is-dragging' : ''}`} onDragOver={onDragOver} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }} onDrop={onDrop}>
      <PageHeader title={g('gallery.title')} subtitle={g('gallery.subtitle')} icon={<Images size={26} />} actions={!q.isPending && !q.isError && media.length === 0 ? undefined : addButton} />

      {dragging ? <div className="gal-dropzone" aria-hidden>{g('gallery.drop')}</div> : null}

      {q.isPending ? (
        <ul className="gal-grid" aria-busy="true" aria-label={g('common.loading')}>
          {Array.from({ length: 9 }, (_, i) => (
            <li key={i} className="gal-skel">
              <Skeleton height={100 + ((i * 53) % 90)} radius={10} />
            </li>
          ))}
        </ul>
      ) : q.isError && !q.data ? (
        <ErrorState title={g('gallery.load_failed')} onRetry={() => void q.refetch()} error={q.error} />
      ) : media.length === 0 ? (
        <EmptyState
          icon={<Images size={28} />}
          title={g('gallery.empty_title')}
          text={canAdd ? g('gallery.empty_text') : g('gallery.empty_viewer')}
          action={addButton}
        />
      ) : (
        <>
          <div className="gal-albums" role="group" aria-label={g('gallery.album_name')}>
            <button type="button" className="btn gal-album" aria-pressed={album === 'all'} onClick={() => setAlbum('all')}>
              {g('gallery.all_photos')} <span className="subtle">{media.length}</span>
            </button>
            {albums.map((a: Album) => (
              <button key={a.id} type="button" className="btn gal-album" aria-pressed={album === a.id} onClick={() => setAlbum(a.id)}>
                {a.name} <span className="subtle">{a.count}</span>
              </button>
            ))}
            <button type="button" className="btn gal-album" aria-pressed={album === 'none'} onClick={() => setAlbum('none')}>
              {g('gallery.no_album')} <span className="subtle">{media.filter((m) => !m.album).length}</span>
            </button>
            {canAdd ? (
              <>
                <button type="button" className="btn ghost" onClick={() => setAlbumEdit({})}>
                  <FolderPlus size={16} aria-hidden /> {g('gallery.new_album')}
                </button>
                {selectedAlbum ? (
                  <button type="button" className="btn ghost" onClick={() => setAlbumEdit({ id: selectedAlbum.id, name: selectedAlbum.name })}>
                    <Pencil size={16} aria-hidden /> {g('gallery.rename_album')}
                  </button>
                ) : null}
              </>
            ) : null}
            {canDeleteAlbum && selectedAlbum ? (
              <button type="button" className="btn ghost" onClick={() => setAlbumDelete({ id: selectedAlbum.id, name: selectedAlbum.name })}>
                <Trash2 size={16} aria-hidden /> {g('gallery.delete_album')}
              </button>
            ) : null}
          </div>

          <div className="gal-filters">
            <div className="gal-sel">
            <Select
              aria-label={g('gallery.person')}
              value={person}
              onChange={setPerson}
              options={[{ value: 'all', label: g('gallery.any_person') }, ...people.map((p) => ({ value: p.id, label: displayName(p, f) }))]}
            />
            </div>
            <div className="gal-sel">
            <Select
              aria-label={g('gallery.decade')}
              value={decade}
              onChange={setDecade}
              options={[
                { value: 'all', label: g('gallery.any_decade') },
                ...decades.map((d) => ({ value: String(d), label: g('gallery.decade_of', { decade: d }) })),
                ...(media.some((m) => !m.taken) ? [{ value: 'undated', label: g('gallery.undated') }] : []),
              ]}
            />
            </div>
            <Switch checked={untagged} onChange={setUntagged}>
              <TagIcon size={14} aria-hidden /> {g('gallery.only_untagged')}
            </Switch>
            {filtersOn ? (
              <button type="button" className="btn ghost gal-clear" onClick={clear}>{g('gallery.clear')}</button>
            ) : null}
            <span className="subtle gal-count" role="status">{g('gallery.count', { count: filtered.length })}</span>
          </div>

          {person !== 'all' ? <PersonPhotos tree={tree} id={person} /> : null}

          {filtered.length === 0 ? (
            <EmptyState title={g('gallery.nomatch_title')} text={g('gallery.nomatch_text')} action={<button type="button" className="btn" onClick={clear}>{g('gallery.clear')}</button>} />
          ) : (
            <ul className={`gal-grid ${dealt}`}>
              {filtered.map((m) => {
                const when = m.taken ? formatDate(m.taken, t.locale) : null;
                const label = m.caption || (when ? g('common.photo_of', { name: when }) : g('common.photo_undated'));
                const tagged = m.tags.some((x) => x.confirmed);
                return (
                  <li key={m.key}>
                    <button
                      type="button"
                      className="gal-tile"
                      style={{ aspectRatio: `${m.width || 4} / ${m.height || 3}` }}
                      onClick={() => setOpenKey(m.key)}
                      aria-label={label}
                    >
                      <img src={mediaUrl(tree, m.key, 'thumb')} alt="" loading="lazy" decoding="async" />
                      <span className="gal-meta">
                        {when ?? g('lb.no_date')}
                        {m.place ? <> · {m.place}</> : null}
                      </span>
                      {!tagged ? <span className="gal-badge">{g('gallery.untagged')}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {openIndex >= 0 ? (
        <Lightbox
          tree={tree}
          items={filtered}
          index={openIndex}
          albums={albums}
          onIndex={(i) => setOpenKey(filtered[i]?.key ?? null)}
          onClose={() => setOpenKey(null)}
        />
      ) : null}

      {uploading ? (
        <UploadDialog
          tree={tree}
          albums={albums}
          initialAlbum={selectedAlbum?.id ?? null}
          files={uploading.files}
          onClose={() => setUploading(null)}
        />
      ) : null}

      {albumDelete ? (
        <DeleteAlbumDialog
          tree={tree}
          id={albumDelete.id}
          name={albumDelete.name}
          onClose={() => setAlbumDelete(null)}
          onDeleted={() => {
            setAlbumDelete(null);
            setAlbum('all');
          }}
        />
      ) : null}

      {albumEdit ? (
        <AlbumDialog
          tree={tree}
          id={albumEdit.id}
          name={albumEdit.name}
          onClose={() => setAlbumEdit(null)}
          onSaved={(id) => {
            setAlbumEdit(null);
            setAlbum(id);
          }}
        />
      ) : null}
    </div>
    </div>
  );
}
