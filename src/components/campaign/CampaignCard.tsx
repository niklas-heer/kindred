// The campaign in one card, for the Today page: the season's day, where the reader's house stands, the orders they
// have left and a way in. It fetches its own data, and renders nothing while the game is off, for a share-link guest,
// or before the answer has arrived.
//
//   <CampaignCard tree={tree} />
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Swords } from 'lucide-react';
import { Arms } from '~/components/Heraldry';
import { campaignStatusQuery } from '~/lib/campaign/campaign.functions';
import { useT } from '~/lib/i18n';
import { useSession } from '~/lib/session';
import './campaign.css';

export function CampaignCard({ tree }: { tree: string }) {
  const t = useT();
  const guest = useSession()?.guest?.tree === tree;
  const { data } = useQuery({ ...campaignStatusQuery(tree), enabled: !guest });
  if (guest || !data?.enabled || data.season === undefined) return null;
  const side = data.side;
  return (
    <section className="ui-card cg-card" aria-labelledby="cg-card-h">
      <h2 className="cg-h" id="cg-card-h"><Swords size={18} aria-hidden /> {t('campaign.title')}</h2>
      {side ? <Arms arms={side.arms} size={44} /> : <span />}
      <div className="cg-card-text">
        <span className="muted">{t('campaign.card.season', { season: data.season, day: (data.day ?? 0) + 1, days: data.days ?? 0 })}</span>
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
