// A painted portrait from one of a person's photos. The person's photos area (and the character editor, which may
// mount this too) shows: "Create a painted portrait" with what it costs and which model paints it; a dialog that sends
// the chosen photo to the model only when the reader clicks create, then shows the painting beside the photo with
// "Use this portrait", "Try again" and "Discard". Nothing the person shows changes until "Use this portrait".
// Off for this family: a steward sees the quiet set-up hint; nobody else sees anything.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { Dialog, Skeleton } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { displayName } from '~/lib/graph';
import { useFamily } from '~/lib/family';
import { toAiLocale } from '~/lib/ai/types';
import { locales, useT } from '~/lib/i18n';
import { acceptPortrait, aiCreatePortrait, discardPortrait, portraitStatusQuery, removePortrait } from '~/lib/portrait.functions';
import { useCan } from '~/lib/session';
import type { GPerson } from '~/lib/types';
import { refreshPhotos } from './photos/refresh';
import { mediaUrl, type MediaItem } from './photos/types';
import './paint-portrait.css';

/** The dialog's picture of a painting that is waiting for a choice (editors only, see routes/api/paint). */
const paintUrl = (tree: string, key: string) => `/api/paint/${tree}/${key.replace(/^portrait\//, '')}`;

export function PaintPortrait({ tree, person, photos }: { tree: string; person: GPerson; photos: MediaItem[] }) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const canEdit = useCan('edit-person');
  const steward = useCan('manage-access');
  const status = useQuery({ ...portraitStatusQuery(tree), enabled: canEdit || steward });
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useRef(opKeys());
  const name = displayName(person, f);
  const remove = useMutation({
    mutationFn: () => removePortrait({ data: { tree, personId: person.id, opKey: keys.current.for('remove', [person.id]) } }),
    onSuccess: async () => {
      keys.current.clear('remove');
      setNotice(t('paint.removed'));
      await refreshPhotos(qc, tree);
    },
    onError: (e) => setNotice(errorText(e, t.locale)),
  });

  if (!canEdit && !steward) return null;
  const st = status.data;
  const ready = !!st && st.enabled && st.configured;
  const costs = st && st.usd !== null && st.usd !== undefined
    ? new Intl.NumberFormat(locales[toAiLocale(t.locale)], { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(st.usd)
    : null;

  return (
    <div className="paint">
      {status.isPending && canEdit ? <Skeleton lines={1} /> : null}
      {canEdit && ready ? (
        <>
          <button type="button" className="btn" onClick={() => setOpen(true)} disabled={!photos.length}>{t('paint.button')}</button>
          <p className="subtle paint-cost">
            {costs && st ? t('paint.cost', { usd: costs, model: st.model }) : t('paint.costUnknown')}
          </p>
          {!photos.length ? <p className="subtle">{t('paint.noPhotos')}</p> : null}
        </>
      ) : null}
      {steward && !ready && st ? (
        <p className="subtle paint-setup">
          {t('paint.setupHint')}{' '}
          <Link className="paint-link" to="/$tree/settings/ai" params={{ tree }}>{t('ai.settingsTitle')}</Link>
        </p>
      ) : null}
      {canEdit && person.portrait ? (
        <button type="button" className="btn ghost paint-remove" onClick={() => remove.mutate()} disabled={remove.isPending}>{t('paint.remove')}</button>
      ) : null}
      {notice ? <p className="subtle paint-notice" role="status">{notice}</p> : null}
      {open && st ? (
        <PaintDialog
          tree={tree}
          person={person}
          photos={photos}
          name={name}
          onClose={(message) => {
            setOpen(false);
            if (message) setNotice(message);
          }}
        />
      ) : null}
    </div>
  );
}

function PaintDialog({ tree, person, photos, name, onClose }: {
  tree: string;
  person: GPerson;
  photos: MediaItem[];
  name: string;
  onClose: (message?: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const keys = useRef(opKeys());
  const [picked, setPicked] = useState<string | null>(photos[0]?.key ?? null);
  const [cand, setCand] = useState<{ key: string; sourceYear: number | null } | null>(null);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const busy = working;

  /** Paints from the chosen photo. The photo is sent here, and only here: on the click. */
  async function paint(mediaKey: string) {
    setWorking(true);
    setErr(null);
    try {
      const c = await aiCreatePortrait({ data: { tree, personId: person.id, mediaKey, locale: t.locale } });
      setCand({ key: c.key, sourceYear: c.sourceYear });
    } catch (e) {
      setErr(errorText(e, t.locale));
    } finally {
      setWorking(false);
    }
  }

  /** Throws the candidate away on the server, so nothing waits on it. Failures are not shown: the candidate is only a draft. */
  async function throwAway(key: string) {
    await discardPortrait({ data: { tree, personId: person.id, key } }).catch(() => undefined);
  }

  async function tryAgain() {
    if (!cand || !picked) return;
    const old = cand.key;
    setCand(null);
    await throwAway(old);
    await paint(picked);
  }

  async function useThis() {
    if (!cand) return;
    setWorking(true);
    setErr(null);
    try {
      await acceptPortrait({ data: { tree, personId: person.id, key: cand.key, opKey: keys.current.for('accept', [cand.key]) } });
      keys.current.clear('accept');
      await refreshPhotos(qc, tree);
      onClose(t('paint.kept'));
    } catch (e) {
      setErr(errorText(e, t.locale));
    } finally {
      setWorking(false);
    }
  }

  async function discard() {
    if (cand) await throwAway(cand.key);
    onClose(cand ? t('paint.discarded') : undefined);
  }

  const picture = picked ? photos.find((m) => m.key === picked) : undefined;
  const year = cand?.sourceYear ?? null;

  return (
    <Dialog
      open
      onClose={() => void discard()}
      title={t('paint.dialogTitle')}
      description={name}
      width="min(620px, 100vw - 24px)"
      dismissible={!busy}
      footer={
        cand ? (
          <div className="paint-actions">
            <button type="button" className="btn ghost" onClick={() => void discard()} disabled={busy}>{t('paint.discard')}</button>
            <button type="button" className="btn" onClick={() => void tryAgain()} disabled={busy}>{t('paint.tryAgain')}</button>
            <button type="button" className="btn primary" onClick={() => void useThis()} disabled={busy}>{t('paint.useThis')}</button>
          </div>
        ) : (
          <div className="paint-actions">
            <button type="button" className="btn ghost" onClick={() => onClose()} disabled={busy}>{t('paint.close')}</button>
            <button type="button" className="btn primary" onClick={() => picked && void paint(picked)} disabled={busy || !picked}>{t('paint.create')}</button>
          </div>
        )
      }
    >
      {working ? (
        <div className="paint-working" role="status">
          <Skeleton lines={3} />
          <p className="subtle">{t('paint.working')}</p>
        </div>
      ) : cand ? (
        <div className="paint-review">
          <figure className="paint-pic">
            <img src={picture ? mediaUrl(tree, picture.key) : ''} alt="" />
            <figcaption className="subtle">{t('paint.sourceHead')}</figcaption>
          </figure>
          <figure className="paint-pic is-painted">
            <img src={paintUrl(tree, cand.key)} alt={name} />
            <figcaption className="subtle">{t('paint.candidateHead')}</figcaption>
          </figure>
          <p className="subtle paint-review-note">
            {year !== null ? t('paint.paintedFrom', { year: String(year) }) : t('paint.paintedFromUnknown')} {t('paint.fitsNote')}
          </p>
          <p className="subtle paint-review-note">{t('paint.reviewNote')}</p>
        </div>
      ) : (
        <div className="paint-pick">
          {photos.length ? (
            <>
              <p className="subtle">{t('paint.pickPhoto')}</p>
              <ul className="paint-strip">
                {photos.map((m) => (
                  <li key={m.key}>
                    <button type="button" className="pp-thumb" aria-pressed={picked === m.key} aria-label={m.caption || name} onClick={() => setPicked(m.key)}>
                      <img src={mediaUrl(tree, m.key)} alt="" loading="lazy" decoding="async" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="subtle">{t('paint.noPhotos')}</p>
          )}
          <p className="ai-privacy">{t('paint.privacy')}</p>
        </div>
      )}
      {err ? <p className="gal-error" role="alert">{err}</p> : null}
    </Dialog>
  );
}
