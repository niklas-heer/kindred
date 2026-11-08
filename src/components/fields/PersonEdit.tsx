// The Edit tab: the names, the life dates and places, the contact details, the biography and the rest of the fields.
// One Save writes all of it, with the places pinned first (the Atlas has them as soon as the person points at them).
// The save bar is sticky at the foot of the tab and says what state the form is in. The dirty guard in the panel covers
// the whole tab. The draft and "Load the latest" both start from one consistent snapshot of the person (`editSnapshot`),
// so the draft never mixes values from one moment with a revision from another.
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Trash2 } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { opKeys, removePerson } from '~/lib/api';
import { getEditSnapshot, savePersonEdit } from '~/lib/person.functions';
import type { EditSnapshot } from '~/lib/person.server';
import { yearOf, type Family } from '~/lib/graph';
import { isoOfDate, periodOf, storedIssue } from '~/lib/partial-date';
import { useCan } from '~/lib/session';
import { toast } from '~/lib/toast';
import type { GPerson, PersonDetail } from '~/lib/types';
import { PlaceInput, placeValue, savePlacesKeyed, type PlaceValue } from '../PlaceInput';
import { MarkdownEditor } from '../MarkdownEditor';
import { DatePicker, Segmented, Switch } from '../ui';
import { DraftContext, DraftTracker } from './draft';
import { draftOf, FieldEditor, type DraftField } from './FieldEditor';
import { CHANGED_SINCE_OPENED, fieldIssue, fieldText } from './model';
import { rebaseDraft, takeTheirs, type Conflict } from './rebase';
import { translateMessage, useT, type Key } from '~/lib/i18n';
import { OccupationField } from './OccupationField';
import { presetLabel } from './presets';
import './editor.css';

interface Props {
  tree: string;
  p: GPerson;
  f: Family;
  /** The panel's read of the person. Not used for the draft: the Edit tab loads its own snapshot, so it is never mixed. */
  detail: PersonDetail;
  done: () => void;
  onRemoved: () => void;
}

interface Values {
  given: string; surname: string; sameName: boolean; currentGiven: string; currentSurname: string;
  nickname: string; sex: '' | 'm' | 'f' | 'x';
  born: string; bornPlace: PlaceValue; died: string; diedPlace: PlaceValue; living: boolean;
  title: string; epithet: string; occupation: string; occupationCode: string; bio: string;
  fields: DraftField[];
}

/** The form's values for a person as the server has them: the same for the first draft and for a rebase. */
function valuesOf(s: EditSnapshot): Values {
  // Names: a null current name means "same as birth", so the switch starts on when both are unset.
  const sameName = s.currentGiven == null && s.currentSurname == null;
  return {
    given: s.given, surname: s.surname ?? '', sameName,
    currentGiven: s.currentGiven ?? s.given, currentSurname: s.currentSurname ?? s.surname ?? '',
    nickname: s.nickname ?? '', sex: (s.sex ?? '') as '' | 'm' | 'f' | 'x',
    born: s.born ?? '', bornPlace: placeValue(s.bornPlace), died: s.died ?? '', diedPlace: placeValue(s.diedPlace), living: s.living,
    title: s.title ?? '', epithet: s.epithet ?? '', occupation: s.occupation ?? '', occupationCode: s.occupationCode ?? '', bio: s.bio ?? '',
    fields: s.fields.map(draftOf),
  };
}

/** The reader's words for the scalar a conflict names (a unit names its first key). */
const LABEL: Record<string, Key> = {
  given: 'edit.givenAtBirth', surname: 'edit.surnameAtBirth', sameName: 'edit.sameName', currentGiven: 'edit.currentGiven',
  currentSurname: 'edit.currentSurname', nickname: 'edit.nickname', sex: 'edit.sex', born: 'edit.born', bornPlace: 'edit.birthplace',
  died: 'edit.died', diedPlace: 'edit.diedPlace', living: 'edit.living', title: 'edit.title', epithet: 'edit.epithet',
  occupation: 'edit.occupation', bio: 'edit.biography',
};

