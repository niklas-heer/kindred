import { formatNumber, useT } from '~/lib/i18n';
// "Family not found" and "Page not found": a friendly page with a link to each of the reader's
// families (none when signed out), never a developer hint. Used by the $tree route (unknown tree id)
// and as the router's default.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Users } from 'lucide-react';
import { myFamiliesQuery } from '~/lib/auth/functions';
import { Main } from './ui/Main';
import { NotFound } from './ui/states';

export function NotFoundPage({ kind = 'page', id }: { kind?: 'family' | 'page'; id?: string }) {
  const t = useT();
  const tLocale = t.locale;
  const tr = t;
  const { data: trees } = useQuery(myFamiliesQuery);
  return (
    <Main className="page ui-notfound-page">
      <NotFound
        icon={kind === 'family' ? <Users size={28} /> : undefined}
        title={kind === 'family' ? t("notfoundpage.family_not_found") : t("notfoundpage.page_not_found")}
        text={
          kind === 'family'
            ? <>{t("notfoundpage.there_s_no_family")} {id ? <>{t("notfoundpage.called")}{id}{t("notfoundpage.")} </> : null}{t("notfoundpage.here_it_may_have_been_renamed_or_the_link_is_old")}</>
            : t("notfoundpage.this_page_doesn_t_exist_or_it_has_moved")
        }
      >
        {trees && trees.length > 0 ? (
          <ul className="ui-state-links" aria-label={t("notfoundpage.your_families")}>
            {trees.map((t) => (
              <li key={t.id}>
                <Link to="/$tree" params={{ tree: t.id }}>
                  <b className="name">{t.name}</b>
                  <span>{formatNumber(t.people, tLocale)} {tr('common.personUnit', {count: t.people})}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ui-state-actions"><Link to="/" className="btn primary">{t("notfoundpage.your_families")}</Link></div>
        )}
      </NotFound>
    </Main>
  );
}
