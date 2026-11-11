// The recipe form in a window: a new recipe from the Cookbook, or a change from a recipe's own page. Closing with
// something typed asks first.
//
//   <RecipeDialog tree={tree} onClose={close} onSaved={(id) => navigate(…)} />
//   <RecipeDialog tree={tree} edit={recipe} onClose={close} />
import { useState } from 'react';
import { Dialog } from '~/components/ui';
import { useT } from '~/lib/i18n';
import type { RecipeDetail } from '~/lib/recipes/model';
import type { GPerson } from '~/lib/types';
import { RecipeForm } from './RecipeForm';

export function RecipeDialog({ tree, edit, person, onClose, onSaved }: { tree: string; edit?: RecipeDetail; person?: GPerson; onClose: () => void; onSaved?: (id: string) => void }) {
  const t = useT();
  const [dirty, setDirty] = useState(false);
  return (
    <Dialog
      open onClose={onClose} variant="event" width="min(760px, 100vw - 16px)" dirty={dirty} bodyClassName="rcp-dialog"
      title={edit ? (edit.structured ? t('recipes.form.edit_title') : t('recipes.form.structure_title')) : t('recipes.form.new_title')}
    >
      <RecipeForm tree={tree} edit={edit} person={person} onDirty={setDirty} onCancel={onClose} onDone={(id) => { onSaved?.(id); onClose(); }} />
    </Dialog>
  );
}
