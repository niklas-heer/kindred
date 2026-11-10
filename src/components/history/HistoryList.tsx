// The rows of the change history, as the History page and a person's History section show them: who did what, when, and
// for a change the fields before and after. An editor can put a person's own fact back from a row (history.functions.ts
// restoreHistoryValue), which is a save like any other and comes back as a row of its own.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { fieldName, lineText, valueText } from '~/lib/history-text';
import { restoreHistoryValue } from '~/lib/history.functions';
import type { HistoryFieldChange, HistoryItem, RestorableField } from '~/lib/history';
import { formatDate, relativeTime, useT, type Translator } from '~/lib/i18n';
import './history.css';

/** One value as the row shows it: what it was, or why it is not shown. */
function Value({ t, f, side }: { t: Translator; f: HistoryFieldChange; side: 'before' | 'after' }) {
  if (f.hidden) return <span className="hist-muted">{t('history.hidden')}</span>;
  const v = f[side];
  if (v === null || v === '') return <span className="hist-muted">{t('history.empty_value')}</span>;
  return <span className="hist-value">{valueText(t, f.name, v)}</span>;
}

function Fields({ item, tree, canRestore }: { item: HistoryItem; tree: string; canRestore: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const keys = useRef(opKeys());
  const [done, setDone] = useState<string | null>(null);
  const restore = useMutation({
    mutationFn: (field: RestorableField) => restoreHistoryValue({ data: { tree, id: item.id, field, opKey: keys.current.for(`restore-${item.id}-${field}`, field) } }),
    onSuccess: async (_r, field) => {
      setDone(field);
      keys.current.clear();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['graph', tree] }),
        qc.invalidateQueries({ queryKey: ['person', tree] }),
        qc.invalidateQueries({ queryKey: ['history', tree] }),
      ]);
    },
  });
  const shown = item.fields;
  if (!shown.length) return null;
  return (
    <>
    <dl className="hist-fields" aria-label={t('history.changes')}>
      {shown.map((f) => (
        <div key={f.name} className="hist-field">
          <dt>{fieldName(t, f.name)}</dt>
          <dd>
            {f.opaque ? <span className="hist-muted">{t('history.not_kept')}</span> : (
              <>
                <del><Value t={t} f={f} side="before" /></del>
                <span aria-hidden className="hist-arrow">→</span>
                <ins><Value t={t} f={f} side="after" /></ins>
                {f.truncated && <small className="hist-muted"> ({t('history.shortened')})</small>}
              </>
            )}
            {canRestore && item.restorable.includes(f.name) && (
              <button
                type="button" className="btn ghost sm hist-restore" disabled={restore.isPending}
                title={t('history.restore_label', { field: fieldName(t, f.name), value: valueText(t, f.name, f.before) })}
                aria-label={t('history.restore_label', { field: fieldName(t, f.name), value: valueText(t, f.name, f.before) })}
                onClick={() => restore.mutate(f.name as RestorableField)}
              >
                <RotateCcw size={14} aria-hidden /> {t('history.restore')}
              </button>
            )}
          </dd>
        </div>
      ))}
    </dl>
    {/* Outside the list: a definition list may hold only its terms and values. */}
    {done && <p className="hist-ok" role="status">{t('history.restored')}</p>}
    {restore.isError && <p className="hist-error" role="alert">{errorText(restore.error, t.locale)}</p>}
    </>
  );
}

/** A list of history rows, newest first. `showPerson` names the person each row is about (the family-wide page). */
export function HistoryList({ tree, items, showPerson = true, canRestore = false }: { tree: string; items: HistoryItem[]; showPerson?: boolean; canRestore?: boolean }) {
  const t = useT();
  return (
    <ol className="hist-list">
      {items.map((item) => (
        <li key={item.id} className="hist-item">
          <div className="hist-line">
            <span className="hist-text">
              {lineText(t, { ...item, author: item.byMe ? t('history.you') : item.author })}
              {item.label && item.kind !== 'person' && <span className="hist-label"> · {item.label}</span>}
            </span>
            <time className="hist-when" dateTime={item.at} title={formatDate(item.at, t.locale, { dateStyle: 'medium', timeStyle: 'short' })}>
              {relativeTime(Date.parse(item.at), t.locale)}
            </time>
          </div>
          {showPerson && item.person && (
            <div className="hist-person">
              {item.action === 'removed' && item.kind === 'person'
                ? <span>{item.personName}</span>
                : <Link to="/$tree/person/$id" params={{ tree, id: item.person }}>{item.personName ?? item.person}</Link>}
            </div>
          )}
          <Fields item={item} tree={tree} canRestore={canRestore} />
        </li>
      ))}
    </ol>
  );
}
