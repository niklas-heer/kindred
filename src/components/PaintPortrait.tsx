// A painted portrait from one of a person's photos. The person's photos area (and the character editor, which may mount
// this too) shows: "Create a painted portrait" with what it costs and which model paints it, and the portraits this person
// has kept. A dialog sends the chosen photo to the model only when the reader clicks create, then shows the draft beside the
// photo with small personal tweaks, "Try again", "Keep for later" and "Use this portrait". Nothing the person shows changes
// until someone chooses "Use this portrait" or "Show this one". Editors may do this, and so may the member linked to the
// person once a steward has confirmed the link (the server checks both); until then that member is told so. Off for this
// family: a steward sees the quiet set-up hint; nobody else sees anything.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ConfirmDialog, Dialog, Segmented, Skeleton } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { displayName } from '~/lib/graph';
import { useFamily } from '~/lib/family';
import { MAX_NOTE_CHARS, awaitsLinkConfirmation, mayPaintPerson, type PortraitTweak } from '~/lib/ai/portrait-rules';
import { toAiLocale } from '~/lib/ai/types';
import { locales, useT } from '~/lib/i18n';
import { acceptPortrait, aiCreatePortrait, discardPortrait, keepPortrait, portraitStatusQuery, portraitVersionsQuery, profilePhotoKeyQuery, removePortrait } from '~/lib/portrait.functions';
import { useCan, useMembership } from '~/lib/session';
import type { GPerson } from '~/lib/types';
import { refreshPhotos } from './photos/refresh';
import { paintSources } from '~/lib/paint-sources';
import { mediaUrl, type MediaItem } from '~/lib/photos/types';
import './paint-portrait.css';

/** A draft's or a kept version's picture (editors and the linked member only, see routes/api/paint). */
const paintUrl = (tree: string, key: string) => `/api/paint/${tree}/${key.replace(/^portrait\//, '')}`;

/** Where a source photo's picture is: a profile photo has its own route, a gallery picture the media route. */
const sourceUrl = (tree: string, person: GPerson, key: string) =>
  key.startsWith('photo/') ? `/api/photo/${tree}/${person.id}${person.photo ? `?v=${encodeURIComponent(person.photo)}` : ''}` : mediaUrl(tree, key);

/** Where the dialog starts: from scratch, or from a kept version's photo and tweaks. */
interface Start { source?: string; tweak?: PortraitTweak | null }

