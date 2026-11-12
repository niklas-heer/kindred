// The end of a reign: its score, its title ("a bold reign") and why, the provinces held turn by turn as a small line, and
// the few battles worth telling, in the order they happened. The chronicle is worked out from the reign's own moves
// (src/lib/campaign/chronicle.ts), the same way the server works out the title it keeps. Below it the page says where the
// reign stands in the family's table, and offers another.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Arms } from '~/components/Heraldry';
import { chronicleOf, highlights, type Chronicle, type Telling, type Title } from '~/lib/campaign/chronicle';
import { RULES, type Move, type Reign, type State } from '~/lib/campaign/engine';
import { useT, type Key } from '~/lib/i18n';
import { Laurel, reducedMotion, seasonLine, type BoardSide } from './parts';

export const TITLE_NAME: Record<Title, Key> = {
  hard: 'campaign.epithet.hard', conqueror: 'campaign.epithet.conqueror', townlord: 'campaign.epithet.townlord', bold: 'campaign.epithet.bold', seafarer: 'campaign.epithet.seafarer', unbroken: 'campaign.epithet.unbroken',
  relentless: 'campaign.epithet.relentless', prudent: 'campaign.epithet.prudent', unlucky: 'campaign.epithet.unlucky', peaceable: 'campaign.epithet.peaceable', steadfast: 'campaign.epithet.steadfast',
};
const TITLE_WHY: Record<Title, Key> = {
  hard: 'campaign.epithet.hard_why', conqueror: 'campaign.epithet.conqueror_why', townlord: 'campaign.epithet.townlord_why', bold: 'campaign.epithet.bold_why', seafarer: 'campaign.epithet.seafarer_why', unbroken: 'campaign.epithet.unbroken_why',
  relentless: 'campaign.epithet.relentless_why', prudent: 'campaign.epithet.prudent_why', unlucky: 'campaign.epithet.unlucky_why', peaceable: 'campaign.epithet.peaceable_why', steadfast: 'campaign.epithet.steadfast_why',
};

/** A number that counts up to its value once, when it first shows. With "reduce motion" it is simply there. */
function useCountUp(to: number, ms = 1100): number {
  const [n, setN] = useState(() => (reducedMotion() ? to : 0));
  useEffect(() => {
    if (reducedMotion()) { setN(to); return; }
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - began) / ms);
      setN(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, ms]);
  return n;
}

/** The provinces held after each turn, as a line: it rises with a conquest and falls with a loss. */
function HeldLine({ held, label }: { held: number[]; label: string }) {
  const w = 300, h = 64, pad = 8;
  const top = Math.max(...held, 4);
  const x = (i: number) => pad + (i / Math.max(1, held.length - 1)) * (w - 2 * pad);
  const y = (n: number) => h - pad - (n / top) * (h - 2 * pad);
  const d = held.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join('');
  return (
    <svg className="cc-line" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      {[4, 8].map((year) => <path key={year} className="cc-line-year" d={`M${x(year)} ${pad / 2}V${h - pad / 2}`} />)}
      <path className="cc-line-fill" d={`${d}L${x(held.length - 1).toFixed(1)} ${h - pad}L${x(0).toFixed(1)} ${h - pad}Z`} />
      <path className="cc-line-path" d={d} pathLength={1} />
      {held.map((n, i) => <circle key={i} className={`cc-line-dot${i && n > held[i - 1] ? ' is-up' : i && n < held[i - 1] ? ' is-down' : ''}`} cx={x(i)} cy={y(n)} r={i === held.length - 1 ? 4 : 2.6} />)}
    </svg>
  );
}

export interface ReignChronicleProps {
  reign: Reign;
  start: State;
  moves: Move[];
  sides: BoardSide[];
  /** Where the reign stands (the server's answer, or that it was not counted), and what to do next. */
  status: ReactNode;
  actions: ReactNode;
}

export function ReignChronicle({ reign, start, moves, sides, status, actions }: ReignChronicleProps) {
  const t = useT();
  const told = useMemo<Chronicle>(() => chronicleOf(start, reign, moves), [start, reign, moves]);
  const side = sides.find((s) => s.id === reign.player);
  const shown = useCountUp(told.score.total);
  const nameOf = (id: string | null) => (id ? sides.find((s) => s.id === id)?.name ?? id : t('campaign.free'));
  const say = (e: Telling) => {
    const vars = { when: seasonLine(t, e.turn), province: reign.map.provinces[e.province].name, house: nameOf(e.other) };
    const text = e.kind === 'took' ? t(e.other ? 'campaign.chronicle.took' : 'campaign.chronicle.claimed', vars) : e.kind === 'lost' ? t('campaign.chronicle.lost', vars) : t('campaign.chronicle.held', vars);
    const more = e.kind === 'took' ? [e.chance < 0.4 ? t('campaign.chronicle.bold', { chance: Math.round(e.chance * 100) }) : '', e.bySea ? t('campaign.chronicle.by_sea') : ''].filter(Boolean).join(' ') : '';
    return more ? `${text} ${more}` : text;
  };
  const few = highlights(told, 5);
  const { score } = told;
  return (
    <section className="ui-card cg-banner cg-result cc" aria-labelledby="cc-h">
      <div className="cc-head">
        {side && <Arms arms={side.arms} size={72} />}
        <div>
          {/* The heading says the whole score at once; the number that counts up is only for the eye. */}
          <h2 id="cc-h" aria-label={t('campaign.result.title', { score: score.total })} data-score={score.total}>{t('campaign.result.title', { score: shown })}</h2>
          <p className="cc-title"><Laurel size={16} /> <b>{t(TITLE_NAME[told.title])}</b> <span className="muted">{t(TITLE_WHY[told.title])}</span></p>
        </div>
      </div>
      <dl className="cc-parts">
        <div><dt>{t('campaign.chronicle.provinces')}</dt><dd>{score.provinces - score.towns}<small>× {RULES.SCORE_PROVINCE}</small></dd></div>
        <div><dt>{t('campaign.chronicle.towns')}</dt><dd>{score.towns}<small>× {RULES.SCORE_TOWN}</small></dd></div>
        <div><dt>{t('campaign.chronicle.won')}</dt><dd>{score.won}<small>× {RULES.SCORE_BATTLE}</small></dd></div>
        <div><dt>{t('campaign.chronicle.lost_troops')}</dt><dd>{score.lost}<small>× −{RULES.SCORE_TROOP}</small></dd></div>
      </dl>
      <div className="cc-story">
        <div className="cc-held">
          <h3>{t('campaign.chronicle.held_title')}</h3>
          <HeldLine held={told.held} label={t('campaign.chronicle.held_label', { from: told.held[0], to: told.held.at(-1) ?? 0, most: Math.max(...told.held) })} />
        </div>
        <div className="cc-tale">
          <h3>{t('campaign.chronicle.title')}</h3>
          {few.length ? <ol>{few.map((e, i) => <li key={i} className={`is-${e.kind}`}>{say(e)}</li>)}</ol> : <p className="muted">{t('campaign.chronicle.quiet')}</p>}
        </div>
      </div>
      <div className="cc-status">{status}</div>
      <div className="cg-banner-actions">{actions}</div>
    </section>
  );
}