/**
 * The Edit tab. Loads the person's snapshot when it opens, and shows the form once it has it. The draft starts from that
 * snapshot and never from anything else.
 */
export function PersonEdit(props: Props) {
  const { tree, p } = props;
  const c = useT();
  const [snap, setSnap] = useState<EditSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  // Retry bumps this, so the same load runs again.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setSnap(null);
    setFailed(false);
    getEditSnapshot({ data: { tree, id: p.id } }).then(
      (s) => { if (live) setSnap(s); },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
  }, [tree, p.id, attempt]);
  if (failed) {
    return (
      <div className="wide pe-state">
        <p role="alert" className="err">{c('edit.loadFailed')}</p>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>{c('ui.retry')}</button>
      </div>
    );
  }
  if (!snap) return <p role="status" className="subtle wide pe-state">{c('ui.loading')}</p>;
  return <EditForm {...props} snap={snap} />;
}

/** The earliest year in the family, rounded down to a century: where the date picker's calendar starts. */
function earliestCentury(f: Family): number {
  let min = Infinity;
  for (const x of f.graph.people) {
    const y = yearOf(x.born);
    if (Number.isFinite(y) && y > 0 && y < min) min = y;
  }
  return Math.max(100, Math.floor((Number.isFinite(min) ? min : 1800) / 100) * 100);
}

/** A date problem that stops a save: a birth after today, a date that is not real, or a death before the birth. */
function datesBlocked(born: string, died: string, living: boolean, today: string): boolean {
  if (storedIssue(born, { notAfter: today })) return true;
  return !living && !!storedIssue(died, { notBefore: periodOf(born)?.from });
}

