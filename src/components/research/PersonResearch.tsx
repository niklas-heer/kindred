// One small section of a person's panel: the research projects that name them. Only what the reader may see; nothing when none.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FolderSearch, Lock } from 'lucide-react';
import { useT } from '~/lib/i18n';
import { personResearchQuery } from '~/lib/research.functions';
import '~/styles/research.css';

export function PersonResearch({ tree, id }: { tree: string; id: string }) {
  const t = useT();
  const q = useQuery(personResearchQuery(tree, id));
  if (!q.data?.length) return null;
  return (
    <section className="pp-ov-section rs-panel" aria-label={t('research.panel_title')}>
      <h3 className="rs-panel-title"><FolderSearch size={14} aria-hidden /> {t('research.panel_title')}</h3>
      <ul className="rs-panel-list">
        {q.data.map((p) => (
          <li key={p.id}>
            <Link to="/$tree/research/$project" params={{ tree, project: p.id }}>{p.title}</Link>
            {p.private ? <span className="rs-private" title={t('research.private_hint')}><Lock size={12} aria-hidden /></span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
