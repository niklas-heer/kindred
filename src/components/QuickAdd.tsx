// Adding a relative from the "+" marks: a tiny form, prefilled where we can guess, saved with ↵.
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { addRelative } from '~/lib/api';
import { displayName, partnersOf, type Family } from '~/lib/graph';
import type { AddRelation } from './Card';
import './quickadd.css';

const TITLE: Record<AddRelation, string> = { parent: 'Add a parent of', child: 'Add a child of', partner: 'Add a partner of', sibling: 'Add a sibling of' };

export function QuickAdd({ family: f, tree, anchor, relation, sex, onDone, onCancel }: {
  family: Family; tree: string; anchor: string; relation: AddRelation; sex?: 'm' | 'f'; onDone: (id: string, person: { given: string; sex?: string }) => void; onCancel: () => void;
}) {
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
      const id = await addRelative({
        data: {
          tree, anchor, relation,
          coParent: value.coParent || undefined,
          person: { given: value.given, surname: value.surname || undefined, sex: value.sex || undefined, born: value.born || undefined, living: value.living },
        },
      });
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      onDone(id, { given: value.given, sex: value.sex || undefined });
    },
  });
  const date = ({ value }: { value: string }) => (value === '' || /^~?\d{3,4}(-\d\d(-\d\d)?)?$/.test(value) ? undefined : '1990, 1990-05 or 1990-05-17');

  return (
    <div className="qa-backdrop" onMouseDown={onCancel}>
      <form
        className="qa panel"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}
      >
        <header>
          <span className="muted">{TITLE[relation]}</span> <b className="display">{displayName(a, f)}</b>
          <button type="button" className="btn icon ghost" onClick={onCancel}><X size={16} /></button>
        </header>
        <div className="qa-grid">
          <form.Field name="given" validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : 'A name, even a guess') }}>
            {(field) => (
              <label className="field">
                <span>Given name</span>
                <input autoFocus className="input" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
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
                <label className="field wide">
                  <span>Other parent</span>
                  <select className="input" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)}>
                    {partners.map((p) => <option key={p.id} value={p.id}>{displayName(p, f)}</option>)}
                    <option value="">Someone else / unknown</option>
                  </select>
                </label>
              )}
            </form.Field>
          )}
          <form.Field name="living">
            {(field) => (
              <label className="field check wide">
                <input type="checkbox" checked={field.state.value} onChange={(e) => field.handleChange(e.target.checked)} /> Still living
              </label>
            )}
          </form.Field>
        </div>
        <footer>
          <span className="faint">Everything else can wait. You can add details later.</span>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(busy) => <button className="btn primary" disabled={busy}><Check size={14} /> Add <kbd>↵</kbd></button>}
          </form.Subscribe>
        </footer>
      </form>
    </div>
  );
}
