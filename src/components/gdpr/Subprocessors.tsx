// Who this server passes personal data to (src/lib/gdpr/subprocessors.ts): on the legal page and in the operator's Privacy tab.
import { useT, type Key } from '~/lib/i18n';
import type { Subprocessor } from '~/lib/operator/shared';
import './gdpr.css';

export function SubprocessorList({ list }: { list: Subprocessor[] }) {
  const t = useT();
  if (!list.length) return <p className="muted">{t('gdpr.no_subprocessors')}</p>;
  return (
    <ul className="gdpr-subs">
      {list.map((s) => (
        <li key={s.id}>{s.url ? <a href={s.url} rel="noopener noreferrer">{s.name}</a> : s.name} · {t(`gdpr.sub_${s.purpose}` as Key)} · <span className="muted">{s.where === 'global' ? t('gdpr.where_global') : s.where}</span></li>
      ))}
    </ul>
  );
}
