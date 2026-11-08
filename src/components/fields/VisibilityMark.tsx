// The three levels a person's field or note can have, as a reader sees and chooses them: a small symbol on the field, and a
// choice of three when it is added or edited. The rule itself is in src/lib/visibility.ts; this only shows it.
import { Lock, PenLine, Users, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT, type Key } from '~/lib/i18n';
import { newOpKey } from '~/lib/api';
import { deletePersonField } from '~/lib/person.functions';
import { VISIBILITIES, type Visibility } from '~/lib/visibility';
import { Segmented } from '../ui/Segmented';
import './visibility.css';

const ICON: Record<Visibility, typeof Lock> = { personal: Lock, editors: PenLine, family: Users };
const LABEL: Record<Visibility, Key> = { personal: 'field.vis.personal', editors: 'field.vis.editors', family: 'field.vis.family' };
const HINT: Record<Visibility, Key> = { personal: 'field.vis.personalHint', editors: 'field.vis.editorsHint', family: 'field.vis.familyHint' };

/** The level's symbol, named for screen readers and on hover. */
export function VisibilityMark({ level }: { level: Visibility }) {
  const c = useT();
  const Icon = ICON[level];
  return <span className={`fv-vis fv-vis-${level}`} role="img" aria-label={c(LABEL[level])} title={`${c(LABEL[level])}: ${c(HINT[level])}`}><Icon size={12} aria-hidden /></span>;
}

/** The choice of level, with what the chosen one means. */
export function VisibilityPicker({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  const c = useT();
  return (
    <div className="fv-vis-picker">
      <Segmented
        size="sm"
        aria-label={c('field.vis.label')}
        value={value}
        onChange={onChange}
        options={VISIBILITIES.map((v) => {
          const Icon = ICON[v];
          return { value: v, label: c(LABEL[v]), icon: <Icon size={13} aria-hidden /> };
        })}
      />
      <span className="subtle">{c(HINT[value])}</span>
    </div>
  );
}

/** For a member who can no longer edit: their own personal item stays theirs to take away. */
export function RemoveOwnField({ tree, person, id }: { tree: string; person: string; id: string }) {
  const c = useT();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deletePersonField({ data: { tree, id, opKey: newOpKey() } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['person', tree, person] }),
  });
  return (
    <button type="button" className="btn icon ghost fv-vis-remove" aria-label={c('field.vis.removeOwn')} title={c('field.vis.removeOwn')} disabled={remove.isPending}
      onClick={() => { if (window.confirm(c('field.vis.removeOwnConfirm'))) remove.mutate(); }}>
      <X size={13} aria-hidden />
    </button>
  );
}
