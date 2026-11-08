// The Edit tab: the names, the facts, the biography and the list of fields. One Save writes all of it, with the
// places pinned first (the Atlas has them as soon as the person points at them). The dirty guard in the
// panel covers the whole tab.
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Trash2 } from 'lucide-react';
import { useContext, useState } from 'react';
import { opKeys, removePerson } from '~/lib/api';
import { savePersonEdit } from '~/lib/person.functions';
import { yearOf, type Family } from '~/lib/graph';
import { validDate } from '~/lib/dates';
import { useCan } from '~/lib/session';
import type { GPerson, PersonDetail } from '~/lib/types';
import { PlaceInput, placeValue, savePlacesKeyed, type PlaceValue } from '../PlaceInput';
import { MarkdownEditor } from '../MarkdownEditor';
import { Select, Switch } from '../ui';
import { DraftContext, DraftTracker } from './draft';
import { draftOf, FieldEditor, type DraftField } from './FieldEditor';
import { fieldIssue } from './model';
import { useT } from '~/lib/i18n';
import { OccupationField } from './OccupationField';

interface Props {
  tree: string;
  p: GPerson;
  f: Family;
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

export function PersonEdit({ tree, p, f, detail, done, onRemoved }: Props) {
  const { leave } = useContext(DraftContext);
  const c = useT();
  const canRemove = useCan('remove-person');
  const medieval = tree === 'realm' || (!!p.born && yearOf(p.born) < 1500);
  const qc = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keys] = useState(opKeys);
  const remove = useMutation({
    mutationFn: () => removePerson({ data: { tree, id: p.id } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      onRemoved();
    },
  });
  // Names: a null current name means "same as birth", so the switch starts on when both are unset.
  const sameName = p.currentGiven == null && p.currentSurname == null;
  const form = useForm({
    defaultValues: {
      given: p.given, surname: p.surname ?? '', sameName,
      currentGiven: p.currentGiven ?? p.given, currentSurname: p.currentSurname ?? p.surname ?? '',
      nickname: p.nickname ?? '', sex: (p.sex ?? '') as '' | 'm' | 'f' | 'x',
      born: p.born ?? '', bornPlace: placeValue(detail.bornPlace), died: p.died ?? '', diedPlace: placeValue(detail.diedPlace), living: p.living,
      title: p.title ?? '', epithet: p.epithet ?? '', occupation: p.occupation ?? '', occupationCode: p.occupationCode ?? '', bio: detail.bio ?? '',
      fields: detail.fields.map(draftOf),
    } as Values,
    onSubmit: async ({ value }) => {
      setSaveError(null);
      try {
        // Pins first: repeating them on a retry changes nothing.
        await savePlacesKeyed(tree, (pl) => keys.for('places', pl), value.bornPlace, value.living ? undefined : value.diedPlace);
        const details = {
          given: value.given, surname: value.surname, nickname: value.nickname, sex: value.sex || null,
          currentGiven: value.sameName ? null : value.currentGiven, currentSurname: value.sameName ? null : value.currentSurname,
          born: value.born, bornPlace: value.bornPlace.name, died: value.died, diedPlace: value.diedPlace.name, living: value.living,
          title: value.title, epithet: value.epithet, occupation: value.occupation, occupationCode: value.occupationCode || null, bio: value.bio,
        };
        const fields = value.fields.map((x) => ({ id: x.id, type: x.type, label: x.label, value: x.value, private: x.private }));
        const body = { tree, id: p.id, details, fields };
        await savePersonEdit({ data: { ...body, opKey: keys.for('edit', body) } });
        keys.clear('edit');
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['graph', tree] }),
          qc.invalidateQueries({ queryKey: ['person', tree, p.id] }),
          qc.invalidateQueries({ queryKey: ['contacts', tree] }),
        ]);
        form.reset(value);
        done();
      } catch (e) {
        // A refused field comes back as the validator's JSON; the reader gets a sentence instead.
        const msg = e instanceof Error ? e.message : '';
        setSaveError(!msg ? c('edit.saveFailed') : msg.startsWith('[') ? c('edit.checkFields') : msg);
      }
    },
  });

  const date = ({ value }: { value: string }) => (value === '' || validDate(value.trim()) ? undefined : c('edit.dateHint'));
  const text = (name: keyof Values, label: string, opts: { placeholder?: string; validate?: typeof date; wide?: boolean } = {}) => (
    <form.Field name={name as never} validators={opts.validate ? { onChange: opts.validate } : undefined}>
      {(field: any) => (
        <label className={`field${opts.wide ? ' wide' : ''}`}>
          <span>{label}</span>
          <input aria-invalid={!!field.state.meta.errors.length} aria-describedby={`edit-${String(name)}-error`} className="input" value={field.state.value} placeholder={opts.placeholder} onChange={(e) => field.handleChange(e.target.value)} />
          {field.state.meta.errors.length ? <em id={`edit-${String(name)}-error`} className="err">{field.state.meta.errors[0]}</em> : null}
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

  return (
    <form className="pp-edit" onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
      <DraftTracker form={form} />

      <div className="rule wide">{c('edit.names')}</div>
      <div className="wide pi-pair">
        {text('given', c('edit.givenAtBirth'))}
        {text('surname', c('edit.surnameAtBirth'))}
      </div>
      <form.Field name="sameName">
        {(field) => (
          <label className="field check wide">
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
          </label>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.values.sameName}>
        {(same) => same ? null : (
          <div className="wide pi-pair">
            {text('currentGiven', c('edit.currentGiven'))}
            {text('currentSurname', c('edit.currentSurname'))}
          </div>
        )}
      </form.Subscribe>
      {text('nickname', c('edit.nickname'), { placeholder: medieval ? c('edit.nicknameMedieval') : c('edit.nicknamePlaceholder') })}
      <form.Field name="sex">
        {(field) => (
          <label className="field">
            <span>{c('edit.sex')}</span>
            <Select aria-label={c('edit.sex')} value={field.state.value} onChange={(v) => field.handleChange(v as Values['sex'])} options={[
              { value: '', label: c('sex.unknown') }, { value: 'f', label: c('sex.f') }, { value: 'm', label: c('sex.m') }, { value: 'x', label: c('sex.x') },
            ]} />
          </label>
        )}
      </form.Field>
      <div className="wide pi-pair">
        {text('born', c('edit.born'), { placeholder: medieval ? '1120 or ~1120' : '1953 or 1953-08-08', validate: date })}
        {place('bornPlace', c('edit.birthplace'))}
      </div>
      <form.Field name="living">
        {(field) => (
          <label className="field check wide">
            <Switch checked={field.state.value} onChange={(v) => field.handleChange(v)}>{c('edit.living')}</Switch>
          </label>
        )}
      </form.Field>
      <form.Subscribe selector={(s) => s.values.living}>
        {(living) => (living ? null : <div className="wide pi-pair">{text('died', c('edit.died'), { validate: date })}{place('diedPlace', c('edit.diedPlace'))}</div>)}
      </form.Subscribe>
      {text('title', c('edit.title'), { placeholder: medieval ? c('edit.titleMedievalPlaceholder') : c('edit.titlePlaceholder') })}
      {text('epithet', c('edit.epithet'), { placeholder: c('edit.epithetPlaceholder') })}
      <form.Subscribe selector={(s) => s.values.sex}>
        {(sex) => (
          <form.Field name="occupation">
            {(field: any) => (
              <form.Field name="occupationCode">
                {(code: any) => (
                  <OccupationField
                    label={c('edit.occupation')}
                    text={field.state.value}
                    code={code.state.value}
                    sex={(sex || undefined) as 'm' | 'f' | 'x' | undefined}
                    onChange={(next) => { field.handleChange(next.text); code.handleChange(next.code); }}
                  />
                )}
              </form.Field>
            )}
          </form.Field>
        )}
      </form.Subscribe>

      <div className="rule wide">{c('edit.biography')}</div>
      <form.Field name="bio">
        {(field) => (
          <div className="field wide">
            <MarkdownEditor tree={tree} label={c('edit.biography')} value={field.state.value} onChange={(v) => field.handleChange(v)} rows={6} />
          </div>
        )}
      </form.Field>

      <form.Field
        name="fields"
        validators={{ onSubmit: ({ value }: { value: DraftField[] }) => (value.some((x) => fieldIssue(x.type, x.value, x.private)) ? c('edit.fixFields') : undefined) }}
      >
        {(field) => (
          <div className="wide">
            <FieldEditor value={field.state.value} onChange={(v) => field.handleChange(v)} fam={f} self={p.id} />
            {field.state.meta.errors.length ? <em className="err" role="alert">{field.state.meta.errors[0]}</em> : null}
          </div>
        )}
      </form.Field>

      {saveError && <em role="alert" className="err wide">{saveError}</em>}
      <div className="row end wide pp-edit-actions">
        {canRemove && (
          <button
            type="button"
            className="btn ghost danger"
            disabled={remove.isPending}
            onClick={() => confirm(c('edit.removeConfirm', { name: p.given })) && remove.mutate()}
          >
            <Trash2 size={14} /> {c('edit.remove')}
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={() => leave(done)}>{c('edit.cancel')}</button>
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
          {([ok, busy]) => <button className="btn primary" disabled={!ok || busy}><Check size={14} /> {c('edit.save')}</button>}
        </form.Subscribe>
      </div>
    </form>
  );
}