function EditForm({ tree, p, f, snap, done, onRemoved }: Omit<Props, 'detail'> & { snap: EditSnapshot }) {
  const { leave } = useContext(DraftContext);
  const c = useT();
  const canRemove = useCan('remove-person');
  const medieval = tree === 'realm' || (!!snap.born && yearOf(snap.born) < 1500);
  const qc = useQueryClient();
  const today = isoOfDate(new Date());
  const thisYear = Number(today.slice(0, 4));
  const minYear = useMemo(() => earliestCentury(f), [f]);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set when the save was refused because the person changed: the reader may load the latest and keep their changes.
  const [stale, setStale] = useState(false);
  const [rebasing, setRebasing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Where the reader and someone else changed the same thing: each is shown, and the reader picks one.
  const [conflicts, setConflicts] = useState<Conflict<DraftField>[]>([]);
  // Read by the submit handler: Save is disabled while a conflict is open, but Enter in a field also submits.
  const openConflicts = useRef(0);
  openConflicts.current = conflicts.length;
  const [keys] = useState(opKeys);
  // What the draft was opened on, read once: a refetch must not re-base the draft on newer data by accident. After a
  // rebase these are the latest values, so the next rebase compares the reader's changes with what they last saw.
  const [start] = useState(() => valuesOf(snap));
  const base = useRef<Values>(start);
  // The revision the draft was opened at; a rebase moves it to the latest one the reader has loaded.
  const revision = useRef(snap.revision);
  const remove = useMutation({
    mutationFn: () => removePerson({ data: { tree, id: p.id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      onRemoved();
    },
  });
  const form = useForm({
    defaultValues: start,
    onSubmit: async ({ value }) => {
      // Nothing is saved while a conflict is open. The choices stay on screen until a save succeeds, so a refused or
      // failed save never drops them. Nor is anything saved with a date the picker has refused.
      if (openConflicts.current > 0) return;
      if (datesBlocked(value.born, value.died, value.living, today)) return;
      setSaveError(null);
      setStale(false);
      setNotice(null);
      try {
        // Pins first: repeating them on a retry changes nothing.
        await savePlacesKeyed(tree, (pl) => keys.for('places', pl), value.bornPlace, value.living ? undefined : value.diedPlace);
        const details = {
          given: value.given, surname: value.surname, nickname: value.nickname, sex: value.sex || null,
          currentGiven: value.sameName ? null : value.currentGiven, currentSurname: value.sameName ? null : value.currentSurname,
          born: value.born, bornPlace: value.bornPlace.name, died: value.died, diedPlace: value.diedPlace.name, living: value.living,
          title: value.title, epithet: value.epithet, occupation: value.occupation, occupationCode: value.occupationCode || null, bio: value.bio,
        };
        const fields = value.fields.map((x) => ({ id: x.id, type: x.type, label: x.label, value: x.value, visibility: x.visibility }));
        const body = { tree, id: p.id, details, fields, revision: revision.current };
        await savePersonEdit({ data: { ...body, opKey: keys.for('edit', body) } });
        keys.clear('edit');
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['graph', tree] }),
          qc.invalidateQueries({ queryKey: ['person', tree, p.id] }),
          qc.invalidateQueries({ queryKey: ['contacts', tree] }),
        ]);
        form.reset(value);
        toast({ title: c('edit.savedTitle'), body: c('edit.savedBody', { name: p.given }), ms: 3500 });
        done();
      } catch (e) {
        // A refused field comes back as the validator's JSON; the reader gets a sentence instead.
        const msg = e instanceof Error ? e.message : '';
        // A server message that is one of ours (in person.server.ts) is shown in the reader's language.
        setSaveError(!msg ? c('edit.saveFailed') : msg.startsWith('[') ? c('edit.checkFields') : translateMessage(msg, c.locale));
        setStale(msg === CHANGED_SINCE_OPENED);
      }
    },
  });

  /**
   * Loads the person as it is now, and rebases the draft onto it: what the reader changed stays changed, the rest
   * takes the latest values, and the revision moves on. Where someone else changed the same thing, the reader's version
   * stays and both are listed for the reader to choose. The reader then checks it and saves again.
   */
  async function loadLatest() {
    setRebasing(true);
    setSaveError(null);
    try {
      const latest = await getEditSnapshot({ data: { tree, id: p.id } });
      const latestValues = valuesOf(latest);
      const { values, conflicts: found } = rebaseDraft<Values, DraftField>(base.current, form.state.values as Values, latestValues);
      base.current = latestValues;
      revision.current = latest.revision;
      for (const k of Object.keys(values) as (keyof Values)[]) form.setFieldValue(k, values[k] as never);
      setConflicts(found);
      setStale(false);
      setNotice(c('edit.rebased'));
    } catch {
      setSaveError(c('edit.saveFailed'));
    } finally {
      setRebasing(false);
    }
  }

  /** Settles one conflict: "mine" keeps the draft's version (already there); "theirs" takes the other person's. */
  function settle(k: Conflict<DraftField>, pick: 'mine' | 'theirs') {
    setConflicts((list) => list.filter((x) => x !== k));
    if (pick === 'theirs') applyTheirs([k]);
  }

  /** Settles every open conflict: "mine" keeps the draft as it is; "theirs" takes the other person's for each. */
  function settleAll(pick: 'mine' | 'theirs') {
    if (pick === 'theirs') applyTheirs(conflicts);
    setConflicts([]);
  }

  /** Takes the other person's version for each conflict in turn, then writes the changed parts of the form once. */
  function applyTheirs(list: Conflict<DraftField>[]) {
    let next = form.state.values as Values;
    for (const k of list) next = takeTheirs(next, k);
    const parts = new Set(list.flatMap((k) => (k.kind === 'value' ? k.keys : ['fields'])));
    for (const part of parts) form.setFieldValue(part as keyof Values, next[part as keyof Values] as never);
  }

  /** A scalar's value as the reader sees it. */
  const shown = (key: string, v: unknown): string => {
    if (key === 'bornPlace' || key === 'diedPlace') return (v as PlaceValue | undefined)?.name || c('edit.empty');
    if (key === 'sex') return c(v ? (`sex.${v}` as Key) : 'sex.unknown');
    if (typeof v === 'boolean') return c(v ? 'edit.yes' : 'edit.no');
    return typeof v === 'string' && v !== '' ? v : c('edit.empty');
  };
  const fieldShown = (x: DraftField | null) => (x ? fieldText(x.type, x.value) || c('edit.empty') : c('edit.gone'));
  /** A field's label and privacy, as the Edit tab shows them: a choice overwrites these too. */
  const fieldMeta = (x: DraftField) =>
    [c('edit.labelOf', { label: x.label ? presetLabel(x.label, c) : c('edit.empty') }), c(`field.vis.${x.visibility}` as Key)].join(' · ');
  const titleOf = (k: Conflict<DraftField>) => {
    if (k.kind === 'value') return c(LABEL[k.keys[0] ?? 'bio'] ?? 'edit.biography');
    const x = k.mine ?? k.theirs;
    const kind = x ? c(`type.${x.type}` as Key) : '';
    // The label goes in the title when both versions share it; otherwise each version's label is listed under it.
    const shared = !k.mine || !k.theirs || k.mine.label === k.theirs.label;
    return x?.label && shared ? `${kind} (${presetLabel(x.label, c)})` : kind;
  };
  const yoursOf = (k: Conflict<DraftField>) => (k.kind === 'value' ? shown(k.keys[0] ?? 'bio', k.mine[k.keys[0] ?? 'bio']) : fieldShown(k.mine));
  const theirsOf = (k: Conflict<DraftField>) => (k.kind === 'value' ? shown(k.keys[0] ?? 'bio', k.theirs[k.keys[0] ?? 'bio']) : fieldShown(k.theirs));

  const text = (name: keyof Values, label: string, opts: { placeholder?: string; wide?: boolean; autoComplete?: string } = {}) => (
    <form.Field name={name as never}>
      {(field: any) => (
        <label className={`field${opts.wide ? ' wide' : ''}`}>
          <span>{label}</span>
          <input
            className="input"
            value={field.state.value}
            placeholder={opts.placeholder}
            autoComplete={opts.autoComplete ?? 'off'}
            onChange={(e) => field.handleChange(e.target.value)}
          />
        </label>
      )}
    </form.Field>
  );
  const place = (name: 'bornPlace' | 'diedPlace', label: string) => (
    <form.Field name={name}>
      {(field) => (
        <div className="field">
          <span id={`edit-${name}-label`}>{label}</span>
          <PlaceInput tree={tree} value={field.state.value} onChange={(v: PlaceValue) => field.handleChange(v)} aria-labelledby={`edit-${name}-label`} />
        </div>
      )}
    </form.Field>
  );
  /** A date the picker writes: the picker checks its own segments, and the form refuses the save while one is wrong. */
  const dateChecks = { onChange: ({ value }: { value: string }) => (storedIssue(value, { notAfter: today }) ? c('date.err.invalid') : undefined) };

  return (
    <form className="pp-edit pe" onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      {/* Always mounted: it registers the draft with the panel's guard. Its own text is shown in the save bar instead. */}
      <span hidden><DraftTracker form={form} /></span>
      <div className="rule">{c('edit.names')}</div>
      <div className="pe-grid">
        {text('given', c('edit.givenAtBirth'))}
        {text('surname', c('edit.surnameAtBirth'))}
        <form.Field name="sameName">
          {(field) => (
            <div className="field check wide">
              <Switch
                checked={field.state.value}
                onChange={(on) => {
                  field.handleChange(on);
                  if (!on) {
                    form.setFieldValue('currentGiven', form.state.values.given);
                    form.setFieldValue('currentSurname', form.state.values.surname);
                  }
                }}
              >{c('edit.sameName')}</Switch>
            </div>
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.values.sameName}>
          {(same) => same ? null : (
            <>
              {text('currentGiven', c('edit.currentGiven'))}
              {text('currentSurname', c('edit.currentSurname'))}
            </>
          )}
        </form.Subscribe>
        {text('nickname', c('edit.nickname'), { placeholder: medieval ? c('edit.nicknameMedieval') : c('edit.nicknamePlaceholder'), wide: true })}
        <form.Field name="sex">
          {(field) => (
            <div className="field wide">
              <span id="edit-sex-label">{c('edit.sex')}</span>
              <Segmented
                aria-labelledby="edit-sex-label"
                block
                value={field.state.value}
                onChange={(v) => field.handleChange(v as Values['sex'])}
                options={[
                  { value: '', label: c('sex.unknown') }, { value: 'f', label: c('sex.f') }, { value: 'm', label: c('sex.m') }, { value: 'x', label: c('sex.x') },
                ]}
              />
            </div>
          )}
        </form.Field>
        {text('title', c('edit.title'), { placeholder: medieval ? c('edit.titleMedievalPlaceholder') : c('edit.titlePlaceholder'), wide: true })}
        {text('epithet', c('edit.epithet'), { placeholder: c('edit.epithetPlaceholder'), wide: true })}
        <form.Subscribe selector={(s) => s.values.sex}>
          {(sex) => (
            <form.Field name="occupation">
              {(field: any) => (
                <form.Field name="occupationCode">
                  {(code: any) => (
                    <div className="wide">
                      <OccupationField
                        label={c('edit.occupation')}
                        text={field.state.value}
                        code={code.state.value}
                        sex={(sex || undefined) as 'm' | 'f' | 'x' | undefined}
                        onChange={(next) => { field.handleChange(next.text); code.handleChange(next.code); }}
                      />
                    </div>
                  )}
                </form.Field>
              )}
            </form.Field>
          )}
        </form.Subscribe>
      </div>

      <div className="rule">{c('edit.lifeSection')}</div>
      <div className="pe-grid">
        <form.Subscribe selector={(s) => [s.values.living, s.values.born] as const}>
          {([living, born]) => (
            <>
              <form.Field name="born" validators={dateChecks}>
                {(field) => (
                  <DatePicker
                    label={c('edit.born')}
                    value={field.state.value}
                    onChange={(v) => field.handleChange(v)}
                    notAfter={today}
                    showAge={living}
                    minYear={minYear}
                    maxYear={thisYear}
                  />
                )}
              </form.Field>
              {place('bornPlace', c('edit.birthplace'))}
              <form.Field name="living">
                {(field) => (
                  <div className="field check wide">
                    <Switch checked={field.state.value} onChange={(v) => field.handleChange(v)}>{c('edit.living')}</Switch>
                  </div>
                )}
              </form.Field>
              {!living && (
                <>
                  <form.Field name="died" validators={{ onChange: ({ value }: { value: string }) => (storedIssue(value, { notBefore: periodOf(born)?.from }) ? c('date.err.invalid') : undefined) }}>
                    {(field) => (
                      <DatePicker
                        label={c('edit.died')}
                        value={field.state.value}
                        onChange={(v) => field.handleChange(v)}
                        notAfter={today}
                        notBefore={born || undefined}
                        notBeforeWhat={c('date.whatBirth')}
                        minYear={minYear}
                        maxYear={thisYear}
                      />
                    )}
                  </form.Field>
                  {place('diedPlace', c('edit.diedPlace'))}
                </>
              )}
            </>
          )}
        </form.Subscribe>
      </div>
      <form.Field name="fields">
        {(field) => <FieldEditor tree={tree} group="life" value={field.state.value} onChange={(v) => field.handleChange(v)} fam={f} self={p.id} />}
      </form.Field>

      <div className="rule">{c('group.contact')}</div>
      <form.Field name="fields">
        {(field) => <FieldEditor tree={tree} group="contact" value={field.state.value} onChange={(v) => field.handleChange(v)} fam={f} self={p.id} />}
      </form.Field>

      <div className="rule">{c('edit.biography')}</div>
      <form.Field name="bio">
        {(field) => (
          <div className="field wide">
            <MarkdownEditor tree={tree} label={c('edit.biography')} value={field.state.value} onChange={(v) => field.handleChange(v)} rows={6} />
          </div>
        )}
      </form.Field>

      <div className="rule">{c('edit.more')}</div>
      <form.Field
        name="fields"
        validators={{ onSubmit: ({ value }: { value: DraftField[] }) => (value.some((x) => fieldIssue(x.type, x.value)) ? c('edit.fixFields') : undefined) }}
      >
        {(field) => (
          <div className="wide">
            <FieldEditor tree={tree} group="more" addMenu value={field.state.value} onChange={(v) => field.handleChange(v)} fam={f} self={p.id} />
            {field.state.meta.errors.length ? <em className="err" role="alert">{field.state.meta.errors[0]}</em> : null}
          </div>
        )}
      </form.Field>

      {saveError && <em role="alert" className="err wide">{saveError}</em>}
      {stale && (
        <div className="wide">
          <button type="button" className="btn" onClick={() => void loadLatest()} disabled={rebasing}>{c('edit.loadLatest')}</button>
        </div>
      )}
      {notice && <p role="status" className="wide subtle">{notice}</p>}
      {conflicts.length > 0 && (
        <div className="wide edit-conflicts" role="group" aria-label={c('edit.conflictsIntro')}>
          <p className="subtle">{c('edit.conflictsIntro')}</p>
          <div className="edit-conflict-choices">
            <button type="button" className="btn" onClick={() => settleAll('mine')}>{c('edit.keepAllMine')}</button>
            <button type="button" className="btn" onClick={() => settleAll('theirs')}>{c('edit.useAllTheirs')}</button>
          </div>
          {conflicts.map((k) => (
            <div className="edit-conflict" key={k.kind === 'field' ? `field-${k.id}` : `value-${k.keys.join('+')}`}>
              <strong>{titleOf(k)}</strong>
              <span>{c('edit.yours', { value: yoursOf(k) })}</span>
              {k.kind === 'field' && k.mine && <span>{fieldMeta(k.mine)}</span>}
              <span>{c('edit.theirs', { value: theirsOf(k) })}</span>
              {k.kind === 'field' && k.theirs && <span>{fieldMeta(k.theirs)}</span>}
              <span className="edit-conflict-choices">
                <button type="button" className="btn" onClick={() => settle(k, 'mine')}>{c('edit.keepMine')}</button>
                <button type="button" className="btn" onClick={() => settle(k, 'theirs')}>{c('edit.useTheirs')}</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {canRemove && (
        <div className="wide pe-remove">
          <button
            type="button"
            className="btn ghost danger"
            disabled={remove.isPending}
            onClick={() => confirm(c('edit.removeConfirm', { name: p.given })) && remove.mutate()}
          >
            <Trash2 size={14} /> {c('edit.remove')}
          </button>
        </div>
      )}

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting, s.isDirty, s.values.born, s.values.died, s.values.living] as const}>
        {([ok, busy, dirty, born, died, living]) => (
          <div className="pe-bar wide" role="group" aria-label={c('edit.barLabel')}>
            <div className="pe-status" role="status" aria-live="polite">
              {conflicts.length > 0 ? (
                <span id="edit-choose-first" className="pe-state warn">{c('edit.chooseFirst')}</span>
              ) : busy ? (
                <span className="pe-state busy">{c('edit.saving')}</span>
              ) : dirty ? (
                <span className="pe-state dirty">{c('draft.unsaved')}</span>
              ) : (
                <span className="pe-state clean">{c('edit.allSaved')}</span>
              )}
            </div>
            <button type="button" className="btn ghost" onClick={() => leave(done)}>{c('edit.cancel')}</button>
            <button
              className="btn primary"
              disabled={!ok || busy || conflicts.length > 0 || datesBlocked(born, died, living, today)}
              aria-describedby={conflicts.length > 0 ? 'edit-choose-first' : undefined}
            >
              <Check size={14} /> {c('edit.save')}
            </button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}
