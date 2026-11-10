// The Edit tab: the names, the life dates and places, the contact details, the biography and the rest of the fields.
// Every change saves itself, after a short pause or on leaving the field, through the same revision-guarded save as ever
// (see autosave.ts for how and edit-values.ts for what). The line at the foot says how that is going and offers Undo. If
// someone else changed the person meanwhile, the draft is rebased on their version: what doesn't clash goes through by
// itself, and what does is shown for the reader to choose, with nothing written until they have. The draft and each rebase
// start from one consistent snapshot of the person (`editSnapshot`), so the draft never mixes values from one moment with a
// revision from another. With `only` set, the same form edits that one field in place on the Everyday tab.
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCw, Trash2, Undo2, X } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { opKeys, removePerson } from '~/lib/api';
import { getEditSnapshot, savePersonEdit } from '~/lib/person.functions';
import type { EditSnapshot } from '~/lib/person.server';
import { fullName, yearOf, type Family } from '~/lib/graph';
import { isoOfDate, periodOf, storedIssue } from '~/lib/partial-date';
import { useCan, useSession } from '~/lib/session';
import { toast } from '~/lib/toast';
import type { Graph, GPerson, GraphPatch, PersonDetail } from '~/lib/types';
import { patchPerson } from '~/lib/graph-patch';
import { PlaceInput, placeValue, savePlacesKeyed, type PlaceValue } from '../PlaceInput';
import { MarkdownEditor } from '../MarkdownEditor';
import { ConfirmDialog, DatePicker, Segmented, Switch } from '../ui';
import { classifyFailure, clearJournal, createAutosaver, journalKey, MAX_UNDO, nextAfter, readJournal, undoStep, writeJournal, type Outcome, type SaveState, type UndoStep } from '~/lib/fields/autosave';
import { DraftContext } from './draft';
import { keepShared, openDraft, sendable, signatureOf, storedForm, wireOf, type EditValues } from '~/lib/fields/edit-values';
import { draftOf, FieldEditor, type DraftField } from './FieldEditor';
import { fieldText } from '~/lib/fields/model';
import { rebaseDraft, takeTheirs, type Conflict } from '~/lib/fields/rebase';
import { translateMessage, useT, type Key } from '~/lib/i18n';
import { isKnownMessage } from '~/lib/i18n/dictionary';
import { MAX_FURTHER, MAX_FURTHER_LENGTH } from '~/lib/further-given';
import { OccupationField } from './OccupationField';
import { presetLabel } from '~/lib/fields/presets';
import './editor.css';

interface Props {
  tree: string;
  p: GPerson;
  f: Family;
  /** The panel's read of the person. Not used for the draft: the Edit tab loads its own snapshot, so it is never mixed. */
  detail: PersonDetail;
  done: () => void;
  onRemoved: () => void;
  /** A field's id: edit just that field, in place. */
  only?: string;
}

type Values = EditValues;

/** The form's values for a person as the server has them: the same for the first draft and for a rebase. */
function valuesOf(s: EditSnapshot): Values {
  // Names: a null current name means "same as birth", so the switch starts on when both are unset.
  const sameName = s.currentGiven == null && s.currentSurname == null;
  return {
    given: s.given, furtherGiven: s.furtherGiven, surname: s.surname ?? '', sameName,
    currentGiven: s.currentGiven ?? s.given, currentSurname: s.currentSurname ?? s.surname ?? '',
    nickname: s.nickname ?? '', sex: (s.sex ?? '') as '' | 'm' | 'f' | 'x',
    born: s.born ?? '', bornPlace: placeValue(s.bornPlace), died: s.died ?? '', diedPlace: placeValue(s.diedPlace), living: s.living,
    title: s.title ?? '', epithet: s.epithet ?? '', occupation: s.occupation ?? '', occupationCode: s.occupationCode ?? '', bio: s.bio ?? '',
    fields: s.fields.map(draftOf),
  };
}

/** The reader's words for the scalar a conflict names (a unit names its first key). */
const LABEL: Record<string, Key> = {
  given: 'edit.givenAtBirth', furtherGiven: 'edit.furtherGiven', surname: 'edit.surnameAtBirth', sameName: 'edit.sameName', currentGiven: 'edit.currentGiven',
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

/** Next and Done on the phone's keyboard, in the order the reader sees the fields. A textarea keeps its Enter for a new line. */
const TEXT_ENTRIES = 'input:not([type=hidden],[type=checkbox],[type=radio],[type=search],[type=file],[disabled],[readonly]),textarea:not([disabled],[readonly])';
const textEntries = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(TEXT_ENTRIES)].filter((el) => el.offsetParent !== null);

