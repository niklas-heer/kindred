// Adding a relative from the "+" marks: a tiny form, prefilled where we can guess, saved with ↵.
// Or linking someone already in the tree: the people who can't be that relative (a third parent, a
// child born before the parent, someone who already is that relative) are marked and can't be picked.
import { useForm, useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { addRelative, linkRelative, opKeys, unlinkRelative } from '~/lib/api';
import { isoOfDate, storedIssue } from '~/lib/partial-date';
import { useMeChosen } from '~/lib/family';
import { ancestorDepths, children, descendants, displayName, parents, partnersOf, siblings, yearOf, type Family } from '~/lib/graph';
import { translateMessage, translateParts, useT, type Key, type Translator, type Vars } from '~/lib/i18n';
import { foldName } from '~/lib/search';
import { useCan } from '~/lib/session';
import { play } from '~/lib/sfx';
import { toast } from '~/lib/toast';
import type { AddRelation } from './Card';
import { PersonRow, searchPeople } from './Palette';
import { PlaceInput, placeValue, savePlacesKeyed, type PlaceValue } from './PlaceInput';
import { Dialog } from './ui/Dialog';
import { DatePicker } from './ui/DatePicker';
import { Select } from './ui/Select';
import { Switch } from './ui/Switch';
import './quickadd.css';

/** A message for a person to read, kept as data so the component translates it: `t(key, vars)`. */
export interface Msg { key: Key; vars?: Vars }
const msg = (key: Key, vars?: Vars): Msg => ({ key, vars });

const TITLE: Record<AddRelation, Key> = { parent: 'quick.add.parent', child: 'quick.add.child', partner: 'quick.add.partner', sibling: 'quick.add.sibling' };
const RELATION_WORD: Record<AddRelation, Key> = { parent: 'quick.rel.parent', child: 'quick.rel.child', partner: 'quick.rel.partner', sibling: 'quick.rel.sibling' };

// ---------- who can be linked ----------

/** Whether someone can be linked as this relative, and how likely it is. */
export interface Verdict {
  ok: boolean;
  /** Why they can't be linked. */
  why?: Msg;
  /** Allowed, but worth a second look ("only 9 years older"). */
  warn?: Msg;
  /** Higher is more plausible: age fit, minus a little for a warning. */
  fit: number;
}

/** About how many years older a parent is than their child: where the age fit is best. */
const GENERATION = 28;

/**
 * The checks the server makes (a third parent, a child born before the parent, a loop, a link that
 * already exists), and a few it leaves to judgement (a sibling as a child, a big age gap).
 */
export function linkVerdict(f: Family, anchor: string, relation: AddRelation, id: string, opts: { coParent?: string; anc?: Map<string, number>; desc?: Set<string> } = {}): Verdict {
  const a = f.byId.get(anchor);
  const p = f.byId.get(id);
  if (!a || !p) return { ok: false, why: msg('quick.v.notInTree'), fit: -100 };
  const name = a.given;
  const no = (why: Msg): Verdict => ({ ok: false, why, fit: -100 });
  if (id === anchor) return no(msg('quick.v.self', { name }));
  const anc = opts.anc ?? ancestorDepths(f, anchor);
  const desc = opts.desc ?? descendants(f, anchor);
  const ay = yearOf(a.born);
  const py = yearOf(p.born);
  const older = ay - py; // how much older p is than the anchor; NaN when either is unknown
  const known = !isNaN(older);
  const blood = (): Msg | undefined =>
    parents(f, anchor).includes(id) ? msg('quick.v.isParent', { name }) : children(f, anchor).includes(id) ? msg('quick.v.isChild', { name }) :
    siblings(f, anchor).includes(id) ? msg('quick.v.isSibling', { name }) : anc.has(id) ? msg('quick.v.isAncestor', { name }) : desc.has(id) ? msg('quick.v.isDescendant', { name }) : undefined;
  let warn: Msg | undefined;
  let expect = 0;

  if (relation === 'parent') {
    if (parents(f, anchor).includes(id)) return no(msg('quick.v.alreadyParent', { name }));
    if (parents(f, anchor).length >= 2) return no(msg('quick.v.twoParents', { name }));
    if (desc.has(id)) return no(children(f, anchor).includes(id) ? msg('quick.v.isChild', { name }) : msg('quick.v.isDescendant', { name }));
    if (siblings(f, anchor).includes(id)) return no(msg('quick.v.isSibling', { name }));
    if (known && older <= 0) return no(older === 0 ? msg('quick.v.sameYear', { name }) : msg('quick.v.bornAfter', { name }));
    if (known && older < 13) warn = msg('quick.v.olderOnly', { count: older, name });
    else if (known && older > 60) warn = msg('quick.v.olderYears', { count: older, name });
    expect = GENERATION;
  } else if (relation === 'child') {
    if (children(f, anchor).includes(id)) return no(msg('quick.v.alreadyChild', { name }));
    if (anc.has(id)) return no(parents(f, anchor).includes(id) ? msg('quick.v.isParent', { name }) : msg('quick.v.isAncestor', { name }));
    if (siblings(f, anchor).includes(id)) return no(msg('quick.v.isSibling', { name }));
    if (partnersOf(f, anchor).includes(id)) return no(msg('quick.v.isPartner', { name }));
    if (known && older >= 0) return no(older === 0 ? msg('quick.v.sameYear', { name }) : msg('quick.v.bornBefore', { name }));
    const co = opts.coParent && opts.coParent !== anchor ? f.byId.get(opts.coParent) : undefined;
    if (co && !isNaN(yearOf(co.born)) && !isNaN(py) && py <= yearOf(co.born)) return no(msg('quick.v.bornBefore', { name: co.given }));
    const after = new Set([...parents(f, id), anchor, ...(co ? [co.id] : [])]);
    if (after.size > 2) return no(parents(f, id).length >= 2 ? msg('quick.v.twoParents', { name: p.given }) : msg('quick.v.anotherParent', { name: p.given }));
    if (known && -older < 13) warn = msg('quick.v.youngerOnly', { count: -older, name });
    else if (known && -older > 60) warn = msg('quick.v.youngerYears', { count: -older, name });
    expect = -GENERATION;
  } else if (relation === 'sibling') {
    const ps = parents(f, anchor);
    if (!ps.length) return no(msg('quick.v.recordParents', { name }));
    if (ps.every((x) => parents(f, id).includes(x))) return no(msg('quick.v.alreadySibling', { name }));
    const rel = anc.has(id) || desc.has(id) ? blood() : undefined;
    if (rel) return no(rel);
    if (new Set([...parents(f, id), ...ps]).size > 2) return no(msg('quick.v.otherParents', { name: p.given }));
    const tooOld = ps.map((x) => f.byId.get(x)).find((x) => x && !isNaN(yearOf(x.born)) && !isNaN(py) && py <= yearOf(x.born));
    if (tooOld) return no(msg('quick.v.bornBefore', { name: tooOld.given }));
    if (known && Math.abs(older) > 25) warn = msg('quick.v.apart', { count: Math.abs(older), name });
  } else {
    if (partnersOf(f, anchor).includes(id)) return no(msg('quick.v.alreadyPartner', { name }));
    const rel = blood();
    if (rel) return no(rel);
    if (known && Math.abs(older) > 25) warn = msg('quick.v.apart', { count: Math.abs(older), name });
  }
  // Each ten years from the likely age costs a point; a warning costs two.
  const fit = (known ? -Math.abs(older - expect) / 10 : -1) - (warn ? 2 : 0);
  return { ok: true, warn, fit };
}

/** Who might be meant before anything is typed: a partner's children for a child, and so on. */
function likely(f: Family, anchor: string, relation: AddRelation, coParent?: string): string[] {
  const mine = new Set(relation === 'child' ? children(f, anchor) : relation === 'parent' ? parents(f, anchor) : relation === 'partner' ? partnersOf(f, anchor) : siblings(f, anchor));
  const out =
    relation === 'child' ? (coParent ? [coParent] : partnersOf(f, anchor)).flatMap((x) => children(f, x)) :
    relation === 'parent' ? parents(f, anchor).flatMap((x) => partnersOf(f, x)) :
    relation === 'partner' ? children(f, anchor).flatMap((c) => parents(f, c)).filter((x) => x !== anchor) :
    parents(f, anchor).flatMap((x) => partnersOf(f, x)).flatMap((x) => children(f, x));
  return [...new Set(out)].filter((x) => x !== anchor && !mine.has(x));
}

/**
 * People already in the tree who could be this relative: name matches ranked by how plausible they
 * are, the impossible ones last and disabled with the reason. Rows are the palette's person row.
 */
export function LinkCandidates({ f, tree, anchor, relation, query, surname, coParent, selected, onPick, limit = 8, born, prefer, label }: {
  f: Family; tree: string; anchor: string; relation: AddRelation; query: string; coParent?: string; selected?: string;
  onPick: (id: string) => void; limit?: number;
  /** A surname typed beside the name: not required to match, but a match ranks first. */
  surname?: string;
  /** A birth year typed for a new person: only near matches count as a likely duplicate. */
  born?: string;
  /** The sex the slot asks for (Blaze's Father or Mother): a match of the other sex ranks lower. */
  prefer?: 'm' | 'f';
  label?: string;
}) {
  const t = useT();
  const who = useMeChosen();
  const anc = useMemo(() => ancestorDepths(f, anchor), [f, anchor]);
  const desc = useMemo(() => descendants(f, anchor), [f, anchor]);
  const myAnc = useMemo(() => (who ? ancestorDepths(f, who) : undefined), [f, who]);
  const rows = useMemo(() => {
    const q = query.trim();
    const pool = q ? searchPeople(f, q, 60) : likely(f, anchor, relation, coParent).map((id) => ({ id, score: 10 }));
    const by = !born || storedIssue(born) ? NaN : yearOf(born);
    const fs = foldName(surname ?? '');
    return pool
      .filter(({ id }) => id !== anchor && (isNaN(by) || isNaN(yearOf(f.byId.get(id)?.born)) || Math.abs(yearOf(f.byId.get(id)!.born) - by) <= 1))
      .map(({ id, score }) => {
        const v = linkVerdict(f, anchor, relation, id, { coParent, anc, desc });
        const sex = f.byId.get(id)?.sex;
        const off = prefer && sex && sex !== 'x' && sex !== prefer;
        const same = !!fs && foldName(f.byId.get(id)?.surname ?? '').startsWith(fs);
        return { id, v: off && v.ok ? { ...v, warn: v.warn ?? msg(sex === 'f' ? 'quick.v.recordedFemale' : 'quick.v.recordedMale'), fit: v.fit - 3 } : v, rank: score + v.fit - (off ? 3 : 0) + (same ? 6 : 0) };
      })
      .sort((a, b) => Number(b.v.ok) - Number(a.v.ok) || b.rank - a.rank)
      .slice(0, limit);
  }, [f, anchor, relation, query, surname, coParent, born, prefer, anc, desc, limit]);

  if (!rows.length) return query.trim() ? <p className="subtle qa-none">{t('quick.nobodyNamed')}</p> : null;
  return (
    <div className="qa-candidates" role="group" aria-label={label ?? t('quick.candidatesAria')}>
      {rows.map(({ id, v }) => (
        <button
          key={id}
          type="button"
          className="palette-item qa-candidate"
          data-warn={v.warn ? true : undefined}
          aria-pressed={selected === id}
          aria-disabled={!v.ok || undefined}
          title={say(t, v.why ?? v.warn)}
          onClick={() => v.ok && onPick(id)}
        >
          <PersonRow f={f} tree={tree} id={id} who={who} anc={myAnc} note={say(t, v.why ?? v.warn)} />
          {selected === id && <Check size={15} className="qa-tick" aria-hidden />}
        </button>
      ))}
    </div>
  );
}

/** A verdict's message, in the reader's language. */
const say = (t: Translator, m: Msg | undefined): string | undefined => (m ? t(m.key, m.vars) : undefined);

/** The surname a new child most likely gets: the one the existing children share, else the father's. */
function childSurname(f: Family, anchor: string, coParent: string): string {
  const a = f.byId.get(anchor)!;
  const shared = (ids: string[]) => {
    const names = [...new Set(ids.map((id) => f.byId.get(id)?.surname).filter(Boolean))];
    return ids.length && names.length === 1 ? names[0]! : undefined;
  };
  const kids = children(f, anchor);
  const together = coParent ? kids.filter((c) => parents(f, c).includes(coParent)) : kids;
  const co = coParent ? f.byId.get(coParent) : undefined;
  const father = a.sex === 'f' && co?.sex === 'm' ? co : a.sex === 'm' ? a : undefined;
  return shared(together) ?? shared(kids) ?? father?.surname ?? a.surname ?? '';
}

// ---------- the dialog ----------

export function QuickAdd({ family: f, tree, anchor, relation, sex, onDone, onLinked, onCancel }: {
  family: Family; tree: string; anchor: string; relation: AddRelation; sex?: 'm' | 'f';
  onDone: (id: string, person: { given: string; sex?: string }) => void;
  /** After linking someone already in the tree: pan to them. Without it, the tree is centred on them. */
  onLinked?: (id: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [linking, setLinking] = useState(false);
  const [partnerKind, setPartnerKind] = useState<'marriage' | 'partnership' | 'other'>('partnership');
  const [start, setStart] = useState('');
  const [place, setPlace] = useState<PlaceValue>(placeValue());
  // One key per attempt, kept for a retry: a save whose answer got lost is never written twice.
  const [keys] = useState(opKeys);
  const search = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canUnlink = useCan('edit-person');
  const a = f.byId.get(anchor)!;
  const partners = partnersOf(f, anchor).map((id) => f.byId.get(id)!).filter(Boolean);
  const firstCo = relation === 'child' && partners.length === 1 ? partners[0].id : '';
  const form = useForm({
    defaultValues: {
      given: '',
      // A child takes the surname its brothers and sisters share; a father usually passes his on; a mother's birth name is usually different.
      surname: relation === 'child' ? childSurname(f, anchor, firstCo) : relation === 'sibling' || (relation === 'parent' && sex !== 'f') ? (a.surname ?? '') : '',
      sex: (sex ?? '') as '' | 'm' | 'f' | 'x',
      born: '',
      living: a.living,
      coParent: firstCo,
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const partnership = relation === 'partner' ? { kind: partnerKind, start: start || undefined, place: place.name.trim() || undefined } : undefined;
        if (relation === 'partner') await savePlacesKeyed(tree, (p) => keys.for('places', p), place);
        const data = {
          tree, anchor, relation, partnership,
          coParent: value.coParent || undefined,
          person: { given: value.given.trim(), surname: value.surname.trim() || undefined, sex: value.sex || undefined, born: value.born.trim() || undefined, living: value.living },
        };
        const id = await addRelative({ data: { ...data, opKey: keys.for('add', data) } });
        await qc.invalidateQueries({ queryKey: ['graph', tree] });
        onDone(id, { given: value.given, sex: value.sex || undefined });
      } catch (e) {
        setError(e instanceof Error ? translateMessage(e.message, t.locale) : t('quick.error.couldNotAdd'));
      }
    },
  });
  const date = ({ value }: { value: string }) => (storedIssue(value.trim(), { notAfter: isoOfDate(new Date()) }) ? t('date.err.invalid') : undefined);
  const given = useStore(form.store, (s) => s.values.given);
  const born = useStore(form.store, (s) => s.values.born);
  const coParent = useStore(form.store, (s) => s.values.coParent);
  const dirty = useStore(form.store, (s) => s.isDirty) || !!query || !!selected || !!start || !!place.name || partnerKind !== 'partnership';
  const submitting = useStore(form.store, (s) => s.isSubmitting);
  const busy = submitting || linking;

  // Switching to "link someone" puts the cursor in the search.
  const switched = useRef(false);
  useEffect(() => {
    if (!switched.current) { switched.current = true; return; }
    if (mode === 'existing') requestAnimationFrame(() => search.current?.focus());
  }, [mode]);

  const saveLink = async () => {
    if (!selected || busy) return;
    const person = f.byId.get(selected);
    const v = linkVerdict(f, anchor, relation, selected, { coParent: form.state.values.coParent || undefined });
    if (!v.ok) return setError(say(t, v.why) ?? t('quick.error.cantLink'));
    setLinking(true);
    setError(null);
    try {
      const partnership = relation === 'partner' ? { kind: partnerKind, start: start || undefined, place: place.name.trim() || undefined } : undefined;
      if (relation === 'partner') await savePlacesKeyed(tree, (p) => keys.for('places', p), place);
      const data = { tree, anchor, relation, person: selected, coParent: relation === 'child' ? form.state.values.coParent || undefined : undefined, partnership };
      const made = await linkRelative({ data: { ...data, opKey: keys.for('link', data) } });
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      play('chime');
      toast({
        title: t('quick.linked', { name: person?.given ?? t('quick.they'), who: a.given, rel: t(RELATION_WORD[relation]) }),
        body: t('quick.linkedBody'),
        person: selected,
        ms: 9000,
        // Linked the wrong person? Undo takes away only what this link added.
        action: !canUnlink || (!made.parents.length && !made.partnership) ? undefined : {
          label: t('quick.undo'),
          run: async () => {
            try {
              await unlinkRelative({ data: { tree, parents: made.parents, partnership: made.partnership } });
              await qc.invalidateQueries({ queryKey: ['graph', tree] });
              play('page');
            } catch (e) {
              toast({ title: t('quick.undoFailed'), body: e instanceof Error ? translateMessage(e.message, t.locale) : t('quick.undoBody') });
            }
          },
        },
      });
      if (onLinked) onLinked(selected);
      else void navigate({ to: '/$tree', params: { tree }, search: (s: Record<string, unknown>) => ({ ...s, focus: selected, sel: selected }) } as never);
      onCancel();
    } catch (e) {
      setError(e instanceof Error ? translateMessage(e.message, t.locale) : t('quick.error.couldNotLink'));
    } finally {
      setLinking(false);
    }
  };
  const formId = useId();
  const pick = (id: string) => { setSelected(id); setMode('existing'); setQuery((q) => q || displayName(f.byId.get(id)!, f)); setError(null); };

  return (
    <Dialog
      open
      onClose={() => { if (!busy) onCancel(); }}
      dismissible={!busy}
      variant="event"
      width={520}
      dirty={dirty && !busy}
      // The words around the name are the small line above it, in whichever order the language puts them.
      title={<>{translateParts(t.locale, TITLE[relation], ['name']).map((part, i) => (typeof part === 'string' ? <span key={i} className="qa-what">{part}</span> : <Fragment key={i}>{displayName(a, f)}</Fragment>))}</>}
      footer={
        <>
          {error ? <span className="err qa-note" role="alert">{error}</span> : <span className="subtle qa-note">{mode === 'existing' ? t('quick.note.existing') : t('quick.note.new')}</span>}
          <button className="btn primary qa-submit" form={formId} disabled={busy || (mode === 'existing' && !selected) || !!storedIssue(start)}><Check size={14} /> {mode === 'existing' ? t('quick.submit.existing') : t('quick.submit.new')} <kbd>↵</kbd></button>
        </>
      }
    >
      <form
        id={formId}
        className="qa"
        onSubmit={(e) => { e.preventDefault(); if (busy) return; if (mode === 'existing') void saveLink(); else void form.handleSubmit(); }}
      >
        <div className="qa-modes" role="group" aria-label={t('quick.modesAria')}>
          <button type="button" className="btn" aria-pressed={mode === 'new'} disabled={busy} onClick={() => { setMode('new'); setError(null); }}>{t('quick.mode.new')}</button>
          <button type="button" className="btn" aria-pressed={mode === 'existing'} disabled={busy} onClick={() => { setMode('existing'); setError(null); }}>{t('quick.mode.existing')}</button>
        </div>
        <fieldset disabled={busy} className="qa-fields">
          {mode === 'existing' && (
            <>
              <label className="field">
                <span>{t('quick.search')}</span>
                <input ref={search} data-autofocus className="input" value={query} placeholder={t('quick.searchPlaceholder')} onChange={(e) => { setQuery(e.target.value); setSelected(''); }} />
              </label>
              <div className="qa-matches" aria-live="polite">
                {!query.trim() && <span className="subtle qa-hint">{likely(f, anchor, relation, coParent || undefined).length ? t('quick.perhaps') : t('quick.typeName')}</span>}
                <LinkCandidates f={f} tree={tree} anchor={anchor} relation={relation} query={query} coParent={relation === 'child' ? coParent || undefined : undefined} selected={selected} onPick={pick} />
              </div>
            </>
          )}
          {mode === 'new' && given.trim().length >= 2 && (
            <div className="qa-matches" aria-live="polite">
              <span className="subtle qa-hint">{t('quick.alreadyInTree')}</span>
              <LinkCandidates f={f} tree={tree} anchor={anchor} relation={relation} query={given} born={born} coParent={relation === 'child' ? coParent || undefined : undefined} onPick={pick} limit={4} />
            </div>
          )}
          <div className="qa-grid">
            {mode === 'new' && <>
              <form.Field name="given" validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t('quick.error.name')) }}>
                {(field) => (
                  <label className="field">
                    <span>{t('quick.given')}</span>
                    <input aria-describedby={`${formId}-given-error`} aria-invalid={!!field.state.meta.errors.length} data-autofocus className="input" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                    {field.state.meta.errors[0] && <em id={`${formId}-given-error`} className="err">{field.state.meta.errors[0]}</em>}
                  </label>
                )}
              </form.Field>
              <form.Field name="surname">
                {(field) => (
                  <label className="field">
                    <span>{t('quick.surnameBirth')}</span>
                    <input className="input" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                  </label>
                )}
              </form.Field>
              <form.Field name="sex">
                {(field) => (
                  <div className="field">
                    <span>{t('quick.sex')}</span>
                    <Select aria-label={t('quick.sex')} value={field.state.value} onChange={(v) => field.handleChange(v)} options={[{ value: '', label: t('quick.sexUnknown') }, { value: 'f', label: t('quick.sexFemale') }, { value: 'm', label: t('quick.sexMale') }, { value: 'x', label: t('quick.sexOther') }]} />
                  </div>
                )}
              </form.Field>
              <form.Field name="born" validators={{ onChange: date }}>
                {(field) => (
                  <DatePicker
                    label={t('quick.born')}
                    value={field.state.value}
                    onChange={(v) => field.handleChange(v)}
                    notAfter={isoOfDate(new Date())}
                    error={field.state.meta.errors[0] ?? undefined}
                  />
                )}
              </form.Field>
            </>}
            {relation === 'child' && partners.length > 0 && (
              <form.Field name="coParent">
                {(field) => (
                  <div className="field wide">
                    <span id={`${formId}-co`}>{t('quick.otherParent')}</span>
                    <Select
                      aria-labelledby={`${formId}-co`}
                      value={field.state.value}
                      onChange={(v) => {
                        // The surname follows the other parent, unless it was typed by hand.
                        const before = childSurname(f, anchor, field.state.value);
                        field.handleChange(v);
                        if (form.state.values.surname === before) form.setFieldValue('surname', childSurname(f, anchor, v));
                      }}
                      options={[...partners.map((p) => ({ value: p.id, label: displayName(p, f) })), { value: '', label: t('quick.someoneElse') }]}
                    />
                  </div>
                )}
              </form.Field>
            )}
            {mode === 'new' && (
              <form.Field name="living">
                {(field) => (
                  <div className="field wide">
                    <Switch checked={field.state.value} onChange={(v) => field.handleChange(v)}>{t('quick.living')}</Switch>
                  </div>
                )}
              </form.Field>
            )}
            {relation === 'partner' && (
              <>
                <div className="field wide">
                  <span>{t('quick.relType')}</span>
                  <Select aria-label={t('quick.relType')} value={partnerKind} onChange={setPartnerKind} options={[{ value: 'marriage', label: t('quick.relMarried') }, { value: 'partnership', label: t('quick.relPartners') }, { value: 'other', label: t('quick.relOther') }]} />
                </div>
                <div className="wide qa-stack">
                  <DatePicker label={t('quick.startDate')} value={start} onChange={setStart} />
                  <div className="field">
                    <span id={`${formId}-place`}>{t('quick.place')}</span>
                    <PlaceInput tree={tree} value={place} onChange={setPlace} aria-labelledby={`${formId}-place`} placeholder={tree === 'realm' ? t('quick.ph.placeWed') : t('quick.ph.placeOther')} />
                  </div>
                </div>
              </>
            )}
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
