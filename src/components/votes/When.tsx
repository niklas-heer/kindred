// When a vote closes, or closed, in the reader's own time zone. The server knows only its own zone, and hydration keeps
// the server's text, so the date is written only in the browser: the server sends the bare <time> element.
//
//   <When at={vote.closesAt} closed={vote.closed} />
import { useIsClient } from '~/components/ui';
import { dateText, useT } from '~/lib/i18n';

export function When({ at, closed }: { at: string; closed: boolean }) {
  const t = useT();
  const client = useIsClient();
  if (!client) return <time dateTime={at} />;
  const date = dateText(Date.parse(at), t.locale, { dateStyle: 'medium', timeStyle: 'short' });
  return <time dateTime={at}>{closed ? t('votes.closed_on', { date }) : t('votes.closes', { date })}</time>;
}
