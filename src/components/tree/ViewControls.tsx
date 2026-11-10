// The controls of the tree's current view: in the toolbar row on wide screens, in the Display sheet on a phone.
import { useNavigate } from '@tanstack/react-router';
import { ArrowDownToLine, ArrowUpToLine, ChevronsDownUp, ChevronsUpDown, Landmark, Users } from 'lucide-react';
import { useMemo } from 'react';
import { Arms } from '~/components/Heraldry';
import { Select, type SelectOption } from '~/components/ui';
import { houseMembers, type Family } from '~/lib/graph';
import { formatNumber, useT } from '~/lib/i18n';
import type { View } from '~/lib/layout';
import { houseRoot } from '~/lib/tree-view';
import { Stepper } from './Stepper';

/** Generations up and down (Family), or how many (Ancestors). `full`: rows of the Display sheet. */
export function ViewSteppers({ view, up, down, full, onUp, onDown }: { view: View; up: number; down: number; full: boolean; onUp: (v: number) => void; onDown: (v: number) => void }) {
  return view === 'family' ? (
    <>
      <Stepper full={full} label="tp.up" long="tp.genUp" icon={<ArrowUpToLine size={15} />} value={up} onChange={onUp} />
      <Stepper full={full} label="tp.down" long="tp.genDown" icon={<ArrowDownToLine size={15} />} value={down} onChange={onDown} />
    </>
  ) : view === 'ancestors' ? (
    <Stepper full={full} label="tp.generations" long="tp.generations" icon={<ArrowUpToLine size={15} />} value={Math.max(up, 6)} onChange={onUp} />
  ) : null;
}

const ALL = '*all';
const PAGE = '*page';

/**
 * Which line a dynasty follows: a house (from its first person), every descendant, or the page of the house shown.
 * `root` is the dynasty's first person; `then` runs before the choice is acted on (the Display sheet closes).
 */
export function HouseSelect({ family: f, tree, line, root, then, onAll, onHouse }: {
  family: Family; tree: string; line: 'house' | 'all'; root: string; then?: () => void; onAll: () => void; onHouse: (root: string) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const houses = useMemo(() => {
    return f.graph.houses.map((h) => [h, houseMembers(f, h.id).length] as const).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
  }, [f]);
  const lineHouse = line === 'house' ? f.house.get(f.byId.get(root)?.house ?? '') : undefined;
  const houseOptions: SelectOption[] = [
    ...houses.map(([h, n]) => ({ value: h.id, label: h.name, icon: <Arms arms={h.arms} size={18} />, hint: formatNumber(n, t.locale), group: t('tp.houseLine') })),
    { value: ALL, label: t('tp.allDesc'), icon: <Users size={16} />, hint: t('tp.throughDaughters'), group: t('tp.everyDesc') },
    ...(lineHouse ? [{ value: PAGE, label: t('tp.openHousePage'), icon: <Landmark size={16} />, hint: lineHouse.name, group: t('tp.thisHouse') }] : []),
  ];
  return (
    <Select
      className="tb-house"
      size="sm"
      aria-label={t('tp.houseWord')}
      title={t('tp.dynastyTitle')}
      placeholder={t('tp.chooseHouse')}
      menuWidth={260}
      value={line === 'house' ? (f.byId.get(root)?.house ?? '') : ALL}
      options={houseOptions}
      onChange={(v) => {
        then?.();
        if (v === PAGE) { if (lineHouse) navigate({ to: '/$tree/house/$house', params: { tree, house: lineHouse.id } }); return; }
        if (v === ALL) { onAll(); return; }
        const r = houseRoot(f, v);
        if (r) onHouse(r);
      }}
    />
  );
}

/** Fold everyone but the line to the selected person, and, once something is folded, unfold it all. */
export function FoldButtons({ folded, onFold, onUnfold, then }: { folded: boolean; onFold: () => void; onUnfold: () => void; then?: () => void }) {
  const t = useT();
  return (
    <>
      <button className="btn tb-fold" onClick={() => { onFold(); then?.(); }} title={t('tp.foldTitle')} aria-label={t('tp.foldOthers')}><ChevronsDownUp size={15} aria-hidden /><span className="tb-label">{t('tp.foldOthers')}</span></button>
      {folded && <button className="btn tb-fold" onClick={() => { onUnfold(); then?.(); }} title={t('tp.unfoldTitle')} aria-label={t('tp.unfoldAll')}><ChevronsUpDown size={15} aria-hidden /><span className="tb-label">{t('tp.unfoldAll')}</span></button>}
    </>
  );
}
