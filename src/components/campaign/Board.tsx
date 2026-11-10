// The campaign's playing board: the standings of the houses, the map (or the same provinces as a list), and the orders
// panel where a member musters, marches and attacks. The live season and the practice skirmish both use it; the page
// decides what an order does (a server call, or the engine in the browser).
import { Crown, Flag, Footprints, List, Map as MapIcon, Minus, Plus, Swords, Tent, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Arms } from '~/components/Heraldry';
import { Segmented } from '~/components/ui';
import { RULES, levyOf, neighbours, provincesOf, standings, troopsOf, type GameMap, type Order, type State } from '~/lib/campaign/engine';
import type { SideView } from '~/lib/campaign/types';
import { useT } from '~/lib/i18n';
import { CampaignMap } from './CampaignMap';

/** A laurel wreath: the mark of a season won. */
export function Laurel({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`cg-laurel ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M12 21c-5-1-8-5-8-10M12 21c5-1 8-5 8-10" />
      <path d="M4.2 8.5c1.6.2 2.6 1.2 2.8 2.8M5 13c1.500-.3 2.800.4 3.400 1.800M7.200 17c1.300-.6 2.700-.2 3.600.9M19.800 8.500c-1.600.2-2.600 1.200-2.800 2.800M19 13c-1.500-.3-2.800.4-3.400 1.800M16.800 17c-1.300-.6-2.700-.2-3.600.9" />
    </svg>
  );
}

// ---------- standings ----------

export function Standings({ sides, state, mySide }: { sides: SideView[]; state: State; mySide: string | null }) {
  const t = useT();
  const ids = sides.map((s) => s.id);
  const order = standings(state, ids);
  const total = state.holder.length;
  return (
    <ol className="cg-standings" aria-label={t('campaign.standings.label')}>
      {order.map((row, i) => {
        const side = sides.find((s) => s.id === row.side)!;
        const levy = levyOf(state, side.id, side.renown.bonus, ids);
        const mine = side.id === mySide;
        return (
          <li key={side.id} className={`ui-card cg-side${mine ? ' is-mine' : ''}`} aria-current={mine ? 'true' : undefined}>
            <div className="cg-side-top">
              <span className="cg-side-rank" aria-hidden>{i + 1}</span>
              <Arms arms={side.arms} size={34} />
              <b className="cg-side-name">
                {side.name}
                {side.laurels > 0 && <span className="cg-side-laurels" title={t('campaign.standings.laurels', { count: side.laurels })}><Laurel size={15} /><span className="sr-only">{t('campaign.standings.laurels', { count: side.laurels })}</span>{side.laurels > 1 ? <span aria-hidden>×{side.laurels}</span> : null}</span>}
              </b>
            </div>
            <span className="cg-side-line cg-side-count">{t('campaign.standings.provinces', { count: row.provinces })} · {t('campaign.standings.troops', { count: row.troops })}</span>
            <span className="cg-side-line subtle">{t('campaign.standings.levy', { count: levy.total })}</span>
            <span className="cg-side-line subtle">
              {mine ? t('campaign.standings.yours') : side.rival ? t('campaign.standings.company') : side.members > 0 ? t('campaign.standings.played', { count: side.members }) : t('campaign.standings.regent')}
              {side.allies.length > 0 && <span title={side.allies.map((a) => a.name).join(', ')}> · {t('campaign.standings.allies', { count: side.allies.length })}<span className="sr-only">: {side.allies.map((a) => a.name).join(', ')}</span></span>}
            </span>
            <span className="cg-side-bar" aria-hidden><span style={{ width: `${(row.provinces / total) * 100}%` }} /></span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- the board ----------

export interface BoardProps {
  map: GameMap;
  sides: SideView[];
  state: State;
  mySide: string | null;
  /** Orders left today; null in the practice skirmish, where they are not counted. */
  orders: number | null;
  changed: ReadonlySet<number>;
  busy: boolean;
  /** Sends an order. Resolves true when it was played, so the form can close. */
  onOrder: (order: Order, cry: string | null) => Promise<boolean>;
  /** Shown under the orders: the practice skirmish puts "End turn" here. */
  footer?: ReactNode;
  /** The game is over (a finished practice skirmish): the board is shown, and no order can be given. */
  over?: boolean;
}

type Action = { type: 'march' | 'attack'; to: number };

export function Board({ map, sides, state, mySide, orders, changed, busy, onOrder, footer, over }: BoardProps) {
  const t = useT();
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selected, setSelected] = useState<number | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const seats = useMemo(() => new Set(Object.values(state.seats)), [state.seats]);
  const nameOf = (side: string | null) => (side ? sides.find((s) => s.id === side)?.name : undefined);
  const isMine = (id: number) => !!mySide && state.holder[id] === mySide;
  const canOrder = !over && !!mySide && (orders === null || orders > 0);

  /** Where an order from `from` could go: its own neighbours, and any other neighbour that is not a seat. */
  const reach = (from: number) => neighbours(map, from).filter((to) => isMine(to) || !(state.holder[to] !== null && seats.has(to)));
  const targets = useMemo(() => new Set(selected !== null && isMine(selected) && !over ? reach(selected) : []),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- isMine and reach read only what is listed here
    [selected, state, map, mySide, over]);

  // Under a narrow map the orders are below it: a choice brings them into view, so the next step is never off screen.
  const panel = useRef<HTMLElement>(null);
  const reveal = () => requestAnimationFrame(() => {
    if (!panel.current || window.innerWidth > 1000) return;
    const calm = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.current.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  });

  const choose = (id: number) => {
    reveal();
    // A press on a province the selected one can reach sets the order's target; a second press on it selects it instead.
    if (selected !== null && selected !== id && targets.has(id) && action?.to !== id) {
      setAction({ type: isMine(id) ? 'march' : 'attack', to: id });
      return;
    }
    setSelected(selected === id && !action ? null : id);
    setAction(null);
  };

  return (
    <div className="cg-board">
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
        {view === 'map' ? (
          <CampaignMap map={map} state={state} sides={sides} mySide={mySide} selected={selected} targets={targets} changed={changed} onSelect={choose} />
        ) : (
          <ul className="cg-list" aria-label={t('campaign.map.label')}>
            {[...map.provinces].sort((a, b) => Number(isMine(b.id)) - Number(isMine(a.id)) || a.name.localeCompare(b.name, t.locale)).map((p) => {
              const held = state.holder[p.id];
              const side = sides.find((s) => s.id === held);
              const flags = { mine: isMine(p.id), seat: seats.has(p.id), changed: changed.has(p.id) };
              return (
                <li key={p.id}>
                  <button type="button" className={`cg-row${selected === p.id ? ' is-selected' : ''}${targets.has(p.id) ? ' is-target' : ''}`} aria-pressed={selected === p.id} onClick={() => choose(p.id)}>
                    {side ? <Arms arms={side.arms} size={24} /> : <Flag size={20} className="cg-row-free" aria-hidden />}
                    <span className="cg-row-text">
                      <b>{p.name}{flags.seat && <Crown size={13} aria-hidden />}{flags.changed && <span className="cg-new">{t('campaign.list.new')}</span>}</b>
                      <small>{side?.name ?? t('campaign.free')} · {t('campaign.list.borders', { places: neighbours(map, p.id).map((n) => map.provinces[n].name).join(', ') })}</small>
                    </span>
                    <span className="cg-row-troops"><span aria-hidden>{state.troops[p.id]}</span><span className="sr-only">{t('campaign.troops', { count: state.troops[p.id] })}. {[flags.mine ? t('campaign.map.yours') : '', flags.seat ? t('campaign.map.seat') : ''].filter(Boolean).join(' ')}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside className="ui-card cg-orders" aria-label={t('campaign.orders.title')} ref={panel}>
        <h2 className="cg-h">{t('campaign.orders.title')}</h2>
        {mySide ? (
          <OrdersHead orders={orders} pool={state.pool[mySide] ?? 0} house={nameOf(mySide) ?? ''} />
        ) : (
          <p className="muted cg-note">{t('campaign.orders.noSide')}</p>
        )}
        {over ? null : selected === null ? (
          <Idle map={map} state={state} mySide={mySide} onPick={(id) => { setSelected(id); setAction(null); }} />
        ) : (
          <Selected
            key={`${selected}:${action?.type ?? ''}:${action?.to ?? ''}`}
            map={map} sides={sides} state={state} mySide={mySide} seats={seats}
            selected={selected} action={action} canOrder={canOrder} busy={busy} outOfOrders={!!mySide && orders !== null && orders < 1}
            setAction={setAction}
            select={(id, next) => { setSelected(id); setAction(next ?? null); }}
            clear={() => { setSelected(null); setAction(null); }}
            send={async (order, cry) => { if (await onOrder(order, cry)) setAction(null); }}
          />
        )}
        {footer}
      </aside>
    </div>
  );
}

function OrdersHead({ orders, pool, house }: { orders: number | null; pool: number; house: string }) {
  const t = useT();
  return (
    <div className="cg-orders-head">
      <p className="cg-for">{t('campaign.orders.for', { house })}</p>
      <dl className="cg-counts">
        <div>
          <dt>{t('campaign.orders.left')}</dt>
          <dd>
            {orders === null ? t('campaign.orders.unlimited') : (
              <>
                <span className="cg-pips" aria-hidden>
                  {Array.from({ length: Math.max(RULES.ORDERS_PER_DAY, orders) }, (_, i) => <i key={i} className={i < orders ? 'on' : ''} />)}
                </span>
                <b data-testid="orders-left">{orders}</b>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('campaign.orders.levy')}</dt>
          <dd><Tent size={15} aria-hidden /> <b data-testid="levy-waiting">{pool}</b></dd>
        </div>
      </dl>
    </div>
  );
}

function Idle({ map, state, mySide, onPick }: { map: GameMap; state: State; mySide: string | null; onPick: (id: number) => void }) {
  const t = useT();
  const mine = map.provinces.filter((p) => mySide && state.holder[p.id] === mySide);
  if (!mine.length) return <p className="muted cg-note">{t('campaign.orders.pickAny')}</p>;
  return (
    <div className="cg-idle">
      <p className="muted cg-note">{t('campaign.orders.pick')}</p>
      <ul className="cg-picks">
        {mine.map((p) => (
          <li key={p.id}>
            <button type="button" className="btn" onClick={() => onPick(p.id)}>{p.name} <span className="cg-n">{state.troops[p.id]}</span></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A number with − and +, and "all" in one press: how many troops an order takes. */
function Troops({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  const t = useT();
  return (
    <div className="cg-troops" role="group" aria-label={label}>
      <button type="button" className="btn icon" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label={t('campaign.orders.fewer')}><Minus size={15} /></button>
      <output aria-live="polite">{value}</output>
      <button type="button" className="btn icon" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={t('campaign.orders.more')}><Plus size={15} /></button>
      <button type="button" className="btn ghost" onClick={() => onChange(max)} disabled={value >= max}>{t('campaign.orders.all', { count: max })}</button>
    </div>
  );
}

interface SelectedProps {
  map: GameMap; sides: SideView[]; state: State; mySide: string | null; seats: ReadonlySet<number>;
  selected: number; action: Action | null; canOrder: boolean; busy: boolean; outOfOrders: boolean;
  setAction: (a: Action | null) => void;
  select: (id: number, action?: Action) => void;
  clear: () => void;
  send: (order: Order, cry: string | null) => Promise<void>;
}

function Selected({ map, sides, state, mySide, seats, selected, action, canOrder, busy, outOfOrders, setAction, select, clear, send }: SelectedProps) {
  const t = useT();
  const p = map.provinces[selected];
  const held = state.holder[selected];
  const side = sides.find((s) => s.id === held);
  const mine = !!mySide && held === mySide;
  const here = state.troops[selected];
  const pool = mySide ? state.pool[mySide] ?? 0 : 0;
  const musterMax = Math.max(0, Math.min(RULES.MUSTER_MAX, pool, RULES.GARRISON_MAX - here));
  const actionMax = action ? (action.type === 'march' ? Math.min(here - 1, RULES.GARRISON_MAX - state.troops[action.to]) : here - 1) : 0;
  const [muster, setMuster] = useState(musterMax);
  const [count, setCount] = useState(actionMax);
  const [cry, setCry] = useState('');
  const words = cry.trim() || null;
  const around = neighbours(map, selected);
  const holderName = (id: number) => sides.find((s) => s.id === state.holder[id])?.name ?? t('campaign.free');
  const why = !mySide ? t('campaign.orders.noSide') : outOfOrders ? t('campaign.orders.none') : null;

  return (
    <div className="cg-sel">
      <div className="cg-sel-head">
        {side ? <Arms arms={side.arms} size={34} /> : <Flag size={26} className="cg-row-free" aria-hidden />}
        <div>
          <h3>{p.name}{seats.has(selected) && <Crown size={15} aria-label={t('campaign.map.seat')} />}</h3>
          <p className="muted">{side ? t('campaign.sel.held', { house: side.name, count: here }) : t('campaign.sel.free', { count: here })}</p>
        </div>
        <button type="button" className="btn icon ghost" onClick={clear} aria-label={t('campaign.sel.clear')}><X size={15} /></button>
      </div>
      {seats.has(selected) && <p className="subtle cg-note">{mine ? t('campaign.sel.seatYours') : t('campaign.sel.seatTheirs')}</p>}

      {mine && !action && (
        <>
          <section className="cg-act">
            <h4><Tent size={15} aria-hidden /> {t('campaign.muster.title')}</h4>
            {musterMax > 0 ? (
              <>
                <Troops value={Math.min(Math.max(1, muster), musterMax)} max={musterMax} onChange={setMuster} label={t('campaign.muster.howMany')} />
                <button type="button" className="btn primary" disabled={!canOrder || busy} onClick={() => void send({ type: 'muster', to: selected, troops: Math.min(Math.max(1, muster), musterMax) }, null)}>
                  {t('campaign.muster.go', { count: Math.min(Math.max(1, muster), musterMax), province: p.name })}
                </button>
              </>
            ) : (
              <p className="subtle cg-note">{pool < 1 ? t('campaign.muster.noLevy') : t('campaign.muster.full', { max: RULES.GARRISON_MAX })}</p>
            )}
          </section>
          <section className="cg-act">
            <h4><Swords size={15} aria-hidden /> {t('campaign.from.title', { province: p.name })}</h4>
            {here < 2 && <p className="subtle cg-note">{t('campaign.from.one')}</p>}
            <ul className="cg-around">
              {around.map((n) => {
                const own = state.holder[n] === mySide;
                const seat = !own && state.holder[n] !== null && seats.has(n);
                const full = own && state.troops[n] >= RULES.GARRISON_MAX;
                return (
                  <li key={n}>
                    <span className="cg-around-name"><b>{map.provinces[n].name}</b><small>{holderName(n)} · {t('campaign.troops', { count: state.troops[n] })}</small></span>
                    {seat ? <span className="subtle cg-around-no">{t('campaign.from.seat')}</span> : (
                      <button type="button" className="btn" disabled={here < 2 || full} onClick={() => setAction({ type: own ? 'march' : 'attack', to: n })}>
                        {own ? <><Footprints size={14} /> {t('campaign.march.short')}</> : <><Swords size={14} /> {t('campaign.attack.short')}</>}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {mine && action && (
        <form className="cg-act cg-form" onSubmit={(e) => { e.preventDefault(); if (actionMax > 0) void send({ type: action.type, from: selected, to: action.to, troops: Math.min(Math.max(1, count), actionMax) }, words); }}>
          <h4>
            {action.type === 'attack' ? <Swords size={15} aria-hidden /> : <Footprints size={15} aria-hidden />}{' '}
            {action.type === 'attack' ? t('campaign.attack.title', { from: p.name, to: map.provinces[action.to].name }) : t('campaign.march.title', { from: p.name, to: map.provinces[action.to].name })}
          </h4>
          {actionMax > 0 ? (
            <>
              <Troops value={Math.min(Math.max(1, count), actionMax)} max={actionMax} onChange={setCount} label={t('campaign.orders.howMany')} />
              {action.type === 'attack' && <Odds send={Math.min(Math.max(1, count), actionMax)} against={state.troops[action.to]} defender={holderName(action.to)} />}
              <label className="cg-cry">
                <span>{t('campaign.cry.label')}</span>
                <input className="input" value={cry} onChange={(e) => setCry(e.target.value)} maxLength={RULES.CRY_MAX} placeholder={t('campaign.cry.placeholder')} autoComplete="off" />
              </label>
            </>
          ) : (
            <p className="subtle cg-note">{action.type === 'march' && here > 1 ? t('campaign.muster.full', { max: RULES.GARRISON_MAX }) : t('campaign.from.one')}</p>
          )}
          <div className="cg-form-actions">
            <button type="button" className="btn" onClick={() => setAction(null)}>{t('campaign.orders.back')}</button>
            <button type="submit" className="btn primary" disabled={!canOrder || busy || actionMax < 1}>
              {action.type === 'attack' ? t('campaign.attack.go', { count: Math.min(Math.max(1, count), Math.max(1, actionMax)) }) : t('campaign.march.go', { count: Math.min(Math.max(1, count), Math.max(1, actionMax)) })}
            </button>
          </div>
        </form>
      )}

      {!mine && mySide && (
        <section className="cg-act">
          <h4><Swords size={15} aria-hidden /> {t('campaign.target.title')}</h4>
          {held !== null && seats.has(selected) ? null : (() => {
            const from = around.filter((n) => state.holder[n] === mySide);
            if (!from.length) return <p className="subtle cg-note">{t('campaign.target.far')}</p>;
            return (
              <ul className="cg-around">
                {from.map((n) => (
                  <li key={n}>
                    <span className="cg-around-name"><b>{map.provinces[n].name}</b><small>{t('campaign.troops', { count: state.troops[n] })}</small></span>
                    <button type="button" className="btn" disabled={state.troops[n] < 2} onClick={() => select(n, { type: 'attack', to: selected })}><Swords size={14} /> {t('campaign.target.from')}</button>
                  </li>
                ))}
              </ul>
            );
          })()}
        </section>
      )}
      {why && mine && <p className="cg-why" role="status">{why}</p>}
    </div>
  );
}

function Odds({ send, against, defender }: { send: number; against: number; defender: string }) {
  const t = useT();
  const ratio = send / Math.max(1, against);
  const word = ratio >= 2 ? t('campaign.odds.good') : ratio >= 1.2 ? t('campaign.odds.fair') : ratio >= 0.8 ? t('campaign.odds.even') : t('campaign.odds.poor');
  return <p className="cg-odds" data-odds={ratio >= 2 ? 'good' : ratio >= 1.2 ? 'fair' : ratio >= 0.8 ? 'even' : 'poor'}><b>{t('campaign.odds.line', { send, against, defender })}</b> {word}</p>;
}

/** A side's count of provinces and troops in a position: what the practice skirmish's result shows. */
export const tally = (state: State, side: string) => ({ provinces: provincesOf(state, side), troops: troopsOf(state, side) });
