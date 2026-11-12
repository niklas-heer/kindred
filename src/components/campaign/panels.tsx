// The campaign page's panels: the family's tables (this week, all time, the houses), a house's renown with what would
// raise it, the seasons of the old shared game, and "how it works". All of them only read.
import { Link } from '@tanstack/react-router';
import { BookOpen, Castle, Crown, Mountain, Swords, Trophy, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Arms } from '~/components/Heraldry';
import { Dialog, Segmented } from '~/components/ui';
import { RULES } from '~/lib/campaign/engine';
import { RENOWN_STEPS, type RenownKey } from '~/lib/campaign/renown';
import type { BoardRow, FameEntry, Leaderboard, SideView, StoredSide } from '~/lib/campaign/types';
import { formatDate, useT, type Key } from '~/lib/i18n';
import { TITLE_NAME } from './Chronicle';
import { Laurel } from './parts';

// ---------- the tables ----------

export function LeaderboardPanel({ board, sides }: { board: Leaderboard; sides: Pick<StoredSide, 'id' | 'name' | 'arms'>[] }) {
  const t = useT();
  const [tab, setTab] = useState<'week' | 'all' | 'houses'>('week');
  const sideOf = (id: string) => sides.find((s) => s.id === id);
  // The note about renown and the quiz shows only where a line carries one of them.
  const advantaged = [...(tab === 'week' ? board.week : board.allTime), ...((tab === 'week' ? board.earlier?.week : board.earlier?.allTime) ?? [])].some((r) => (r.renown ?? 0) > 0 || (r.grant ?? 0) > 0);
  const rows = (list: BoardRow[], all: boolean) => (
    <ol className="cg-table">
      {list.map((r, i) => {
        const side = sideOf(r.side);
        return (
          <li key={`${r.name}-${i}`} className={r.mine ? 'is-mine' : ''} aria-current={r.mine ? 'true' : undefined}>
            <span className="cg-table-rank">{r.rank}</span>
            {side ? <Arms arms={side.arms} size={22} /> : <span />}
            <span className="cg-table-name"><b>{r.name}</b><small>{all ? t('campaign.board.week_of', { week: r.week?.slice(6) ?? '' }) : t('campaign.board.runs', { count: r.runs ?? 0 })}{r.title && <> · {t(TITLE_NAME[r.title])}</>}</small></span>
            {/* What the levy had beyond the base, beside the score it helped to make. */}
            <span className="cg-table-adv">
              {(r.renown ?? 0) > 0 && <span className="cg-adv is-renown">{t('campaign.board.adv_renown', { count: r.renown ?? 0 })}</span>}
              {(r.grant ?? 0) > 0 && <span className="cg-adv is-quiz">{t('campaign.board.adv_grant', { count: r.grant ?? 0 })}</span>}
            </span>
            <span className="cg-table-score">{r.score}</span>
          </li>
        );
      })}
    </ol>
  );
  // Reigns played under earlier rules: kept as they were, shown apart, and never ranked with today's.
  const earlier = (list: BoardRow[] | undefined) => !!list?.length && (
    <div className="cg-earlier">
      <h3>{t('campaign.board.earlier')}</h3>
      {rows(list, true)}
      <p className="subtle cg-note">{t('campaign.board.earlier_note')}</p>
    </div>
  );
  return (
    <section className="ui-card cg-panel" aria-labelledby="cg-board-h">
      <h2 className="cg-h" id="cg-board-h"><Trophy size={18} aria-hidden /> {t('campaign.board.title')}</h2>
      <Segmented
        aria-label={t('campaign.board.title')}
        size="sm"
        value={tab}
        onChange={setTab}
        options={[{ value: 'week', label: t('campaign.board.week') }, { value: 'all', label: t('campaign.board.all') }, { value: 'houses', label: t('campaign.board.houses') }]}
      />
      {tab === 'week' && (board.week.length ? rows(board.week, false) : <p className="muted cg-note">{t('campaign.board.empty')}</p>)}
      {tab === 'week' && earlier(board.earlier?.week)}
      {tab === 'all' && (board.allTime.length ? rows(board.allTime, true) : <p className="muted cg-note">{t('campaign.board.empty_all')}</p>)}
      {tab === 'all' && earlier(board.earlier?.allTime)}
      {tab === 'houses' && (board.houses.length ? (
        <>
          <h3 className="cg-table-label">{t('campaign.board.houses_label')}</h3>
          <ol className="cg-table">
            {board.houses.map((h) => (
              <li key={h.side}>
                <span className="cg-table-rank">{h.rank}</span>
                <Arms arms={h.arms} size={22} />
                <span className="cg-table-name"><b>{h.name}</b><small>{t('campaign.board.members', { count: h.members })}</small></span>
                <span className="cg-table-adv" />
                <span className="cg-table-score">{h.total}</span>
              </li>
            ))}
          </ol>
        </>
      ) : <p className="muted cg-note">{t('campaign.board.empty')}</p>)}
      <p className="subtle cg-note">{tab === 'houses' ? t('campaign.board.houses_note') : t('campaign.board.note')}</p>
      {tab !== 'houses' && advantaged && <p className="subtle cg-note">{t('campaign.board.adv_note')}</p>}
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

export function RenownCard({ side, tree }: { side: SideView; tree: string }) {
  const t = useT();
  const r = side.renown;
  return (
    <section className="ui-card cg-panel cg-renown" aria-labelledby="cg-renown-h">
      <h2 className="cg-h" id="cg-renown-h"><BookOpen size={18} aria-hidden /> {t('campaign.renown.title', { house: side.name })}</h2>
      <p className="muted cg-note">{t('campaign.renown.what', { max: RULES.RENOWN_MAX_BONUS })}</p>
      <div className="cg-score">
        <b className="cg-score-n">{r.score}</b><span className="subtle"> / 100</span>
        <div className="cg-meter" role="img" aria-label={t('campaign.renown.score', { score: r.score })}>
          <span style={{ width: `${r.score}%` }} />
          {RENOWN_STEPS.map((step) => <i key={step} style={{ left: `${step}%` }} />)}
        </div>
        <p className="cg-next"><b>{t('campaign.levy.renown', { count: r.bonus })}</b> · {r.toNext === null ? t('campaign.renown.top') : t('campaign.renown.next', { count: r.toNext })}</p>
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
      {r.tips.length > 0 && (
        <div className="cg-tips">
          <h3>{t('campaign.tip.title')}</h3>
          <ul>
            {r.tips.map((key) => <li key={key}>{t(TIP[key], { house: side.name })}</li>)}
          </ul>
          <div className="cg-tip-links">
            <Link className="btn" to="/$tree/needed" params={{ tree }}>{t('campaign.tip.needed')}</Link>
            {!side.rival && <Link className="btn" to="/$tree/house/$house" params={{ tree, house: side.id }}>{t('campaign.tip.house', { house: side.name })}</Link>}
          </div>
        </div>
      )}
      <p className="subtle cg-note">{t('campaign.renown.fixed')}</p>
    </section>
  );
}

// ---------- the seasons of old ----------

export function SeasonsOfOld({ fame }: { fame: FameEntry[] }) {
  const t = useT();
  if (!fame.length) return null;
  return (
    <section className="ui-card cg-panel" aria-labelledby="cg-fame-h">
      <h2 className="cg-h" id="cg-fame-h"><Laurel size={18} /> {t('campaign.fame.title')}</h2>
      <p className="muted cg-note">{t('campaign.fame.what')}</p>
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
    </section>
  );
}

// ---------- how it works ----------

/**
 * "How the Campaign works". `onPlay` is the main action when the page offers one (a practice reign while the game is
 * off); without it the dialog just closes.
 */
export function HowItWorks({ open, onClose, onPlay, playLabel }: { open: boolean; onClose: () => void; onPlay?: () => void; playLabel?: string }) {
  const t = useT();
  const steps: { icon: ReactNode; title: Key; text: Key }[] = [
    { icon: <Crown size={20} />, title: 'campaign.how.reign_title', text: 'campaign.how.reign_text' },
    { icon: <Users size={20} />, title: 'campaign.how.turn_title', text: 'campaign.how.turn_text' },
    { icon: <Swords size={20} />, title: 'campaign.how.battle_title', text: 'campaign.how.battle_text' },
    { icon: <Mountain size={20} />, title: 'campaign.how.land_title', text: 'campaign.how.land_text' },
    { icon: <BookOpen size={20} />, title: 'campaign.how.renown_title', text: 'campaign.how.renown_text' },
    { icon: <Castle size={20} />, title: 'campaign.how.score_title', text: 'campaign.how.score_text' },
  ];
  const numbers = { turns: RULES.TURNS, orders: RULES.ORDERS_PER_TURN, rounds: RULES.BATTLE_ROUNDS, max: RULES.RENOWN_MAX_BONUS, short: RULES.CROSSING_ROUNDS, marsh: RULES.MARSH_GARRISON_MAX };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="event"
      title={t('campaign.how.title')}
      width="min(640px, 100vw - 24px)"
      initialFocus="[data-autofocus]"
      footer={
        onPlay ? (
          <>
            <button type="button" className="btn" onClick={onClose}>{t('campaign.how.later')}</button>
            <button type="button" className="btn primary" onClick={onPlay} data-autofocus>{playLabel}</button>
          </>
        ) : <button type="button" className="btn primary" onClick={onClose} data-autofocus>{t('campaign.how.close')}</button>
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
