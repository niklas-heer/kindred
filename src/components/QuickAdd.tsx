// Adding a relative from the "+" marks: a tiny form, prefilled where we can guess, saved with ↵.
import { useForm, useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { addRelative, linkRelative } from '~/lib/api';
import { validDate } from '~/lib/dates';
import { useId, useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Select } from './ui/Select';
import { Switch } from './ui/Switch';
import { displayName, lifespan, partnersOf, yearOf, type Family } from '~/lib/graph';
import type { AddRelation } from './Card';
import { searchPeople } from './Palette';
import './quickadd.css';

const TITLE: Record<AddRelation, string> = { parent: 'Add a parent of', child: 'Add a child of', partner: 'Add a partner of', sibling: 'Add a sibling of' };

export function QuickAdd({ family: f, tree, anchor, relation, sex, onDone, onCancel }: {
  family: Family; tree: string; anchor: string; relation: AddRelation; sex?: 'm' | 'f'; onDone: (id: string, person: { given: string; sex?: string }) => void; onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [linking, setLinking] = useState(false);
  const [partnerKind, setPartnerKind] = useState<'marriage' | 'partnership' | 'other'>('partnership');
  const [start, setStart] = useState('');
  const [place, setPlace] = useState('');
  const qc = useQueryClient();
  const a = f.byId.get(anchor)!;
  const partners = partnersOf(f, anchor).map((id) => f.byId.get(id)!).filter(Boolean);
  const form = useForm({
    defaultValues: {
      given: '',
      // A father usually passes on the surname; a mother's birth name is usually different.
      surname: relation === 'child' || relation === 'sibling' || (relation === 'parent' && sex !== 'f') ? (a.surname ?? '') : '',
      sex: (sex ?? '') as '' | 'm' | 'f' | 'x',
      born: '',
      living: a.living,
      coParent: relation === 'child' && partners.length === 1 ? partners[0].id : '',
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
      const id = await addRelative({
        data: {
          tree, anchor, relation,
          partnership: relation === 'partner' ? {kind: partnerKind, start: start || undefined, place: place || undefined} : undefined,
          coParent: value.coParent || undefined,
          person: { given: value.given, surname: value.surname || undefined, sex: value.sex || undefined, born: value.born || undefined, living: value.living },
        },
      });
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      onDone(id, { given: value.given, sex: value.sex || undefined });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add them');
      }
    },
  });
  const date = ({ value }: { value: string }) => (value === '' || validDate(value.trim()) ? undefined : 'Enter a real year, year-month or year-month-day');
  const given = useStore(form.store, (s) => s.values.given);
  const born = useStore(form.store, (s) => s.values.born);
  const dirty = useStore(form.store, (s) => s.isDirty) || !!query || !!selected || !!start || !!place || partnerKind !== 'partnership';
  const submitting = useStore(form.store, (s) => s.isSubmitting);
  const busy = submitting || linking;
  const matches = searchPeople(f, mode === 'existing' ? query : given, 8).map(({id}) => f.byId.get(id)!).filter((p) => p.id !== anchor && (mode === 'existing' || !born || !p.born || Math.abs(yearOf(p.born) - yearOf(born)) <= 1));
  const saveLink = async () => { if (!selected || busy) return; setLinking(true); setError(null); try {
    await linkRelative({data: {tree, anchor, relation, person: selected, coParent: form.state.values.coParent || undefined, partnership: relation === 'partner' ? {kind: partnerKind, start: start || undefined, place: place || undefined} : undefined}});
    await qc.invalidateQueries({queryKey: ['graph', tree]}); onCancel();
  } catch (e) { setError(e instanceof Error ? e.message : 'Could not link this person'); } finally { setLinking(false); } };
  const formId = useId();

  return (
    <Dialog
      open
      onClose={() => { if (!busy) onCancel(); }}
      dismissible={!busy}
      variant="event"
      width={500}
      dirty={dirty}
      title={<><span className="qa-what">{TITLE[relation]}</span> {displayName(a, f)}</>}
      footer={
        <>
          {error ? <span className="err qa-note">{error}</span> : <span className="subtle qa-note">Everything else can wait. You can add details later.</span>}
          <button className="btn primary" form={formId} disabled={busy || (mode === 'existing' && !selected) || (!!start && !validDate(start))}><Check size={14} /> {mode === 'existing' ? 'Link person' : 'Create new'} <kbd>↵</kbd></button>
        </>
      }
    >
      <form
        id={formId}
        className="qa"
        onSubmit={(e) => { e.preventDefault(); if (busy) return; if (mode === 'existing') void saveLink(); else void form.handleSubmit(); }}
      >
        <div className="qa-modes"><button type="button" className="btn" aria-pressed={mode === 'new'} disabled={busy} onClick={() => setMode('new')}>Create new</button><button type="button" className="btn" aria-pressed={mode === 'existing'} disabled={busy} onClick={() => setMode('existing')}>Link someone already in the tree</button></div>
        <fieldset disabled={busy} className="qa-fields">
        {mode === 'existing' && <label className="field"><span>Search the tree</span><input className="input" value={query} onChange={(e) => { setQuery(e.target.value); setSelected(''); }} /></label>}
        {(mode === 'existing' || given.trim()) && <div className="qa-matches" aria-live="polite"><span className="subtle">{mode === 'new' ? 'Already in the tree? Check before creating a duplicate.' : selected ? 'Person selected' : `${matches.length} matches`}</span>{matches.map((p) => <button className="btn" type="button" key={p.id} aria-pressed={selected === p.id} onClick={() => { setSelected(p.id); setMode('existing'); setQuery(displayName(p, f)); }}>{displayName(p, f)} · {lifespan(p)}</button>)}</div>}
        <div className="qa-grid">
        {mode === 'new' && <>

          <form.Field name="given" validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'A name, even a guess') }}>
            {(field) => (
              <label className="field">
                <span>Given name</span>
                <input aria-describedby={`${formId}-given-error`} aria-invalid={!!field.state.meta.errors.length} data-autofocus className="input" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                {field.state.meta.errors[0] && <em id={`${formId}-given-error`} className="err">{field.state.meta.errors[0]}</em>}
              </label>
            )}
          </form.Field>
          <form.Field name="surname">
            {(field) => (
              <label className="field">
                <span>Surname at birth</span>
                <input className="input" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
              </label>
            )}
          </form.Field>
          <form.Field name="sex">
            {(field) => (
              <div className="field">
                <span>Sex</span>
                <Select aria-label="Sex" value={field.state.value} onChange={(v) => field.handleChange(v)} options={[{value: '', label: 'Unknown'}, {value: 'f', label: 'Female'}, {value: 'm', label: 'Male'}, {value: 'x', label: 'Other'}]} />
              </div>
            )}
          </form.Field>
          <form.Field name="born" validators={{ onChange: date }}>
            {(field) => (
              <label className="field">
                <span>Born</span>
                <input aria-describedby={`${formId}-born-error`} aria-invalid={!!field.state.meta.errors.length} className="input" placeholder={tree === 'realm' ? '1120 or ~1120' : '1990 or ~1890'} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                {field.state.meta.errors[0] && <em id={`${formId}-born-error`} className="err">{field.state.meta.errors[0]}</em>}
              </label>
            )}
          </form.Field>
          </>}
          {relation === 'child' && partners.length > 0 && (
            <form.Field name="coParent">
              {(field) => (
                <div className="field wide">
                  <span id={`${formId}-co`}>Other parent</span>
                  <Select
                    aria-labelledby={`${formId}-co`}
                    value={field.state.value}
                    onChange={(v) => field.handleChange(v)}
                    options={[...partners.map((p) => ({ value: p.id, label: displayName(p, f) })), { value: '', label: 'Someone else / unknown' }]}
                  />
                </div>
              )}
            </form.Field>
          )}
          {mode === 'new' && <form.Field name="living">
            {(field) => (
              <div className="field wide">
                <Switch checked={field.state.value} onChange={(v) => field.handleChange(v)}>Still living</Switch>
              </div>
            )}
          </form.Field>}
          {relation === 'partner' && <><div className="field wide"><span>Relationship type</span><Select aria-label="Relationship type" value={partnerKind} onChange={setPartnerKind} options={[{value: 'marriage', label: 'Married'}, {value: 'partnership', label: 'Partners'}, {value: 'other', label: 'Other'}]} /></div><label className="field"><span>Start date (optional)</span><input className="input" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={!!start && !validDate(start)} aria-describedby={`${formId}-start-error`} placeholder={tree === 'realm' ? '1140' : '2000-06'} />{!!start && !validDate(start) && <em id={`${formId}-start-error`} className="err">Enter a real date.</em>}</label><label className="field"><span>Place (optional)</span><input className="input" value={place} onChange={(e) => setPlace(e.target.value)} /></label></>}
        </div></fieldset>
      </form>
    </Dialog>
  );
}
