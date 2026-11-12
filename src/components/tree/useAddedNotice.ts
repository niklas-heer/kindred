import { useQueryClient } from '@tanstack/react-query';
import type { RefObject } from 'react';
import type { AddRelation } from '~/components/Card';
import { removePerson } from '~/lib/api';
import type { Family } from '~/lib/graph';
import { translateMessage, useT, type Key, type Vars } from '~/lib/i18n';
import { play } from '~/lib/sfx';
import { toast } from '~/lib/toast';

/**
 * A CK3-style notice once someone joins: "A daughter for House Valcourt", with Undo for whoever may remove people.
 * `selectNow` holds the page's current select handler: Undo runs seconds later, after the page has drawn again.
 */
export function useAddedNotice({ f, tree, canRemove, selectNow }: { f: Family; tree: string; canRemove: boolean; selectNow: RefObject<(id: string) => void> }) {
  const t = useT();
  const qc = useQueryClient();
  return (id: string, person: { given: string; sex?: string }, anchor: string, relation: AddRelation) => {
    const a = f.byId.get(anchor);
    const h = a?.house ? f.house.get(a.house) : undefined;
    const fam = h ? (h.name.startsWith('House') ? h.name : t('tp.famNamed', { name: h.name })) : t('tp.famFallback');
    const word = (m: Key, w: Key, x: Key, vars?: Vars) => t(person.sex === 'm' ? m : person.sex === 'f' ? w : x, vars);
    const anchorName = a?.given ?? t('card.someone');
    const title =
      relation === 'child' ? word('tp.ann.son', 'tp.ann.daughter', 'tp.ann.child', { family: fam }) :
      relation === 'partner' ? t('tp.annPartner', { name: person.given, family: fam }) :
      relation === 'sibling' ? word('tp.ann.brother', 'tp.ann.sister', 'tp.ann.sibling', { name: anchorName }) :
      word('tp.annFather', 'tp.annMother', 'tp.annParent', { who: anchorName });
    play('chime');
    toast({
      title,
      body: t('tp.annBody', { name: person.given }),
      person: id,
      ms: 9000,
      // Added by mistake? One click takes them out again.
      action: !canRemove ? undefined : {
        label: t('tp.undo'),
        run: async () => {
          // Back to the person they were adding to first: once the new person is gone, the page would
          // otherwise clear the selection that pointed at them, and land on the focus instead.
          selectNow.current(anchor);
          try {
            await removePerson({ data: { tree, id } });
            await qc.invalidateQueries({ queryKey: ['graph', tree] });
            play('page');
          } catch (e) {
            toast({ title: t('quick.undoFailed'), body: e instanceof Error ? translateMessage(e.message, t.locale) : t('tp.undoBody') });
          }
        },
      },
    });
  };
}
