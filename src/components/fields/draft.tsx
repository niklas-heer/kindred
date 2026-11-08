// The unsaved-changes guard for the person panel's forms. A form registers its draft here; leaving the
// panel (a tab, the close button, another person) asks first when the draft is dirty.
import { useStore } from '@tanstack/react-form';
import { createContext, useContext, useEffect } from 'react';
import { useCopy } from './strings';

export type Draft = { dirty: boolean; busy: boolean; save: () => Promise<boolean> };

export const DraftContext = createContext<{ register: (draft: Draft | null) => void; leave: (next: () => void) => void }>({
  register: () => {},
  leave: (next) => next(),
});

/** Reports a form's dirty and busy state to the panel, and shows "Unsaved changes" while it is dirty. */
export function DraftTracker({ form }: { form: any }) {
  const { register } = useContext(DraftContext);
  const c = useCopy();
  const dirty = useStore(form.store, (s: any) => s.isDirty) as boolean;
  const busy = useStore(form.store, (s: any) => s.isSubmitting) as boolean;
  useEffect(() => { register({ dirty, busy, save: async () => { await form.handleSubmit(); return !form.state.isDirty; } }); }, [dirty, busy, form, register]);
  useEffect(() => () => register(null), [register]);
  return dirty ? <span className="pp-unsaved" role="status">{c('draft.unsaved')}</span> : null;
}
