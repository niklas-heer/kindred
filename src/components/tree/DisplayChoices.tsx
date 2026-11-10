// Names and ages on the tree's cards: the reader's two display choices.
import type { NameMode } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { Select } from '~/components/ui';

export type AgeMode = 'living' | 'all' | 'off';

/** Names and ages on the cards: in the toolbar's row when there is room, else in the Display sheet, each under its name. */
export function DisplayChoices({ nameMode, onName, ageMode, onAge, labelled }: { nameMode: NameMode; onName: (m: NameMode) => void; ageMode: AgeMode; onAge: (m: AgeMode) => void; labelled?: boolean }) {
  const t = useT();
  const names = (
    <Select size="sm" value={nameMode} onChange={onName} aria-label={t('tp.names')} options={[
      { value: 'nickname', label: t('tp.nick') }, { value: 'first', label: t('tp.firstName') }, { value: 'full', label: t('tp.fullName') },
    ]} />
  );
  const ages = (
    <Select size="sm" value={ageMode} onChange={onAge} aria-label={t('tp.ages')} options={[
      { value: 'living', label: t('tp.agesLiving') }, { value: 'all', label: t('tp.agesAll') }, { value: 'off', label: t('tp.agesHidden') },
    ]} />
  );
  if (!labelled) return <>{names}{ages}</>;
  return (
    <>
      <div className="tb-sheet-field"><span aria-hidden>{t('tp.names')}</span>{names}</div>
      <div className="tb-sheet-field"><span aria-hidden>{t('tp.ages')}</span>{ages}</div>
    </>
  );
}
