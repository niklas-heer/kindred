import { formatNumber, useT } from '~/lib/i18n';
// A signed-in reader opened a family they don't belong to. Says so without revealing whether that
// family exists, and offers the families they do belong to.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { myFamiliesQuery } from '~/lib/auth/functions';
import { useSession } from '~/lib/session';
import { signOut } from './AccountMenu';
import { Main } from './ui/Main';
import { NotFound } from './ui/states';

export function NoAccessPage() {
  const t = useT();
  const tLocale = t.locale;
  const tr = t;
  const session = useSession();
  const { data: trees } = useQuery(myFamiliesQuery);
  return (
    <Main className="page ui-notfound-page">
      <NotFound
        icon={<Lock size={28} />}
        title={t("noaccess.you_don_t_have_access_to_this_family")}
        text={<>{t("noaccess.you_re_signed_in_as")} <b>{session?.user?.name ?? t("noaccess.someone_else")}</b>{t("noaccess.if_you_should_be_here_ask_one_of_this_family_s_stewards_to_send_you_an_invitation")}</>}
      >
        {trees && trees.length > 0 && (
          <ul className="ui-state-links" aria-label={t("noaccess.your_families")}>
            {trees.map((t) => (
              <li key={t.id}>
                <Link to="/$tree" params={{ tree: t.id }}>
                  <b className="name">{t.name}</b>
                  <span>{formatNumber(t.people, tLocale)} {tr('common.personUnit', {count: t.people})}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="ui-state-actions">
          <Link to="/" search={trees && trees.length >= 2 ? { families: "all" } : {}} className="btn">{trees?.length === 1 ? t("noaccess.your_family") : t("noaccess.your_families")}</Link>
          <button className="btn ghost" onClick={() => void signOut(session?.accessLogout)}>{t("noaccess.sign_out")}</button>
        </div>
      </NotFound>
    </Main>
  );
}
