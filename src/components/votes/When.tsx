// When a vote closes, or closed, in the reader's own time zone. The server writes it in its zone and the browser in the
// reader's, so the text may differ between the two: it sits in its own element, which hydration lets change.
//
//   <When at={vote.closesAt} closed={vote.closed} />
import { dateText, useT } from '~/lib/i18n';

export function When({ at, closed }: { at: string; closed: boolean }) {
  const t = useT();
  const date = dateText(Date.parse(at), t.locale, { dateStyle: 'medium', timeStyle: 'short' });
  return <time dateTime={at} suppressHydrationWarning>{closed ? t('votes.closed_on', { date }) : t('votes.closes', { date })}</time>;
}
