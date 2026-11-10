// The Campaign: a slow game between the family's houses, on a map made from the family's own places (docs/campaign.md).
// Members only. The page shows the live season (orders go to the server, which rolls the dice) or, on request, a practice
// skirmish that runs in the browser with the same rules. While the game is off it explains itself and offers the practice.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleHelp, Flag, RotateCcw, Sunrise, Swords, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BattleDialog, type Battle } from '~/components/campaign/BattleDialog';
import { Board, Standings, tally } from '~/components/campaign/Board';
import { CampaignChronicle, HallOfFame, HowItWorks, RenownCard } from '~/components/campaign/panels';
import { usePractice } from '~/components/campaign/practice';
import '~/components/campaign/campaign.css';
import { Arms } from '~/components/Heraldry';
import { EmptyState, ErrorState, PageHeader, Select, Skeleton } from '~/components/ui';
import { newOpKey } from '~/lib/api';
import { campaignQuery, campaignStatusQuery, giveCampaignOrder, markCampaignSeen, pledgeCampaignSide } from '~/lib/campaign/campaign.functions';
import { RULES, levyOf, standings, type Order } from '~/lib/campaign/engine';
import type { CampaignBoard, CampaignView } from '~/lib/campaign/types';
import { errorText } from '~/lib/errortext';
import { useTreeId } from '~/lib/family';
import { formatDate, translate, useT, type Locale } from '~/lib/i18n';
import { useCan, useSession } from '~/lib/session';
import { play } from '~/lib/sfx';
import { treeTitle } from '~/lib/title';
import { toast } from '~/lib/toast';

export const Route = createFileRoute('/$tree/campaign')({
  validateSearch: (search: Record<string, unknown>): { practice?: boolean } => (search.practice === true || search.practice === 'true' || search.practice === 1 ? { practice: true } : {}),
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'campaign.title')) }] }),
  component: CampaignPage,
});

const INTRO_KEY = 'kindred:campaign:intro';

function CampaignPage() {
  const t = useT();
  const tree = useTreeId();
  const session = useSession();
  const guest = session?.guest?.tree === tree;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery({ ...campaignQuery(tree), enabled: !guest });
  const [how, setHow] = useState(false);
  const practice = !!search.practice;
  const setPractice = (on: boolean) => void navigate({ search: on ? { practice: true } : {}, replace: true });

  // The first visit opens "how it works" once; after that it is behind its button.
  const ready = !!q.data;
  useEffect(() => {
    if (!ready) return;
    try {
      if (localStorage.getItem(INTRO_KEY)) return;
      localStorage.setItem(INTRO_KEY, '1');
    } catch { /* storage can be off: then it opens each time, which is better than never */ }
    setHow(true);
  }, [ready]);

  if (guest) return <div className="page"><div className="page-inner"><EmptyState icon={<Swords size={30} />} title={t('campaign.guest_title')} text={t('campaign.guest_text')} /></div></div>;

  const help = <button type="button" className="btn" onClick={() => setHow(true)}><CircleHelp size={16} /> {t('campaign.how.button')}</button>;
  const view = q.data;
  return (
    <div className="page cg-page">
      <div className="page-inner">
        {q.isError ? <ErrorState title={t('campaign.load_failed')} error={q.error} onRetry={() => void q.refetch()} />
          : !view ? <Skeleton height={520} />
          : practice ? <Practice board={view.board} mySide={view.me?.side ?? null} name={session?.user?.name ?? ''} help={help} leave={() => setPractice(false)} live={view.enabled} />
          : view.enabled ? <Live view={view} tree={tree} help={help} startPractice={() => setPractice(true)} />
          : <Off view={view} tree={tree} help={help} startPractice={() => setPractice(true)} />}
      </div>
      <HowItWorks open={how} onClose={() => setHow(false)} onPractice={practice ? undefined : () => { setHow(false); setPractice(true); }} />
    </div>
  );
}

// ---------- while the game is off ----------

