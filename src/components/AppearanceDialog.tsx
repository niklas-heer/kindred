// The character editor in its dialog: opened from a person's portrait, or from "Appearance" on their Edit tab. The look is
// saved only on Save, as one change in the family's history; closing with changes asks first, and the save is retried
// with the same key until it lands. Where nothing can be saved (a demo, a "View as" preview, a reader who may not edit
// this person) the editor still opens, to try things on, and says so instead of failing at the end.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { opKeys } from '~/lib/api';
import { awaitsLinkConfirmation, mayPaintPerson } from '~/lib/ai/portrait-rules';
import { useT, type Key } from '~/lib/i18n';
import { setLook } from '~/lib/person.functions';
import { useMember, useSession } from '~/lib/session';
import type { GPerson, House, Look } from '~/lib/types';
import { CharacterEditor } from './CharacterEditor';
import { Dialog } from './ui';

/**
 * Why a look made here will not be saved, as the key of the sentence that says so; null when it will be. Whoever may
 * paint a person's portrait may draw it: an editor, or the member who is this person once that link is confirmed.
 */
export function useLookNotice(tree: string, personId: string): Key | null {
  const session = useSession();
  const member = useMember(tree);
  if (session?.demo) return 'character.readonly.demo';
  if (session?.viewAs) return 'character.readonly.preview';
  if (mayPaintPerson(member, personId)) return null;
  return awaitsLinkConfirmation(member, personId) ? 'character.readonly.unconfirmed' : 'character.readonly.role';
}

export function AppearanceDialog({ tree, p, house, onClose }: { tree: string; p: GPerson; house: House | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const notice = useLookNotice(tree, p.id);
  const [draft, setDraft] = useState<Look | undefined>(p.look);
  const [keys] = useState(opKeys);
  const dirty = JSON.stringify(draft ?? null) !== JSON.stringify(p.look ?? null);
  const save = useMutation({
    mutationFn: () => setLook({ data: { tree, id: p.id, look: draft!, opKey: keys.for('look', [p.id, draft]) } }),
    onSuccess: async () => {
      keys.clear('look');
      await qc.invalidateQueries({ queryKey: ['person', tree, p.id] });
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('panel.appearance_title', { name: p.given })}
      // Nothing to lose where nothing can be kept: a look tried on in a demo closes without a question.
      dirty={dirty && !notice}
      width={1060}
      dismissible={!save.isPending}
      bodyClassName="ce-dialog-body"
      initialFocus=".ce-surprise"
      footer={notice
        ? <button type="button" className="btn" onClick={onClose}>{t('character.close')}</button>
        : <>
          {save.isError && <p className="err" role="alert">{t('panel.appearance_failed')}</p>}
          <button type="button" className="btn primary" onClick={() => save.mutate()} disabled={!dirty || !draft || save.isPending}>{t('panel.appearance_save')}</button>
        </>}
    >
      <CharacterEditor person={p} tree={tree} house={house} value={draft} onChange={setDraft} notice={notice ? t(notice) : undefined} />
    </Dialog>
  );
}
