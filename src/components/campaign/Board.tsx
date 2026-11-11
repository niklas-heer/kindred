// The board of a reign: the map (or the same provinces as a list), the turn's three steps, and the order bar.
//
// A turn has three steps: 1 Reinforce (each press on a province of one's own places one troop of the levy, which costs
// no order), 2 Orders (three marches or attacks), 3 End turn (the regents move, and their attacks are shown briefly).
//
// Choosing an order is a small state machine, the same on the map and in the list:
//   inspect  a press on any province shows what it is; nothing else happens.
//   select   a press on a province of one's own with troops to spare chooses it: a thick gold outline, everything it
//            cannot reach dims, and its neighbours are ringed (footprints for a march, swords and the chance for an
//            attack, a lock for a seat).
//   target   a press on a ringed neighbour draws the arrow and opens the order bar: how many troops, the exact chance,
//            and a button that says what will happen ("March 4", "Attack with 4").
//   confirm  only that button moves anything. Escape, Back or a press on the sea goes one step back; a press on another
//            province of one's own only chooses that one instead.
// Marches and placed troops can be undone until the turn ends (back to the last battle).
import { Crown, Flag, List, Map as MapIcon, Minus, Plus, Sunrise, Swords, Undo2, X, Footprints, Lock, Tent, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Arms } from '~/components/Heraldry';
import { Segmented } from '~/components/ui';
import { CampaignError, RULES, capOf, levyOf, neighbours, orderTroops, sendable, terrainOf, winChance, type GameEvent, type GameMap, type Move, type Reign, type Terrain } from '~/lib/campaign/engine';
import type { StoredSide } from '~/lib/campaign/types';
import { useT, type Key } from '~/lib/i18n';
import { play as sound } from '~/lib/sfx';
import { toast } from '~/lib/toast';
import { errorText } from '~/lib/errortext';
import { CampaignMap, TERRAIN_NAME, TERRAIN_RULE, TerrainIcon, type Reach } from './CampaignMap';
import type { ReignGame } from './reign';

export type BoardSide = Pick<StoredSide, 'id' | 'name' | 'arms' | 'rival'>;
type Attack = Extract<GameEvent, { t: 'attack' }>;

