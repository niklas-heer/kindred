// Games, for stewards: the switch for the Campaign (off until a steward turns it on), and the switch for the daily quiz on the Today page (on until a steward turns it off). The server checks the steward's
// role on every call (src/lib/campaign/campaign.functions.ts, src/lib/today/today.functions.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Gamepad2, KeyRound, Swords } from 'lucide-react';
import { GameIcon } from '~/components/GameIcon';
import { PolicyLockNote } from '~/components/operator/PolicyLock';
import '~/components/campaign/campaign.css';
import { EmptyState, ErrorState, PageHeader, Skeleton, Switch } from '~/components/ui';
import { campaignQuery, campaignSettingsQuery, campaignStatusQuery, setCampaignOn } from '~/lib/campaign/campaign.functions';
import { RULES } from '~/lib/campaign/engine';
import { errorText } from '~/lib/errortext';
import { useFamily, useTreeId } from '~/lib/family';
import { translate, useT, type Locale } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { treeTitle } from '~/lib/title';
import { quizQuery, setQuizOn, todaySettingsQuery } from '~/lib/today/today.functions';

export const Route = createFileRoute('/$tree/settings/games')({
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'campaign.games.title')) }] }),
  component: GamesPage,
});

function GamesPage() {
  const t = useT();
  const tree = useTreeId();
  const f = useFamily();
  const qc = useQueryClient();
  const steward = useCan('manage-access');
  const settings = useQuery({ ...campaignSettingsQuery(tree), enabled: steward });
  const refresh = () => Promise.all([campaignSettingsQuery(tree), campaignQuery(tree), campaignStatusQuery(tree)].map((o) => qc.invalidateQueries({ queryKey: o.queryKey })));
  const toggle = useMutation({ mutationFn: (on: boolean) => setCampaignOn({ data: { tree, on } }), onSettled: refresh });
  const quiz = useQuery({ ...todaySettingsQuery(tree), enabled: steward });
  const quizToggle = useMutation({
    mutationFn: (on: boolean) => setQuizOn({ data: { tree, on } }),
    onSettled: () => Promise.all([todaySettingsQuery(tree), quizQuery(tree)].map((o) => qc.invalidateQueries({ queryKey: o.queryKey }))),
  });

  if (!steward) {
    return <div className="page"><div className="page-inner"><EmptyState icon={<KeyRound size={30} />} title={t('campaign.games.only_stewards')} text={t('campaign.games.only_stewards_text', { family: f.graph.tree.name })} /></div></div>;
  }
  const on = toggle.isPending ? !!toggle.variables : !!settings.data?.enabled;
  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader title={t('campaign.games.title')} subtitle={t('campaign.games.subtitle')} icon={<Gamepad2 size={26} />} />
        {settings.isError ? <ErrorState title={t('campaign.load_failed')} error={settings.error} onRetry={() => void settings.refetch()} />
          : !settings.data ? <Skeleton height={220} />
          : (
            <div className="cg-games">
              <section className="ui-card" aria-labelledby="cg-games-h">
                <h2 className="cg-h" id="cg-games-h"><Swords size={18} aria-hidden /> {t('campaign.title')}</h2>
                <p>{t('campaign.games.what', { turns: RULES.TURNS })}</p>
                <p className="muted">{t('campaign.games.promise')}</p>
                {/* Locked by the server's operator: the switch stays in view, off, with one sentence and their contact. */}
                <Switch checked={on && !settings.data.lock.locked} onChange={(next) => toggle.mutate(next)} disabled={toggle.isPending || settings.data.lock.locked}>{t('campaign.games.switch')}</Switch>
                {settings.data.lock.locked && <PolicyLockNote reason={settings.data.lock.reason} />}
                {toggle.isError && <p role="alert">{errorText(toggle.error, t.locale)}</p>}
                <div className="cg-games-row">
                  {settings.data.enabled && !settings.data.lock.locked && <Link className="btn primary" to="/$tree/campaign" params={{ tree }}>{t('campaign.card.open')}</Link>}
                  <Link className="btn" to="/$tree/campaign" params={{ tree }} search={{ practice: true }}>{t('campaign.practice.try')}</Link>
                </div>
                {settings.data.enabled && !settings.data.lock.locked && <p className="subtle">{t('campaign.games.on')}</p>}
              </section>
              <section className="ui-card" aria-labelledby="cg-games-quiz">
                <h2 className="cg-h" id="cg-games-quiz"><GameIcon name="laurel-crown" size={18} /> {t('today.games.title')}</h2>
                <p>{t('today.games.what')}</p>
                <p className="muted">{t('today.games.promise')}</p>
                {quiz.isError ? <p role="alert">{errorText(quiz.error, t.locale)}</p> : (
                  <Switch checked={quizToggle.isPending ? !!quizToggle.variables : quiz.data?.quiz !== false} onChange={(next) => quizToggle.mutate(next)} disabled={quizToggle.isPending || !quiz.data}>{t('today.games.switch')}</Switch>
                )}
                {quizToggle.isError && <p role="alert">{errorText(quizToggle.error, t.locale)}</p>}
                <div className="cg-games-row">
                  <Link className="btn" to="/$tree/today" params={{ tree }}>{t('today.games.open')}</Link>
                </div>
              </section>
            </div>
          )}
      </div>
    </div>
  );
}
