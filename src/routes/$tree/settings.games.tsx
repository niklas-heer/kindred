// Games, for stewards: the switch for the Campaign (off until a steward turns it on) and "end the season now". The
// server checks the steward's role on every call (src/lib/campaign/campaign.functions.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Gamepad2, KeyRound, Swords } from 'lucide-react';
import { useState } from 'react';
import '~/components/campaign/campaign.css';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton, Switch } from '~/components/ui';
import { campaignQuery, campaignSettingsQuery, campaignStatusQuery, endCampaignSeason, setCampaignOn } from '~/lib/campaign/campaign.functions';
import { RULES } from '~/lib/campaign/engine';
import { errorText } from '~/lib/errortext';
import { useFamily, useTreeId } from '~/lib/family';
import { translate, useT, type Locale } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { treeTitle } from '~/lib/title';

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
  const [ending, setEnding] = useState(false);
  const refresh = () => Promise.all([campaignSettingsQuery(tree), campaignQuery(tree), campaignStatusQuery(tree)].map((o) => qc.invalidateQueries({ queryKey: o.queryKey })));
  const toggle = useMutation({ mutationFn: (on: boolean) => setCampaignOn({ data: { tree, on } }), onSettled: refresh });
  const end = useMutation({ mutationFn: () => endCampaignSeason({ data: { tree } }), onSuccess: () => setEnding(false), onSettled: refresh });

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
                <p>{t('campaign.games.what', { days: RULES.SEASON_DAYS })}</p>
                <p className="muted">{t('campaign.games.promise')}</p>
                <Switch checked={on} onChange={(next) => toggle.mutate(next)} disabled={toggle.isPending}>{t('campaign.games.switch')}</Switch>
                {toggle.isError && <p role="alert">{errorText(toggle.error, t.locale)}</p>}
                <div className="cg-games-row">
                  {settings.data.enabled && <Link className="btn primary" to="/$tree/campaign" params={{ tree }}>{t('campaign.card.open')}</Link>}
                  <Link className="btn" to="/$tree/campaign" params={{ tree }} search={{ practice: true }}>{t('campaign.practice.try')}</Link>
                  {settings.data.enabled && settings.data.season > 0 && <button type="button" className="btn" onClick={() => setEnding(true)}>{t('campaign.games.end')}</button>}
                </div>
                {settings.data.enabled && settings.data.season > 0 && <p className="subtle">{t('campaign.games.season', { season: settings.data.season })}</p>}
              </section>
            </div>
          )}
      </div>
      <ConfirmDialog
        open={ending}
        onClose={() => setEnding(false)}
        onConfirm={() => end.mutate()}
        title={t('campaign.games.end_title')}
        confirmLabel={t('campaign.games.end_confirm')}
        busy={end.isPending}
        error={end.isError ? errorText(end.error, t.locale) : undefined}
      >
        <p>{t('campaign.games.end_text')}</p>
      </ConfirmDialog>
    </div>
  );
}