function Off({ view, tree, help, startPractice }: { view: CampaignView; tree: string; help: React.ReactNode; startPractice: () => void }) {
  const t = useT();
  const steward = useCan('manage-access');
  return (
    <>
      <PageHeader title={t('campaign.title')} subtitle={t('campaign.subtitle')} icon={<Swords size={26} />} actions={help} />
      <section className="ui-card cg-banner">
        <h2>{t('campaign.off.title')}</h2>
        <p>{steward ? t('campaign.off.steward') : t('campaign.off.member')}</p>
        <div className="cg-banner-actions">
          <button type="button" className="btn primary" onClick={startPractice}><Swords size={16} /> {t('campaign.practice.try')}</button>
          {steward && <Link className="btn" to="/$tree/settings/games" params={{ tree }}>{t('campaign.off.settings')}</Link>}
        </div>
      </section>
      <HallOfFame fame={view.fame} />
    </>
  );
}

// ---------- the season ----------

function Live({ view, tree, help, startPractice }: { view: CampaignView; tree: string; help: React.ReactNode; startPractice: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { board } = view;
  const state = view.state!;
  const me = view.me!;
  const season = view.season!;
  const [battle, setBattle] = useState<Battle | null>(null);
  // What changed since the last visit stays marked for this visit, though the server is told at once that it was seen.
  const [changed] = useState(() => new Set(view.changed ?? []));
  const newest = view.log?.[0]?.id ?? 0;
  useEffect(() => {
    if (newest > 0) void markCampaignSeen({ data: { tree, upTo: newest } }).catch(() => {});
  }, [tree, newest]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: campaignQuery(tree).queryKey }), qc.invalidateQueries({ queryKey: campaignStatusQuery(tree).queryKey })]);
  const order = useMutation({ mutationFn: (v: { order: Order; cry: string | null }) => giveCampaignOrder({ data: { tree, opKey: newOpKey(), order: v.order, cry: v.cry } }) });
  const pledge = useMutation({ mutationFn: (side: string) => pledgeCampaignSide({ data: { tree, side } }), onSettled: refresh });

  const onOrder = async (o: Order, cry: string | null) => {
    try {
      const result = await order.mutateAsync({ order: o, cry });
      if (result.event.t === 'attack') setBattle(result.event);
      else { play('tick'); await refresh(); }
      return true;
    } catch (e) {
      toast({ title: t('campaign.err.title'), body: errorText(e, t.locale) });
      void refresh();
      return false;
    }
  };

  const mine = board.sides.find((s) => s.id === me.side);
  const shown = mine ?? board.sides[0];
  const ids = board.sides.map((s) => s.id);
  const houses = board.sides.filter((s) => !s.rival);

  return (
    <>
      <PageHeader
        title={t('campaign.title')}
        subtitle={t('campaign.season.line', { season: season.number, day: Math.min(season.day + 1, season.days), days: season.days, date: formatDate(season.ends, t.locale) })}
        icon={<Swords size={26} />}
        actions={<>{help}<button type="button" className="btn" onClick={startPractice}><Swords size={16} /> {t('campaign.practice.button')}</button></>}
      />

      {me.chooses && !me.side && (
        <section className="ui-card cg-banner" aria-labelledby="cg-pledge-h">
          <h2 id="cg-pledge-h">{t('campaign.pledge.title')}</h2>
          {houses.length ? (
            <>
              <p>{t('campaign.pledge.text')}</p>
              <ul className="cg-pledge">
                {houses.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="btn" disabled={pledge.isPending} onClick={() => pledge.mutate(s.id)}>
                      <Arms arms={s.arms} size={30} /> {t('campaign.pledge.serve', { house: s.name })}
                    </button>
                  </li>
                ))}
              </ul>
              {pledge.isError && <p role="alert">{errorText(pledge.error, t.locale)}</p>}
            </>
          ) : (
            <>
              <p>{t('campaign.pledge.noHouses')}</p>
              <div className="cg-banner-actions"><Link className="btn" to="/$tree/houses" params={{ tree }}>{t('shell.houses')}</Link></div>
            </>
          )}
        </section>
      )}

      <Standings sides={board.sides} state={state} mySide={me.side} />
      <Board map={board.map} sides={board.sides} state={state} mySide={me.side} orders={me.orders} changed={changed} busy={order.isPending} onOrder={onOrder} />
      <div className="cg-lower">
        <CampaignChronicle log={view.log ?? []} map={board.map} sides={board.sides} empty={t('campaign.chronicle.empty')} />
        {shown && <RenownCard side={shown} levy={levyOf(state, shown.id, shown.renown.bonus, ids)} tree={tree} mine={!!mine} />}
        <HallOfFame fame={view.fame} />
      </div>
      {battle && <BattleDialog battle={battle} map={board.map} sides={board.sides} mySide={me.side} onClose={() => { setBattle(null); void refresh(); }} />}
    </>
  );
}

