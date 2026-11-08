// Linking what the family already holds to a project: a picture from the Gallery, a person, or a place from the Atlas.
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { PersonPicker, mediaUrl, type MediaItem } from '~/components/photos';
import { Dialog, Notice, Skeleton, Switch } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import { useT } from '~/lib/i18n';
import { galleryQuery } from '~/lib/photos.functions';
import { addResearchLink } from '~/lib/research.functions';
import { useCan } from '~/lib/session';
import { useResearchRefresh } from './forms';

function useLink(tree: string, project: string) {
  const t = useT();
  const refresh = useResearchRefresh(tree);
  const keys = useRef(opKeys()).current;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = async (kind: 'picture' | 'person' | 'place', target: string, makePrivate: boolean | undefined, done: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const payload = { project, kind, target, private: makePrivate };
      await addResearchLink({ data: { tree, ...payload, opKey: keys.for(`${kind}:${target}`, payload) } });
      keys.clear(`${kind}:${target}`);
      await refresh();
      done();
    } catch (e) {
      setError(e instanceof Error ? errorText(e, t.locale) : t('research.failed'));
    } finally {
      setBusy(false);
    }
  };
  return { link, error, busy };
}

const pickerWidth = 'min(640px, 100vw - 24px)';

export function AddPictureDialog({ tree, project, linked, onClose }: { tree: string; project: string; linked: Set<string>; onClose: () => void }) {
  const t = useT();
  const gallery = useQuery(galleryQuery(tree));
  const { link, error, busy } = useLink(tree, project);
  const items = (gallery.data?.media ?? []).filter((m) => !linked.has(m.key));

  return (
    <Dialog open onClose={onClose} title={t('research.add_picture_title')} width={pickerWidth}>
      {gallery.isPending ? <Skeleton lines={4} /> : !gallery.data?.media.length ? <p className="muted">{t('research.gallery_empty')}</p> : !items.length ? <p className="muted">{t('research.gallery_all_added')}</p> : (
        <ul className="rs-pick-grid">
          {items.map((m: MediaItem) => (
            <li key={m.key}>
              <button type="button" className="rs-pick-tile" disabled={busy} onClick={() => void link('picture', m.key, undefined, onClose)} aria-label={m.caption || m.taken || t('research.add_picture')}>
                <img src={mediaUrl(tree, m.key)} alt="" loading="lazy" decoding="async" />
                <span className="rs-pick-add" aria-hidden><Plus size={16} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <Notice>{error}</Notice> : null}
    </Dialog>
  );
}

export function AddPersonDialog({ tree, project, onClose }: { tree: string; project: string; onClose: () => void }) {
  const t = useT();
  const canEdit = useCan('edit-research');
  const [priv, setPriv] = useState(false);
  const { link, error } = useLink(tree, project);
  return (
    <Dialog open onClose={onClose} title={t('research.add_person')} width="min(460px, 100vw - 24px)">
      <PersonPicker label={t('research.add_person')} onPick={(p) => void link('person', p.id, priv, onClose)} />
      {canEdit ? <div className="rs-pick-switch"><Switch checked={priv} onChange={setPriv}>{t('research.private_person')}</Switch></div> : null}
      {error ? <Notice>{error}</Notice> : null}
    </Dialog>
  );
}

export function AddPlaceDialog({ tree, project, linked, onClose }: { tree: string; project: string; linked: Set<string>; onClose: () => void }) {
  const t = useT();
  const f = useFamily();
  const [q, setQ] = useState('');
  const { link, error, busy } = useLink(tree, project);
  const matches = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase(t.locale);
    return f.graph.places.filter((p) => !linked.has(p.name) && p.name.toLocaleLowerCase(t.locale).includes(needle)).slice(0, 30);
  }, [f, q, linked, t.locale]);

  return (
    <Dialog open onClose={onClose} title={t('research.add_place_title')} width="min(460px, 100vw - 24px)">
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('research.place_search')} aria-label={t('research.place_search')} autoComplete="off" data-autofocus />
      {matches.length ? (
        <ul className="rs-place-list">
          {matches.map((p) => (
            <li key={p.name}>
              <button type="button" className="rs-place-item" disabled={busy} onClick={() => void link('place', p.name, undefined, onClose)}>{p.name}</button>
            </li>
          ))}
        </ul>
      ) : <p className="muted rs-place-none">{t('research.place_none')}</p>}
      {error ? <Notice>{error}</Notice> : null}
    </Dialog>
  );
}
