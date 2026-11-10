// The campaign in one card, for the Today page: the season's day, where the reader's house stands, the orders they
// have left and a way in. It fetches its own data, and renders nothing for a share-link guest or before the answer has
// arrived. While the game is off it renders nothing either, except for a steward, who is told once that it is there
// and can turn it on from the card (the same switch as the Games page); "Not now" puts the card away for good in this
// browser, and the Campaign stays under More.
//
//   <CampaignCard tree={tree} />
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Swords } from 'lucide-react';
import { Arms } from '~/components/Heraldry';
import { useIsClient } from '~/components/ui';
import { campaignQuery, campaignSettingsQuery, campaignStatusQuery, setCampaignOn } from '~/lib/campaign/campaign.functions';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { setPref, usePref } from '~/lib/prefs';
import { useCan, useSession } from '~/lib/session';
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
  if (data.enabled) return data.season === undefined ? null : 'on';
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

  const side = data.side;
  return (
    <section className="ui-card cg-card" aria-labelledby="cg-card-h">
      <h2 className="cg-h" id="cg-card-h"><Swords size={18} aria-hidden /> {t('campaign.title')}</h2>
      {side ? <Arms arms={side.arms} size={44} /> : <span />}
      <div className="cg-card-text">
        <span className="muted">{t('campaign.card.season', { season: data.season ?? 0, day: (data.day ?? 0) + 1, days: data.days ?? 0 })}</span>
        {side ? (
          <b>{t('campaign.card.standing', { house: side.name, count: side.provinces, rank: side.rank, of: side.of })}</b>
        ) : (
          <b>{t('campaign.card.choose')}</b>
        )}
        <span>{t('campaign.card.orders', { count: data.orders ?? 0 })}</span>
      </div>
      <Link className="btn primary" to="/$tree/campaign" params={{ tree }}>{t('campaign.card.open')}</Link>
    </section>
  );
}