/** A laurel wreath: the mark of a season won, and of a best score. */
export function Laurel({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`cg-laurel ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M12 21c-5-1-8-5-8-10M12 21c5-1 8-5 8-10" />
      <path d="M4.2 8.5c1.6.2 2.6 1.2 2.8 2.8M5 13c1.500-.3 2.800.4 3.400 1.800M7.200 17c1.300-.6 2.700-.2 3.600.9M19.800 8.500c-1.600.2-2.600 1.200-2.800 2.800M19 13c-1.500-.3-2.800.4-3.400 1.800M16.800 17c-1.300-.6-2.700-.2-3.600.9" />
    </svg>
  );
}

/** What the terrain does to a battle, as the preview says it ("defender +1"); nothing for plains and towns. */
const MOD: Partial<Record<Terrain, Key>> = { forest: 'campaign.preview.forest', highland: 'campaign.preview.highland' };

type Choice =
  | { k: 'none' }
  | { k: 'inspect'; id: number }
  | { k: 'select'; from: number }
  | { k: 'target'; from: number; to: number; troops: number };

export interface BoardProps {
  reign: Reign;
  sides: BoardSide[];
  game: ReignGame;
  /** The player's attack was fought: the page shows the battle. */
  onAttack: (battle: Attack) => void;
  /** Where renown comes from: a link to Information needed, shown with the levy. */
  renownLink?: ReactNode;
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const REPLAY_MS = 1100;

export function Board({ reign, sides, game, onAttack, renownLink }: BoardProps) {
  const t = useT();
  const { map, player } = reign;
  const { state } = game;
  const [view, setView] = useState<'map' | 'list'>('map');
  const [pick, setPick] = useState<Choice>({ k: 'none' });
  const [skipped, setSkipped] = useState(-1);
  const [replay, setReplay] = useState<{ events: Attack[]; at: number; turn: number } | null>(null);
  const seats = useMemo(() => new Set(Object.values(state.seats)), [state.seats]);
  const nameOf = (side: string | null) => (side ? sides.find((s) => s.id === side)?.name ?? side : t('campaign.free'));
  const isMine = (id: number) => state.holder[id] === player;
  const pool = state.pool[player] ?? 0;
  const over = game.over;
  // Step 1 while levy waits and the player has not moved on; step 2 after.
  const step: 1 | 2 = !over && pool > 0 && skipped !== state.turn ? 1 : 2;
  const levy = levyOf(state, map, player, reign.renown, state.turn === 0 ? reign.grant : 0);

  /** What a province of one's own can reach, with the chance of an attack sent with all it can spare. */
  const reachOf = (from: number): Map<number, Reach> => {
    const out = new Map<number, Reach>();
    const spare = state.troops[from] - 1;
    for (const to of neighbours(map, from)) {
      const h = state.holder[to];
      if (h === player) { if (state.troops[to] < capOf(map, to)) out.set(to, { kind: 'march' }); }
      else if (h !== null && seats.has(to)) out.set(to, { kind: 'locked' });
      else out.set(to, { kind: 'attack', chance: winChance(spare, state.troops[to], terrainOf(map, to)) });
    }
    return out;
  };
  const from = pick.k === 'select' || pick.k === 'target' ? pick.from : null;
  const reach = useMemo(() => (from !== null ? reachOf(from) : new Map<number, Reach>()),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- reachOf reads only the position, the map and the player, listed here
    [from, state, map, player]);

  // A new turn starts with nothing chosen.
  const [turnSeen, setTurnSeen] = useState(state.turn);
  if (turnSeen !== state.turn) { setTurnSeen(state.turn); setPick({ k: 'none' }); }

  const refuse = (e: unknown) => {
    if (e instanceof CampaignError) toast({ title: t('campaign.err.title'), body: t(e.message as Key) });
    else toast({ title: t('campaign.err.title'), body: errorText(e, t.locale) });
  };

  const maxFor = (f: number, to: number) => sendable(state, map, player, f, to);
  // Taking a move back changes what a province can spare, so an open order goes with it.
  const undo = () => { game.undo(); setPick({ k: 'none' }); };

  const choose = (id: number) => {
    if (over || replay) { setPick({ k: 'inspect', id }); return; }
    if (step === 1) {
      if (isMine(id)) {
        try { game.move({ t: 'place', to: id }); sound('tick'); } catch (e) { refuse(e); }
      }
      setPick({ k: 'inspect', id });
      return;
    }
    if (from !== null && from !== id) {
      const r = reach.get(id);
      if (r && r.kind !== 'locked') { setPick({ k: 'target', from, to: id, troops: maxFor(from, id) }); return; }
    }
    if (isMine(id) && state.troops[id] >= 2 && state.orders > 0) {
      setPick(pick.k === 'select' && pick.from === id ? { k: 'inspect', id } : { k: 'select', from: id });
      return;
    }
    setPick({ k: 'inspect', id });
  };
  const back = () => setPick(pick.k === 'target' ? { k: 'select', from: pick.from } : { k: 'none' });

  useEffect(() => {
    if (pick.k === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A dialog over the board (a battle) handles its own Escape.
      if (document.querySelector('dialog[open]')) return;
      setPick(pick.k === 'target' ? { k: 'select', from: pick.from } : { k: 'none' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);

  const confirm = () => {
    if (pick.k !== 'target') return;
    const kind = isMine(pick.to) ? 'march' : 'attack';
    try {
      const troops = orderTroops(pick.troops, state, map, player, pick.from, pick.to);
      const events = game.move({ t: kind, from: pick.from, to: pick.to, troops } as Move);
      const e = events[0];
      setPick({ k: 'none' });
      if (e?.t === 'attack') onAttack(e);
      else sound('tick');
    } catch (err) { refuse(err); }
  };

  const endTurn = () => {
    try {
      const turn = state.turn;
      const events = game.move({ t: 'end' }).filter((e): e is Attack => e.t === 'attack');
      setPick({ k: 'none' });
      sound('page');
      setReplay(events.length && !reducedMotion() ? { events, at: 0, turn } : null);
      setReport({ turn, events });
    } catch (err) { refuse(err); }
  };
  const [report, setReport] = useState<{ turn: number; events: Attack[] } | null>(null);

  // The regents' attacks, one after another; "Skip" ends it.
  useEffect(() => {
    if (!replay) return;
    const id = window.setTimeout(() => setReplay(replay.at + 1 < replay.events.length ? { ...replay, at: replay.at + 1 } : null), REPLAY_MS);
    return () => window.clearTimeout(id);
  }, [replay]);
  const shown = replay ? replay.events[replay.at] : null;

  const line = (e: Attack) => {
    const vars = { house: nameOf(e.side), province: map.provinces[e.to].name, defender: nameOf(e.defender) };
    if (e.defender === player) return t(e.took ? 'campaign.report.took_yours' : 'campaign.report.held_yours', vars);
    return t(e.took ? (e.defender ? 'campaign.report.took' : 'campaign.report.claimed') : 'campaign.report.repelled', vars);
  };

  const arrow = shown ? { from: shown.from, to: shown.to, kind: 'attack' as const }
    : pick.k === 'target' ? { from: pick.from, to: pick.to, kind: isMine(pick.to) ? ('march' as const) : ('attack' as const) } : null;
  const selected = from;
  const marked = shown ? shown.to : pick.k === 'inspect' ? pick.id : null;

  return (
    <div className={`cg-board${pick.k === 'target' ? ' has-bar' : ''}`}>
      <div className="cg-field">
        <div className="cg-field-head">
          <Segmented
            aria-label={t('campaign.view.label')}
            size="sm"
            value={view}
            onChange={setView}
            options={[{ value: 'map', label: t('campaign.view.map'), icon: <MapIcon size={14} /> }, { value: 'list', label: t('campaign.view.list'), icon: <List size={14} /> }]}
          />
          <span className="cg-legend subtle"><Crown size={14} aria-hidden /> {t('campaign.legend.seat')}</span>
        </div>
        {shown && (
          <p className="cg-replay" role="status">
            <Swords size={15} aria-hidden /> {line(shown)}
            <button type="button" className="btn ghost sm" onClick={() => setReplay(null)}>{t('campaign.report.skip')}</button>
          </p>
        )}
        {view === 'map' ? (
          <CampaignMap map={map} state={state} sides={sides} player={player} selected={selected} reach={reach} arrow={arrow} marked={marked} onSelect={choose} onClear={() => setPick({ k: 'none' })} />
        ) : (
          <ul className="cg-list" aria-label={t('campaign.map.label')}>
            {[...map.provinces].sort((a, b) => Number(isMine(b.id)) - Number(isMine(a.id)) || a.name.localeCompare(b.name, t.locale)).map((p) => {
              const side = sides.find((s) => s.id === state.holder[p.id]);
              const r = reach.get(p.id);
              const terrain = terrainOf(map, p.id);
              const dim = selected !== null && selected !== p.id && !r;
              return (
                <li key={p.id}>
                  <button type="button" className={`cg-row${selected === p.id ? ' is-selected' : ''}${r ? ` is-${r.kind}` : ''}${dim ? ' is-dim' : ''}`} aria-pressed={selected === p.id} onClick={() => choose(p.id)} data-province={p.name}>
                    {side ? <Arms arms={side.arms} size={24} /> : <Flag size={20} className="cg-row-free" aria-hidden />}
                    <span className="cg-row-text">
                      <b>{p.name}{seats.has(p.id) && <Crown size={13} aria-hidden />}</b>
                      <small><TerrainIcon terrain={terrain} size={12} /> {t(TERRAIN_NAME[terrain])} · {side?.name ?? t('campaign.free')}</small>
                    </span>
                    <span className="cg-row-end">
                      {r && <ReachMark reach={r} />}
                      <span className="cg-row-troops"><span aria-hidden>{state.troops[p.id]}</span><span className="sr-only">{t('campaign.troops', { count: state.troops[p.id] })}. {isMine(p.id) ? t('campaign.map.yours') : ''}</span></span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <TerrainLegend />
      </div>

      <aside className="ui-card cg-orders" aria-label={t('campaign.orders.title')}>
        <div className="cg-turn-head">
          <h2 className="cg-h">{over ? t('campaign.reign.over') : t('campaign.reign.turn', { turn: state.turn + 1, turns: RULES.TURNS })}</h2>
          <span className="cg-score-now" data-testid="score-now">{t('campaign.reign.score_now', { score: game.score.total })}</span>
        </div>
        {!over && (
          <ol className="cg-steps" aria-label={t('campaign.steps.label')}>
            <li className={step === 1 ? 'is-on' : 'is-done'} aria-current={step === 1 ? 'step' : undefined}>
              {/* Levy left after "Done placing": the step can be returned to until the turn ends. */}
              {step === 2 && pool > 0 ? (
                <button type="button" className="cg-step-back" onClick={() => { setSkipped(-1); setPick({ k: 'none' }); }} aria-label={t('campaign.steps.reinforce_back', { count: pool })} title={t('campaign.steps.reinforce_back', { count: pool })}>
                  <b>1</b> {t('campaign.steps.reinforce')} <Undo2 size={13} aria-hidden />
                </button>
              ) : <><b>1</b> {t('campaign.steps.reinforce')}</>}
            </li>
            <li className={step === 2 ? 'is-on' : ''} aria-current={step === 2 ? 'step' : undefined}><b>2</b> {t('campaign.steps.orders', { count: state.orders })}</li>
            <li><b>3</b> {t('campaign.steps.end')}</li>
          </ol>
        )}

        {!over && step === 1 && (
          <section className="cg-act" aria-labelledby="cg-step1">
            <h3 id="cg-step1"><Tent size={15} aria-hidden /> {t('campaign.reinforce.title', { count: pool })}</h3>
            <p className="muted cg-note">{t('campaign.reinforce.how')}</p>
            <p className="cg-levy" data-testid="levy">
              {t('campaign.levy.line', { total: levy.total, base: levy.base, towns: levy.towns })}
              {levy.renown > 0 && <> · <b>{t('campaign.levy.renown', { count: levy.renown })}</b></>}
              {levy.grant > 0 && <> · {t('campaign.levy.grant', { count: levy.grant })}</>}
            </p>
            {renownLink}
            <div className="cg-step-actions">
              <button type="button" className="btn" disabled={!game.canUndo} onClick={undo}><Undo2 size={15} /> {t('campaign.undo')}</button>
              <button type="button" className="btn primary" onClick={() => { setSkipped(state.turn); setPick({ k: 'none' }); }}>{t('campaign.reinforce.done')} <ChevronRight size={15} /></button>
            </div>
          </section>
        )}

        {!over && step === 2 && (
          <section className="cg-act" aria-labelledby="cg-step2">
            <h3 id="cg-step2"><Swords size={15} aria-hidden /> {t('campaign.orders.left', { count: state.orders })}</h3>
            <span className="cg-pips" aria-hidden>{Array.from({ length: RULES.ORDERS_PER_TURN }, (_, i) => <i key={i} className={i < state.orders ? 'on' : ''} />)}</span>
            <p className="muted cg-note">{state.orders > 0 ? t('campaign.orders.how') : t('campaign.orders.none')}</p>
            {pool > 0 && <p className="subtle cg-note">{t('campaign.orders.kept', { count: pool })}</p>}
          </section>
        )}

        {pick.k === 'inspect' && <Inspect id={pick.id} map={map} state={state} sides={sides} player={player} step={step} onClose={() => setPick({ k: 'none' })} />}
        {pick.k === 'select' && (
          <div className="cg-sel" role="status">
            <p className="cg-note"><b>{map.provinces[pick.from].name}</b> · {t('campaign.select.text', { count: state.troops[pick.from] - 1 })}</p>
            <button type="button" className="btn ghost" onClick={back}>{t('campaign.cancel')}</button>
          </div>
        )}

        {pick.k === 'target' && (
          <OrderBar
            key={`${pick.from}-${pick.to}`}
            map={map} state={state} from={pick.from} to={pick.to} troops={pick.troops} max={maxFor(pick.from, pick.to)} march={isMine(pick.to)}
            defender={nameOf(state.holder[pick.to])}
            onTroops={(n) => setPick({ ...pick, troops: n })}
            onBack={back}
            onConfirm={confirm}
          />
        )}

        {!over && (
          <div className="cg-turn">
            {step === 2 && <button type="button" className="btn" disabled={!game.canUndo} onClick={undo}><Undo2 size={15} /> {t('campaign.undo')}</button>}
            <button type="button" className={`btn${step === 2 && pick.k !== 'target' ? ' primary' : ''}`} onClick={endTurn} disabled={!!replay}><Sunrise size={16} /> {state.turn + 1 >= RULES.TURNS ? t('campaign.end.last') : t('campaign.end.turn')}</button>
          </div>
        )}

        {report && !replay && (
          <section className="cg-report" aria-labelledby="cg-report-h">
            <h3 id="cg-report-h">{t('campaign.report.title', { turn: report.turn + 1 })}</h3>
            {report.events.length ? <ul>{report.events.map((e, i) => <li key={i} className={e.defender === player && e.took ? 'is-loss' : ''}>{line(e)}</li>)}</ul> : <p className="muted cg-note">{t('campaign.report.quiet')}</p>}
          </section>
        )}
      </aside>
    </div>
  );
}

function ReachMark({ reach }: { reach: Reach }) {
  const t = useT();
  if (reach.kind === 'march') return <span className="cg-reach is-march"><Footprints size={13} aria-hidden /><span className="sr-only">{t('campaign.reach.march')}</span></span>;
  if (reach.kind === 'locked') return <span className="cg-reach is-locked"><Lock size={13} aria-hidden /><span className="sr-only">{t('campaign.map.seat')}</span></span>;
  return <span className="cg-reach is-attack"><Swords size={13} aria-hidden /> {Math.round(reach.chance * 100)}%<span className="sr-only"> {t('campaign.reach.attack')}</span></span>;
}

function Inspect({ id, map, state, sides, player, step, onClose }: { id: number; map: GameMap; state: ReignGame['state']; sides: BoardSide[]; player: string; step: 1 | 2; onClose: () => void }) {
  const t = useT();
  const p = map.provinces[id];
  const held = state.holder[id];
  const side = sides.find((s) => s.id === held);
  const terrain = terrainOf(map, id);
  const seat = held !== null && state.seats[held] === id;
  const mine = held === player;
  return (
    <div className="cg-sel">
      <div className="cg-sel-head">
        {side ? <Arms arms={side.arms} size={34} /> : <Flag size={26} className="cg-row-free" aria-hidden />}
        <div>
          <h3>{p.name}{seat && <Crown size={15} aria-label={t('campaign.map.seat')} />}</h3>
          <p className="muted">{side ? t('campaign.sel.held', { house: side.name, count: state.troops[id] }) : t('campaign.sel.free', { count: state.troops[id] })}</p>
        </div>
        <button type="button" className="btn icon ghost" onClick={onClose} aria-label={t('campaign.sel.clear')}><X size={15} /></button>
      </div>
      <p className="cg-terrain-line"><TerrainIcon terrain={terrain} size={15} /> <b>{t(TERRAIN_NAME[terrain])}</b> · {t(TERRAIN_RULE[terrain], { cap: capOf(map, id) })}</p>
      {seat && <p className="subtle cg-note">{mine ? t('campaign.sel.seatYours') : t('campaign.sel.seatTheirs')}</p>}
      {mine && step === 2 && state.troops[id] < 2 && <p className="subtle cg-note">{t('campaign.from.one')}</p>}
      {mine && step === 2 && state.troops[id] >= 2 && state.orders < 1 && <p className="subtle cg-note">{t('campaign.orders.none')}</p>}
    </div>
  );
}

function OrderBar({ map, state, from, to, troops, max, march, defender, onTroops, onBack, onConfirm }: {
  map: GameMap; state: ReignGame['state']; from: number; to: number; troops: number; max: number; march: boolean; defender: string;
  onTroops: (n: number) => void; onBack: () => void; onConfirm: () => void;
}) {
  const t = useT();
  const n = Math.max(1, Math.min(troops, max));
  const terrain = terrainOf(map, to);
  const chance = winChance(n, state.troops[to], terrain);
  const mod = MOD[terrain];
  return (
    <section className="cg-orderbar" aria-labelledby="cg-bar-h">
      <h3 id="cg-bar-h">
        {march ? <Footprints size={15} aria-hidden /> : <Swords size={15} aria-hidden />}{' '}
        {t(march ? 'campaign.march.title' : 'campaign.attack.title', { from: map.provinces[from].name, to: map.provinces[to].name })}
      </h3>
      {max > 0 ? (
        <>
          <div className="cg-troops" role="group" aria-label={t('campaign.orders.howMany')}>
            <button type="button" className="btn icon" onClick={() => onTroops(n - 1)} disabled={n <= 1} aria-label={t('campaign.orders.fewer')}><Minus size={15} /></button>
            <output aria-live="polite" data-testid="troops">{n}</output>
            <button type="button" className="btn icon" onClick={() => onTroops(n + 1)} disabled={n >= max} aria-label={t('campaign.orders.more')}><Plus size={15} /></button>
            <button type="button" className="btn ghost" onClick={() => onTroops(max)} disabled={n >= max}>{t('campaign.orders.all', { count: max })}</button>
          </div>
          {!march && (
            <p className="cg-odds" data-odds={chance >= 0.65 ? 'good' : chance >= 0.4 ? 'fair' : 'poor'} data-testid="chance">
              {t('campaign.preview.line', { send: n, against: state.troops[to], defender, terrain: t(TERRAIN_NAME[terrain]), mod: mod ? ` ${t(mod)}` : '', chance: Math.round(chance * 100) })}
            </p>
          )}
        </>
      ) : (
        <p className="subtle cg-note">{t('campaign.full', { max: capOf(map, to) })}</p>
      )}
      <div className="cg-form-actions">
        <button type="button" className="btn" onClick={onBack}>{t('campaign.orders.back')}</button>
        <button type="button" className="btn primary" disabled={max < 1} onClick={onConfirm}>{t(march ? 'campaign.march.go' : 'campaign.attack.go', { count: n })}</button>
      </div>
    </section>
  );
}

/** The four kinds of land and what each does, labelled as the game's own terrain. */
export function TerrainLegend() {
  const t = useT();
  return (
    <details className="cg-terrain-legend">
      <summary>{t('campaign.terrain.legend')}</summary>
      <ul>
        {(['plains', 'forest', 'highland', 'town'] as const).map((k) => (
          <li key={k}><span className={`cg-swatch is-${k}`} aria-hidden><TerrainIcon terrain={k} size={14} /></span> <b>{t(TERRAIN_NAME[k])}</b> {t(TERRAIN_RULE[k], { cap: k === 'town' ? RULES.TOWN_GARRISON_MAX : RULES.GARRISON_MAX })}</li>
        ))}
      </ul>
      <p className="subtle">{t('campaign.terrain.note')}</p>
    </details>
  );
}
