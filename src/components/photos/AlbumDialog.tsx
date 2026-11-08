// Creates an album, or renames one. The new album is handed back so the gallery can show it at once.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Dialog, Notice } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { saveAlbum } from '~/lib/photos.functions';
import { refreshPhotos } from './refresh';
import { useG } from './strings';
import '~/styles/gallery.css';

export function AlbumDialog({ tree, id, name, onClose, onSaved }: {
  tree: string;
  /** The album to rename; absent to create one. */
  id?: string;
  name?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const g = useG();
  const qc = useQueryClient();
  const [value, setValue] = useState(name ?? '');
  const keys = useRef(opKeys());
  const save = useMutation({
    mutationFn: () => saveAlbum({ data: { tree, id, name: value.trim(), opKey: keys.current.for('saveAlbum', [id, value.trim()]) } }),
    onSuccess: async (r) => {
      keys.current.clear('saveAlbum');
      await refreshPhotos(qc, tree);
      onSaved(r.id);
    },
  });
  const dirty = value.trim() !== (name ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim()) save.mutate();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={id ? g('gallery.rename_album') : g('al.create')}
      width="min(420px, 100vw - 24px)"
      dirty={dirty}
      footer={
        <button type="submit" form="gal-album-form" className="btn primary" disabled={!value.trim() || save.isPending}>
          {id ? g('al.save') : g('al.create')}
        </button>
      }
    >
      <form id="gal-album-form" className="gal-album-form" onSubmit={submit}>
        <label className="gal-field">
          <span>{g('gallery.album_name')}</span>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} data-autofocus required />
        </label>
        {save.isError ? <Notice>{g('pp.failed')}</Notice> : null}
      </form>
    </Dialog>
  );
}