// ---------- the practice skirmish ----------

function Practice({ board, mySide, name, help, leave, live }: { board: CampaignBoard; mySide: string | null; name: string; help: React.ReactNode; leave: () => void; live: boolean }) {
  const t = useT();
  const first = board.sides.find((s) => s.id === mySide && !s.rival) ?? board.sides.find((s) => !s.rival) ?? board.sides[0];
  const game = usePractice(board, first.id, name);
  const [battle, setBattle] = useState<Battle | null>(null);
  const none = useMemo(() => new Set<number>(), []);
  const ids = board.sides.map((s) => s.id);
  const table = standings(game.state, ids);
  const rank = table.findIndex((r) => r.side === game.side) + 1;
  const winner = board.sides.find((s) => s.id === table[0]?.side);
  const playable = board.sides.filter((s) => !s.rival);

  const onOrder = async (o: Order) => {
    try {
      const e = game.give(o);
      if (e.t === 'attack') setBattle(e);
      else play('tick');
      return true;
    } catch (e) {
      toast({ title: t('campaign.err.title'), body: errorText(e, t.locale) });
      return false;
    }
  };
  const endTurn = () => {
    const attacks = game.endTurn();
    const lost = attacks.filter((e) => e.t === 'attack' && e.took && e.defender === game.side).length;
    play('page');
    if (lost) toast({ title: t('campaign.practice.night'), body: t('campaign.practice.lost', { count: lost }) });
  };

  return (
    <>
      <PageHeader
        title={t('campaign.practice.title')}
        subtitle={game.over ? t('campaign.practice.overLine') : t('campaign.practice.line', { turn: game.state.day + 1, turns: RULES.PRACTICE_DAYS })}
        icon={<Swords size={26} />}
        actions={<>{help}<button type="button" className="btn" onClick={leave}><Undo2 size={16} /> {live ? t('campaign.practice.back') : t('campaign.practice.leave')}</button></>}
      />
      {game.over && (
        <section className="ui-card cg-banner cg-result" aria-live="polite">
          {winner && <Arms arms={winner.arms} size={72} />}
          <h2>{winner?.id === game.side ? t('campaign.practice.won') : t('campaign.practice.wonBy', { house: winner?.name ?? '' })}</h2>
          <p>{t('campaign.practice.result', { count: tally(game.state, game.side).provinces, rank, of: table.length })}</p>
          <div className="cg-banner-actions">
            <button type="button" className="btn primary" onClick={() => game.restart()}><RotateCcw size={16} /> {t('campaign.practice.again')}</button>
            <button type="button" className="btn" onClick={leave}>{live ? t('campaign.practice.back') : t('campaign.practice.leave')}</button>
          </div>
        </section>
      )}
      <Standings sides={board.sides} state={game.state} mySide={game.side} />
      <Board
        map={board.map} sides={board.sides} state={game.state} mySide={game.side} orders={null} changed={none} busy={false} over={game.over}
        onOrder={onOrder}
        footer={
          <div className="cg-turn">
            {!game.over && <button type="button" className="btn primary" onClick={endTurn}><Sunrise size={16} /> {t('campaign.practice.endTurn')}</button>}
            {playable.length > 1 && (
              <label className="cg-cry">
                <span id="cg-playas">{t('campaign.practice.playAs')}</span>
                <Select aria-labelledby="cg-playas" value={game.side} onChange={(side) => game.restart(side)} options={playable.map((s) => ({ value: s.id, label: s.name }))} />
              </label>
            )}
            <button type="button" className="btn ghost" onClick={() => game.restart()}><RotateCcw size={15} /> {t('campaign.practice.restart')}</button>
            <p className="subtle cg-note"><Flag size={13} aria-hidden /> {t('campaign.practice.note')}</p>
          </div>
        }
      />
      <div className="cg-lower">
        <CampaignChronicle log={game.log} map={board.map} sides={board.sides} empty={t('campaign.practice.empty')} />
      </div>
      {battle && <BattleDialog battle={battle} map={board.map} sides={board.sides} mySide={game.side} onClose={() => setBattle(null)} />}
    </>
  );
}
