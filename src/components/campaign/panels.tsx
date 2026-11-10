// The campaign page's side panels: the chronicle, a house's renown with what would raise it, the hall of fame, and
// "how it works". All of them only read.
import { Link } from '@tanstack/react-router';
import { BookOpen, Footprints, Landmark, ScrollText, Sparkles, Swords, Tent, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';
import { Arms } from '~/components/Heraldry';
import { Dialog } from '~/components/ui';
import { RULES, type GameMap, type Levy } from '~/lib/campaign/engine';
import { RENOWN_STEPS, type RenownKey } from '~/lib/campaign/renown';
import type { FameEntry, LogEntry, SideView } from '~/lib/campaign/types';
import { formatDate, useT, type Key } from '~/lib/i18n';
import { Laurel } from './Board';

// ---------- the chronicle ----------

/** One chronicle entry as a sentence in the reader's language. */
function useLine(map: GameMap, sides: SideView[]) {
  const t = useT();
  const house = (id: string | null | undefined) => sides.find((s) => s.id === id)?.name ?? t('campaign.free');
  const place = (id: number) => map.provinces[id]?.name ?? '';
  return (l: LogEntry): string => {
    const e = l.event;
    const who = l.name;
    switch (l.kind) {
      case 'season_start': return t('campaign.log.seasonStart');
      case 'season_end': return l.winner ? t('campaign.log.seasonEnd', { house: house(l.winner) }) : t('campaign.log.seasonEndNone');
      case 'pledge': return t('campaign.log.pledge', { name: who ?? '', house: house(l.side) });
      case 'bonus': return t('campaign.log.bonus', { name: who ?? '' });
      case 'muster': return e?.t === 'muster' ? t('campaign.log.muster', { name: who ?? '', count: e.troops, province: place(e.to), house: house(l.side) }) : '';
      case 'march': return e?.t === 'march' ? t('campaign.log.march', { name: who ?? '', count: e.troops, from: place(e.from), province: place(e.to) }) : '';
      case 'attack': {
        if (e?.t !== 'attack') return '';
        const vars = { name: who ?? '', house: house(l.side), province: place(e.to), defender: house(e.defender) };
        if (e.took) return e.defender ? t(who ? 'campaign.log.took' : 'campaign.log.tookRegent', vars) : t(who ? 'campaign.log.claimed' : 'campaign.log.claimedRegent', vars);
        return e.defender ? t(who ? 'campaign.log.repelled' : 'campaign.log.repelledRegent', vars) : t(who ? 'campaign.log.repelledFree' : 'campaign.log.repelledFreeRegent', vars);
      }
      default: return '';
    }
  };
}

const KIND_ICON: Record<LogEntry['kind'], ReactNode> = {
  attack: <Swords size={15} />, muster: <Tent size={15} />, march: <Footprints size={15} />, season_start: <ScrollText size={15} />,
  season_end: <Trophy size={15} />, pledge: <Landmark size={15} />, bonus: <Sparkles size={15} />,
};

export function CampaignChronicle({ log, map, sides, empty }: { log: LogEntry[]; map: GameMap; sides: SideView[]; empty: string }) {
  const t = useT();
  const line = useLine(map, sides);
  let day = -1;
  return (
    <section className="ui-card cg-panel" aria-labelledby="cg-chronicle-h">
      <h2 className="cg-h" id="cg-chronicle-h"><ScrollText size={18} aria-hidden /> {t('campaign.chronicle.title')}</h2>
      {log.length === 0 ? <p className="muted cg-note">{empty}</p> : (
        <ol className="cg-log">
          {log.map((l) => {
            const text = line(l);
            if (!text) return null;
            const head = l.day !== day ? <li key={`d${l.id}`} className="cg-log-day">{t('campaign.day', { day: l.day + 1 })}</li> : null;
            day = l.day;
            const side = sides.find((s) => s.id === l.side);
            return [
              head,
              <li key={l.id} className={`cg-log-line${l.mine ? ' is-mine' : ''}${l.kind === 'attack' && l.event?.t === 'attack' && l.event.took ? ' is-took' : ''}`}>
                <span className="cg-log-icon" aria-hidden>{side ? <Arms arms={side.arms} size={18} /> : KIND_ICON[l.kind]}</span>
                <span>
                  {text}
                  {l.cry && <q className="cg-cry-said">{l.cry}</q>}
                </span>
              </li>,
            ];
          })}
        </ol>
      )}
    </section>
  );
}

// ---------- renown ----------

const PART_LABEL: Record<RenownKey, Key> = {
  portraits: 'campaign.renown.portraits', dates: 'campaign.renown.dates', places: 'campaign.renown.places',
  memories: 'campaign.renown.memories', events: 'campaign.renown.events', sources: 'campaign.renown.sources',
};
const TIP: Record<RenownKey, Key> = {
  portraits: 'campaign.tip.portraits', dates: 'campaign.tip.dates', places: 'campaign.tip.places',
  memories: 'campaign.tip.memories', events: 'campaign.tip.events', sources: 'campaign.tip.sources',
};

export function RenownCard({ side, levy, tree, mine }: { side: SideView; levy: Levy; tree: string; mine: boolean }) {
  const t = useT();
  const r = side.renown;
  return (
    <section className="ui-card cg-panel cg-renown" aria-labelledby="cg-renown-h">
      <h2 className="cg-h" id="cg-renown-h"><BookOpen size={18} aria-hidden /> {t('campaign.renown.title', { house: side.name })}</h2>
      <p className="muted cg-note">{t('campaign.renown.what')}</p>
      <div className="cg-score">
        <b className="cg-score-n">{r.score}</b><span className="subtle"> / 100</span>
        <div className="cg-meter" role="img" aria-label={t('campaign.renown.score', { score: r.score })}>
          <span style={{ width: `${r.score}%` }} />
          {RENOWN_STEPS.map((step) => <i key={step} style={{ left: `${step}%` }} />)}
        </div>
        <p className="cg-next">{r.toNext === null ? t('campaign.renown.top') : t('campaign.renown.next', { count: r.toNext })}</p>
      </div>
      {r.parts.length > 0 && (
        <ul className="cg-parts">
          {r.parts.map((p) => (
            <li key={p.key}>
              <span>{t(PART_LABEL[p.key])}</span>
              <span className="cg-part-bar" aria-hidden><span style={{ width: `${(p.points / p.max) * 100}%` }} /></span>
              <span className="cg-part-n">{t('campaign.renown.points', { points: p.points, max: p.max })}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="cg-levy">
        <Tent size={15} aria-hidden /> {t('campaign.levy.line', { total: levy.total, base: levy.base, renown: levy.renown, rally: levy.rally })}
      </p>
      {r.tips.length > 0 && (
        <div className="cg-tips">
          <h3>{mine ? t('campaign.tip.title') : t('campaign.tip.titleOther')}</h3>
          <ul>
            {r.tips.map((key) => <li key={key}>{t(TIP[key], { house: side.name })}</li>)}
          </ul>
          <div className="cg-tip-links">
            <Link className="btn" to="/$tree/needed" params={{ tree }}>{t('campaign.tip.needed')}</Link>
            {!side.rival && <Link className="btn" to="/$tree/house/$house" params={{ tree, house: side.id }}>{t('campaign.tip.house', { house: side.name })}</Link>}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- the hall of fame ----------

export function HallOfFame({ fame }: { fame: FameEntry[] }) {
  const t = useT();
  return (
    <section className="ui-card cg-panel" aria-labelledby="cg-fame-h">
      <h2 className="cg-h" id="cg-fame-h"><Trophy size={18} aria-hidden /> {t('campaign.fame.title')}</h2>
      {fame.length === 0 ? <p className="muted cg-note">{t('campaign.fame.empty')}</p> : (
        <ol className="cg-fame">
          {fame.map((f) => (
            <li key={f.season}>
              {f.winner ? <Arms arms={f.winner.arms} size={30} /> : <span />}
              <span className="cg-fame-text">
                <b><Laurel size={15} /> {f.winner?.name ?? t('campaign.fame.nobody')}</b>
                <small>{t('campaign.fame.line', { season: f.season, date: formatDate(f.ended.slice(0, 10), t.locale), count: f.standings[0]?.provinces ?? 0 })}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------- how it works ----------

export function HowItWorks({ open, onClose, onPractice }: { open: boolean; onClose: () => void; onPractice?: () => void }) {
  const t = useT();
  const steps: { icon: ReactNode; title: Key; text: Key }[] = [
    { icon: <Landmark size={20} />, title: 'campaign.how.map_title', text: 'campaign.how.map_text' },
    { icon: <ScrollText size={20} />, title: 'campaign.how.orders_title', text: 'campaign.how.orders_text' },
    { icon: <Swords size={20} />, title: 'campaign.how.battle_title', text: 'campaign.how.battle_text' },
    { icon: <BookOpen size={20} />, title: 'campaign.how.renown_title', text: 'campaign.how.renown_text' },
    { icon: <Trophy size={20} />, title: 'campaign.how.season_title', text: 'campaign.how.season_text' },
  ];
  const numbers = { orders: RULES.ORDERS_PER_DAY, bank: RULES.ORDERS_BANK, days: RULES.SEASON_DAYS, rounds: RULES.BATTLE_ROUNDS, max: RULES.GARRISON_MAX };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="event"
      title={t('campaign.how.title')}
      width="min(560px, 100vw - 24px)"
      initialFocus="[data-autofocus]"
      footer={
        <>
          {onPractice && <button type="button" className="btn" onClick={onPractice}>{t('campaign.practice.try')}</button>}
          <button type="button" className="btn primary" onClick={onClose} data-autofocus>{t('campaign.how.close')}</button>
        </>
      }
    >
      <ol className="cg-how">
        {steps.map((s) => (
          <li key={s.title}>
            <span className="cg-how-icon" aria-hidden>{s.icon}</span>
            <div><b>{t(s.title, numbers)}</b><p>{t(s.text, numbers)}</p></div>
          </li>
        ))}
      </ol>
      <p className="cg-how-foot">{t('campaign.how.foot')}</p>
    </Dialog>
  );
}