const deviceStore = () => { try { return window.localStorage; } catch { return undefined; } };

function EditForm({ tree, p, f, snap, done, onRemoved, only }: Omit<Props, 'detail'> & { snap: EditSnapshot }) {
  const { leave, register } = useContext(DraftContext);
  const c = useT();
  const words = useRef(c);
  words.current = c;
  const canRemove = useCan('remove-person');
  const medieval = tree === 'realm' || (!!snap.born && yearOf(snap.born) < 1500);
  const qc = useQueryClient();
  const today = isoOfDate(new Date());
  const thisYear = Number(today.slice(0, 4));
  const minYear = useMemo(() => earliestCentury(f), [f]);
  const account = useSession()?.user?.id ?? 'anonymous';
  const [draftKey] = useState(() => journalKey(account, tree, p.id));
  const [opened] = useState(() => openDraft(valuesOf(snap), readJournal<Values>(deviceStore(), draftKey, Date.now())));
  const [state, setState] = useState<SaveState>('saved');
  // Set once anything has been saved or is on its way, so the line stops explaining itself. A draft left on this device
  // counts even when the server already has it: its write landed as the page went away, and the reader never saw it confirmed.
  const [edited, setEdited] = useState(opened.leftOver);
  // Something typed that cannot be written yet: it stays in the form with its red mark.
  const [held, setHeld] = useState(false);
  // The server's own words for a refused write (translated when shown).
  const [refusal, setRefusal] = useState<string | null>(null);
  // Where the reader and someone else changed the same thing: each is shown, and the reader picks one.
  const [conflicts, setConflicts] = useState<Conflict<DraftField>[]>(opened.conflicts);
  const [undoCount, setUndoCount] = useState(0);
  const [focusKey, setFocusKey] = useState<string | null>(() => (only ? opened.start.fields.find((x) => x.id === only)?.key ?? null : null));
  const [keys] = useState(opKeys);
  const root = useRef<HTMLFormElement>(null);
  const conflictList = useRef<HTMLDivElement>(null);
  // What the server holds, as far as this draft knows, and the revision that is at. Each save moves both on, and so does
  // a rebase: it compares the reader's changes with what they last saw.
  const base = useRef<Values>(opened.base);
  const revision = useRef(snap.revision);
  // While a conflict is open, the version from before it. The draft on this device is kept against this one and not the
  // latest: otherwise, opened again, the reader's unchosen version would look like a plain edit and be written over theirs.
  const unchosen = useRef<Values | null>(opened.unchosen);
  const history = useRef<UndoStep<Values>[]>([]);
  // The write now owed comes from Undo, so it is not itself a change that can be undone.
  const undoing = useRef(false);
  const closing = useRef(false);
  const discarded = useRef(false);
  // The rest of the app reads the person afresh once the reader pauses, and not after every write.
  const touched = useRef(false);
  // The person as the last save left them, for patching the page's copy of the family; and whether a save also pinned a place,
  // which changes the family's places, so the family is read again instead.
  const patch = useRef<GraphPatch | undefined>(undefined);
  const pinned = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remove = useMutation({
    mutationFn: () => removePerson({ data: { tree, id: p.id } }),
    onSuccess: async () => {
      discarded.current = true;
      saver.pause();
      clearJournal(deviceStore(), draftKey);
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      onRemoved();
    },
  });
  const [askRemove, setAskRemove] = useState(false);
  // What leaves the tree with this person, counted, so the question names it instead of hinting at it.
  const links = (f.parentsOf.get(p.id)?.length ?? 0) + (f.childrenOf.get(p.id)?.length ?? 0) + (f.unionsOf.get(p.id)?.length ?? 0);
  const goes = [
    links ? c('edit.removeLinks', { count: links }) : '',
    p.stories ? c('edit.removeStories', { count: p.stories }) : '',
    snap.fields.length ? c('edit.removeDetails', { count: snap.fields.length }) : '',
    p.photo || p.portrait ? c('edit.removePhoto') : '',
  ].filter(Boolean);
  const form = useForm({ defaultValues: opened.start });
  const current = () => form.state.values as Values;
  const canWrite = (v: Values) => sendable(v, base.current, today);

  /** Puts a rebased or undone draft in the form: only the parts that differ, so the rest keep their state. */
  function applyValues(next: Values) {
    const now = current();
    for (const k of Object.keys(next) as (keyof Values)[]) {
      if (JSON.stringify(next[k]) !== JSON.stringify(now[k])) form.setFieldValue(k, next[k] as never);
    }
  }

  function refresh() {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
    if (!touched.current) return;
    touched.current = false;
    const patched = pinned.current ? null : patchPerson(qc.getQueryData<Graph>(['graph', tree]), p.id, patch.current);
    patch.current = undefined;
    pinned.current = false;
    if (patched) qc.setQueryData(['graph', tree], patched);
    else void qc.invalidateQueries({ queryKey: ['graph', tree] });
    void qc.invalidateQueries({ queryKey: ['person', tree, p.id] });
    void qc.invalidateQueries({ queryKey: ['contacts', tree] });
  }

  /** Keeps the draft on this device until the server has it, so a sleeping phone or a killed page loses nothing. */
  function remember(saver: { state: SaveState }) {
    if (discarded.current) return;
    if (saver.state === 'saved' && !canWrite(current()).held) clearJournal(deviceStore(), draftKey);
    else writeJournal(deviceStore(), draftKey, { at: Date.now(), revision: revision.current, base: unchosen.current ?? base.current, draft: current() });
  }

  async function write(v: Values): Promise<Outcome> {
    const sent = canWrite(v).values;
    setRefusal(null);
    try {
      // Pins first, and only a place that changed: repeating one on a retry changes nothing.
      const pin = (now: PlaceValue, was: PlaceValue) => (JSON.stringify(now) === JSON.stringify(was) ? undefined : now);
      const pins = [pin(sent.bornPlace, base.current.bornPlace), sent.living ? undefined : pin(sent.diedPlace, base.current.diedPlace)];
      await savePlacesKeyed(tree, (pl) => keys.for('places', pl), ...pins);
      // A pin with coordinates writes the family's places (savePlacesKeyed), which only a full read brings back.
      if (pins.some((v) => !!v?.name.trim() && v.lat !== undefined && v.lng !== undefined)) pinned.current = true;
      const body = { tree, id: p.id, ...wireOf(sent), revision: revision.current };
      const saved = await savePersonEdit({ data: { ...body, opKey: keys.for('edit', body) } });
      keys.clear('edit');
      // A field this save added is the reader's: the server recorded them as its author.
      const written = storedForm({ ...sent, fields: sent.fields.map((x, i) => ({ ...x, id: saved.fieldIds[i] ?? x.id, authored: x.authored || !x.id })) });
      if (undoing.current) {
        undoing.current = false;
      } else {
        history.current = [...history.current.slice(1 - MAX_UNDO), { before: base.current, after: written }];
        setUndoCount(history.current.length);
      }
      base.current = written;
      revision.current = saved.revision;
      patch.current = saved.person;
      touched.current = true;
      // A new field learns its id, so the next save updates it instead of adding it again.
      const ids = new Map(sent.fields.flatMap((x, i) => (!x.id && saved.fieldIds[i] ? [[x.key, saved.fieldIds[i]!] as const] : [])));
      if (ids.size) form.setFieldValue('fields', (list: DraftField[]) => list.map((x) => (!x.id && ids.has(x.key) ? { ...x, id: ids.get(x.key), authored: true } : x)));
      return 'saved';
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      const failure = classifyFailure(message, isKnownMessage);
      if (failure === 'stale') return reconcile();
      if (failure === 'refused') { setRefusal(message); return 'refused'; }
      throw e;
    }
  }

  /**
   * Someone else changed the person: loads them as they are now and rebases the draft. What the reader changed stays
   * changed, the rest takes the latest values, and where both changed the same thing the writing stops and both are listed.
   */
  async function reconcile(): Promise<Outcome> {
    // The form has gone: the draft on this device carries it to the next time the person is opened.
    if (closing.current) return 'conflict';
    const snapshot = await getEditSnapshot({ data: { tree, id: p.id } });
    const latest = valuesOf(snapshot);
    const { values, conflicts: found } = rebaseDraft<Values, DraftField>(base.current, current(), latest);
    if (found.length) unchosen.current = base.current;
    base.current = latest;
    revision.current = snapshot.revision;
    saver.baseline(latest);
    applyValues(values);
    setConflicts(found);
    if (!found.length) toast({ title: words.current('edit.rebased'), ms: 5000 });
    return found.length ? 'conflict' : 'again';
  }
  const [saver] = useState(() => createAutosaver<Values>({
    initial: opened.base,
    signature: (v) => signatureOf(canWrite(v).values),
    send: write,
    onState: (next) => {
      setState(next);
      if (next !== 'saved') setEdited(true);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = next === 'saved' ? setTimeout(refresh, 1200) : null;
      remember(saver);
    },
  }));

  // Every change in the form, from the first (a draft brought back from this device) on, goes to the saver.
  useEffect(() => {
    closing.current = false;
    saver.open();
    let seen: unknown;
    const push = () => {
      const values = current();
      if (values === seen) return;
      seen = values;
      setHeld(canWrite(values).held);
      saver.change(values);
      remember(saver);
      if (only && !values.fields.some((x) => x.id === only || x.key === focusKey)) done();
    };
    if (opened.conflicts.length) saver.pause();
    push();
    const sub = form.store.subscribe(push);
    if (opened.restored) {
      // A draft brought back with something in it that cannot be saved: say so, and bring that field into view.
      const stuck = canWrite(current()).held;
      toast({ title: words.current('edit.restored'), body: words.current(stuck ? 'edit.restoredFix' : 'edit.restoredBody'), ms: 8000 });
      if (stuck) requestAnimationFrame(() => requestAnimationFrame(() => showIssue(false)));
    }
    // The phone going to sleep or the page going away is a reason to write now; coming back is a reason to try again.
    const hidden = () => { if (document.visibilityState === 'hidden') void saver.flush(); else saver.wake(); };
    const leaving = () => void saver.flush();
    const online = () => saver.wake();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leaving);
    window.addEventListener('online', online);
    return () => {
      sub.unsubscribe();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leaving);
      window.removeEventListener('online', online);
      closing.current = true;
      if (discarded.current) return;
      // The form closes mid-save: the write finishes on its own, and if it can't, the draft on this device is still there.
      void saver.close().finally(refresh);
    };
    // Once for the form's life: the saver, the form and the refs do not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A conflict stops the writing; the last choice starts it again.
  useEffect(() => {
    if (conflicts.length) { saver.pause(); return; }
    unchosen.current = null;
    if (saver.state === 'paused') saver.resume();
  }, [conflicts.length, saver]);

  const unresolved = conflicts.length > 0 || state === 'failed' || held;
  useEffect(() => {
    register({
      dirty: unresolved,
      busy: false,
      save: async () => (await saver.flush()) && !canWrite(current()).held,
      discard: () => { discarded.current = true; saver.pause(); clearJournal(deviceStore(), draftKey); },
    });
    // canWrite and current read refs; only `unresolved` changes what the panel is told.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolved, register, saver, draftKey]);
  useEffect(() => () => register(null), [register]);

  // The phone's keyboard offers Next, and Done on the last field. Set here because the date picker and the place box are
  // shared with forms that have no next field.
  useEffect(() => {
    const form = root.current;
    if (!form) return;
    const stamp = () => {
      const all = textEntries(form);
      all.forEach((el, i) => { if (el.tagName === 'INPUT') el.setAttribute('enterkeyhint', i === all.length - 1 ? 'done' : 'next'); });
    };
    stamp();
    const watch = new MutationObserver(stamp);
    watch.observe(form, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);

  /** Next on the keyboard: the field after this one. A popup that took the Enter has already called preventDefault. */
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== 'Enter' || e.defaultPrevented || e.shiftKey || e.nativeEvent.isComposing) return;
    const from = e.target as HTMLElement;
    // A popup drawn outside the form (the map pin's box) still bubbles here; its Enter is its own.
    if (from.tagName !== 'INPUT' || !from.matches(TEXT_ENTRIES) || !root.current?.contains(from)) return;
    e.preventDefault();
    const next = root.current && nextAfter(textEntries(root.current), from);
    if (next) next.focus(); else from.blur();
  }

  /** Leaving a field writes it. The date picker's own parts count as one field, so a half-typed date is not a change yet. */
  function onLeaveField(e: FocusEvent<HTMLFormElement>) {
    const picker = (e.target as Element).closest('.dp');
    if (picker && picker.contains(e.relatedTarget as Node | null)) return;
    void saver.flush();
  }

  /** Brings the first field marked in red into view, so "check the fields marked in red" never means a search. */
  function showIssue(focus = true) {
    const mark = root.current?.querySelector<HTMLElement>('[aria-invalid="true"], .err');
    if (!mark) return;
    mark.scrollIntoView({ block: 'center' });
    if (focus) (mark.matches('input, textarea') ? mark : mark.closest('.field, .dp')?.querySelector<HTMLElement>('input, textarea'))?.focus({ preventScroll: true });
  }

  /** The way out of a value that cannot be saved: the form goes back to what the server has. Saved changes stay. */
  function dropUnsaved() {
    applyValues(base.current);
  }

  /** Takes back the last saved change. Disabled while a write is owed, so it always means the change the reader last saw saved. */
  function undo() {
    const step = history.current[history.current.length - 1];
    if (!step || saver.state !== 'saved') return;
    history.current = history.current.slice(0, -1);
    setUndoCount(history.current.length);
    undoing.current = true;
    const { values: undone, conflicts: found } = undoStep<Values, DraftField>(step, current());
    const values = keepShared(undone, base.current);
    if (values !== undone) toast({ title: words.current('field.vis.staysShared'), ms: 6000 });
    applyValues(values);
    if (found.length) { undoing.current = false; setConflicts(found); return; }
    void saver.flush().then((ok) => { if (ok) undoing.current = false; });
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
    if (Array.isArray(v)) return v.filter(Boolean).join(', ') || c('edit.empty');
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

  const text = (name: keyof Values, label: string, opts: { placeholder?: string; wide?: boolean; autoComplete?: string; words?: boolean; required?: boolean } = {}) => (
    <form.Field name={name as never}>
      {(field: any) => (
        <label className={`field${opts.wide ? ' wide' : ''}`}>
          <span>{label}</span>
          <input
            className="input"
            value={field.state.value}
            placeholder={opts.placeholder}
            autoComplete={opts.autoComplete ?? 'off'}
            autoCapitalize={opts.words ? 'words' : undefined}
            aria-required={opts.required || undefined}
            aria-invalid={opts.required && !field.state.value.trim() ? true : undefined}
            aria-describedby={opts.required && !field.state.value.trim() ? `pe-issue-${String(name)}` : undefined}
            onChange={(e) => field.handleChange(e.target.value)}
          />
          {opts.required && !field.state.value.trim() && <em className="err fe-issue" id={`pe-issue-${String(name)}`} role="status">{c('issue.required')}</em>}
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

  const conflictBlock = conflicts.length > 0 && (
    <div className="wide edit-conflicts" role="group" aria-label={c('edit.conflictsIntro')} ref={conflictList}>
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
  );

  const statusText = conflicts.length > 0 ? <span className="pe-state warn">{c('edit.chooseFirst')}</span>
    : state === 'failed' ? <span className="pe-state warn">{refusal ? (refusal.startsWith('[') ? c('edit.checkFields') : translateMessage(refusal, c.locale)) : c('edit.saveStuck')}</span>
    : state === 'retrying' ? <span className="pe-state warn">{c('edit.retrying')}</span>
    : state === 'saving' || state === 'waiting' ? <span className="pe-state busy">{c('edit.saving')}</span>
    : held ? <span className="pe-state warn">{c('edit.fixFields')}</span>
    : edited ? <span className="pe-state clean">{c('edit.allSaved')}</span>
    : <span className="pe-state hint">{c('edit.autosaveHint')}</span>;

  const statusLine = (
    <div className="pe-bar wide" role="group" aria-label={c('edit.barLabel')}>
      <div className="pe-status" role="status" aria-live="polite">{statusText}</div>
      {conflicts.length > 0 && <button type="button" className="btn ghost" onClick={() => conflictList.current?.scrollIntoView({ block: 'center' })}>{c('edit.showConflicts')}</button>}
      {held && !conflicts.length && <button type="button" className="btn ghost" onClick={() => showIssue()}>{c('edit.showIssue')}</button>}
      {held && !conflicts.length && <button type="button" className="btn ghost" onClick={dropUnsaved}><Undo2 size={14} aria-hidden /> {c('edit.dropUnsaved')}</button>}
      {state === 'failed' && <button type="button" className="btn ghost" onClick={() => void saver.retry()}><RotateCw size={14} aria-hidden /> {c('ui.retry')}</button>}
      {undoCount > 0 && !conflicts.length && <button type="button" className="btn ghost" disabled={state !== 'saved'} onClick={undo}><Undo2 size={14} aria-hidden /> {c('edit.undo')}</button>}
      {only && <button type="button" className="btn" onClick={() => leave(done)}>{c('edit.done')}</button>}
    </div>
  );

  const formProps = { ref: root, noValidate: true, onSubmit: (e: { preventDefault: () => void }) => { e.preventDefault(); void saver.flush(); }, onKeyDown, onBlur: onLeaveField };

  if (only) {
    return (
      <form className="pp-edit pe pe-inline" {...formProps}>
        <form.Field name="fields">
          {(field) => <FieldEditor tree={tree} group="more" only={only} focusKey={focusKey} value={field.state.value} onChange={(v) => field.handleChange(v)} fam={f} self={p.id} />}
        </form.Field>
        {conflictBlock}
        {statusLine}
      </form>
    );
  }

  return (
    <form className="pp-edit pe" {...formProps}>
      <div className="rule">{c('edit.names')}</div>
      <div className="pe-grid">
        {text('given', c('edit.givenAtBirth'), { words: true, required: true })}
        {text('surname', c('edit.surnameAtBirth'), { words: true })}
        <form.Field name="furtherGiven">
          {(field) => (
            <div className="field wide pe-further">
              {field.state.value.map((name, i) => (
                <div key={i} className="pe-further-row">
                  <label className="field">
                    <span>{c('edit.furtherGivenRow', { n: i + 2 })}</span>
                    <input
                      className="input"
                      value={name}
                      autoComplete="off"
                      autoCapitalize="words"
                      maxLength={MAX_FURTHER_LENGTH}
                      onChange={(e) => field.handleChange(field.state.value.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn ghost"
                    aria-label={c('edit.removeGiven', { n: i + 2 })}
                    title={c('edit.removeGiven', { n: i + 2 })}
                    onClick={() => field.handleChange(field.state.value.filter((_, j) => j !== i))}
                  >
                    <X size={14} aria-hidden />
                  </button>
                </div>
              ))}
              {field.state.value.length < MAX_FURTHER && (
                <button type="button" className="btn ghost pe-further-add" onClick={() => field.handleChange([...field.state.value, ''])}>
                  <Plus size={14} aria-hidden /> {c('edit.addGiven')}
                </button>
              )}
            </div>
          )}
        </form.Field>
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
              {text('currentGiven', c('edit.currentGiven'), { words: true, required: true })}
              {text('currentSurname', c('edit.currentSurname'), { words: true })}
            </>
          )}
        </form.Subscribe>
        {text('nickname', c('edit.nickname'), { placeholder: medieval ? c('edit.nicknameMedieval') : c('edit.nicknamePlaceholder'), wide: true, words: true })}
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
        {(field) => <FieldEditor tree={tree} group="life" focusKey={focusKey} value={field.state.value} onChange={(v) => field.handleChange(v)} fam={f} self={p.id} />}
      </form.Field>

      <div className="rule">{c('group.contact')}</div>
      <form.Field name="fields">
        {(field) => <FieldEditor tree={tree} group="contact" focusKey={focusKey} value={field.state.value} onChange={(v) => field.handleChange(v)} fam={f} self={p.id} />}
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
      <form.Field name="fields">
        {(field) => (
          <div className="wide">
            <FieldEditor tree={tree} group="more" addMenu focusKey={focusKey} onAdded={setFocusKey} value={field.state.value} onChange={(v) => field.handleChange(v)} fam={f} self={p.id} />
          </div>
        )}
      </form.Field>

      {conflictBlock}

      {canRemove && (
        <div className="wide pe-remove">
          <button
            type="button"
            className="btn ghost danger"
            disabled={remove.isPending}
            onClick={() => { remove.reset(); setAskRemove(true); }}
          >
            <Trash2 size={14} /> {c('edit.remove')}
          </button>
          <ConfirmDialog
            open={askRemove}
            onClose={() => setAskRemove(false)}
            onConfirm={() => remove.mutate()}
            title={c('edit.removeTitle', { name: fullName(p) })}
            confirmLabel={c('edit.removeYes', { name: p.given })}
            busy={remove.isPending}
            error={remove.isError ? c('edit.removeFailed') : undefined}
          >
            {goes.length ? (
              <>
                <p>{c('edit.removeGoes')}</p>
                <ul>{goes.map((line) => <li key={line}>{line}</li>)}</ul>
              </>
            ) : null}
            <p>{c('edit.removeStays')}</p>
            <p className="subtle">{c('edit.removeForGood')}</p>
          </ConfirmDialog>
        </div>
      )}

      {statusLine}
    </form>
  );
}
