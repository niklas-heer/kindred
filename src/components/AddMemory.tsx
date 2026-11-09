// "Add a memory" from the Chronicle: first who it is about, then the same form the person panel uses (StoryForm), so
// there is one way to write a memory and one place that saves it.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { chronicleQuery } from '~/lib/api';
import { useFamily, useMeChosen } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { closestFamily } from '~/lib/person-overview';
import { toast } from '~/lib/toast';
import type { GPerson } from '~/lib/types';
import { DraftContext, type Draft } from './fields/draft';
import { StoryForm } from './PersonPanel';
import { PersonPicker } from './photos/PersonPicker';
import { Portrait } from './Portrait';
import { Dialog } from './ui';
import '~/styles/chronicle.css';

export function AddMemory({ tree, onClose }: { tree: string; onClose: () => void }) {
  const t = useT();
  const f = useFamily();
  const me = useMeChosen();
  const [about, setAbout] = useState<GPerson | null>(null);
  const [dirty, setDirty] = useState(false);
  const recent = useQuery(chronicleQuery(tree)).data as { person: string }[] | undefined;
  // The people a reader most often writes about: their own closest family, then themselves. For a reader who has not
  // said who they are, the people the family wrote about last, so the list never opens on the oldest ancestors.
  const suggested = useMemo(
    () => (me ? [...closestFamily(f, me, 7).shown.map((r) => r.id), me] : [...new Set((recent ?? []).map((s) => s.person))].slice(0, 8)),
    [f, me, recent],
  );
  // The form reports what is typed, so closing the window asks before throwing it away.
  const draft = useMemo(() => ({
    register: (d: Draft | null) => setDirty(!!d?.dirty),
    leave: (next: () => void) => next(),
  }), []);

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('chronicle.add_title')}
      description={about ? undefined : t('chronicle.add_intro')}
      variant="event"
      width="min(560px, 100vw - 24px)"
      dirty={dirty}
      bodyClassName="chr-add"
    >
      {about ? (
        <>
          <div className="chr-add-about">
            <Portrait person={about} tree={tree} size={44} decorative />
            <div>
              <span className="subtle">{t('chronicle.add_about')}</span>
              <b>{displayName(about, f)}</b>
            </div>
            <button type="button" className="btn ghost" onClick={() => setAbout(null)}>{t('chronicle.add_change')}</button>
          </div>
          <DraftContext.Provider value={draft}>
            <StoryForm
              tree={tree}
              person={about}
              done={onClose}
              saved={() => toast({ title: t('chronicle.add_saved'), body: t('chronicle.add_saved_body', { name: about.given }), person: about.id, icon: 'quill-ink' })}
            />
          </DraftContext.Provider>
        </>
      ) : (
        <>
          <h3 className="chr-add-q">{t('chronicle.add_who')}</h3>
          <PersonPicker
            label={t('chronicle.add_who')}
            onPick={setAbout}
            suggested={suggested}
            portraits={tree}
          />
        </>
      )}
    </Dialog>
  );
}
