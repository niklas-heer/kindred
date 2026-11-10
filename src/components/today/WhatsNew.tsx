// "What's new": what changed in the family since the reader's last visit, in plain sentences grouped by the person it is
// about ("Mara added 3 photos"), and comments and reactions on what the reader wrote. It fetches for itself, so any page
// can mount it: <WhatsNew tree={tree} />. A share-link guest gets nothing (it renders nothing and asks the server nothing).
//
// The visit rule is the server's (history.server.ts noteVisit): the news starts where the reader was last shown it, and it
// stays the same throughout a visit, so opening the page twice shows the same news. Showing it counts as seen.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useEffect, useId } from 'react';
import { lineText } from '~/lib/history-text';
import { whatsNewQuery } from '~/lib/history.functions';
import type { WhatsNewReply } from '~/lib/history';
import { formatDate, useT, type Key, type Translator } from '~/lib/i18n';
import { useMember } from '~/lib/session';
import '~/components/history/history.css';
import './today.css';

/** The groups and lines shown before "and n more"; the rest is on the History page. */
const GROUPS = 8;

const replyText = (t: Translator, r: WhatsNewReply) => t(`history.reply.${r.kind}_${r.target}` as Key, { author: r.author, count: r.count });

export function WhatsNew({ tree, className = '' }: { tree: string; className?: string }) {
  const t = useT();
  const member = !!useMember(tree);
  const heading = useId();
  const qc = useQueryClient();
  const q = useQuery({ ...whatsNewQuery(tree), enabled: member, staleTime: 5 * 60_000 });
  // Being shown the news clears the dot beside History in the account menu.
  useEffect(() => {
    if (q.isSuccess) void qc.invalidateQueries({ queryKey: ['news-count', tree] });
  }, [q.isSuccess, qc, tree]);
  if (!member) return null;
  const news = q.data;
  const shown = news?.groups.slice(0, GROUPS) ?? [];
  const hidden = (news?.groups.slice(GROUPS) ?? []).reduce((n, g) => n + g.lines.reduce((m, l) => m + l.count, 0), 0);

  return (
    <section className={`ui-card td-card whats-new ${className}`} aria-labelledby={heading} aria-busy={q.isPending}>
      <div className="td-card-head whats-new-head">
        <h2 className="td-h" id={heading}><Sparkles size={18} aria-hidden /> {t('history.whats_new')}</h2>
        {news && <span className="subtle">{news.first ? t('history.first_visit') : t('history.since_visit', { when: formatDate(new Date(news.since), t.locale, { day: 'numeric', month: 'long' }) })}</span>}
      </div>
      {q.isPending ? <p className="subtle">{t('history.loading')}</p>
        : q.isError ? <p className="subtle" role="alert">{t('history.failed')}</p>
        : news && !news.groups.length && !news.replies.length ? <p className="subtle">{t('history.nothing_new')}</p>
        : news && (
          <>
            {news.replies.length > 0 && (
              <div className="whats-new-group">
                <h3>{t('history.replies')}</h3>
                <ul>
                  {news.replies.map((r) => (
                    <li key={`${r.kind}-${r.target}-${r.id}`}>
                      {replyText(t, r)}
                      {r.label && <span className="hist-label"> · {r.label}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="whats-new-groups">
              {shown.map((g) => (
                <li key={g.person ?? ''} className="whats-new-group">
                  <h3>
                    {g.person && g.lines.every((l) => !(l.kind === 'person' && l.action === 'removed'))
                      ? <Link to="/$tree/person/$id" params={{ tree, id: g.person }}>{g.name ?? g.person}</Link>
                      : g.person ? g.name : t('history.the_family')}
                  </h3>
                  <ul>
                    {g.lines.map((l) => (
                      <li key={`${l.author}-${l.kind}-${l.action}`}>
                        {lineText(t, l)}
                        {l.label && l.kind !== 'person' && <span className="hist-label"> · {l.label}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {hidden > 0 && <p className="subtle">{t('history.more_changes', { count: hidden })}</p>}
          </>
        )}
      <Link className="td-more-link" to="/$tree/history" params={{ tree }}>{t('history.see_all')}</Link>
    </section>
  );
}
