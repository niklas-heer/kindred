// The battle: two banners, and the dice of each round as the server rolled them (or the engine, in a practice
// skirmish). The rounds appear one after another; with "reduce motion" they are all there at once and nothing tumbles.
// The result is also said in words, in a live region. Sound goes through the app's own switch (src/lib/sfx.ts).
import { Flag, Swords } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Arms } from '~/components/Heraldry';
import { Dialog } from '~/components/ui';
import type { GameEvent, GameMap } from '~/lib/campaign/engine';
import type { SideView } from '~/lib/campaign/types';
import { useT } from '~/lib/i18n';
import { play } from '~/lib/sfx';

export type Battle = Extract<GameEvent, { t: 'attack' }>;

const PIPS: Record<number, [number, number][]> = {
  1: [[12, 12]],
  2: [[7, 7], [17, 17]],
  3: [[7, 7], [12, 12], [17, 17]],
  4: [[7, 7], [17, 7], [7, 17], [17, 17]],
  5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]],
  6: [[7, 6.5], [17, 6.5], [7, 12], [17, 12], [7, 17.5], [17, 17.5]],
};

function Die({ value, lost, defender, delay }: { value: number; lost: boolean; defender?: boolean; delay: number }) {
  return (
    <svg className={`cb-die${defender ? ' is-defender' : ''}${lost ? ' is-lost' : ''}`} viewBox="0 0 24 24" width="34" height="34" style={{ animationDelay: `${delay}ms` }} aria-hidden>
      <rect x="1.5" y="1.5" width="21" height="21" rx="4" />
      {PIPS[value]?.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="2" />)}
    </svg>
  );
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROUND_MS = 900;

export function BattleDialog({ battle, map, sides, mySide, onClose }: { battle: Battle; map: GameMap; sides: SideView[]; mySide: string | null; onClose: () => void }) {
  const t = useT();
  const attacker = sides.find((s) => s.id === battle.side);
  const defender = sides.find((s) => s.id === battle.defender);
  const province = map.provinces[battle.to].name;
  const [shown, setShown] = useState(() => (reducedMotion() ? battle.rounds.length : 0));
  const done = shown >= battle.rounds.length;

  useEffect(() => {
    if (done) return;
    if (shown === 0) play('seal');
    const id = window.setTimeout(() => { setShown((n) => n + 1); play('tick'); }, shown === 0 ? 350 : ROUND_MS);
    return () => window.clearTimeout(id);
  }, [shown, done]);
  useEffect(() => {
    if (done && battle.took && battle.side === mySide) play('fanfare');
  }, [done, battle, mySide]);

  const mine = battle.side === mySide;
  const outcome = battle.took
    ? mine ? t('campaign.battle.won', { province }) : t('campaign.battle.taken', { province, house: attacker?.name ?? '' })
    : mine ? t('campaign.battle.lost', { province }) : t('campaign.battle.held', { province });

  return (
    <Dialog
      open
      onClose={onClose}
      variant="event"
      title={t('campaign.battle.title', { province })}
      width="min(520px, 100vw - 24px)"
      initialFocus="[data-autofocus]"
      footer={<>{!done && <button type="button" className="btn" onClick={() => setShown(battle.rounds.length)}>{t('campaign.battle.skip')}</button>}<button type="button" className="btn primary" onClick={onClose} data-autofocus>{t('campaign.battle.close')}</button></>}
    >
      <div className="cb">
        <div className="cb-sides">
          <div className="cb-side">
            {attacker && <Arms arms={attacker.arms} size={56} />}
            <b>{attacker?.name}</b>
            <span className="muted">{t('campaign.battle.sent', { count: battle.committed })}</span>
          </div>
          <Swords className="cb-vs" size={26} aria-hidden />
          <div className="cb-side">
            {defender ? <Arms arms={defender.arms} size={56} /> : <Flag size={44} className="cg-row-free" aria-hidden />}
            <b>{defender?.name ?? t('campaign.free')}</b>
            <span className="muted">{t('campaign.battle.defended', { count: battle.defenders })}</span>
          </div>
        </div>
        <ol className="cb-rounds">
          {battle.rounds.slice(0, shown).map((r, i) => (
            <li key={i} className="cb-round">
              <span className="cb-round-n">{t('campaign.battle.round', { n: i + 1 })}</span>
              <span className="cb-dice" aria-label={t('campaign.battle.rolled', { who: attacker?.name ?? '', dice: r.a.join(', ') })}>
                {r.a.map((v, j) => <Die key={j} value={v} lost={j < r.d.length && v <= r.d[j]} delay={j * 70} />)}
              </span>
              <span className="cb-dice" aria-label={t('campaign.battle.rolled', { who: defender?.name ?? t('campaign.free'), dice: r.d.join(', ') })}>
                {r.d.map((v, j) => <Die key={j} value={v} defender lost={j < r.a.length && r.a[j] > v} delay={200 + j * 70} />)}
              </span>
              <span className="cb-loss">{t('campaign.battle.losses', { a: r.aLost, d: r.dLost })}</span>
            </li>
          ))}
        </ol>
        <div className="cb-result" aria-live="polite">
          {done && (
            <>
              <p className={`cb-outcome${battle.took ? ' is-won' : ''}`}>{outcome}</p>
              <p className="muted">{t('campaign.battle.total', { a: battle.aLost, d: battle.dLost })}</p>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
