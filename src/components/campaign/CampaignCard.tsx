// The campaign in one card, for the Today page: where the reader stands in this week's table ("You are 2nd of 5 this
// week"), or an invitation to a first reign, and a way in. It fetches its own data, and renders nothing for a share-link guest or before the answer has
// arrived. While the game is off it renders nothing either, except for a steward, who is told once that it is there
// and can turn it on from the card (the same switch as the Games page); "Not now" puts the card away for good in this
// browser, and the Campaign stays under More.
//
//   <CampaignCard tree={tree} />
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Swords } from 'lucide-react';
import { useIsClient } from '~/components/ui';
import { campaignQuery, campaignSettingsQuery, campaignStatusQuery, setCampaignOn } from '~/lib/campaign/campaign.functions';
import { errorText } from '~/lib/errortext';
import { ordinal, useT } from '~/lib/i18n';
import { setPref, usePref } from '~/lib/prefs';
import { useCan, useSession } from '~/lib/session';
import { Laurel } from './parts';
import './campaign.css';

/** Where a steward's "Not now" is kept, per family, in this browser. */
const HINT_PREF = (tree: string) => `campaign-hint:${tree}`;

/**
 * What the card has to show: the season (`on`), the steward's one-time note that the game exists (`hint`), or nothing.
 * The Today page asks too, to know whether the card has a place in its strip.
 */
export function useCampaignCard(tree: string): 'on' | 'hint' | null {
  const session = useSession();
  const guest = session?.guest?.tree === tree;
  const steward = useCan('manage-access');
  const { data } = useQuery({ ...campaignStatusQuery(tree), enabled: !guest });
  const dismissed = usePref(HINT_PREF(tree)) !== null;
  // The note depends on what this browser remembers, so it is drawn only once the page runs here.
  const client = useIsClient();
  if (guest || !data) return null;
  if (data.enabled) return 'on';
  // A demo and a preview can turn nothing on: no note there.
  return steward && client && !dismissed && !session?.demo && !session?.viewAs ? 'hint' : null;
}

export function CampaignCard({ tree }: { tree: string }) {
  const t = useT();
  const qc = useQueryClient();
  const shows = useCampaignCard(tree);
  const { data } = useQuery({ ...campaignStatusQuery(tree), enabled: shows !== null });
  const turnOn = useMutation({
    mutationFn: () => setCampaignOn({ data: { tree, on: true } }),
    onSettled: () => Promise.all([campaignStatusQuery(tree), campaignQuery(tree), campaignSettingsQuery(tree)].map((o) => qc.invalidateQueries({ queryKey: o.queryKey }))),
  });
  if (!shows || !data) return null;

  if (shows === 'hint') {
    return (
      <section className="ui-card cg-card cg-card-off" aria-labelledby="cg-card-h">
        <h2 className="cg-h" id="cg-card-h"><Swords size={18} aria-hidden /> {t('campaign.off.title')}</h2>
        <p className="cg-card-note">{t('campaign.card.off_text')}</p>
        <p className="cg-card-note subtle">{t('campaign.turn_on_text')}</p>
        {turnOn.isError && <p role="alert">{errorText(turnOn.error, t.locale)}</p>}
        <div className="cg-card-actions">
          <button type="button" className="btn primary" disabled={turnOn.isPending} onClick={() => turnOn.mutate()}>{t('campaign.turn_on')}</button>
          <Link className="btn" to="/$tree/campaign" params={{ tree }}>{t('campaign.card.look')}</Link>
          <button type="button" className="btn ghost" onClick={() => setPref(HINT_PREF(tree), '1')}>{t('campaign.card.not_now')}</button>
        </div>
      </section>
    );
  }

  const played = data.rank != null && data.best != null;
  return (
    <section className="ui-card cg-card" aria-labelledby="cg-card-h">
      <h2 className="cg-h" id="cg-card-h"><Swords size={18} aria-hidden /> {t('campaign.title')}</h2>
      <span className="cg-card-rank" aria-hidden>{played ? <Laurel size={30} /> : <Swords size={28} />}</span>
      <div className="cg-card-text">
        <span className="muted">{t('campaign.card.week')}</span>
        {played ? (
          <b>{(data.of ?? 1) < 2 ? t('campaign.card.alone') : t(data.tied ? 'campaign.card.rank_shared' : 'campaign.card.rank', { rank: ordinal(data.rank!, t.locale), of: data.of ?? 1 })}</b>
        ) : (
          <b>{t('campaign.card.invite')}</b>
        )}
        {played && <span>{t('campaign.card.best', { score: data.best!, count: data.runs ?? 0 })}</span>}
        {/* One reign a day counts, so the card says whether today's is still to play. */}
        {played && <span className="cg-card-today">{t(data.today ? 'campaign.card.today_done' : 'campaign.card.today_open')}</span>}
      </div>
      <Link className={`btn${data.today ? '' : ' primary'}`} to="/$tree/campaign" params={{ tree }}>{!played ? t('campaign.card.play') : data.today ? t('campaign.card.open') : t('campaign.card.play_today')}</Link>
    </section>
  );
}
