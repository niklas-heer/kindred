// "Born, but no source": the Needed page's list, for editors, of the people whose birth the family recorded without a
// source for it. Each name opens the person's page, where the Edit tab cites one. Nothing at all for anyone else, or when
// every recorded birth has a source.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useFamily, useTreeId } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { unsourcedBirthsQuery } from '~/lib/sources.functions';
import './life.css';

const FIRST = 40;

export function UnsourcedBirths() {
  const t = useT();
  const tree = useTreeId();
  const f = useFamily();
  const canEdit = useCan('edit-person');
  const q = useQuery({ ...unsourcedBirthsQuery(tree), enabled: canEdit });
  const [all, setAll] = useState(false);
  const ids = (q.data ?? []).filter((id) => f.byId.has(id));
  if (!canEdit || !ids.length) return null;
  const shown = all ? ids : ids.slice(0, FIRST);
  return (
    <section className="unsourced" aria-labelledby="unsourced-head">
      <h2 id="unsourced-head" className="rule">{t('sources.needed_title')}</h2>
      <p className="subtle">{t('sources.needed_text', { count: ids.length })}</p>
      <ul>
        {shown.map((id) => (
          <li key={id}><Link className="chip" to="/$tree/person/$id" params={{ tree, id }}>{displayName(f.byId.get(id)!, f)}</Link></li>
        ))}
      </ul>
      {ids.length > shown.length && <button type="button" className="btn" onClick={() => setAll(true)}>{t('sources.needed_more', { count: ids.length - shown.length })}</button>}
    </section>
  );
}
