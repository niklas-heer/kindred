// Adding a relative from the "+" marks: a tiny form, prefilled where we can guess, saved with ↵.
import { useForm, useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { addRelative } from '~/lib/api';
import { validDate } from '~/lib/dates';
import { useId, useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Select } from './ui/Select';
import { Switch } from './ui/Switch';
import { displayName, partnersOf, type Family } from '~/lib/graph';
import type { AddRelation } from './Card';
import './quickadd.css';

const TITLE: Record<AddRelation, string> = { parent: 'Add a parent of', child: 'Add a child of', partner: 'Add a partner of', sibling: 'Add a sibling of' };

export function QuickAdd({ family: f, tree, anchor, relation, sex, onDone, onCancel }: {
  family: Family; tree: string; anchor: string; relation: AddRelation; sex?: 'm' | 'f'; onDone: (id: string, person: { given: string; sex?: string }) => void; onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
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
  const date = ({ value }: { value: string }) => (value === '' || validDate(value.trim()) ? undefined : 'A real date: 1990, 1990-05 or 1990-05-17');
  const dirty = useStore(form.store, (s) => s.isDirty);
  const busy = useStore(form.store, (s) => s.isSubmitting);
  const formId = useId();

  return (
    <Dialog
      open
      onClose={onCancel}
      variant="event"
      width={500}
      dirty={dirty && !busy}
      title={<><span className="qa-what">{TITLE[relation]}</span> {displayName(a, f)}</>}
      footer={
        <>
          {error ? <span className="err qa-note">{error}</span> : <span className="subtle qa-note">Everything else can wait. You can add details later.</span>}
          <button className="btn primary" form={formId} disabled={busy}><Check size={14} /> Add <kbd>↵</kbd></button>
        </>
      }
    >
      <form
        id={formId}
        className="qa"
        onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
      >
        <div className="qa-grid">
          <form.Field name="given" validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'A name, even a guess') }}>
            {(field) => (
              <label className="field">
                <span>Given name</span>
                <input data-autofocus className="input" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                {field.state.meta.errors[0] && <em className="err">{field.state.meta.errors[0]}</em>}
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
                <div className="seg">
                  {([['f', 'Female'], ['m', 'Male'], ['x', 'Other'], ['', '?']] as const).map(([v, l]) => (
                    <button key={v} type="button" className="btn" aria-pressed={field.state.value === v} onClick={() => field.handleChange(v)}>{l}</button>
                  ))}
                </div>
              </div>
            )}
          </form.Field>
          <form.Field name="born" validators={{ onChange: date }}>
            {(field) => (
              <label className="field">
                <span>Born</span>
                <input className="input" placeholder="1990-05-17 or ~1890" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                {field.state.meta.errors[0] && <em className="err">{field.state.meta.errors[0]}</em>}
              </label>
            )}
          </form.Field>
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
          <form.Field name="living">
            {(field) => (
              <div className="field wide">
                <Switch checked={field.state.value} onChange={(v) => field.handleChange(v)}>Still living</Switch>
              </div>
            )}
          </form.Field>
        </div>
      </form>
    </Dialog>
  );
}