export function PaintPortrait({ tree, person, photos: gallery }: { tree: string; person: GPerson; photos: MediaItem[] }) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const editor = useCan('edit-person');
  const membership = useMembership(tree);
  const canPaint = editor || mayPaintPerson(membership, person.id);
  const awaiting = awaitsLinkConfirmation(membership, person.id);
  const steward = useCan('manage-access');
  const status = useQuery({ ...portraitStatusQuery(tree), enabled: canPaint || steward || awaiting });
  const profile = useQuery({ ...profilePhotoKeyQuery(tree, person.id, person.photo), enabled: canPaint && !!person.photo });
  const versions = useQuery({ ...portraitVersionsQuery(tree, person.id), enabled: canPaint });
  const photos = paintSources(profile.data, gallery);
  const [open, setOpen] = useState<Start | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useRef(opKeys());
  const name = displayName(person, f);
  const refresh = async () => {
    await Promise.all([refreshPhotos(qc, tree), qc.invalidateQueries({ queryKey: portraitVersionsQuery(tree, person.id).queryKey })]);
  };
  const remove = useMutation({
    mutationFn: () => removePortrait({ data: { tree, personId: person.id, opKey: keys.current.for('remove', [person.id]) } }),
    onSuccess: async () => {
      keys.current.clear('remove');
      setNotice(t('paint.removed'));
      await refresh();
    },
    onError: (e) => setNotice(errorText(e, t.locale)),
  });
  const show = useMutation({
    mutationFn: (key: string) => acceptPortrait({ data: { tree, personId: person.id, key, opKey: keys.current.for('show', [key]) } }),
    onSuccess: async () => {
      keys.current.clear('show');
      setNotice(t('paint.versionShown'));
      await refresh();
    },
    onError: (e) => setNotice(errorText(e, t.locale)),
  });
  const drop = useMutation({
    mutationFn: (key: string) => discardPortrait({ data: { tree, personId: person.id, key, opKey: keys.current.for('drop', [key]) } }),
    onSuccess: async () => {
      keys.current.clear('drop');
      setDropping(null);
      setNotice(t('paint.versionDeleted'));
      await refresh();
    },
    onError: (e) => setNotice(errorText(e, t.locale)),
  });
  // The portrait the reader was asked about, by its key.
  const [dropping, setDropping] = useState<string | null>(null);

  if (!canPaint && !steward && !awaiting) return null;
  const st = status.data;
  const ready = !!st && st.enabled && st.configured;
  const costs = st && st.usd !== null && st.usd !== undefined
    ? new Intl.NumberFormat(locales[toAiLocale(t.locale)], { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(st.usd)
    : null;
  const kept = canPaint ? versions.data ?? [] : [];
  const changing = show.isPending || drop.isPending;

  return (
    <div className="paint">
      {status.isPending && canPaint ? <Skeleton lines={1} /> : null}
      {canPaint && ready ? (
        <>
          <button type="button" className="btn" onClick={() => setOpen({})} disabled={!photos.length}>{t('paint.button')}</button>
          <p className="subtle paint-cost">
            {costs && st ? t('paint.cost', { usd: costs, model: st.model }) : t('paint.costUnknown')}
          </p>
          {!photos.length ? <p className="subtle">{t('paint.noPhotos')}</p> : null}
        </>
      ) : null}
      {awaiting && ready ? <p className="subtle paint-setup" role="status">{t('paint.awaitingSteward')}</p> : null}
      {steward && !ready && st ? (
        <p className="subtle paint-setup">
          {t('paint.setupHint')}{' '}
          <Link className="paint-link" to="/$tree/settings/ai" params={{ tree }}>{t('ai.settingsTitle')}</Link>
        </p>
      ) : null}
      {kept.length ? (
        <section className="paint-versions" aria-label={t('paint.versionsTitle')}>
          <h4 className="paint-versions-title">{t('paint.versionsTitle')}</h4>
          <ul className="paint-version-list">
            {kept.map((v) => (
              <li key={v.key} className="paint-version" data-shown={v.shown ? '' : undefined}>
                <img src={paintUrl(tree, v.key)} alt={name} loading="lazy" decoding="async" />
                {v.shown ? (
                  <span className="paint-version-badge">{t('paint.versionIsShown')}</span>
                ) : (
                  <button type="button" className="btn sm" onClick={() => show.mutate(v.key)} disabled={changing}>{t('paint.versionShow')}</button>
                )}
                {ready ? <button type="button" className="btn ghost sm" onClick={() => setOpen({ source: v.source, tweak: v.tweak })} disabled={changing || !photos.length}>{t('paint.versionTweak')}</button> : null}
                {!v.shown ? (
                  <button type="button" className="btn ghost sm" onClick={() => { drop.reset(); setDropping(v.key); }} disabled={changing}>{t('paint.versionDelete')}</button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ConfirmDialog
        open={!!dropping}
        onClose={() => setDropping(null)}
        onConfirm={() => dropping && drop.mutate(dropping)}
        title={t('paint.versionDeleteTitle', { name })}
        confirmLabel={t('paint.versionDeleteYes')}
        busy={drop.isPending}
        error={drop.isError ? errorText(drop.error, t.locale) : undefined}
      >
        {dropping ? <img className="paint-confirm-img" src={paintUrl(tree, dropping)} alt={name} /> : null}
        <p>{t('paint.versionDeleteBody')}</p>
      </ConfirmDialog>
      {canPaint && person.portrait ? (
        <button type="button" className="btn ghost paint-remove" onClick={() => remove.mutate()} disabled={remove.isPending}>{t('paint.remove')}</button>
      ) : null}
      {notice ? <p className="subtle paint-notice" role="status">{notice}</p> : null}
      {open && st ? (
        <PaintDialog
          tree={tree}
          person={person}
          photos={photos}
          name={name}
          start={open}
          cost={costs}
          onChanged={refresh}
          onClose={(message) => {
            setOpen(null);
            if (message) setNotice(message);
          }}
        />
      ) : null}
    </div>
  );
}

/** The small choices a person can make, on top of the family style. Empty strings mean "as the family style has it". */
interface TweakForm { framing: '' | 'closer' | 'farther'; warmth: '' | 'warmer' | 'cooler'; smile: '' | 'gentle'; note: string }

const formOf = (t?: PortraitTweak | null): TweakForm => ({ framing: t?.framing ?? '', warmth: t?.warmth ?? '', smile: t?.smile ? 'gentle' : '', note: t?.note ?? '' });

function tweakOf(f: TweakForm): PortraitTweak | undefined {
  const out: PortraitTweak = {};
  if (f.framing) out.framing = f.framing;
  if (f.warmth) out.warmth = f.warmth;
  if (f.smile) out.smile = true;
  if (f.note.trim()) out.note = f.note.trim();
  return Object.keys(out).length ? out : undefined;
}

function TweakControls({ value, onChange, cost }: { value: TweakForm; onChange: (v: TweakForm) => void; cost: string | null }) {
  const t = useT();
  return (
    <fieldset className="paint-tweak">
      <legend>{t('paint.tweakTitle')}</legend>
      <p className="subtle">{t('paint.tweakHint')}</p>
      <div className="paint-tweak-row">
        <span id="paint-tw-frame">{t('paint.tweakFraming')}</span>
        <Segmented size="sm" block aria-labelledby="paint-tw-frame" value={value.framing} onChange={(framing) => onChange({ ...value, framing })}
          options={[{ value: 'closer', label: t('paint.tweakCloser') }, { value: '', label: t('paint.tweakAsIs') }, { value: 'farther', label: t('paint.tweakFarther') }]} />
      </div>
      <div className="paint-tweak-row">
        <span id="paint-tw-warm">{t('paint.tweakWarmth')}</span>
        <Segmented size="sm" block aria-labelledby="paint-tw-warm" value={value.warmth} onChange={(warmth) => onChange({ ...value, warmth })}
          options={[{ value: 'warmer', label: t('paint.tweakWarmer') }, { value: '', label: t('paint.tweakAsIs') }, { value: 'cooler', label: t('paint.tweakCooler') }]} />
      </div>
      <div className="paint-tweak-row">
        <span id="paint-tw-smile">{t('paint.tweakSmile')}</span>
        <Segmented size="sm" block aria-labelledby="paint-tw-smile" value={value.smile} onChange={(smile) => onChange({ ...value, smile })}
          options={[{ value: '', label: t('paint.tweakAsIs') }, { value: 'gentle', label: t('paint.tweakGentle') }]} />
      </div>
      <label className="paint-tweak-note">
        <span>{t('paint.tweakNote')}</span>
        <input className="input" value={value.note} maxLength={MAX_NOTE_CHARS} placeholder={t('paint.tweakNoteHint')} onChange={(e) => onChange({ ...value, note: e.target.value })} />
      </label>
      {cost ? <p className="subtle">{t('paint.tweakCost', { usd: cost })}</p> : null}
    </fieldset>
  );
}

function PaintDialog({ tree, person, photos, name, start, cost, onChanged, onClose }: {
  tree: string;
  person: GPerson;
  photos: { key: string; caption: string | null }[];
  name: string;
  start: Start;
  cost: string | null;
  onChanged: () => Promise<void>;
  onClose: (message?: string) => void;
}) {
  const t = useT();
  const keys = useRef(opKeys());
  const [picked, setPicked] = useState<string | null>(photos.find((m) => m.key === start.source)?.key ?? photos[0]?.key ?? null);
  const [drafts, setDrafts] = useState<{ key: string; sourceYear: number | null }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [form, setForm] = useState<TweakForm>(formOf(start.tweak));
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const busy = working;
  const cand = drafts.find((d) => d.key === active) ?? null;

  /** Paints from the chosen photo. The photo is sent here, and only here: on the click. Earlier drafts stay, to compare. */
  async function paint(mediaKey: string) {
    setWorking(true);
    setErr(null);
    try {
      const c = await aiCreatePortrait({ data: { tree, personId: person.id, mediaKey, locale: t.locale, tweak: tweakOf(form) } });
      setDrafts((all) => [...all, { key: c.key, sourceYear: c.sourceYear }]);
      setActive(c.key);
    } catch (e) {
      setErr(errorText(e, t.locale));
    } finally {
      setWorking(false);
    }
  }

  /** Throws drafts away on the server, so nothing waits on them. Failures are not shown: a draft is swept anyway. */
  async function throwAway(list: string[]) {
    await Promise.all(list.map((key) => discardPortrait({ data: { tree, personId: person.id, key } }).catch(() => undefined)));
  }

  async function applyThis() {
    if (!cand) return;
    setWorking(true);
    setErr(null);
    try {
      await acceptPortrait({ data: { tree, personId: person.id, key: cand.key, opKey: keys.current.for('accept', [cand.key]) } });
      keys.current.clear('accept');
      await throwAway(drafts.filter((d) => d.key !== cand.key).map((d) => d.key));
      await onChanged();
      onClose(t('paint.kept'));
    } catch (e) {
      setErr(errorText(e, t.locale));
    } finally {
      setWorking(false);
    }
  }

  async function keepThis() {
    if (!cand) return;
    setWorking(true);
    setErr(null);
    try {
      await keepPortrait({ data: { tree, personId: person.id, key: cand.key, opKey: keys.current.for('keep', [cand.key]) } });
      keys.current.clear('keep');
      await onChanged();
      const rest = drafts.filter((d) => d.key !== cand.key);
      setDrafts(rest);
      setActive(rest.at(-1)?.key ?? null);
      if (!rest.length) onClose(t('paint.keptVersion'));
    } catch (e) {
      setErr(errorText(e, t.locale));
    } finally {
      setWorking(false);
    }
  }

  async function discardActive() {
    if (!cand) return;
    await throwAway([cand.key]);
    const rest = drafts.filter((d) => d.key !== cand.key);
    setDrafts(rest);
    setActive(rest.at(-1)?.key ?? null);
    if (!rest.length) onClose(t('paint.discarded'));
  }

  async function closeAll() {
    await throwAway(drafts.map((d) => d.key));
    onClose(drafts.length ? t('paint.discarded') : undefined);
  }

  const picture = picked ? photos.find((m) => m.key === picked) : undefined;
  const year = cand?.sourceYear ?? null;

  return (
    <Dialog
      open
      onClose={() => { if (!busy) void closeAll(); }}
      closeButton={!busy}
      title={t('paint.dialogTitle')}
      description={name}
      width="min(620px, 100vw - 24px)"
      dismissible={!busy && !drafts.length}
      bodyClassName="paint-body"
      footer={
        cand ? (
          <div className="paint-actions">
            <button type="button" className="btn ghost" onClick={() => void discardActive()} disabled={busy}>{t('paint.discard')}</button>
            <button type="button" className="btn" onClick={() => picked && void paint(picked)} disabled={busy || !picked}>{t('paint.tryAgain')}</button>
            <button type="button" className="btn" onClick={() => void keepThis()} disabled={busy}>{t('paint.keepVersion')}</button>
            <button type="button" className="btn primary" onClick={() => void applyThis()} disabled={busy}>{t('paint.useThis')}</button>
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
            <img src={picture ? sourceUrl(tree, person, picture.key) : ''} alt="" />
            <figcaption className="subtle">{t('paint.sourceHead')}</figcaption>
          </figure>
          <figure className="paint-pic is-painted">
            <img src={paintUrl(tree, cand.key)} alt={name} />
            <figcaption className="subtle">{t('paint.candidateHead')}</figcaption>
          </figure>
          {drafts.length > 1 ? (
            <ul className="paint-strip paint-drafts" aria-label={t('paint.draftsLabel')}>
              {drafts.map((d, i) => (
                <li key={d.key}>
                  <button type="button" className="pp-thumb" aria-pressed={d.key === cand.key} aria-label={t('paint.draftN', { n: String(i + 1) })} onClick={() => setActive(d.key)}>
                    <img src={paintUrl(tree, d.key)} alt="" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="subtle paint-review-note">
            {year !== null ? t('paint.paintedFrom', { year: String(year) }) : t('paint.paintedFromUnknown')} {t('paint.fitsNote')}
          </p>
          <p className="subtle paint-review-note">{t('paint.reviewNote')}</p>
          <div className="paint-review-tweak"><TweakControls value={form} onChange={setForm} cost={cost} /></div>
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
                      <img src={sourceUrl(tree, person, m.key)} alt="" loading="lazy" decoding="async" />
                    </button>
                  </li>
                ))}
              </ul>
              <TweakControls value={form} onChange={setForm} cost={cost} />
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
